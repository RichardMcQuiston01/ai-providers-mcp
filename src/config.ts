// The ONLY file that reads process.env. Everything else gets a ServerConfig.
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  checkProviderHost,
  parseAllowedHosts,
} from '@richardmcquiston01/ai-providers';
import {
  IMAGE_PROVIDERS,
  TEXT_PROVIDERS,
  type ImageProviderConfig,
  type TextProviderConfig,
} from '@richardmcquiston01/ai-providers/providers';

import { err, ok, type Result } from './result.js';

/** A plain environment map; tests pass one in instead of touching process. */
export type EnvironmentMap = Readonly<Record<string, string | undefined>>;

/** Default Claude model for this server (cheaper than the ai-providers default). */
export const DEFAULT_CLAUDE_MODEL: string = 'claude-sonnet-5-5';
export const DEFAULT_CLAUDE_EFFORT: 'low' | 'medium' | 'high' = 'medium';

/** Abuse and cost limits applied by the tools. Provider limits are not a substitute. */
export interface ServerLimits {
  readonly maxPromptChars: number;
  readonly maxImages: number;
  readonly maxImageBytes: number;
  /** Largest generated image the server will return. */
  readonly maxOutputImageBytes: number;
  readonly timeoutMs: number;
}

export const DEFAULT_LIMITS: ServerLimits = {
  maxPromptChars: 100_000,
  maxImages: 4,
  maxImageBytes: 8 * 1024 * 1024,
  maxOutputImageBytes: 16 * 1024 * 1024,
  timeoutMs: 120_000,
};

export type TransportName = 'stdio' | 'http';

export interface HttpConfig {
  /** Loopback unless `allowNonLoopback` is set (e.g. inside a container). */
  readonly host: string;
  readonly port: number;
  /** Null means "read or generate one on first run". Never a default value. */
  readonly authToken: string | null;
  /** Where a generated token is stored (file mode 0600). */
  readonly tokenFilePath: string;
  /** Exact origins a browser may call from, e.g. chrome-extension://abc. */
  readonly allowedOrigins: readonly string[];
  readonly allowNonLoopback: boolean;
}

/** One provider the operator configured, plus which environment variable enabled it. */
export interface ProviderSettings<T> {
  readonly name: string;
  readonly config: T;
}

export interface ServerConfig {
  readonly transport: TransportName;
  /** Configured text providers by name, in a fixed order. */
  readonly textProviders: readonly ProviderSettings<TextProviderConfig>[];
  readonly imageProviders: readonly ProviderSettings<ImageProviderConfig>[];
  /** Null when no text (or image) provider is configured. */
  readonly defaultTextProvider: string | null;
  readonly defaultImageProvider: string | null;
  readonly limits: ServerLimits;
  readonly http: HttpConfig;
}

const DEFAULT_HTTP_PORT: number = 8787;
export const DEFAULT_HTTP_HOST: string = '127.0.0.1';
/** Shortest auth token accepted; a generated one is much longer. */
export const MIN_AUTH_TOKEN_LENGTH: number = 24;
const LOOPBACK_BIND_HOSTS: readonly string[] = [
  '127.0.0.1',
  '::1',
  'localhost',
];
const MAX_MODEL_NAME_LENGTH: number = 200;

/** Reads a variable; an empty or whitespace-only value counts as unset. */
function readVariable(env: EnvironmentMap, name: string): string | null {
  const raw: string | undefined = env[name];
  if (raw === undefined) {
    return null;
  }
  const trimmed: string = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** A model name from the environment or a tool call: short, no whitespace or control characters. */
export function checkModelName(value: string, source: string): Result<string> {
  const trimmed: string = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_MODEL_NAME_LENGTH) {
    return err(
      `${source}: model name must be 1 to ${MAX_MODEL_NAME_LENGTH} characters, got ${trimmed.length}.`
    );
  }
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(trimmed)) {
    return err(
      `${source}: model name must not contain whitespace or control characters.`
    );
  }
  return ok(trimmed);
}

/** Reads and validates an optional model override. */
function readModel(env: EnvironmentMap, name: string): Result<string | null> {
  const raw: string | null = readVariable(env, name);
  if (raw === null) {
    return ok(null);
  }
  const checked: Result<string> = checkModelName(raw, name);
  return checked.ok ? ok(checked.value) : checked;
}

function readPositiveInteger(
  env: EnvironmentMap,
  name: string,
  fallback: number,
  maximum: number
): Result<number> {
  const raw: string | null = readVariable(env, name);
  if (raw === null) {
    return ok(fallback);
  }
  const parsed: number = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    return err(
      `${name}: expected a whole number from 1 to ${maximum}, got "${raw}".`
    );
  }
  return ok(parsed);
}

/** Splits a comma-separated list, dropping blanks. */
function readList(env: EnvironmentMap, name: string): readonly string[] {
  const raw: string | null = readVariable(env, name);
  if (raw === null) {
    return [];
  }
  return raw
    .split(',')
    .map((item: string): string => item.trim())
    .filter((item: string): boolean => item.length > 0);
}

/** A key-based hosted provider: enabled when its key is set. */
interface HostedSpec {
  readonly name: 'claude' | 'gemini' | 'openai' | 'grok';
  readonly keyVariable: string;
  readonly modelVariable: string | null;
  readonly textCapable: boolean;
  readonly imageCapable: boolean;
}

// One table, no per-provider switches elsewhere.
const HOSTED_PROVIDERS: readonly HostedSpec[] = [
  {
    name: 'claude',
    keyVariable: 'ANTHROPIC_API_KEY',
    modelVariable: 'CLAUDE_TEXT_MODEL',
    textCapable: true,
    imageCapable: false,
  },
  {
    name: 'gemini',
    keyVariable: 'GEMINI_API_KEY',
    modelVariable: 'GEMINI_TEXT_MODEL',
    textCapable: true,
    imageCapable: true,
  },
  {
    name: 'openai',
    keyVariable: 'OPENAI_API_KEY',
    modelVariable: 'OPENAI_TEXT_MODEL',
    textCapable: true,
    imageCapable: true,
  },
  {
    name: 'grok',
    keyVariable: 'XAI_API_KEY',
    modelVariable: null,
    textCapable: true,
    imageCapable: true,
  },
];

function buildHostedText(
  spec: HostedSpec,
  apiKey: string,
  model: string | null,
  timeoutMs: number
): TextProviderConfig {
  switch (spec.name) {
    case 'claude':
      return {
        provider: 'claude',
        apiKey,
        model: model ?? DEFAULT_CLAUDE_MODEL,
        effort: DEFAULT_CLAUDE_EFFORT,
        timeoutMs,
      };
    case 'gemini':
      return {
        provider: 'gemini',
        apiKey,
        timeoutMs,
        ...(model === null ? {} : { model }),
      };
    case 'openai':
      return {
        provider: 'openai',
        apiKey,
        timeoutMs,
        ...(model === null ? {} : { model }),
      };
    case 'grok':
      return {
        provider: 'grok',
        apiKey,
        timeoutMs,
        ...(model === null ? {} : { model }),
      };
  }
}

function buildHostedImage(
  spec: HostedSpec,
  apiKey: string,
  timeoutMs: number
): ImageProviderConfig | null {
  switch (spec.name) {
    case 'gemini':
      return { provider: 'gemini', apiKey, timeoutMs };
    case 'openai':
      return { provider: 'openai', apiKey, timeoutMs };
    case 'grok':
      return { provider: 'grok', apiKey, timeoutMs };
    case 'claude':
      return null;
  }
}

/** Checks a default-provider name against the valid names and what is configured. */
function chooseDefault(
  env: EnvironmentMap,
  variable: string,
  kind: 'text' | 'image',
  validNames: readonly string[],
  configuredNames: readonly string[]
): Result<string | null> {
  const requested: string | null = readVariable(env, variable);
  if (requested === null) {
    if (configuredNames.length === 0) {
      return ok(null);
    }
    const onlyName: string | undefined = configuredNames[0];
    if (configuredNames.length === 1 && onlyName !== undefined) {
      return ok(onlyName);
    }
    return err(
      `${variable} is not set and ${configuredNames.length} ${kind} providers are configured (${configuredNames.join(', ')}). ` +
        `Set ${variable} so prompts go only to the provider you choose.`
    );
  }
  const name: string = requested.toLowerCase();
  if (!validNames.includes(name)) {
    return err(
      `${variable}: unknown ${kind} provider "${requested}". Valid names: ${validNames.join(', ')}.`
    );
  }
  if (!configuredNames.includes(name)) {
    const configuredLabel: string =
      configuredNames.length === 0 ? 'none' : configuredNames.join(', ');
    return err(
      `${variable}: ${kind} provider "${name}" is not configured (missing its API key or host setting). Configured: ${configuredLabel}.`
    );
  }
  return ok(name);
}

/** True when a bind address only accepts connections from this machine. */
export function isLoopbackBindHost(host: string): boolean {
  return LOOPBACK_BIND_HOSTS.includes(host.toLowerCase());
}

/** Reads a true/false variable; anything else is an error naming the variable. */
function readBoolean(env: EnvironmentMap, name: string): Result<boolean> {
  const raw: string | null = readVariable(env, name);
  if (raw === null) {
    return ok(false);
  }
  const lowered: string = raw.toLowerCase();
  if (lowered === 'true' || lowered === '1') return ok(true);
  if (lowered === 'false' || lowered === '0') return ok(false);
  return err(`${name}: expected true or false, got "${raw}".`);
}

/** An origin is scheme://host[:port] with no path, query or wildcard. */
const ORIGIN_PATTERN: RegExp = /^[a-z][a-z0-9+.-]*:\/\/[^/\s*?#]+$/;

function checkOrigins(origins: readonly string[]): Result<readonly string[]> {
  const normalized: string[] = [];
  for (const origin of origins) {
    const lowered: string = origin.toLowerCase();
    if (!ORIGIN_PATTERN.test(lowered)) {
      return err(
        `MCP_ALLOWED_ORIGINS: "${origin}" is not an origin. Use scheme://host[:port] with no path or wildcard, e.g. chrome-extension://abcdef or http://localhost:3000.`
      );
    }
    normalized.push(lowered);
  }
  return ok(normalized);
}

/** Where a generated token is stored when MCP_TOKEN_FILE is not set. */
function defaultTokenFilePath(env: EnvironmentMap): string {
  const configHome: string =
    readVariable(env, 'XDG_CONFIG_HOME') ?? join(homedir(), '.config');
  return join(configHome, 'ai-providers-mcp', 'token');
}

function parseHttpConfig(
  env: EnvironmentMap,
  port: number
): Result<HttpConfig> {
  const allowNonLoopback: Result<boolean> = readBoolean(
    env,
    'MCP_HTTP_ALLOW_NON_LOOPBACK'
  );
  if (!allowNonLoopback.ok) return allowNonLoopback;
  const host: string = readVariable(env, 'MCP_HTTP_HOST') ?? DEFAULT_HTTP_HOST;
  if (!allowNonLoopback.value && !isLoopbackBindHost(host)) {
    return err(
      `MCP_HTTP_HOST: "${host}" is not a loopback address. The HTTP transport binds ${LOOPBACK_BIND_HOSTS.join(', ')} only. ` +
        'Inside a container, set MCP_HTTP_ALLOW_NON_LOOPBACK=true and publish the port on 127.0.0.1 only.'
    );
  }
  const authToken: string | null = readVariable(env, 'MCP_AUTH_TOKEN');
  if (
    authToken !== null &&
    (authToken.length < MIN_AUTH_TOKEN_LENGTH || /\s/.test(authToken))
  ) {
    return err(
      `MCP_AUTH_TOKEN: must be at least ${MIN_AUTH_TOKEN_LENGTH} characters with no whitespace. Leave it unset to generate one on first run.`
    );
  }
  const origins: Result<readonly string[]> = checkOrigins(
    readList(env, 'MCP_ALLOWED_ORIGINS')
  );
  if (!origins.ok) return origins;
  return ok({
    host,
    port,
    authToken,
    tokenFilePath:
      readVariable(env, 'MCP_TOKEN_FILE') ?? defaultTokenFilePath(env),
    allowedOrigins: origins.value,
    allowNonLoopback: allowNonLoopback.value,
  });
}

/** Chooses stdio or http from the --http flag, then MCP_TRANSPORT, else stdio. */
function chooseTransport(
  env: EnvironmentMap,
  args: readonly string[]
): Result<TransportName> {
  if (args.includes('--http')) return ok('http');
  if (args.includes('--stdio')) return ok('stdio');
  const raw: string | null = readVariable(env, 'MCP_TRANSPORT');
  if (raw === null) return ok('stdio');
  const lowered: string = raw.toLowerCase();
  if (lowered === 'stdio' || lowered === 'http') return ok(lowered);
  return err(`MCP_TRANSPORT: expected stdio or http, got "${raw}".`);
}

/**
 * Builds the server configuration from an environment map.
 * Never includes a key in an error message.
 */
export function parseConfig(
  env: EnvironmentMap,
  args: readonly string[] = []
): Result<ServerConfig> {
  const timeout: Result<number> = readPositiveInteger(
    env,
    'AI_TIMEOUT_MS',
    DEFAULT_LIMITS.timeoutMs,
    600_000
  );
  if (!timeout.ok) return timeout;
  const maxPromptChars: Result<number> = readPositiveInteger(
    env,
    'AI_MAX_PROMPT_CHARS',
    DEFAULT_LIMITS.maxPromptChars,
    2_000_000
  );
  if (!maxPromptChars.ok) return maxPromptChars;
  const maxImages: Result<number> = readPositiveInteger(
    env,
    'AI_MAX_IMAGES',
    DEFAULT_LIMITS.maxImages,
    16
  );
  if (!maxImages.ok) return maxImages;
  const maxImageBytes: Result<number> = readPositiveInteger(
    env,
    'AI_MAX_IMAGE_BYTES',
    DEFAULT_LIMITS.maxImageBytes,
    64 * 1024 * 1024
  );
  if (!maxImageBytes.ok) return maxImageBytes;
  const maxOutputImageBytes: Result<number> = readPositiveInteger(
    env,
    'AI_MAX_OUTPUT_IMAGE_BYTES',
    DEFAULT_LIMITS.maxOutputImageBytes,
    64 * 1024 * 1024
  );
  if (!maxOutputImageBytes.ok) return maxOutputImageBytes;
  const port: Result<number> = readPositiveInteger(
    env,
    'MCP_HTTP_PORT',
    DEFAULT_HTTP_PORT,
    65_535
  );
  if (!port.ok) return port;

  const textProviders: ProviderSettings<TextProviderConfig>[] = [];
  const imageProviders: ProviderSettings<ImageProviderConfig>[] = [];

  for (const spec of HOSTED_PROVIDERS) {
    const apiKey: string | null = readVariable(env, spec.keyVariable);
    if (apiKey === null) {
      continue;
    }
    const model: Result<string | null> =
      spec.modelVariable === null
        ? ok(null)
        : readModel(env, spec.modelVariable);
    if (!model.ok) return model;
    if (spec.textCapable) {
      textProviders.push({
        name: spec.name,
        config: buildHostedText(spec, apiKey, model.value, timeout.value),
      });
    }
    if (spec.imageCapable) {
      const imageConfig: ImageProviderConfig | null = buildHostedImage(
        spec,
        apiKey,
        timeout.value
      );
      if (imageConfig !== null) {
        imageProviders.push({ name: spec.name, config: imageConfig });
      }
    }
  }

  // Ollama: enabled by OLLAMA_MODEL. Loopback unless AI_ALLOWED_HOSTS lists the host.
  const ollamaModel: Result<string | null> = readModel(env, 'OLLAMA_MODEL');
  if (!ollamaModel.ok) return ollamaModel;
  const allowedHosts: readonly string[] = parseAllowedHosts(
    readVariable(env, 'AI_ALLOWED_HOSTS') ?? ''
  );
  if (ollamaModel.value !== null) {
    const ollamaHost: string | null = readVariable(env, 'OLLAMA_HOST');
    if (ollamaHost !== null) {
      const checkedHost: Result<string> = checkProviderHost(
        'OLLAMA_HOST',
        ollamaHost,
        {
          allowedHosts,
          allowedHostsLabel: 'AI_ALLOWED_HOSTS',
        }
      );
      if (!checkedHost.ok) return checkedHost;
    }
    textProviders.push({
      name: 'ollama',
      config: {
        provider: 'ollama',
        model: ollamaModel.value,
        allowedHosts,
        allowedHostsLabel: 'AI_ALLOWED_HOSTS',
        timeoutMs: timeout.value,
        ...(ollamaHost === null ? {} : { host: ollamaHost }),
      },
    });
  }

  const textNames: readonly string[] = textProviders.map(
    (entry): string => entry.name
  );
  const imageNames: readonly string[] = imageProviders.map(
    (entry): string => entry.name
  );
  const defaultText: Result<string | null> = chooseDefault(
    env,
    'AI_TEXT_PROVIDER',
    'text',
    TEXT_PROVIDERS,
    textNames
  );
  if (!defaultText.ok) return defaultText;
  const defaultImage: Result<string | null> = chooseDefault(
    env,
    'AI_IMAGE_PROVIDER',
    'image',
    IMAGE_PROVIDERS,
    imageNames
  );
  if (!defaultImage.ok) return defaultImage;

  const transport: Result<TransportName> = chooseTransport(env, args);
  if (!transport.ok) return transport;
  const http: Result<HttpConfig> = parseHttpConfig(env, port.value);
  if (!http.ok) return http;

  return ok({
    transport: transport.value,
    textProviders,
    imageProviders,
    defaultTextProvider: defaultText.value,
    defaultImageProvider: defaultImage.value,
    limits: {
      maxPromptChars: maxPromptChars.value,
      maxImages: maxImages.value,
      maxImageBytes: maxImageBytes.value,
      maxOutputImageBytes: maxOutputImageBytes.value,
      timeoutMs: timeout.value,
    },
    http: http.value,
  });
}

/** Loads configuration from the real process environment. */
export function loadConfig(): Result<ServerConfig> {
  return parseConfig(process.env, process.argv.slice(2));
}

/** Which keys are set, never their values, for startup logs. */
export function describeConfig(config: ServerConfig): string {
  const textLabel: string =
    config.textProviders.map((entry): string => entry.name).join(', ') ||
    'none';
  const imageLabel: string =
    config.imageProviders.map((entry): string => entry.name).join(', ') ||
    'none';
  return (
    `text providers: ${textLabel} (default: ${config.defaultTextProvider ?? 'none'}); ` +
    `image providers: ${imageLabel} (default: ${config.defaultImageProvider ?? 'none'}); ` +
    `transport: ${config.transport}; ` +
    `http token: ${config.http.authToken === null ? 'not set' : 'set'}`
  );
}

/**
 * Sets the process exit code. Lives here because `process` is restricted to
 * this file; the entry point uses it to exit gracefully with a non-zero code.
 */
export function setProcessExitCode(code: number): void {
  process.exitCode = code;
}

/** Runs `handler` once on SIGINT or SIGTERM, for a graceful shutdown. */
export function onTerminationSignal(handler: () => void): void {
  process.once('SIGINT', handler);
  process.once('SIGTERM', handler);
}
