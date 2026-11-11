---
'ai-providers-mcp': patch
---

Require `@richardmcquiston01/ai-providers` `^0.5.4`. Version 0.5.4 is the first release whose `checkImageInput` checks an image's bytes as well as its declared type; this server already checked the bytes itself. The README now shows how to run with `npx` plus the optional provider SDK (`npx -y -p ai-providers-mcp -p @anthropic-ai/sdk ai-providers-mcp`), because `npx` does not install optional peers.
