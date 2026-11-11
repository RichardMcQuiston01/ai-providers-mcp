import { createRequire } from 'node:module';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { ServerConfig } from './config.js';
import type { ProviderRegistry } from './providers.js';
import { registerGenerateImage } from './tools/generateImage.js';
import { registerGenerateText } from './tools/generateText.js';
import { registerListProviders } from './tools/listProviders.js';
import { err, ok, type Result } from './result.js';

export const SERVER_NAME: string = 'ai-providers-mcp';

/**
 * Reads the version from package.json, so `changeset version` is the only
 * place it is bumped. The path works from src/ and from dist/ (both sit one
 * level below the package root, in the repo, the npm tarball and the image).
 */
export function readPackageVersion(): Result<string> {
  try {
    const require: NodeRequire = createRequire(import.meta.url);
    const parsed: unknown = require('../package.json');
    const version: unknown =
      typeof parsed === 'object' && parsed !== null && 'version' in parsed
        ? (parsed as { version: unknown }).version
        : undefined;
    return typeof version === 'string' && version.length > 0
      ? ok(version)
      : err('package.json has no version string.');
  } catch (caught: unknown) {
    return err(
      `Could not read ../package.json for the server version: ${caught instanceof Error ? caught.message : String(caught)}`,
      caught
    );
  }
}

const packageVersion: Result<string> = readPackageVersion();
/** The version reported in the MCP handshake; "unknown" if package.json cannot be read. */
export const SERVER_VERSION: string = packageVersion.ok
  ? packageVersion.value
  : 'unknown';

/** Builds the MCP server with every tool registered. Transport-agnostic. */
export function createServer(
  config: ServerConfig,
  registry: ProviderRegistry
): McpServer {
  const server: McpServer = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });
  registerListProviders(server, registry);
  registerGenerateText(server, registry, config.limits);
  registerGenerateImage(server, registry, config.limits);
  return server;
}
