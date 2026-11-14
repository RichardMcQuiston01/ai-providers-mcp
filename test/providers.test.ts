import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createTextGenerator,
  type TextProviderConfig,
} from '@richardmcquiston01/ai-providers/providers';
import type {
  TextGenerator,
  TextResult,
} from '@richardmcquiston01/ai-providers';

import { parseConfig, type ServerConfig } from '../src/config.js';
import {
  createProviderRegistry,
  type ProviderRegistry,
  type ProviderSummary,
} from '../src/providers.js';
import { err, ok, type Result } from '../src/result.js';
import { FakeImageGenerator, FakeTextGenerator } from './fakes.js';

function configFor(env: Record<string, string>): ServerConfig {
  const parsed: Result<ServerConfig> = parseConfig(env);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.value;
}

function fakeRegistry(env: Record<string, string>): {
  registry: ProviderRegistry;
  seen: TextProviderConfig[];
} {
  const seen: TextProviderConfig[] = [];
  const created: Result<ProviderRegistry> = createProviderRegistry(
    configFor(env),
    (settings: TextProviderConfig): Result<TextGenerator> => {
      seen.push(settings);
      const model: string =
        'model' in settings ? (settings.model ?? 'default') : 'default';
      return ok(new FakeTextGenerator(settings.provider, model));
    },
    (settings): Result<FakeImageGenerator> =>
      ok(new FakeImageGenerator(settings.provider))
  );
  if (!created.ok) {
    throw new Error(created.error);
  }
  return { registry: created.value, seen };
}

test('registry lists configured providers and marks the default', () => {
  const { registry } = fakeRegistry({ ANTHROPIC_API_KEY: 'k' });
  const listed: readonly ProviderSummary[] = registry.listProviders();
  assert.equal(listed.length, 1);
  assert.deepEqual(listed[0], {
    name: 'claude',
    kind: 'text',
    model: 'claude-sonnet-5-5',
    isDefault: true,
  });
});

test('a client cannot pick a provider the operator did not configure', () => {
  const { registry } = fakeRegistry({ ANTHROPIC_API_KEY: 'k' });
  const result: Result<TextGenerator> = registry.getTextGenerator('openai');
  assert.equal(result.ok, false);
  assert.match(
    result.ok ? '' : result.error,
    /"openai" is not configured.*Configured text providers: claude/
  );
});

test('a per-call model changes only the model, never the key', () => {
  const { registry, seen } = fakeRegistry({
    ANTHROPIC_API_KEY: 'operator-key',
  });
  const result: Result<TextGenerator> = registry.getTextGenerator(
    'claude',
    'claude-haiku-5-5'
  );
  assert.equal(result.ok, true);
  const last: TextProviderConfig | undefined = seen[seen.length - 1];
  assert.equal(
    last?.provider === 'claude' ? last.model : '',
    'claude-haiku-5-5'
  );
  assert.equal(last?.provider === 'claude' ? last.apiKey : '', 'operator-key');
});

test('a bad per-call model is rejected before any provider is built', () => {
  const { registry, seen } = fakeRegistry({ ANTHROPIC_API_KEY: 'k' });
  const before: number = seen.length;
  const result: Result<TextGenerator> = registry.getTextGenerator(
    undefined,
    'a b'
  );
  assert.equal(result.ok, false);
  assert.equal(seen.length, before);
});

test('no configured provider gives a descriptive error', () => {
  const { registry } = fakeRegistry({});
  const text: Result<TextGenerator> = registry.getTextGenerator();
  assert.equal(text.ok, false);
  assert.match(text.ok ? '' : text.error, /No text provider is configured/);
});

test('a provider that fails to build fails startup naming the provider', () => {
  const created: Result<ProviderRegistry> = createProviderRegistry(
    configFor({ ANTHROPIC_API_KEY: 'k' }),
    () => err('Claude needs the package @anthropic-ai/sdk.'),
    () => err('unused')
  );
  assert.equal(created.ok, false);
  assert.match(
    created.ok ? '' : created.error,
    /Text provider "claude" could not be created: Claude needs the package/
  );
});

test('real ai-providers: a missing optional peer is a Result, not a crash', async () => {
  const built: Result<TextGenerator> = createTextGenerator({
    provider: 'claude',
    apiKey: 'k',
  });
  if (!built.ok) {
    assert.match(built.error, /@anthropic-ai\/sdk/);
    return;
  }
  const generated: Result<TextResult> = await built.value.generateText({
    instructions: '',
    prompt: 'x',
  });
  assert.equal(generated.ok, false);
  assert.match(generated.ok ? '' : generated.error, /@anthropic-ai\/sdk/);
});
