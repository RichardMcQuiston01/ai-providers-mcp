import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  CallToolResult,
  ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js';
import {
  ok,
  toBase64,
  type ImageGenerator,
  type Result,
  type TextGenerator,
} from '@richardmcquiston01/ai-providers';

import {
  DEFAULT_LIMITS,
  parseConfig,
  type ServerConfig,
} from '../src/config.js';
import {
  createProviderRegistry,
  type ProviderRegistry,
} from '../src/providers.js';
import { createServer, SERVER_VERSION } from '../src/server.js';
import { FakeImageGenerator, FakeTextGenerator } from './fakes.js';

// A 1x1 PNG, the smallest real image the format check accepts.
const TINY_PNG_BASE64: string =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

interface Harness {
  readonly client: Client;
  readonly text: FakeTextGenerator;
}

async function connect(
  env: Record<string, string>,
  makeText: (provider: string, model: string) => FakeTextGenerator
): Promise<Harness> {
  const parsed: Result<ServerConfig> = parseConfig(env);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  let latest: FakeTextGenerator = makeText('claude', 'claude-sonnet-5-5');
  const registry: Result<ProviderRegistry> = createProviderRegistry(
    parsed.value,
    (settings): Result<TextGenerator> => {
      const model: string =
        'model' in settings && settings.model ? settings.model : 'default';
      latest = makeText(settings.provider, model);
      return ok(latest);
    },
    (settings): Result<ImageGenerator> =>
      ok(new FakeImageGenerator(settings.provider))
  );
  if (!registry.ok) {
    throw new Error(registry.error);
  }
  const server: McpServer = createServer(parsed.value, registry.value);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client: Client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return {
    client,
    get text(): FakeTextGenerator {
      return latest;
    },
  };
}

function firstText(result: CallToolResult): string {
  const first: CallToolResult['content'][number] | undefined =
    result.content[0];
  return first !== undefined && first.type === 'text' ? first.text : '';
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}

const ENV: Record<string, string> = { ANTHROPIC_API_KEY: 'test-only-key' };

test('the server exposes list_providers, generate_text and generate_image', async () => {
  const { client } = await connect(ENV, (p, m) => new FakeTextGenerator(p, m));
  const listed: ListToolsResult = await client.listTools();
  assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [
    'generate_image',
    'generate_text',
    'list_providers',
  ]);
});

test('list_providers reports providers and never a key', async () => {
  const { client } = await connect(ENV, (p, m) => new FakeTextGenerator(p, m));
  const result: CallToolResult = await call(client, 'list_providers', {});
  assert.notEqual(result.isError, true);
  assert.equal(firstText(result).includes('test-only-key'), false);
  assert.deepEqual(result.structuredContent, {
    providers: [
      {
        name: 'claude',
        kind: 'text',
        model: 'claude-sonnet-5-5',
        isDefault: true,
      },
    ],
  });
});

test('generate_text returns { text } and passes instructions through', async () => {
  const harness: Harness = await connect(
    ENV,
    (p, m) => new FakeTextGenerator(p, m, 'hello world')
  );
  const result: CallToolResult = await call(harness.client, 'generate_text', {
    prompt: 'say hi',
    instructions: 'be brief',
  });
  assert.notEqual(result.isError, true);
  assert.deepEqual(result.structuredContent, { text: 'hello world' });
  assert.equal(harness.text.requests[0]?.instructions, 'be brief');
  assert.equal(harness.text.requests[0]?.prompt, 'say hi');
});

test('a provider failure comes back as isError with the provider message', async () => {
  const { client } = await connect(
    ENV,
    (p, m) =>
      new FakeTextGenerator(
        p,
        m,
        '',
        'claude (claude-sonnet-5-5): HTTP 429 rate limited'
      )
  );
  const result: CallToolResult = await call(client, 'generate_text', {
    prompt: 'x',
  });
  assert.equal(result.isError, true);
  assert.match(firstText(result), /HTTP 429 rate limited/);
});

test('a provider that throws is caught and reported, not propagated', async () => {
  class ThrowingGenerator extends FakeTextGenerator {
    public override async generateText(): Promise<never> {
      throw new Error('socket exploded');
    }
  }
  const { client } = await connect(ENV, (p, m) => new ThrowingGenerator(p, m));
  const result: CallToolResult = await call(client, 'generate_text', {
    prompt: 'x',
  });
  assert.equal(result.isError, true);
  assert.match(
    firstText(result),
    /claude.*failed unexpectedly: socket exploded/
  );
});

test('an unconfigured provider is refused and the configured ones are listed', async () => {
  const { client } = await connect(ENV, (p, m) => new FakeTextGenerator(p, m));
  const result: CallToolResult = await call(client, 'generate_text', {
    prompt: 'x',
    provider: 'openai',
  });
  assert.equal(result.isError, true);
  assert.match(firstText(result), /"openai" is not configured.*claude/);
});

test('invalid input is rejected as an error result: empty, oversize, too many images', async () => {
  const { client } = await connect(
    { ...ENV, AI_MAX_PROMPT_CHARS: '10', AI_MAX_IMAGES: '1' },
    (p, m) => new FakeTextGenerator(p, m)
  );
  const empty: CallToolResult = await call(client, 'generate_text', {
    prompt: '',
  });
  assert.equal(empty.isError, true);
  assert.match(firstText(empty), /prompt must not be empty/);

  const oversize: CallToolResult = await call(client, 'generate_text', {
    prompt: 'x'.repeat(11),
  });
  assert.equal(oversize.isError, true);
  assert.match(firstText(oversize), /at most 10 characters/);

  const image: { mimeType: string; data: string } = {
    mimeType: 'image/png',
    data: TINY_PNG_BASE64,
  };
  const tooMany: CallToolResult = await call(client, 'generate_text', {
    prompt: 'x',
    images: [image, image],
  });
  assert.equal(tooMany.isError, true);
  assert.match(firstText(tooMany), /at most 1 images/);
});

test('images are checked by their bytes, not the declared type', async () => {
  const harness: Harness = await connect(
    ENV,
    (p, m) => new FakeTextGenerator(p, m)
  );
  const notAnImage: CallToolResult = await call(
    harness.client,
    'generate_text',
    {
      prompt: 'x',
      images: [
        {
          mimeType: 'image/png',
          data: toBase64(new TextEncoder().encode('<svg onload=alert(1)>')),
        },
      ],
    }
  );
  assert.equal(notAnImage.isError, true);
  assert.equal(harness.text.requests.length, 0);

  const valid: CallToolResult = await call(harness.client, 'generate_text', {
    prompt: 'x',
    images: [{ mimeType: 'image/png', data: TINY_PNG_BASE64 }],
  });
  assert.notEqual(valid.isError, true);
  assert.equal(harness.text.requests[0]?.images?.length, 1);
});

test('oversize image data is rejected before decoding', async () => {
  const { client } = await connect(
    { ...ENV, AI_MAX_IMAGE_BYTES: '16' },
    (p, m) => new FakeTextGenerator(p, m)
  );
  const result: CallToolResult = await call(client, 'generate_text', {
    prompt: 'x',
    images: [{ mimeType: 'image/png', data: TINY_PNG_BASE64 }],
  });
  assert.equal(result.isError, true);
  assert.match(firstText(result), /decode to at most 16 bytes/);
});

test('the default limits are the documented ones', () => {
  assert.equal(DEFAULT_LIMITS.maxImages, 4);
});

test('the MCP handshake reports the version from package.json', async () => {
  const pkg: { version: string } = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  ) as { version: string };
  assert.equal(SERVER_VERSION, pkg.version);
  const { client } = await connect(ENV, (p, m) => new FakeTextGenerator(p, m));
  assert.equal(client.getServerVersion()?.version, pkg.version);
});
