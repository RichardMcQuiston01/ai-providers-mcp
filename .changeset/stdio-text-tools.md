---
'ai-providers-mcp': minor
---

Add the MCP server over stdio with `list_providers` and `generate_text`. Input is validated with Zod and capped by the configured limits, images are checked by their bytes, and every failure comes back as a tool result with `isError: true`.
