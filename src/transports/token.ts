import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Stats } from 'node:fs';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { platform } from 'node:os';
import { dirname } from 'node:path';

import { describeUnknownError } from '@richardmcquiston01/ai-providers';

import { MIN_AUTH_TOKEN_LENGTH, type HttpConfig } from '../config.js';
import { err, ok, type Result } from '../result.js';

export type TokenSource = 'environment' | 'file' | 'generated';

/** The bearer token and where it came from. Never log `token`. */
export interface ResolvedToken {
  readonly token: string;
  readonly source: TokenSource;
  readonly path: string | null;
}

/** 32 random bytes as base64url: 43 characters, far above the minimum. */
function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

function isMissingFile(caught: unknown): boolean {
  return (
    typeof caught === 'object' &&
    caught !== null &&
    'code' in caught &&
    (caught as { code?: unknown }).code === 'ENOENT'
  );
}

/** A token file readable by group or others is refused (POSIX only). */
function isTooPermissive(mode: number): boolean {
  return platform() !== 'win32' && (mode & 0o077) !== 0;
}

/**
 * Finds the bearer token: MCP_AUTH_TOKEN, else the token file, else a new
 * random token written to that file with mode 0600. The token itself is
 * never printed; callers log only the path.
 */
export async function resolveAuthToken(
  http: Pick<HttpConfig, 'authToken' | 'tokenFilePath'>
): Promise<Result<ResolvedToken>> {
  if (http.authToken !== null) {
    return ok({ token: http.authToken, source: 'environment', path: null });
  }
  const path: string = http.tokenFilePath;
  try {
    const info: Stats = await stat(path);
    if (isTooPermissive(info.mode)) {
      return err(
        `Token file ${path} is readable by other users (mode ${(info.mode & 0o777).toString(8)}). Run: chmod 600 ${path}`
      );
    }
    const stored: string = (await readFile(path, 'utf8')).trim();
    if (stored.length < MIN_AUTH_TOKEN_LENGTH || /\s/.test(stored)) {
      return err(
        `Token file ${path} does not hold a valid token (needs ${MIN_AUTH_TOKEN_LENGTH}+ characters, no whitespace). Delete it to generate a new one.`
      );
    }
    return ok({ token: stored, source: 'file', path });
  } catch (caught: unknown) {
    if (!isMissingFile(caught)) {
      return err(
        `Could not read the token file ${path}: ${describeUnknownError(caught)}`,
        caught
      );
    }
  }
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const token: string = generateToken();
    // 'wx' fails if another process created the file first, so it is never overwritten.
    await writeFile(path, `${token}\n`, { flag: 'wx', mode: 0o600 });
    await chmod(path, 0o600);
    return ok({ token, source: 'generated', path });
  } catch (caught: unknown) {
    return err(
      `Could not store a new token at ${path}: ${describeUnknownError(caught)}. Set MCP_TOKEN_FILE to a writable path or MCP_AUTH_TOKEN.`,
      caught
    );
  }
}

/** Constant-time comparison; hashing first hides the length of the real token. */
export function tokensMatch(provided: string, expected: string): boolean {
  const providedDigest: Buffer = createHash('sha256').update(provided).digest();
  const expectedDigest: Buffer = createHash('sha256').update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}
