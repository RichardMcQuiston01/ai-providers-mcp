import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { describeUnknownError } from '@richardmcquiston01/ai-providers';

import { err, ok, type Result } from '../result.js';

/**
 * Serves MCP over stdin/stdout. stdout carries only protocol messages, so
 * nothing else may write to it.
 */
export async function runStdio(server: McpServer): Promise<Result<void>> {
  try {
    await server.connect(new StdioServerTransport());
    return ok(undefined);
  } catch (caught: unknown) {
    return err(
      `Could not start the stdio transport: ${describeUnknownError(caught)}`,
      caught
    );
  }
}
