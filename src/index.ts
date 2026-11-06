#!/usr/bin/env node
import { ok, type Result } from './result.js';

/** Package name, used in startup messages. */
export const SERVER_NAME: string = 'ai-providers-mcp';

/**
 * Placeholder entry point for the scaffold stage. Real transport selection
 * arrives with Stage 2.
 */
export function describeStartup(): Result<string> {
  return ok(`${SERVER_NAME}: scaffold only, no tools registered yet.`);
}

// stdout belongs to the MCP protocol, so all logging goes to stderr.
const startupResult: Result<string> = describeStartup();
if (startupResult.ok) {
  console.error(startupResult.value);
} else {
  console.error(startupResult.error);
}
