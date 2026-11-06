// The only file that builds concrete providers. Everything else uses the
// TextGenerator / ImageGenerator interfaces.
import type {
  ImageGenerator,
  TextGenerator,
} from '@richardmcquiston01/ai-providers';
import {
  createImageGenerator,
  createTextGenerator,
  type ImageProviderConfig,
  type TextProviderConfig,
} from '@richardmcquiston01/ai-providers/providers';

import {
  checkModelName,
  type ProviderSettings,
  type ServerConfig,
} from './config.js';
import { err, ok, type Result } from './result.js';

/** Builds a text generator from settings; injectable so tests need no SDKs. */
export type TextFactory = (config: TextProviderConfig) => Result<TextGenerator>;
export type ImageFactory = (
  config: ImageProviderConfig
) => Result<ImageGenerator>;

/** What `list_providers` reports for one provider. */
export interface ProviderSummary {
  readonly name: string;
  readonly kind: 'text' | 'image';
  readonly model: string;
  readonly isDefault: boolean;
}

export interface ProviderRegistry {
  /** Resolves a text generator; `provider` and `model` default to the operator's choice. */
  getTextGenerator(provider?: string, model?: string): Result<TextGenerator>;
  getImageGenerator(provider?: string): Result<ImageGenerator>;
  listProviders(): readonly ProviderSummary[];
}

function findSettings<T>(
  entries: readonly ProviderSettings<T>[],
  name: string
): ProviderSettings<T> | undefined {
  return entries.find((entry): boolean => entry.name === name);
}

function configuredLabel<T>(entries: readonly ProviderSettings<T>[]): string {
  return entries.length === 0
    ? 'none'
    : entries.map((entry): string => entry.name).join(', ');
}

/** Picks the requested (or default) entry, only from what the operator configured. */
function selectSettings<T>(
  kind: 'text' | 'image',
  entries: readonly ProviderSettings<T>[],
  defaultName: string | null,
  requested: string | undefined
): Result<ProviderSettings<T>> {
  const name: string | null =
    requested === undefined ? defaultName : requested.trim().toLowerCase();
  if (name === null || name.length === 0) {
    return err(
      `No ${kind} provider is configured. Set a provider API key or host in the server environment.`
    );
  }
  const found: ProviderSettings<T> | undefined = findSettings(entries, name);
  if (found === undefined) {
    return err(
      `The ${kind} provider "${name}" is not configured on this server. Configured ${kind} providers: ${configuredLabel(entries)}.`
    );
  }
  return ok(found);
}

/**
 * Builds the registry and the default generators up front, so a bad setting
 * fails at startup with the provider's own message instead of on first use.
 */
export function createProviderRegistry(
  config: ServerConfig,
  makeText: TextFactory = createTextGenerator,
  makeImage: ImageFactory = createImageGenerator
): Result<ProviderRegistry> {
  const summaries: ProviderSummary[] = [];

  for (const entry of config.textProviders) {
    const built: Result<TextGenerator> = makeText(entry.config);
    if (!built.ok) {
      return err(
        `Text provider "${entry.name}" could not be created: ${built.error}`,
        built.cause
      );
    }
    summaries.push({
      name: entry.name,
      kind: 'text',
      model: built.value.model,
      isDefault: entry.name === config.defaultTextProvider,
    });
  }
  for (const entry of config.imageProviders) {
    const built: Result<ImageGenerator> = makeImage(entry.config);
    if (!built.ok) {
      return err(
        `Image provider "${entry.name}" could not be created: ${built.error}`,
        built.cause
      );
    }
    summaries.push({
      name: entry.name,
      kind: 'image',
      model: built.value.model,
      isDefault: entry.name === config.defaultImageProvider,
    });
  }

  return ok({
    getTextGenerator(provider?: string, model?: string): Result<TextGenerator> {
      const selected: Result<ProviderSettings<TextProviderConfig>> =
        selectSettings(
          'text',
          config.textProviders,
          config.defaultTextProvider,
          provider
        );
      if (!selected.ok) return selected;
      let settings: TextProviderConfig = selected.value.config;
      if (model !== undefined) {
        const checkedModel: Result<string> = checkModelName(model, 'model');
        if (!checkedModel.ok) return checkedModel;
        // Only the model changes; keys and hosts always come from the operator.
        settings = { ...settings, model: checkedModel.value };
      }
      return makeText(settings);
    },
    getImageGenerator(provider?: string): Result<ImageGenerator> {
      const selected: Result<ProviderSettings<ImageProviderConfig>> =
        selectSettings(
          'image',
          config.imageProviders,
          config.defaultImageProvider,
          provider
        );
      if (!selected.ok) return selected;
      return makeImage(selected.value.config);
    },
    listProviders(): readonly ProviderSummary[] {
      return summaries;
    },
  });
}
