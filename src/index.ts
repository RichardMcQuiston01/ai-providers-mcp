#!/usr/bin/env node
import {
  describeConfig,
  isLoopbackBindHost,
  loadConfig,
  onTerminationSignal,
  setProcessExitCode,
  type ServerConfig,
} from './config.js';
import { createProviderRegistry, type ProviderRegistry } from './providers.js';
import type { Result } from './result.js';
import { createServer, SERVER_NAME } from './server.js';
import {
  startHttpServer,
  MCP_PATH,
  type RunningHttpServer,
} from './transports/http.js';
import { runStdio } from './transports/stdio.js';
import { resolveAuthToken, type ResolvedToken } from './transports/token.js';

/** Logs to stderr only: under stdio, stdout belongs to the MCP protocol. */
function logError(message: string): void {
  console.error(`${SERVER_NAME}: ${message}`);
}

/** Runs the HTTP transport until a termination signal. */
async function runHttp(
  config: ServerConfig,
  registry: ProviderRegistry
): Promise<Result<void>> {
  const token: Result<ResolvedToken> = await resolveAuthToken(config.http);
  if (!token.ok) {
    return token;
  }
  const running: Result<RunningHttpServer> = await startHttpServer({
    http: config.http,
    limits: config.limits,
    token: token.value.token,
    createMcpServer: () => createServer(config, registry),
    log: logError,
  });
  if (!running.ok) {
    return running;
  }
  if (!isLoopbackBindHost(config.http.host)) {
    logError(
      `warning: bound to ${config.http.host} over plain HTTP. The bearer token is not encrypted in transit; publish the port on 127.0.0.1 only.`
    );
  }
  // The token itself is never printed, only where it lives.
  const tokenNote: string =
    token.value.source === 'environment'
      ? 'bearer token from MCP_AUTH_TOKEN'
      : `bearer token ${token.value.source === 'generated' ? 'generated and stored' : 'read'} at ${token.value.path ?? ''}`;
  logError(
    `listening on http://${running.value.host}:${running.value.port}${MCP_PATH} (${tokenNote})`
  );
  onTerminationSignal((): void => {
    void running.value.close().then((): void => logError('stopped'));
  });
  return { ok: true, value: undefined };
}

async function main(): Promise<Result<void>> {
  const config: Result<ServerConfig> = loadConfig();
  if (!config.ok) {
    return config;
  }
  const registry: Result<ProviderRegistry> = createProviderRegistry(
    config.value
  );
  if (!registry.ok) {
    return registry;
  }
  logError(describeConfig(config.value));
  if (config.value.transport === 'http') {
    return runHttp(config.value, registry.value);
  }
  return runStdio(createServer(config.value, registry.value));
}

const outcome: Result<void> = await main();
if (!outcome.ok) {
  logError(outcome.error);
  setProcessExitCode(1);
}
