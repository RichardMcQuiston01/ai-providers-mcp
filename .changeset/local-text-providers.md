---
'ai-providers-mcp': minor
---

Add OpenRouter (`OPENROUTER_API_KEY`) and local OpenAI-protocol text servers: LM Studio (`LMSTUDIO_MODEL`), vLLM (`VLLM_MODEL`), llama.cpp (`LLAMACPP_MODEL`) and any other compatible server (`OPENAI_COMPATIBLE_MODEL` plus `OPENAI_COMPATIBLE_HOST`). Local hosts stay on loopback unless listed in `AI_ALLOWED_HOSTS`. These providers need the optional `openai` package.
