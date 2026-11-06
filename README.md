# ai-providers-mcp

- Author: [Richard McQuiston](mailto:richard.mcquiston01@gmail.com)
- Website: https://richardmcquiston.com/
- NPM Package: https://www.npmjs.com/~richardmcquiston01

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/P1V529Z7ZP)

## Table of Contents

| [Overview](#overview) | [Status](#status) | [Getting Started](#getting-started) | [Tools](#tools) | [Configuration](#configuration) | [Security](#security) | [Privacy](#privacy) | [Disclaimer](#disclaimer) | [Buy Me a Coffee](#buy-me-a-coffee) | [License](#license) | [Copyright](#copyright) |

## Overview

A TypeScript [MCP](https://modelcontextprotocol.io/) server that routes text and image generation to swappable AI providers (Claude, Gemini, OpenAI, Grok, Ollama and other local servers) through [`@richardmcquiston01/ai-providers`](https://github.com/RichardMcQuiston01/ai-providers).

The provider is chosen in configuration, so a client calls the same tool whether the model behind it is hosted or local. The server is intentionally generic: it generates text and images. Prompt rules, output checks and the decision to use a result belong to the client.

> **Not related to the unscoped npm package [`ai-providers`](https://www.npmjs.com/package/ai-providers)**, which is published by a different maintainer.

Typical clients are Claude Desktop and Claude Code (MCP over stdio), and local apps that connect over Streamable HTTP.

[Back to Top](#table-of-contents)

## Status

Pre-release. The scaffold is being built in stages; see [ROADMAP.md](ROADMAP.md). The sections below describe the planned behavior and may change before the first release (`0.1.0`).

[Back to Top](#table-of-contents)

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) for development. Node.js 20 or later to run the published package.
- Your own API key for each hosted provider you want to use. Keys are never bundled. Local providers such as Ollama need no key.
- Optional SDK peers, installed only for providers that need them: `@anthropic-ai/sdk`, `openai`, `@richardmcquiston01/gemini-icon-gen`. A missing peer is reported as an error naming the package.

### Installation

Once published, no install is needed; MCP clients can run it with `npx -y ai-providers-mcp`.

From source:

```bash
git clone https://github.com/RichardMcQuiston01/ai-providers-mcp.git
cd ai-providers-mcp
bun install
bun run build
```

### Usage

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "ai-providers": {
      "command": "npx",
      "args": ["-y", "ai-providers-mcp"],
      "env": {
        "AI_TEXT_PROVIDER": "claude",
        "ANTHROPIC_API_KEY": "your-key-here"
      }
    }
  }
}
```

Claude Code:

```bash
claude mcp add ai-providers --env AI_TEXT_PROVIDER=claude --env ANTHROPIC_API_KEY=your-key-here -- npx -y ai-providers-mcp
```

### Examples

Example `generate_text` call (arguments):

```json
{
  "prompt": "Summarize the following in two sentences: ...",
  "instructions": "Reply in plain text.",
  "provider": "ollama"
}
```

[Back to Top](#table-of-contents)

## Tools

| Tool             | Input                                                            | Output                                     |
| ---------------- | ---------------------------------------------------------------- | ------------------------------------------ |
| `list_providers` | none                                                             | configured providers and default models    |
| `generate_text`  | `prompt`, optional `instructions`, `provider`, `model`, `images` | `{ text }` or an error with a clear reason |
| `generate_image` | `prompt`, optional `instructions`, `images`, `provider`, `mode`  | image content (base64) plus MIME type      |

- Every input is validated with Zod and treated as untrusted.
- A failed provider call returns an MCP tool result with `isError: true` and a descriptive message naming the provider, model, action and status. It is never a thrown exception.
- `provider` and `model` can only select among providers the operator configured. A client can never supply an API key or host.
- Prompt size, image count and image bytes are capped, and calls have a timeout.

[Back to Top](#table-of-contents)

## Configuration

Set variables in the client's `env` block, the shell, or a git-ignored `.env`. See [`.env.example`](.env.example).

| Variable                                                                      | Purpose                                                               |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `AI_TEXT_PROVIDER`                                                            | default text provider name (`claude`, `gemini`, ...)                  |
| `AI_IMAGE_PROVIDER`                                                           | default image provider name                                           |
| `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`        | provider keys                                                         |
| `CLAUDE_TEXT_MODEL`, `GEMINI_TEXT_MODEL`, `OPENAI_TEXT_MODEL`, `OLLAMA_MODEL` | model overrides                                                       |
| `OLLAMA_HOST` (and similar local hosts)                                       | local server URL; loopback unless explicitly allowed                  |
| `AI_ALLOWED_HOSTS`                                                            | comma-separated hosts, besides loopback, that local providers may use |
| `AI_TIMEOUT_MS`                                                               | per-call timeout in milliseconds (default `120000`)                   |
| `AI_MAX_PROMPT_CHARS`, `AI_MAX_IMAGES`, `AI_MAX_IMAGE_BYTES`                  | input limits (defaults `100000`, `4`, `8388608`)                      |
| `MCP_HTTP_PORT`, `MCP_AUTH_TOKEN`, `MCP_ALLOWED_ORIGINS`                      | HTTP transport                                                        |

The default Claude model is `claude-sonnet-5-5` with effort `medium` to keep cost low. Override it with `CLAUDE_TEXT_MODEL` or per call. An unknown provider name returns an error listing the valid names. Setting a provider's key (or `OLLAMA_MODEL` for Ollama) enables it. If more than one provider of a kind is enabled, set `AI_TEXT_PROVIDER` / `AI_IMAGE_PROVIDER` so prompts only go where you choose.

[Back to Top](#table-of-contents)

## Security

- **stdio** is the default transport. Logs go to stderr only, because stdout carries the protocol.
- **Streamable HTTP** binds `127.0.0.1`, requires a bearer token, and checks the `Origin` header against an allow list. If no token is configured, one is generated on first run and its storage location is printed (never the token itself). There is no default token.
- Keys come from the environment, are never logged or echoed in errors, and startup logs only show whether a key is set.
- The server returns generated text or images only. It never executes or follows model output.
- Docker images run as a non-root user with no keys baked in, and the compose file publishes the port on `127.0.0.1` only.

[Back to Top](#table-of-contents)

## Privacy

Each user supplies their own provider keys. Prompts and images are sent to whichever hosted provider is configured (Anthropic, Google, OpenAI, xAI). They stay on your machine or network only when you use Ollama or another local server.

[Back to Top](#table-of-contents)

## Disclaimer

Not affiliated with or endorsed by Anthropic, Google, OpenAI or xAI. Claude, Gemini, OpenAI, Grok and other names are trademarks of their respective owners.

[Back to Top](#table-of-contents)

## Buy Me a Coffee

If this app, code, or repository has helped you or someone you know, please consider donating. I appreciate any help to offset the costs of development and/or AI Credits.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/P1V529Z7ZP)

[Back to Top](#table-of-contents)

## License

Apache 2

[Back to Top](#table-of-contents)

## Copyright

(c)2026 Richard McQuiston. All rights reserved.

[Back to Top](#table-of-contents)
