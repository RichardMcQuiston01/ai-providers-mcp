import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describeUnknownError } from '@richardmcquiston01/ai-providers';

import {
  isLoopbackBindHost,
  type HttpConfig,
  type ServerLimits,
} from '../config.js';
import { err, ok, type Result } from '../result.js';
import { tokensMatch } from './token.js';

/** The one path that serves MCP. Everything else is a 404. */
export const MCP_PATH: string = '/mcp';

const CORS_ALLOWED_HEADERS: string =
  'authorization, content-type, accept, mcp-protocol-version, mcp-session-id';
const BODY_SLACK_BYTES: number = 64 * 1024;
/** Requests handled at once; more get 429. Each can spend provider credits. */
export const DEFAULT_MAX_CONCURRENT_REQUESTS: number = 8;
/** A JSON-RPC batch longer than this is refused; MCP clients send one message per POST. */
const MAX_BATCH_LENGTH: number = 1;

export interface HttpServerOptions {
  readonly http: Pick<
    HttpConfig,
    'host' | 'port' | 'allowedOrigins' | 'allowNonLoopback'
  >;
  readonly limits: ServerLimits;
  /** The bearer token. Never logged. */
  readonly token: string;
  /** Builds a fresh MCP server per request (stateless; tools hold no session). */
  readonly createMcpServer: () => McpServer;
  readonly maxConcurrentRequests?: number;
  /** stderr logger; receives no tokens, headers or bodies. */
  readonly log: (message: string) => void;
}

export interface RunningHttpServer {
  readonly host: string;
  readonly port: number;
  close(): Promise<void>;
}

/** Largest request body worth reading: prompts plus the maximum base64 images. */
export function maxBodyBytes(limits: ServerLimits): number {
  const imageBase64: number = Math.ceil(limits.maxImageBytes / 3) * 4;
  // JSON escaping can grow a character several-fold, so allow generously for text.
  return (
    limits.maxPromptChars * 16 +
    limits.maxImages * imageBase64 +
    BODY_SLACK_BYTES
  );
}

function sendJson(
  res: ServerResponse,
  status: number,
  message: string,
  headers: Record<string, string> = {}
): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  const body: string = JSON.stringify({ error: { status, message } });
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

/** Rejections close the connection so an unread body is not streamed to a dead end. */
function reject(
  res: ServerResponse,
  status: number,
  message: string,
  headers: Record<string, string> = {}
): void {
  sendJson(res, status, message, { ...headers, Connection: 'close' });
}

function singleHeader(req: IncomingMessage, name: string): string | undefined {
  const value: string | string[] | undefined = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** Host header values this server answers to; blocks DNS rebinding. */
function allowedHostValues(host: string, port: number): ReadonlySet<string> {
  const names: string[] = ['127.0.0.1', 'localhost', '[::1]'];
  if (!isLoopbackBindHost(host) && host !== '0.0.0.0' && host !== '::') {
    names.push(host.toLowerCase());
  }
  return new Set(names.map((name: string): string => `${name}:${port}`));
}

type BodyResult = Result<unknown> & { readonly tooLarge?: boolean };

/**
 * Reads and parses a JSON body, giving up at `maxBytes`. When the limit is
 * hit the stream is paused, not destroyed, so the 413 reply can be sent
 * before the caller closes the connection.
 */
function readJsonBody(
  req: IncomingMessage,
  maxBytes: number
): Promise<BodyResult> {
  const declared: number = Number(singleHeader(req, 'content-length') ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    return Promise.resolve({
      ...err(`Request body is ${declared} bytes; the limit is ${maxBytes}.`),
      tooLarge: true,
    });
  }
  return new Promise<BodyResult>((resolve): void => {
    const chunks: Buffer[] = [];
    let received: number = 0;
    req.on('data', (chunk: Buffer): void => {
      received += chunk.length;
      if (received > maxBytes) {
        req.pause();
        req.removeAllListeners('data');
        req.removeAllListeners('end');
        resolve({
          ...err(`Request body is over the ${maxBytes} byte limit.`),
          tooLarge: true,
        });
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', (): void => {
      try {
        resolve(
          ok(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
        );
      } catch (caught: unknown) {
        resolve(
          err(`Request body is not valid JSON: ${describeUnknownError(caught)}`)
        );
      }
    });
    req.on('error', (caught: Error): void => {
      resolve(
        err(`Could not read the request body: ${describeUnknownError(caught)}`)
      );
    });
  });
}

function extractBearer(req: IncomingMessage): string | null {
  const header: string | undefined = singleHeader(req, 'authorization');
  if (header === undefined) {
    return null;
  }
  const match: RegExpExecArray | null = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1] ?? null;
}

/**
 * Starts the Streamable HTTP transport. Order of checks on every request:
 * path, Host header, Origin allow list, CORS preflight, bearer token,
 * method, content type, JSON body. Responses are JSON only.
 */
export async function startHttpServer(
  options: HttpServerOptions
): Promise<Result<RunningHttpServer>> {
  const { http, limits, token, log } = options;
  if (!http.allowNonLoopback && !isLoopbackBindHost(http.host)) {
    return err(
      `Refusing to bind ${http.host}: the HTTP transport only binds loopback unless MCP_HTTP_ALLOW_NON_LOOPBACK=true.`
    );
  }
  const bodyLimit: number = maxBodyBytes(limits);
  const allowedOrigins: ReadonlySet<string> = new Set(http.allowedOrigins);
  let allowedHosts: ReadonlySet<string> = new Set();
  const maxConcurrent: number =
    options.maxConcurrentRequests ?? DEFAULT_MAX_CONCURRENT_REQUESTS;
  let inFlight: number = 0;

  async function handle(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    // Always set, so a shared cache never serves one origin's reply to another.
    res.setHeader('Vary', 'Origin');
    res.setHeader('Cache-Control', 'no-store');
    const path: string = (req.url ?? '').split('?')[0] ?? '';
    if (path !== MCP_PATH) {
      sendJson(res, 404, `Not found. The MCP endpoint is ${MCP_PATH}.`);
      return;
    }
    const hostHeader: string | undefined = singleHeader(req, 'host');
    if (
      hostHeader === undefined ||
      !allowedHosts.has(hostHeader.toLowerCase())
    ) {
      reject(
        res,
        403,
        'Host header is not allowed. Connect to 127.0.0.1 or localhost on the server port.'
      );
      return;
    }
    const origin: string | undefined = singleHeader(req, 'origin');
    const corsHeaders: Record<string, string> = {};
    if (origin !== undefined) {
      if (!allowedOrigins.has(origin.toLowerCase())) {
        reject(
          res,
          403,
          'Origin is not allowed. Add it to MCP_ALLOWED_ORIGINS on the server.'
        );
        return;
      }
      corsHeaders['Access-Control-Allow-Origin'] = origin;
    }
    if (req.method === 'OPTIONS') {
      if (origin === undefined) {
        sendJson(res, 400, 'Preflight requests need an Origin header.');
        return;
      }
      res.writeHead(204, {
        ...corsHeaders,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': CORS_ALLOWED_HEADERS,
        'Access-Control-Max-Age': '600',
      });
      res.end();
      return;
    }
    const provided: string | null = extractBearer(req);
    if (provided === null || !tokensMatch(provided, token)) {
      reject(
        res,
        401,
        'Missing or invalid bearer token. Send Authorization: Bearer <token>.',
        {
          ...corsHeaders,
          'WWW-Authenticate': 'Bearer realm="ai-providers-mcp"',
        }
      );
      return;
    }
    if (req.method !== 'POST') {
      reject(
        res,
        405,
        'Only POST is supported; this server is stateless and has no event stream.',
        {
          ...corsHeaders,
          Allow: 'POST, OPTIONS',
        }
      );
      return;
    }
    const contentType: string =
      (singleHeader(req, 'content-type') ?? '')
        .split(';')[0]
        ?.trim()
        .toLowerCase() ?? '';
    if (contentType !== 'application/json') {
      sendJson(res, 415, 'Content-Type must be application/json.', corsHeaders);
      return;
    }
    // Cap concurrent work before buffering a body: every call can spend credits.
    if (inFlight >= maxConcurrent) {
      reject(
        res,
        429,
        `Too many requests in progress (limit ${maxConcurrent}). Retry shortly.`,
        { ...corsHeaders, 'Retry-After': '1' }
      );
      return;
    }
    inFlight += 1;
    res.once('close', (): void => {
      inFlight -= 1;
    });
    const body: BodyResult = await readJsonBody(req, bodyLimit);
    if (!body.ok) {
      if (body.tooLarge === true) {
        // Reply first, then drop the connection so the rest is never read.
        res.once('finish', (): void => {
          req.destroy();
        });
        sendJson(res, 413, body.error, {
          ...corsHeaders,
          Connection: 'close',
        });
        return;
      }
      sendJson(res, 400, body.error, corsHeaders);
      return;
    }
    if (Array.isArray(body.value) && body.value.length > MAX_BATCH_LENGTH) {
      sendJson(
        res,
        400,
        `JSON-RPC batches are not supported; send one message per request (got ${body.value.length}).`,
        corsHeaders
      );
      return;
    }
    for (const [name, value] of Object.entries(corsHeaders)) {
      res.setHeader(name, value);
    }
    const mcpServer: McpServer = options.createMcpServer();
    // Stateless: a fresh transport per request, plain JSON responses (no SSE).
    const transport: StreamableHTTPServerTransport =
      new StreamableHTTPServerTransport({
        enableJsonResponse: true,
      });
    res.on('close', (): void => {
      void transport.close();
      void mcpServer.close();
    });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, body.value);
  }

  const server: Server = createHttpServer((req, res): void => {
    handle(req, res).catch((caught: unknown): void => {
      // Details go to stderr only; the client gets a stable message.
      log(`HTTP request failed: ${describeUnknownError(caught)}`);
      sendJson(
        res,
        500,
        'The server hit an internal error while handling the request. Check the server log.'
      );
    });
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 60_000;
  server.keepAliveTimeout = 5_000;

  return new Promise<Result<RunningHttpServer>>((resolve): void => {
    server.once('error', (caught: Error): void => {
      resolve(
        err(
          `Could not listen on ${http.host}:${http.port}: ${describeUnknownError(caught)}`,
          caught
        )
      );
    });
    server.listen(http.port, http.host, (): void => {
      const address: AddressInfo = server.address() as AddressInfo;
      allowedHosts = allowedHostValues(http.host, address.port);
      resolve(
        ok({
          host: http.host,
          port: address.port,
          close: (): Promise<void> =>
            new Promise<void>((done): void => {
              server.close((): void => done());
              server.closeAllConnections();
            }),
        })
      );
    });
  });
}
