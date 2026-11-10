import {
  checkImageOutput,
  fromBase64,
  type AiImage,
} from '@richardmcquiston01/ai-providers';
import { z } from 'zod';

import type { ServerLimits } from '../config.js';
import { err, ok, type Result } from '../result.js';

/** One client-supplied image, as sent over MCP. */
export interface ImageInput {
  readonly mimeType: string;
  readonly data: string;
}

/** Longest base64 text that can decode to `maxBytes`. */
function maxBase64Length(maxBytes: number): number {
  return Math.ceil(maxBytes / 3) * 4;
}

/** Zod schema for the optional `images` argument, sized from the operator's limits. */
export function buildImagesSchema(
  limits: ServerLimits,
  description: string
): z.ZodOptional<
  z.ZodArray<z.ZodObject<{ mimeType: z.ZodString; data: z.ZodString }>>
> {
  return z
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
    .describe(description);
}

/** Decodes and checks client images: size, then real format from the bytes. */
export function decodeImages(
  images: readonly ImageInput[] | undefined,
  limits: ServerLimits
): Result<readonly AiImage[]> {
  const decoded: AiImage[] = [];
  const list: readonly ImageInput[] = images ?? [];
  for (let index: number = 0; index < list.length; index += 1) {
    const item: ImageInput | undefined = list[index];
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
export function withTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number
): AbortSignal {
  const timeout: AbortSignal = AbortSignal.timeout(timeoutMs);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}
