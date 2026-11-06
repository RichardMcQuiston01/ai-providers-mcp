import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import type { ProviderRegistry, ProviderSummary } from '../providers.js';
import { toolJson } from './toolResult.js';

export const LIST_PROVIDERS_TOOL: string = 'list_providers';

const providerSummarySchema: z.ZodType<ProviderSummary> = z.object({
  name: z.string(),
  kind: z.enum(['text', 'image']),
  model: z.string(),
  isDefault: z.boolean(),
});

/** The handler, separate from registration so tests can call it directly. */
export function listProvidersHandler(
  registry: ProviderRegistry
): CallToolResult {
  const providers: readonly ProviderSummary[] = registry.listProviders();
  return toolJson({ providers });
}

export function registerListProviders(
  server: McpServer,
  registry: ProviderRegistry
): void {
  server.registerTool(
    LIST_PROVIDERS_TOOL,
    {
      title: 'List providers',
      description:
        'Lists the text and image providers this server is configured with, their default models, and which is the default. Never returns keys or hosts.',
      outputSchema: { providers: z.array(providerSummarySchema) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (): CallToolResult => listProvidersHandler(registry)
  );
}
