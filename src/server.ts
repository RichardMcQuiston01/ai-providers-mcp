import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { ServerConfig } from './config.js';
import type { ProviderRegistry } from './providers.js';
import { registerGenerateImage } from './tools/generateImage.js';
import { registerGenerateText } from './tools/generateText.js';
import { registerListProviders } from './tools/listProviders.js';

export const SERVER_NAME: string = 'ai-providers-mcp';
export const SERVER_VERSION: string = '0.0.0';

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
