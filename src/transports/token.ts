import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Stats } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  readFile,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { platform, userInfo } from 'node:os';
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

/** Reads and validates an existing token file. A missing file is `null`. */
async function readTokenFile(path: string): Promise<Result<string> | null> {
  try {
    // lstat: a symlink is refused rather than followed.
    const info: Stats = await lstat(path);
    if (!info.isFile()) {
      return err(
        `Token path ${path} is not a regular file (symlinks are refused). Remove it or set MCP_TOKEN_FILE.`
      );
    }
    if (platform() !== 'win32' && info.uid !== userInfo().uid) {
      return err(
        `Token file ${path} is owned by another user (uid ${info.uid}). Remove it or set MCP_TOKEN_FILE.`
      );
    }
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
    return ok(stored);
  } catch (caught: unknown) {
    if (isMissingFile(caught)) {
      return null;
    }
    return err(
      `Could not read the token file ${path}: ${describeUnknownError(caught)}`,
      caught
    );
  }
}

function isAlreadyExists(caught: unknown): boolean {
  return (
    typeof caught === 'object' &&
    caught !== null &&
    'code' in caught &&
    (caught as { code?: unknown }).code === 'EEXIST'
  );
}

/**
 * Writes a new token so it appears all at once: write a private temp file,
 * then hard-link it into place. link() fails if the path exists, so an
 * existing file is never replaced and a concurrent reader never sees a
 * half-written token.
 */
async function createTokenFile(
  path: string
): Promise<Result<string> | 'exists'> {
  const temporaryPath: string = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const token: string = generateToken();
    await writeFile(temporaryPath, `${token}\n`, { flag: 'wx', mode: 0o600 });
    await link(temporaryPath, path);
    return ok(token);
  } catch (caught: unknown) {
    if (isAlreadyExists(caught)) {
      return 'exists';
    }
    return err(
      `Could not store a new token at ${path}: ${describeUnknownError(caught)}. Set MCP_TOKEN_FILE to a writable path or MCP_AUTH_TOKEN.`,
      caught
    );
  } finally {
    await unlink(temporaryPath).catch((): void => undefined);
  }
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
  const existing: Result<string> | null = await readTokenFile(path);
  if (existing !== null) {
    return existing.ok
      ? ok({ token: existing.value, source: 'file', path })
      : existing;
  }
  const created: Result<string> | 'exists' = await createTokenFile(path);
  if (created === 'exists') {
    // Another instance won the race; use its token.
    const winner: Result<string> | null = await readTokenFile(path);
    if (winner === null) {
      return err(`Token file ${path} disappeared while starting. Try again.`);
    }
    return winner.ok
      ? ok({ token: winner.value, source: 'file', path })
      : winner;
  }
  return created.ok
    ? ok({ token: created.value, source: 'generated', path })
    : created;
}

/** Constant-time comparison; hashing first hides the length of the real token. */
export function tokensMatch(provided: string, expected: string): boolean {
  const providedDigest: Buffer = createHash('sha256').update(provided).digest();
  const expectedDigest: Buffer = createHash('sha256').update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}
