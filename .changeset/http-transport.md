---
'ai-providers-mcp': minor
---

Add the Streamable HTTP transport (`--http` or `MCP_TRANSPORT=http`). It binds loopback only, requires a bearer token (generated into a 0600 file on first run if `MCP_AUTH_TOKEN` is unset), checks the Host and Origin headers, and serves JSON only.
