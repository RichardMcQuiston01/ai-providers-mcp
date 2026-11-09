import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  checkImageOutput,
  describeUnknownError,
  toBase64,
  type AiImage,
  type ImageGenerator,
  type ImageResult,
} from '@richardmcquiston01/ai-providers';
import { z } from 'zod';

import type { ServerLimits } from '../config.js';
import type { ProviderRegistry } from '../providers.js';
import { err, ok, type Result } from '../result.js';
import { buildImagesSchema, decodeImages, withTimeout } from './imageInput.js';
import { toolError } from './toolResult.js';

export const GENERATE_IMAGE_TOOL: string = 'generate_image';

/**
 * Zod shape built from the operator's limits. All tool input is untrusted.
 * The return type is inferred so the SDK can type the handler's arguments.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function buildGenerateImageShape(limits: ServerLimits) {
  return {
    prompt: z
      .string()
      .min(1, 'prompt must not be empty')
      .max(
        limits.maxPromptChars,
        `prompt must be at most ${limits.maxPromptChars} characters`
      )
      .describe('What to generate or how to edit the image(s).'),
    instructions: z
      .string()
      .max(
        limits.maxPromptChars,
        `instructions must be at most ${limits.maxPromptChars} characters`
      )
      .optional()
      .describe('Optional fixed rules that apply to every result.'),
    images: buildImagesSchema(
      limits,
      'Optional images to edit (first) and use as references (rest).'
    ),
    provider: z
      .string()
      .max(64)
      .optional()
      .describe(
        'A configured image provider name. Defaults to the server default. See list_providers.'
      ),
    mode: z
      .string()
      .max(200)
      .optional()
      .describe(
        'Optional provider mode (for Gemini and OpenAI, the image model). An unknown mode returns the valid ones.'
      ),
  };
}

/** The validated input of a generate_image call. */
export type GenerateImageInput = z.infer<
  z.ZodObject<ReturnType<typeof buildGenerateImageShape>>
>;

/**
 * A client may only choose among the modes the provider reports, so it can
 * never name an arbitrary workflow or model the operator did not offer.
 */
async function resolveMode(
  generator: ImageGenerator,
  mode: string | undefined
): Promise<Result<string | null>> {
  if (mode === undefined) {
    return ok(null);
  }
  const label: string = `${generator.provider} (${generator.model})`;
  const listed: Result<readonly string[]> = await generator.listModes();
  if (!listed.ok) {
    return err(`Could not list the modes for ${label}: ${listed.error}`);
  }
  if (listed.value.length === 0) {
    return err(
      `${label} has no selectable modes, but mode "${mode}" was requested. Leave mode out.`
    );
  }
  if (!listed.value.includes(mode)) {
    return err(
      `Mode "${mode}" is not available for ${label}. Available modes: ${listed.value.join(', ')}.`
    );
  }
  return ok(mode);
}

/** Checks the provider's output: real type from the bytes, within the size cap. */
function checkGeneratedImage(
  result: ImageResult,
  generator: ImageGenerator,
  limits: ServerLimits
): Result<AiImage> {
  const label: string = `${generator.provider} (${generator.model})`;
  const checked: Result<AiImage> = checkImageOutput(result.image.data, label);
  if (!checked.ok) {
    return checked;
  }
  if (checked.value.data.byteLength > limits.maxOutputImageBytes) {
    return err(
      `${label} returned an image of ${checked.value.data.byteLength} bytes, over the ${limits.maxOutputImageBytes} byte output limit. ` +
        'Ask for a smaller image, or raise AI_MAX_OUTPUT_IMAGE_BYTES on the server.'
    );
  }
  return checked;
}

/** The MCP result: the image as an image content block, plus a short text note. */
function imageResult(image: AiImage, notes: string | null): CallToolResult {
  const bytes: number = image.data.byteLength;
  const summary: string =
    `Generated ${image.mimeType} image, ${bytes} bytes.` +
    (notes === null ? '' : ` ${notes}`);
  return {
    content: [
      {
        type: 'image',
        data: toBase64(image.data),
        mimeType: image.mimeType,
      },
      { type: 'text', text: summary },
    ],
    // The pixels are only in the image block; repeating them here would double the payload.
    structuredContent: { mimeType: image.mimeType, bytes, notes },
  };
}

/**
 * Runs one image generation. Every failure, including a thrown exception
 * from a provider, comes back as an isError result with a descriptive message.
 */
export async function generateImageHandler(
  registry: ProviderRegistry,
  limits: ServerLimits,
  input: GenerateImageInput,
  signal?: AbortSignal
): Promise<CallToolResult> {
  const generator: Result<ImageGenerator> = registry.getImageGenerator(
    input.provider
  );
  if (!generator.ok) {
    return toolError(generator.error);
  }
  const label: string = `${generator.value.provider} (${generator.value.model})`;
  try {
    const images: Result<readonly AiImage[]> = decodeImages(
      input.images,
      limits
    );
    if (!images.ok) {
      return toolError(images.error);
    }
    const mode: Result<string | null> = await resolveMode(
      generator.value,
      input.mode
    );
    if (!mode.ok) {
      return toolError(mode.error);
    }
    const generated: Result<ImageResult> = await generator.value.generateImage({
      instructions: input.instructions ?? '',
      prompt: input.prompt,
      images: images.value,
      mode: mode.value,
      signal: withTimeout(signal, limits.timeoutMs),
    });
    if (!generated.ok) {
      return toolError(generated.error);
    }
    const checked: Result<AiImage> = checkGeneratedImage(
      generated.value,
      generator.value,
      limits
    );
    if (!checked.ok) {
      return toolError(checked.error);
    }
    return imageResult(checked.value, generated.value.notes);
  } catch (caught: unknown) {
    return toolError(
      `Generating an image with ${label} failed unexpectedly: ${describeUnknownError(caught)}`
    );
  }
}

export function registerGenerateImage(
  server: McpServer,
  registry: ProviderRegistry,
  limits: ServerLimits
): void {
  server.registerTool(
    GENERATE_IMAGE_TOOL,
    {
      title: 'Generate image',
      description:
        'Generates or edits an image with the configured AI provider. Optional instructions, input images, provider and mode. Returns the image (base64 image content with its MIME type), or an error naming the provider, model and reason.',
      inputSchema: buildGenerateImageShape(limits),
      outputSchema: {
        mimeType: z.string(),
        bytes: z.number(),
        notes: z.string().nullable(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (
      args: GenerateImageInput,
      extra: { signal: AbortSignal }
    ): Promise<CallToolResult> =>
      generateImageHandler(registry, limits, args, extra.signal)
  );
}
