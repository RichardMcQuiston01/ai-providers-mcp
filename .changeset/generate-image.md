---
'ai-providers-mcp': minor
---

Add the `generate_image` tool. It takes a prompt, optional instructions, input images, provider and mode, and returns an MCP image content block with a short note. Client images are checked by their bytes, `mode` can only be one the provider lists, the real output type comes from the bytes, and outputs over `AI_MAX_OUTPUT_IMAGE_BYTES` (default 16 MiB) are refused.
