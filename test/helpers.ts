import { ok, type Result } from '@richardmcquiston01/ai-providers';

import { parseConfig, type ServerConfig } from '../src/config.js';
import {
  createProviderRegistry,
  type ProviderRegistry,
} from '../src/providers.js';
import { FakeImageGenerator, FakeTextGenerator } from './fakes.js';

export interface FakeSetup {
  readonly config: ServerConfig;
  readonly registry: ProviderRegistry;
}

/** Config plus a registry of fake generators. No network, no real SDKs. */
export function fakeSetup(env: Record<string, string>): FakeSetup {
  const parsed: Result<ServerConfig> = parseConfig(env);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  const registry: Result<ProviderRegistry> = createProviderRegistry(
    parsed.value,
    (settings) =>
      ok(
        new FakeTextGenerator(
          settings.provider,
          'fake-model',
          'hello over http'
        )
      ),
    (settings) => ok(new FakeImageGenerator(settings.provider))
  );
  if (!registry.ok) {
    throw new Error(registry.error);
  }
  return { config: parsed.value, registry: registry.value };
}
