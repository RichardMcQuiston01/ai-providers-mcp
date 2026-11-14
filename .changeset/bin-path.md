---
'ai-providers-mcp': patch
---

Write the `bin` path as `dist/index.js`, without the leading `./`. npm rewrote it on publish and printed a warning; the command and what it runs are unchanged.
