import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_CLAUDE_MODEL,
  describeConfig,
  parseConfig,
  type EnvironmentMap,
  type ServerConfig,
} from '../src/config.js';
import type { TextProviderConfig } from '@richardmcquiston01/ai-providers/providers';
import type { Result } from '../src/result.js';

function mustParse(env: EnvironmentMap): ServerConfig {
  const result: Result<ServerConfig> = parseConfig(env);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.value;
}

function mustFail(env: EnvironmentMap): string {
  const result: Result<ServerConfig> = parseConfig(env);
  assert.equal(result.ok, false);
  return result.ok ? '' : result.error;
}

test('empty environment configures nothing and is not an error', () => {
  const config: ServerConfig = mustParse({});
  assert.equal(config.textProviders.length, 0);
  assert.equal(config.defaultTextProvider, null);
  assert.equal(config.defaultImageProvider, null);
  assert.equal(config.http.authToken, null);
});

test('a single key makes that provider the default', () => {
  const config: ServerConfig = mustParse({ ANTHROPIC_API_KEY: 'k' });
  assert.equal(config.defaultTextProvider, 'claude');
  const claude: TextProviderConfig | undefined =
    config.textProviders[0]?.config;
  assert.equal(claude?.provider, 'claude');
  if (claude?.provider === 'claude') {
    assert.equal(claude.model, DEFAULT_CLAUDE_MODEL);
    assert.equal(claude.effort, 'medium');
  }
});

test('CLAUDE_TEXT_MODEL overrides the default model', () => {
  const config: ServerConfig = mustParse({
    ANTHROPIC_API_KEY: 'k',
    CLAUDE_TEXT_MODEL: 'claude-opus-5-5',
  });
  const claude: TextProviderConfig | undefined =
    config.textProviders[0]?.config;
  assert.equal(
    claude?.provider === 'claude' ? claude.model : '',
    'claude-opus-5-5'
  );
});

test('several providers without AI_TEXT_PROVIDER is an error that says why', () => {
  const message: string = mustFail({
    ANTHROPIC_API_KEY: 'k',
    OPENAI_API_KEY: 'k',
  });
  assert.match(message, /AI_TEXT_PROVIDER is not set/);
  assert.match(message, /claude, openai/);
});

test('unknown provider name lists the valid ones', () => {
  const message: string = mustFail({ AI_TEXT_PROVIDER: 'nope' });
  assert.match(message, /unknown text provider "nope"/);
  assert.match(message, /claude/);
  assert.match(message, /ollama/);
});

test('a valid name that is not configured names the missing setting', () => {
  const message: string = mustFail({ AI_TEXT_PROVIDER: 'gemini' });
  assert.match(message, /"gemini" is not configured/);
});

test('image defaults only come from image-capable providers', () => {
  const message: string = mustFail({
    ANTHROPIC_API_KEY: 'k',
    AI_IMAGE_PROVIDER: 'claude',
  });
  assert.match(message, /unknown image provider "claude"/);
});

test('ollama is enabled by OLLAMA_MODEL and stays on loopback by default', () => {
  const config: ServerConfig = mustParse({ OLLAMA_MODEL: 'llama3.2' });
  assert.equal(config.defaultTextProvider, 'ollama');
  const message: string = mustFail({
    OLLAMA_MODEL: 'llama3.2',
    OLLAMA_HOST: 'http://gpu-box:11434',
  });
  assert.match(message, /OLLAMA_HOST/);
  assert.match(message, /AI_ALLOWED_HOSTS/);
});

test('a remote ollama host works once it is explicitly allowed', () => {
  const config: ServerConfig = mustParse({
    OLLAMA_MODEL: 'llama3.2',
    OLLAMA_HOST: 'http://gpu-box:11434',
    AI_ALLOWED_HOSTS: 'gpu-box',
  });
  assert.equal(config.textProviders[0]?.name, 'ollama');
});

test('openrouter is enabled by its key and is text only', () => {
  const config: ServerConfig = mustParse({
    OPENROUTER_API_KEY: 'k',
    OPENROUTER_MODEL: 'anthropic/claude-sonnet-5-5',
  });
  assert.equal(config.defaultTextProvider, 'openrouter');
  assert.equal(config.imageProviders.length, 0);
  const settings: TextProviderConfig | undefined =
    config.textProviders[0]?.config;
  assert.equal(settings?.provider, 'openrouter');
  assert.equal(
    settings !== undefined && 'model' in settings ? settings.model : null,
    'anthropic/claude-sonnet-5-5'
  );
});

test('lmstudio, vllm and llamacpp are enabled by their model variables', () => {
  const config: ServerConfig = mustParse({
    LMSTUDIO_MODEL: 'qwen',
    VLLM_MODEL: 'llama',
    LLAMACPP_MODEL: 'gguf',
    AI_TEXT_PROVIDER: 'vllm',
  });
  assert.deepEqual(
    config.textProviders.map((entry): string => entry.name),
    ['lmstudio', 'vllm', 'llamacpp']
  );
  assert.equal(config.defaultTextProvider, 'vllm');
});

test('local servers stay on loopback unless allowed, and name the variable', () => {
  for (const prefix of ['LMSTUDIO', 'VLLM', 'LLAMACPP']) {
    const message: string = mustFail({
      [`${prefix}_MODEL`]: 'm',
      [`${prefix}_HOST`]: 'http://gpu-box:1234',
    });
    assert.match(message, new RegExp(`${prefix}_HOST`));
    assert.match(message, /AI_ALLOWED_HOSTS/);
  }
  const config: ServerConfig = mustParse({
    LMSTUDIO_MODEL: 'm',
    LMSTUDIO_HOST: 'http://gpu-box:1234',
    AI_ALLOWED_HOSTS: 'gpu-box',
  });
  assert.equal(config.textProviders[0]?.name, 'lmstudio');
  const settings: TextProviderConfig | undefined =
    config.textProviders[0]?.config;
  assert.equal(
    settings !== undefined && 'host' in settings ? settings.host : null,
    'http://gpu-box:1234'
  );
});

test('the not-configured error names the variable that enables the provider', () => {
  assert.match(
    mustFail({
      AI_TEXT_PROVIDER: 'lmstudio',
      LMSTUDIO_HOST: 'http://127.0.0.1:1234',
      LMSTUDIO_API_KEY: 'k',
    }),
    /set LMSTUDIO_MODEL to enable it/
  );
  assert.match(
    mustFail({ AI_TEXT_PROVIDER: 'claude' }),
    /set ANTHROPIC_API_KEY to enable it/
  );
  assert.match(
    mustFail({ AI_TEXT_PROVIDER: 'openai-compatible' }),
    /set OPENAI_COMPATIBLE_MODEL and OPENAI_COMPATIBLE_HOST to enable it/
  );
});

test('served model names with spaces work for vllm but not ollama', () => {
  const config: ServerConfig = mustParse({ VLLM_MODEL: 'Team Chat' });
  const settings: TextProviderConfig | undefined =
    config.textProviders[0]?.config;
  assert.equal(
    settings !== undefined && 'model' in settings ? settings.model : null,
    'Team Chat'
  );
  assert.match(mustFail({ OLLAMA_MODEL: 'Team Chat' }), /OLLAMA_MODEL/);
  assert.match(mustFail({ VLLM_MODEL: 'Team\tChat' }), /other than spaces/);
  assert.match(mustFail({ VLLM_MODEL: 'Team\u0001Chat' }), /VLLM_MODEL/);
});

test('openai-compatible takes an optional API path and rejects odd ones', () => {
  const base: EnvironmentMap = {
    OPENAI_COMPATIBLE_MODEL: 'm',
    OPENAI_COMPATIBLE_HOST: 'http://127.0.0.1:1337',
  };
  const config: ServerConfig = mustParse({
    ...base,
    OPENAI_COMPATIBLE_API_PATH: '/inference/v1',
  });
  const settings: TextProviderConfig | undefined =
    config.textProviders[0]?.config;
  assert.equal(
    settings !== undefined && 'apiPath' in settings ? settings.apiPath : null,
    '/inference/v1'
  );
  for (const bad of ['v1', '/a b', '/v1?x=1', '/a/../b', '/v1#frag']) {
    assert.match(
      mustFail({ ...base, OPENAI_COMPATIBLE_API_PATH: bad }),
      /OPENAI_COMPATIBLE_API_PATH/
    );
  }
});

test('a local server key is passed to the provider and never logged', () => {
  const config: ServerConfig = mustParse({
    VLLM_MODEL: 'm',
    VLLM_API_KEY: 'super-secret-local-key',
  });
  const settings: TextProviderConfig | undefined =
    config.textProviders[0]?.config;
  assert.equal(
    settings !== undefined && 'apiKey' in settings ? settings.apiKey : null,
    'super-secret-local-key'
  );
  assert.doesNotMatch(describeConfig(config), /super-secret/);
});

test('openai-compatible needs a host and an allowed one', () => {
  const missing: string = mustFail({ OPENAI_COMPATIBLE_MODEL: 'm' });
  assert.match(missing, /OPENAI_COMPATIBLE_HOST/);
  const remote: string = mustFail({
    OPENAI_COMPATIBLE_MODEL: 'm',
    OPENAI_COMPATIBLE_HOST: 'http://jan.example:1337',
  });
  assert.match(remote, /AI_ALLOWED_HOSTS/);
  const config: ServerConfig = mustParse({
    OPENAI_COMPATIBLE_MODEL: 'm',
    OPENAI_COMPATIBLE_HOST: 'http://127.0.0.1:1337',
  });
  assert.equal(config.defaultTextProvider, 'openai-compatible');
});

test('invalid numbers and model names are rejected with the variable name', () => {
  assert.match(mustFail({ AI_TIMEOUT_MS: 'soon' }), /AI_TIMEOUT_MS/);
  assert.match(mustFail({ MCP_HTTP_PORT: '70000' }), /MCP_HTTP_PORT/);
  assert.match(
    mustFail({ ANTHROPIC_API_KEY: 'k', CLAUDE_TEXT_MODEL: 'bad model' }),
    /CLAUDE_TEXT_MODEL/
  );
});

test('blank values count as unset', () => {
  const config: ServerConfig = mustParse({ ANTHROPIC_API_KEY: '   ' });
  assert.equal(config.textProviders.length, 0);
});

test('neither errors nor the startup summary ever contain a key', () => {
  const secret: string = 'not-a-real-key-for-tests';
  const config: ServerConfig = mustParse({
    ANTHROPIC_API_KEY: secret,
    MCP_AUTH_TOKEN: secret,
  });
  const summary: string = describeConfig(config);
  assert.equal(summary.includes(secret), false);
  assert.match(summary, /http token: set/);
  const message: string = mustFail({
    ANTHROPIC_API_KEY: secret,
    AI_TEXT_PROVIDER: 'nope',
  });
  assert.equal(message.includes(secret), false);
});

test('transport defaults to stdio; --http and MCP_TRANSPORT select http', () => {
  const stdio: ServerConfig = mustParse({});
  assert.equal(stdio.transport, 'stdio');
  const flag: Result<ServerConfig> = parseConfig({}, ['--http']);
  assert.equal(flag.ok && flag.value.transport, 'http');
  assert.equal(mustParse({ MCP_TRANSPORT: 'http' }).transport, 'http');
  assert.match(mustFail({ MCP_TRANSPORT: 'carrier-pigeon' }), /MCP_TRANSPORT/);
});

test('HTTP binds loopback by default and refuses other hosts unless allowed', () => {
  assert.equal(mustParse({}).http.host, '127.0.0.1');
  const message: string = mustFail({ MCP_HTTP_HOST: '0.0.0.0' });
  assert.match(message, /not a loopback address/);
  assert.match(message, /MCP_HTTP_ALLOW_NON_LOOPBACK/);
  const container: ServerConfig = mustParse({
    MCP_HTTP_HOST: '0.0.0.0',
    MCP_HTTP_ALLOW_NON_LOOPBACK: 'true',
  });
  assert.equal(container.http.host, '0.0.0.0');
});

test('a weak MCP_AUTH_TOKEN is rejected without echoing it', () => {
  const message: string = mustFail({ MCP_AUTH_TOKEN: 'hunter2' });
  assert.match(message, /MCP_AUTH_TOKEN/);
  assert.equal(message.includes('hunter2'), false);
  assert.equal(
    mustParse({ MCP_AUTH_TOKEN: 'a'.repeat(32) }).http.authToken,
    'a'.repeat(32)
  );
});

test('MCP_ALLOWED_ORIGINS takes exact origins only', () => {
  const config: ServerConfig = mustParse({
    MCP_ALLOWED_ORIGINS: 'chrome-extension://abc, HTTP://localhost:3000',
  });
  assert.deepEqual(config.http.allowedOrigins, [
    'chrome-extension://abc',
    'http://localhost:3000',
  ]);
  assert.match(mustFail({ MCP_ALLOWED_ORIGINS: '*' }), /not an origin/);
  assert.match(
    mustFail({ MCP_ALLOWED_ORIGINS: 'https://a.example/path' }),
    /not an origin/
  );
});

test('the output image cap has a default and can be set', () => {
  assert.equal(mustParse({}).limits.maxOutputImageBytes, 16 * 1024 * 1024);
  assert.equal(
    mustParse({ AI_MAX_OUTPUT_IMAGE_BYTES: '1000' }).limits.maxOutputImageBytes,
    1000
  );
  assert.match(
    mustFail({ AI_MAX_OUTPUT_IMAGE_BYTES: 'big' }),
    /AI_MAX_OUTPUT_IMAGE_BYTES/
  );
});

test('MCP_ALLOWED_HOSTS takes host:port values only', () => {
  const config: ServerConfig = mustParse({
    MCP_ALLOWED_HOSTS: '127.0.0.1:9000, LOCALHOST:9000, [::1]:9000',
  });
  assert.deepEqual(config.http.allowedHosts, [
    '127.0.0.1:9000',
    'localhost:9000',
    '[::1]:9000',
  ]);
  assert.deepEqual(mustParse({}).http.allowedHosts, []);
  for (const bad of [
    '127.0.0.1',
    'http://127.0.0.1:9000',
    '*:9000',
    'host:99999',
    'a b:80',
  ]) {
    assert.match(mustFail({ MCP_ALLOWED_HOSTS: bad }), /MCP_ALLOWED_HOSTS/);
  }
});
