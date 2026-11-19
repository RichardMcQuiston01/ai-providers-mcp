---
'ai-providers-mcp': patch
---

Local OpenAI-protocol servers accept served model names with spaces (vLLM `--served-model-name`), both in configuration and per call. `OPENAI_COMPATIBLE_API_PATH` sets an API path other than `/v1`. The error for a default provider that is not configured now names the variable that enables it. The README and Compose file now explain that a `*_FILE` secret variable must be listed under `environment:`, and that a local server must listen on an address the container can reach.
