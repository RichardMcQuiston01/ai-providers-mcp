#!/usr/bin/env node
import {
  describeConfig,
  loadConfig,
  setProcessExitCode,
  type ServerConfig,
} from './config.js';
import { createProviderRegistry, type ProviderRegistry } from './providers.js';
import type { Result } from './result.js';
import { createServer, SERVER_NAME } from './server.js';
import { runStdio } from './transports/stdio.js';

/** Logs to stderr only: under stdio, stdout belongs to the MCP protocol. */
function logError(message: string): void {
  console.error(`${SERVER_NAME}: ${message}`);
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
  return runStdio(createServer(config.value, registry.value));
}

const outcome: Result<void> = await main();
if (!outcome.ok) {
  logError(outcome.error);
  setProcessExitCode(1);
}
