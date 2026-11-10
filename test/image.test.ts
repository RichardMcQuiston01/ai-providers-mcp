import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  CallToolResult,
  ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js';
import {
  fromBase64,
  ok,
  toBase64,
  type AiImage,
  type ImageGenerator,
  type ImageRequest,
  type ImageResult,
  type Result,
} from '@richardmcquiston01/ai-providers';

import { parseConfig, type ServerConfig } from '../src/config.js';
import {
  createProviderRegistry,
  type ProviderRegistry,
} from '../src/providers.js';
import { createServer } from '../src/server.js';
import { FakeImageGenerator, FakeTextGenerator } from './fakes.js';

// A 1x1 PNG, the smallest real image the byte check accepts.
const TINY_PNG_BASE64: string =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const TINY_PNG: Uint8Array = fromBase64(TINY_PNG_BASE64) ?? new Uint8Array();

const ENV: Record<string, string> = { GEMINI_API_KEY: 'test-only-key' };

/** What the fake provider returns: PNG bytes, deliberately mislabelled as JPEG. */
const GENERATED: ImageResult = {
  image: { mimeType: 'image/jpeg', data: TINY_PNG },
  notes: 'Made by the fake.',
};

interface Harness {
  readonly client: Client;
  readonly image: FakeImageGenerator;
}

async function connect(
  env: Record<string, string>,
  makeImage: () => FakeImageGenerator
): Promise<Harness> {
  const parsed: Result<ServerConfig> = parseConfig(env);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  let latest: FakeImageGenerator = makeImage();
  const registry: Result<ProviderRegistry> = createProviderRegistry(
    parsed.value,
    (settings) => ok(new FakeTextGenerator(settings.provider)),
    (): Result<ImageGenerator> => {
      latest = makeImage();
      return ok(latest);
    }
  );
  if (!registry.ok) {
    throw new Error(registry.error);
  }
  const server: McpServer = createServer(parsed.value, registry.value);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client: Client = new Client({ name: 'image-test', version: '0.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return {
    client,
    get image(): FakeImageGenerator {
      return latest;
    },
  };
}

function working(modes: readonly string[] = []): () => FakeImageGenerator {
  return (): FakeImageGenerator =>
    new FakeImageGenerator(
      'gemini',
      'fake-image-model',
      GENERATED,
      null,
      modes
    );
}

function firstText(result: CallToolResult): string {
  for (const block of result.content) {
    if (block.type === 'text') {
      return block.text;
    }
  }
  return '';
}

async function call(
  client: Client,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  return (await client.callTool({
    name: 'generate_image',
    arguments: args,
  })) as CallToolResult;
}

test('generate_image is listed next to the other tools', async () => {
  const { client } = await connect(ENV, working());
  const listed: ListToolsResult = await client.listTools();
  assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [
    'generate_image',
    'generate_text',
    'list_providers',
  ]);
});

test('returns an image block whose type comes from the bytes, not the provider', async () => {
  const harness: Harness = await connect(ENV, working());
  const result: CallToolResult = await call(harness.client, {
    prompt: 'a red square',
    instructions: 'flat colours',
  });
  assert.notEqual(result.isError, true);
  const block: CallToolResult['content'][number] | undefined =
    result.content.find((item) => item.type === 'image');
  assert.ok(block && block.type === 'image');
  assert.equal(block.mimeType, 'image/png');
  assert.deepEqual(fromBase64(block.data), TINY_PNG);
  assert.match(
    firstText(result),
    /Generated image\/png image, \d+ bytes\. Made by the fake\./
  );
  assert.deepEqual(result.structuredContent, {
    mimeType: 'image/png',
    bytes: TINY_PNG.byteLength,
    notes: 'Made by the fake.',
  });
  // The pixels appear once, in the image block, not again as structured content.
  assert.equal(
    JSON.stringify(result.structuredContent).includes(toBase64(TINY_PNG)),
    false
  );
  const request: ImageRequest | undefined = harness.image.requests[0];
  assert.equal(request?.prompt, 'a red square');
  assert.equal(request?.instructions, 'flat colours');
  assert.equal(request?.mode, null);
  assert.deepEqual(request?.images, []);
});

test('client images are decoded by their bytes and passed on', async () => {
  const harness: Harness = await connect(ENV, working());
  const result: CallToolResult = await call(harness.client, {
    prompt: 'make it blue',
    images: [{ mimeType: 'image/jpeg', data: TINY_PNG_BASE64 }],
  });
  assert.notEqual(result.isError, true);
  const sent: AiImage | undefined = harness.image.requests[0]?.images[0];
  assert.equal(sent?.mimeType, 'image/png');
  assert.deepEqual(sent?.data, TINY_PNG);
});

test('mode: a listed mode is passed through, anything else lists the valid ones', async () => {
  const harness: Harness = await connect(ENV, working(['model-a', 'model-b']));
  const good: CallToolResult = await call(harness.client, {
    prompt: 'x',
    mode: 'model-b',
  });
  assert.notEqual(good.isError, true);
  assert.equal(harness.image.requests[0]?.mode, 'model-b');

  const bad: CallToolResult = await call(harness.client, {
    prompt: 'x',
    mode: '../../etc/passwd',
  });
  assert.equal(bad.isError, true);
  assert.match(
    firstText(bad),
    /Mode "..\/..\/etc\/passwd" is not available for gemini.*Available modes: model-a, model-b\./
  );
  // The registry builds a fresh generator per call; the rejected one never generated.
  assert.equal(harness.image.requests.length, 0);
});

test('a mode for a provider with no modes is refused', async () => {
  const harness: Harness = await connect(ENV, working([]));
  const result: CallToolResult = await call(harness.client, {
    prompt: 'x',
    mode: 'anything',
  });
  assert.equal(result.isError, true);
  assert.match(firstText(result), /has no selectable modes/);
  assert.equal(harness.image.requests.length, 0);
});

test('a provider failure comes back as isError with the provider message', async () => {
  const { client } = await connect(
    ENV,
    () =>
      new FakeImageGenerator(
        'gemini',
        'fake-image-model',
        null,
        'gemini (fake-image-model): HTTP 429 quota exceeded'
      )
  );
  const result: CallToolResult = await call(client, { prompt: 'x' });
  assert.equal(result.isError, true);
  assert.match(firstText(result), /HTTP 429 quota exceeded/);
});

test('a provider that throws is caught and reported', async () => {
  class Throwing extends FakeImageGenerator {
    public override async generateImage(): Promise<never> {
      throw new Error('socket exploded');
    }
  }
  const { client } = await connect(
    ENV,
    () => new Throwing('gemini', 'fake-image-model')
  );
  const result: CallToolResult = await call(client, { prompt: 'x' });
  assert.equal(result.isError, true);
  assert.match(
    firstText(result),
    /gemini \(fake-image-model\) failed unexpectedly: socket exploded/
  );
});

test('an output over the size cap is refused with the setting to change', async () => {
  const { client } = await connect(
    { ...ENV, AI_MAX_OUTPUT_IMAGE_BYTES: '10' },
    working()
  );
  const result: CallToolResult = await call(client, { prompt: 'x' });
  assert.equal(result.isError, true);
  assert.match(
    firstText(result),
    /over the 10 byte output limit.*AI_MAX_OUTPUT_IMAGE_BYTES/
  );
});

test('provider output that is not an image is refused', async () => {
  const { client } = await connect(
    ENV,
    () =>
      new FakeImageGenerator('gemini', 'fake-image-model', {
        image: {
          mimeType: 'image/png',
          data: new TextEncoder().encode('<svg/>'),
        },
        notes: null,
      })
  );
  const result: CallToolResult = await call(client, { prompt: 'x' });
  assert.equal(result.isError, true);
  assert.match(firstText(result), /isn't a PNG, JPEG or WebP image/);
});

test('only configured image providers can be chosen', async () => {
  const { client } = await connect(ENV, working());
  const result: CallToolResult = await call(client, {
    prompt: 'x',
    provider: 'openai',
  });
  assert.equal(result.isError, true);
  assert.match(
    firstText(result),
    /image provider "openai" is not configured.*gemini/
  );
});

test('with no image provider configured the error says so', async () => {
  const { client } = await connect(
    { ANTHROPIC_API_KEY: 'test-only-key' },
    working()
  );
  const result: CallToolResult = await call(client, { prompt: 'x' });
  assert.equal(result.isError, true);
  assert.match(firstText(result), /No image provider is configured/);
});

test('invalid input never reaches the provider: empty, too many images, oversize, not an image', async () => {
  const harness: Harness = await connect(
    { ...ENV, AI_MAX_IMAGES: '1', AI_MAX_IMAGE_BYTES: '16' },
    working()
  );
  const calls: Record<string, unknown>[] = [
    { prompt: '' },
    {
      prompt: 'x',
      images: [
        { mimeType: 'image/png', data: 'AAAA' },
        { mimeType: 'image/png', data: 'AAAA' },
      ],
    },
    { prompt: 'x', images: [{ mimeType: 'image/png', data: TINY_PNG_BASE64 }] },
    {
      prompt: 'x',
      images: [
        {
          mimeType: 'image/png',
          data: toBase64(new TextEncoder().encode('<svg onload=1>')),
        },
      ],
    },
  ];
  for (const args of calls) {
    const result: CallToolResult = await call(harness.client, args);
    assert.equal(result.isError, true, JSON.stringify(args).slice(0, 60));
  }
  assert.equal(harness.image.requests.length, 0);
});
