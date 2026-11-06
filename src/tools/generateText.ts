import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  checkImageOutput,
  describeUnknownError,
  fromBase64,
  type AiImage,
  type TextGenerator,
  type TextResult,
} from '@richardmcquiston01/ai-providers';
import { z } from 'zod';

import type { ServerLimits } from '../config.js';
import type { ProviderRegistry } from '../providers.js';
import { err, ok, type Result } from '../result.js';
import { toolError, toolText } from './toolResult.js';

export const GENERATE_TEXT_TOOL: string = 'generate_text';

/** Longest base64 text that can decode to `maxBytes`. */
function maxBase64Length(maxBytes: number): number {
  return Math.ceil(maxBytes / 3) * 4;
}

/**
 * Zod shape built from the operator's limits. All tool input is untrusted.
 * The return type is inferred so the SDK can type the handler's arguments.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function buildGenerateTextShape(limits: ServerLimits) {
  return {
    prompt: z
      .string()
      .min(1, 'prompt must not be empty')
      .max(
        limits.maxPromptChars,
        `prompt must be at most ${limits.maxPromptChars} characters`
      )
      .describe('The text to send to the model.'),
    instructions: z
      .string()
      .max(
        limits.maxPromptChars,
        `instructions must be at most ${limits.maxPromptChars} characters`
      )
      .optional()
      .describe('Optional fixed rules, sent as the system prompt.'),
    provider: z
      .string()
      .max(64)
      .optional()
      .describe(
        'A configured provider name. Defaults to the server default. See list_providers.'
      ),
    model: z
      .string()
      .max(200)
      .optional()
      .describe('Optional model name for the chosen provider.'),
    images: z
      .array(
        z.object({
          mimeType: z
            .string()
            .max(100)
            .describe('Declared type; the bytes are checked, not this value.'),
          data: z
            .string()
            .max(
              maxBase64Length(limits.maxImageBytes),
              `image data must decode to at most ${limits.maxImageBytes} bytes`
            )
            .describe('Base64 image bytes (PNG, JPEG or WebP).'),
        })
      )
      .max(limits.maxImages, `at most ${limits.maxImages} images are allowed`)
      .optional()
      .describe('Optional images for vision models.'),
  };
}

/** The validated input of a generate_text call. */
export type GenerateTextInput = z.infer<
  z.ZodObject<ReturnType<typeof buildGenerateTextShape>>
>;

/** Decodes and checks client images: size, then real format from the bytes. */
export function decodeImages(
  images: GenerateTextInput['images'],
  limits: ServerLimits
): Result<readonly AiImage[]> {
  const decoded: AiImage[] = [];
  const list: readonly { mimeType: string; data: string }[] = images ?? [];
  for (let index: number = 0; index < list.length; index += 1) {
    const item: { mimeType: string; data: string } | undefined = list[index];
    if (item === undefined) {
      continue;
    }
    const label: string = `Image ${index + 1}`;
    const bytes: Uint8Array | null = fromBase64(item.data);
    if (bytes === null) {
      return err(`${label}: data is not valid base64.`);
    }
    if (bytes.byteLength > limits.maxImageBytes) {
      return err(
        `${label}: ${bytes.byteLength} bytes is over the ${limits.maxImageBytes} byte limit.`
      );
    }
    // The declared mimeType is never trusted: the real type comes from the bytes.
    const checked: Result<AiImage> = checkImageOutput(bytes, label);
    if (!checked.ok) {
      return err(`${label}: data is not a PNG, JPEG or WebP image.`);
    }
    decoded.push(checked.value);
  }
  return ok(decoded);
}

/** Combines the client's cancellation with the server timeout. */
function withTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number
): AbortSignal {
  const timeout: AbortSignal = AbortSignal.timeout(timeoutMs);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

/**
 * Runs one generation. Every failure, including a thrown exception from a
 * provider, comes back as an isError result with a descriptive message.
 */
export async function generateTextHandler(
  registry: ProviderRegistry,
  limits: ServerLimits,
  input: GenerateTextInput,
  signal?: AbortSignal
): Promise<CallToolResult> {
  const generator: Result<TextGenerator> = registry.getTextGenerator(
    input.provider,
    input.model
  );
  if (!generator.ok) {
    return toolError(generator.error);
  }
  const images: Result<readonly AiImage[]> = decodeImages(input.images, limits);
  if (!images.ok) {
    return toolError(images.error);
  }
  const label: string = `${generator.value.provider} (${generator.value.model})`;
  try {
    const generated: Result<TextResult> = await generator.value.generateText({
      instructions: input.instructions ?? '',
      prompt: input.prompt,
      ...(images.value.length > 0 ? { images: images.value } : {}),
      signal: withTimeout(signal, limits.timeoutMs),
    });
    if (!generated.ok) {
      return toolError(generated.error);
    }
    return toolText(generated.value.text);
  } catch (caught: unknown) {
    return toolError(
      `Generating text with ${label} failed unexpectedly: ${describeUnknownError(caught)}`
    );
  }
}

export function registerGenerateText(
  server: McpServer,
  registry: ProviderRegistry,
  limits: ServerLimits
): void {
  server.registerTool(
    GENERATE_TEXT_TOOL,
    {
      title: 'Generate text',
      description:
        'Generates text with the configured AI provider. Optional instructions, provider, model and images. Returns { text }, or an error naming the provider, model and reason.',
      inputSchema: buildGenerateTextShape(limits),
      outputSchema: { text: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (
      args: GenerateTextInput,
      extra: { signal: AbortSignal }
    ): Promise<CallToolResult> =>
      generateTextHandler(registry, limits, args, extra.signal)
  );
}
