import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/** A failed tool call: a normal MCP result with isError, never a thrown exception. */
export function toolError(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

/** A successful text result, with the same value as structured content. */
export function toolText(text: string): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent: { text },
  };
}

/** Structured JSON result, also shown as text for clients that ignore structured content. */
export function toolJson(value: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}
