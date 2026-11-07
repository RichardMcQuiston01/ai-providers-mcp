import assert from 'node:assert/strict';
import {
  request,
  type ClientRequest,
  type IncomingHttpHeaders,
} from 'node:http';
import { after, before, test } from 'node:test';

import type { Result } from '@richardmcquiston01/ai-providers';

import { createServer } from '../src/server.js';
import {
  startHttpServer,
  type RunningHttpServer,
} from '../src/transports/http.js';
import { fakeSetup, type FakeSetup } from './helpers.js';

const TOKEN: string = 'test-only-token-0123456789-abcdefghij';
const ALLOWED_ORIGIN: string = 'chrome-extension://abcdefghijklmnop';

const setup: FakeSetup = fakeSetup({ ANTHROPIC_API_KEY: 'test-only-key' });
const logged: string[] = [];
let running: RunningHttpServer;

function start(
  overrides: {
    allowNonLoopback?: boolean;
    host?: string;
    maxPromptChars?: number;
    maxImageBytes?: number;
  } = {}
): Promise<Result<RunningHttpServer>> {
  return startHttpServer({
    http: {
      host: overrides.host ?? '127.0.0.1',
      port: 0,
      allowedOrigins: [ALLOWED_ORIGIN],
      allowNonLoopback: overrides.allowNonLoopback ?? false,
    },
    limits: {
      ...setup.config.limits,
      maxPromptChars:
        overrides.maxPromptChars ?? setup.config.limits.maxPromptChars,
      maxImageBytes:
        overrides.maxImageBytes ?? setup.config.limits.maxImageBytes,
    },
    token: TOKEN,
    createMcpServer: () => createServer(setup.config, setup.registry),
    log: (message: string): void => {
      logged.push(message);
    },
  });
}

before(async () => {
  const started: Result<RunningHttpServer> = await start();
  if (!started.ok) {
    throw new Error(started.error);
  }
  running = started.value;
});

after(async () => {
  await running.close();
});

interface RawResponse {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

/** node:http so tests can set Host, which fetch forbids. */
function raw(
  method: string,
  headers: Record<string, string>,
  body?: string,
  port: number = running.port
): Promise<RawResponse> {
  return new Promise<RawResponse>((resolve, reject): void => {
    const req: ClientRequest = request(
      { host: '127.0.0.1', port, path: '/mcp', method, headers },
      (res): void => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer): void => {
          chunks.push(chunk);
        });
        res.on('end', (): void => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', reject);
    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

const GOOD: Record<string, string> = {
  authorization: `Bearer ${TOKEN}`,
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

function rpc(
  method: string,
  params: Record<string, unknown>,
  id: number = 1
): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params });
}

const INITIALIZE: string = rpc('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'http-test', version: '0.0.0' },
});

test('a valid request is served as JSON, and tools work', async () => {
  const init: RawResponse = await raw('POST', GOOD, INITIALIZE);
  assert.equal(init.status, 200);
  assert.match(String(init.headers['content-type']), /application\/json/);

  const call: RawResponse = await raw(
    'POST',
    GOOD,
    rpc('tools/call', { name: 'generate_text', arguments: { prompt: 'hi' } }, 2)
  );
  assert.equal(call.status, 200);
  assert.match(call.body, /hello over http/);
});

test('missing or wrong bearer token is 401 and the token is never echoed', async () => {
  const none: RawResponse = await raw(
    'POST',
    { ...GOOD, authorization: '' },
    INITIALIZE
  );
  assert.equal(none.status, 401);
  assert.match(String(none.headers['www-authenticate']), /Bearer/);
  const wrong: RawResponse = await raw(
    'POST',
    { ...GOOD, authorization: 'Bearer wrong-token' },
    INITIALIZE
  );
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.includes('wrong-token'), false);
  assert.equal(wrong.body.includes(TOKEN), false);
});

test('a token in the query string does not authenticate', async () => {
  const response: RawResponse = await new Promise<RawResponse>(
    (resolve, reject): void => {
      const req: ClientRequest = request(
        {
          host: '127.0.0.1',
          port: running.port,
          path: `/mcp?token=${TOKEN}`,
          method: 'POST',
          headers: { 'content-type': 'application/json' },
        },
        (res): void => {
          res.resume();
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: '',
          });
        }
      );
      req.on('error', reject);
      req.end(INITIALIZE);
    }
  );
  assert.equal(response.status, 401);
});

test('a Host header that is not loopback is rejected (DNS rebinding)', async () => {
  const response: RawResponse = await raw(
    'POST',
    { ...GOOD, host: 'evil.example.com' },
    INITIALIZE
  );
  assert.equal(response.status, 403);
  assert.match(response.body, /Host header is not allowed/);
});

test('an Origin outside the allow list is rejected even with a valid token', async () => {
  const response: RawResponse = await raw(
    'POST',
    { ...GOOD, origin: 'https://evil.example.com' },
    INITIALIZE
  );
  assert.equal(response.status, 403);
  assert.match(response.body, /MCP_ALLOWED_ORIGINS/);
});

test('an allowed Origin gets CORS headers on preflight and on the response', async () => {
  const preflight: RawResponse = await raw(
    'OPTIONS',
    { origin: ALLOWED_ORIGIN },
    undefined
  );
  assert.equal(preflight.status, 204);
  assert.equal(
    preflight.headers['access-control-allow-origin'],
    ALLOWED_ORIGIN
  );
  assert.match(
    String(preflight.headers['access-control-allow-headers']),
    /authorization/
  );

  const real: RawResponse = await raw(
    'POST',
    { ...GOOD, origin: ALLOWED_ORIGIN },
    INITIALIZE
  );
  assert.equal(real.status, 200);
  assert.equal(real.headers['access-control-allow-origin'], ALLOWED_ORIGIN);
});

test('preflight from a disallowed origin gets no CORS headers', async () => {
  const response: RawResponse = await raw(
    'OPTIONS',
    { origin: 'https://evil.example.com' },
    undefined
  );
  assert.equal(response.status, 403);
  assert.equal(response.headers['access-control-allow-origin'], undefined);
});

test('requests without an Origin (CLI clients) still need the token', async () => {
  const response: RawResponse = await raw(
    'POST',
    { ...GOOD, authorization: '' },
    INITIALIZE
  );
  assert.equal(response.status, 401);
});

test('JSON only: wrong content type is 415, bad JSON is 400, GET is 405', async () => {
  const wrongType: RawResponse = await raw(
    'POST',
    { ...GOOD, 'content-type': 'text/plain' },
    INITIALIZE
  );
  assert.equal(wrongType.status, 415);
  const badJson: RawResponse = await raw('POST', GOOD, '{not json');
  assert.equal(badJson.status, 400);
  assert.match(badJson.body, /not valid JSON/);
  const get: RawResponse = await raw('GET', GOOD);
  assert.equal(get.status, 405);
  for (const response of [wrongType, badJson, get]) {
    assert.match(String(response.headers['content-type']), /application\/json/);
  }
});

test('unknown paths are 404', async () => {
  const response: RawResponse = await new Promise<RawResponse>(
    (resolve, reject): void => {
      const req: ClientRequest = request(
        {
          host: '127.0.0.1',
          port: running.port,
          path: '/other',
          method: 'POST',
          headers: GOOD,
        },
        (res): void => {
          res.resume();
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: '',
          });
        }
      );
      req.on('error', reject);
      req.end('{}');
    }
  );
  assert.equal(response.status, 404);
});

test('an oversize body is 413 before it is parsed', async () => {
  const small: Result<RunningHttpServer> = await start({
    maxPromptChars: 10,
    maxImageBytes: 16,
  });
  assert.equal(small.ok, true);
  if (!small.ok) return;
  try {
    const response: RawResponse = await raw(
      'POST',
      GOOD,
      JSON.stringify({ filler: 'x'.repeat(1_000_000) }),
      small.value.port
    );
    assert.equal(response.status, 413);
  } finally {
    await small.value.close();
  }
});

test('binding a non-loopback address is refused unless explicitly allowed', async () => {
  const refused: Result<RunningHttpServer> = await start({ host: '0.0.0.0' });
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? '' : refused.error, /only binds loopback/);
  const allowed: Result<RunningHttpServer> = await start({
    host: '0.0.0.0',
    allowNonLoopback: true,
  });
  assert.equal(allowed.ok, true);
  if (allowed.ok) {
    await allowed.value.close();
  }
});

test('the server log never contains the token or provider keys', () => {
  const everything: string = logged.join('\n');
  assert.equal(everything.includes(TOKEN), false);
  assert.equal(everything.includes('test-only-key'), false);
});
