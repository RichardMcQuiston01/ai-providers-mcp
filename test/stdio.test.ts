import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const REPO_ROOT: string = fileURLToPath(new URL('..', import.meta.url));
const FAKE_KEY: string = 'not-a-real-key-for-tests';

/** Starts the real entry point over stdio with a fake key. No network is used. */
async function startRealServer(env: Record<string, string>): Promise<{
  client: Client;
  transport: StdioClientTransport;
}> {
  const transport: StdioClientTransport = new StdioClientTransport({
    command: 'bun',
    args: ['src/index.ts'],
    cwd: REPO_ROOT,
    env,
    stderr: 'pipe',
  });
  const client: Client = new Client({ name: 'stdio-test', version: '0.0.0' });
  await client.connect(transport);
  return { client, transport };
}

test('the real entry point speaks MCP on stdout and logs only to stderr', async () => {
  const { client, transport } = await startRealServer({
    ANTHROPIC_API_KEY: FAKE_KEY,
  });
  let stderrText: string = '';
  transport.stderr?.on('data', (chunk: Buffer): void => {
    stderrText += chunk.toString();
  });
  try {
    // If anything non-protocol had reached stdout, connect() above would have failed.
    const result: CallToolResult = (await client.callTool({
      name: 'list_providers',
      arguments: {},
    })) as CallToolResult;
    assert.notEqual(result.isError, true);
    assert.match(JSON.stringify(result.structuredContent), /"claude"/);
  } finally {
    await client.close();
  }
  assert.match(stderrText, /text providers: claude/);
  assert.equal(stderrText.includes(FAKE_KEY), false);
});

test('a missing optional peer is a tool error naming the package, not a crash', async () => {
  const { client } = await startRealServer({ ANTHROPIC_API_KEY: FAKE_KEY });
  try {
    const result: CallToolResult = (await client.callTool({
      name: 'generate_text',
      arguments: { prompt: 'hello' },
    })) as CallToolResult;
    const first: CallToolResult['content'][number] | undefined =
      result.content[0];
    const message: string =
      first !== undefined && first.type === 'text' ? first.text : '';
    // Passes when the SDK peer is absent. With it installed the call would
    // reach the network, so this repo deliberately does not install it.
    assert.equal(result.isError, true);
    assert.match(message, /@anthropic-ai\/sdk/);
    assert.equal(message.includes(FAKE_KEY), false);
  } finally {
    await client.close();
  }
});

test('a bad configuration exits non-zero with a descriptive stderr message', async () => {
  const transport: StdioClientTransport = new StdioClientTransport({
    command: 'bun',
    args: ['src/index.ts'],
    cwd: REPO_ROOT,
    env: { AI_TEXT_PROVIDER: 'nope' },
    stderr: 'pipe',
  });
  let stderrText: string = '';
  transport.stderr?.on('data', (chunk: Buffer): void => {
    stderrText += chunk.toString();
  });
  const client: Client = new Client({ name: 'stdio-test', version: '0.0.0' });
  await assert.rejects(client.connect(transport));
  assert.match(stderrText, /unknown text provider "nope"/);
});
