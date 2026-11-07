import assert from 'node:assert/strict';
import {
  chmod,
  mkdtemp,
  readdir,
  readFile,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { platform, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import type { Result } from '@richardmcquiston01/ai-providers';

import {
  resolveAuthToken,
  tokensMatch,
  type ResolvedToken,
} from '../src/transports/token.js';

async function freshPath(): Promise<string> {
  const directory: string = await mkdtemp(join(tmpdir(), 'aipmcp-token-'));
  return join(directory, 'nested', 'token');
}

test('MCP_AUTH_TOKEN wins and nothing is written', async () => {
  const path: string = await freshPath();
  const result: Result<ResolvedToken> = await resolveAuthToken({
    authToken: 'e'.repeat(30),
    tokenFilePath: path,
  });
  assert.equal(result.ok && result.value.source, 'environment');
  await assert.rejects(stat(path));
});

test('first run generates a strong token in a 0600 file, and later runs reuse it', async () => {
  const path: string = await freshPath();
  const first: Result<ResolvedToken> = await resolveAuthToken({
    authToken: null,
    tokenFilePath: path,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.value.source, 'generated');
  assert.ok(first.value.token.length >= 43);
  if (platform() !== 'win32') {
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  }
  assert.equal((await readFile(path, 'utf8')).trim(), first.value.token);

  const second: Result<ResolvedToken> = await resolveAuthToken({
    authToken: null,
    tokenFilePath: path,
  });
  assert.equal(second.ok && second.value.source, 'file');
  assert.equal(second.ok && second.value.token, first.value.token);
});

test('a token file other users can read is refused with the fix', async () => {
  const path: string = await freshPath();
  await resolveAuthToken({ authToken: null, tokenFilePath: path });
  await chmod(path, 0o644);
  const result: Result<ResolvedToken> = await resolveAuthToken({
    authToken: null,
    tokenFilePath: path,
  });
  assert.equal(result.ok, false);
  assert.match(
    result.ok ? '' : result.error,
    /readable by other users.*chmod 600/
  );
});

test('a malformed token file is refused without echoing its contents', async () => {
  const path: string = await freshPath();
  await resolveAuthToken({ authToken: null, tokenFilePath: path });
  await writeFile(path, 'short secret\n', { mode: 0o600 });
  const result: Result<ResolvedToken> = await resolveAuthToken({
    authToken: null,
    tokenFilePath: path,
  });
  assert.equal(result.ok, false);
  assert.equal((result.ok ? '' : result.error).includes('short secret'), false);
});

test('tokensMatch is exact', () => {
  assert.equal(tokensMatch('abc', 'abc'), true);
  assert.equal(tokensMatch('abc', 'abd'), false);
  assert.equal(tokensMatch('abc', 'abcd'), false);
  assert.equal(tokensMatch('', 'abc'), false);
});

test('a symlinked token path is refused, not followed', async () => {
  if (platform() === 'win32') return;
  const path: string = await freshPath();
  await resolveAuthToken({ authToken: null, tokenFilePath: path });
  const target: string = `${path}.target`;
  await writeFile(target, `${'z'.repeat(40)}\n`, { mode: 0o600 });
  const linked: string = `${path}.link`;
  await symlink(target, linked);
  const result: Result<ResolvedToken> = await resolveAuthToken({
    authToken: null,
    tokenFilePath: linked,
  });
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.error, /not a regular file/);
});

test('simultaneous first starts agree on one token and leave no temp files', async () => {
  const path: string = await freshPath();
  const results: Result<ResolvedToken>[] = await Promise.all(
    Array.from({ length: 8 }, (): Promise<Result<ResolvedToken>> =>
      resolveAuthToken({ authToken: null, tokenFilePath: path })
    )
  );
  const tokens: Set<string> = new Set();
  for (const result of results) {
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    if (result.ok) tokens.add(result.value.token);
  }
  assert.equal(tokens.size, 1);
  assert.deepEqual(await readdir(dirname(path)), ['token']);
});
