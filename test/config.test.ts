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
