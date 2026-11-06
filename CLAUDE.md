# CLAUDE.md

Project memory for Claude Code. Read this before changing anything.

## What this is

`ai-providers-mcp`: a TypeScript MCP server that routes text and image
generation to swappable AI providers through
[`@richardmcquiston01/ai-providers`](https://github.com/RichardMcQuiston01/ai-providers)
(`TextGenerator` and `ImageGenerator` interfaces). The provider is chosen in
configuration, so a client calls the same tool whether the model is Claude,
Gemini, OpenAI, Grok, Ollama or another local server.

It is generic on purpose. It is not a resume tool, a captioning tool or
anything consumer-specific. Prompt rules, output checks and the decision to
use a result belong to the client that calls the server.

Not related to the unscoped npm package `ai-providers` (a different
maintainer). Say so near the top of the README.

Typical clients: Claude Desktop and Claude Code (MCP), and local apps such as
a browser-extension bridge (HTTP, if added; see Open decisions).

## Status

New repo; the scaffold has not been created yet. Build in this order:

1. Config loading and provider construction (`src/config.ts`).
2. MCP tools over stdio: `list_providers`, `generate_text`.
3. Streamable HTTP transport (localhost, bearer token).
4. `generate_image`.
5. Dockerfile and compose file.
6. README, LICENSE, disclaimers, changeset, first release.

## Tools (planned)

| Tool             | Input                                                            | Output                                     |
| ---------------- | ---------------------------------------------------------------- | ------------------------------------------ |
| `list_providers` | none                                                             | configured providers and default models    |
| `generate_text`  | `prompt`, optional `instructions`, `provider`, `model`, `images` | `{ text }` or an error with a clear reason |
| `generate_image` | `prompt`, optional `instructions`, `images`, `provider`, `mode`  | image content (base64) plus MIME type      |

- Validate every input with Zod. Treat all tool input as untrusted.
- A tool never returns a thrown exception to the client. A failed provider
  call comes back as an MCP tool result with `isError: true` and the
  descriptive message from the provider's `Result`.
- `provider` and `model` may only select among providers the operator
  configured. Never let a client supply an API key or a host.

## Layout (planned)

```
src/
  index.ts       entry: picks transport from CLI flag or env
  config.ts      the ONLY file that reads process.env; returns Result<ServerConfig>
  providers.ts   builds generators from config with createTextGenerator/createImageGenerator
  tools/         one file per tool: schema, handler, registration
  transports/    stdio.ts, http.ts (bearer auth, origin allow list, 127.0.0.1 bind)
  result.ts      re-export Result helpers from ai-providers; do not redefine
test/            node:test + node:assert, run by bun test; fake generators, no network
```

## Rules

- **Generic only.** No resume, Etsy, caption or other consumer wording in
  tools, prompts or docs (examples excepted). The server generates; clients
  decide.
- **Results, not throws.** Every internal function returns `Result<T>` and
  the caller checks it. Catch what can be caught, continue when safe, and
  exit gracefully when not. Error messages name the provider, model, the
  action, the HTTP status and the provider's message. No generic "something
  went wrong".
- **No credentials in code, logs or errors.** Keys come from the
  environment in `config.ts` and are passed to providers as options (the
  `ai-providers` package never reads the environment). Never echo a key,
  full URL with credentials or an Authorization header. Mask keys in
  startup logs (show only whether one is set).
- **stdout belongs to the protocol.** Under stdio, anything written to
  stdout that is not an MCP message corrupts the session. All logs go to
  stderr. Never use `console.log`.
- **Local by default.** The HTTP transport binds `127.0.0.1`, requires a
  bearer token, and checks the `Origin` header against an allow list. If no
  token is configured, generate one on first run and print where it was
  stored (never print it to a shared log). Never ship a default token.
- **Prompt injection.** Text a client sends may contain instructions aimed
  at the model. The server only returns generated text or images; it never
  executes, evaluates or follows output.
- **Cost and abuse limits.** Cap prompt size, image count and image bytes,
  and set `timeoutMs`. Provider limits are not a substitute.
- **Providers stay swappable.** Code against `TextGenerator` and
  `ImageGenerator`, never a concrete provider class, outside `providers.ts`.
- **Optional peers.** Install an SDK peer (`@anthropic-ai/sdk`, `openai`,
  `@richardmcquiston01/gemini-icon-gen`) only for providers that need one.
  A missing peer is a `Result` error naming the package, never an import
  crash.
- **No database in v1.** If persistence is added later, use Prisma with
  singular table names, snake_case columns, UUID primary keys, and
  `created_at` / `updated_at` on non-join tables.
- **JSON only** for any HTTP request and response. No SOAP.

## Configuration

Environment variables (a git-ignored `.env`; Bun loads it). Keep
`.env.example` current and never commit `.env`.

| Variable                                                                      | Purpose                                              |
| ----------------------------------------------------------------------------- | ---------------------------------------------------- |
| `AI_TEXT_PROVIDER`                                                            | default text provider name (`claude`, `gemini`, ...) |
| `AI_IMAGE_PROVIDER`                                                           | default image provider name                          |
| `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`        | provider keys                                        |
| `CLAUDE_TEXT_MODEL`, `GEMINI_TEXT_MODEL`, `OPENAI_TEXT_MODEL`, `OLLAMA_MODEL` | model overrides                                      |
| `OLLAMA_HOST` (and similar local hosts)                                       | local server URL; loopback unless allowed            |
| `MCP_HTTP_PORT`, `MCP_AUTH_TOKEN`, `MCP_ALLOWED_ORIGINS`                      | HTTP transport                                       |

- Default Claude model in this server is `claude-sonnet-5-5` with effort
  `medium`, not the `ai-providers` default (`claude-opus-5-5`), to keep
  cost low. The model is always overridable by env and per call.
- The `provider` names must match `TEXT_PROVIDERS` / `IMAGE_PROVIDERS`
  exported by `ai-providers`. An unknown name is an error that lists the
  valid ones.

## Commands (Bun only)

Never `npm`/`npx`/`tsx` locally, matching `ai-providers`. The release
workflow's `npm publish` is the one exception (provenance).

```bash
bun install
bun run typecheck
bun run lint
bun run format        # format:check in CI
bun run test
bun run build
bun run changeset
```

## Conventions

- TypeScript strict, plus `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitReturns`, `noImplicitOverride`,
  `verbatimModuleSyntax`, `useUnknownInCatchVariables`.
- Google TypeScript Style Guide. Descriptive camelCase names. Type every
  variable and function return; avoid `any`.
- Prettier; ESLint blocks `process` outside `config.ts` and `console.log`.
- Tests use fake generators implementing `TextGenerator` /
  `ImageGenerator`. No network, no real keys. A separate opt-in
  `bun run live-check` may call real providers using `.env`.
- Clean, reusable code; small files; no duplicated provider switches.

## Docker

- Multi-stage build; run as a non-root user; no keys, `.env` or personal
  files baked into the image.
- Keys arrive as environment variables or Docker secrets at run time.
- `docker-compose.yml` publishes the port on `127.0.0.1` only.
- To reach Ollama on the host or over Tailscale, pass its URL and allow the
  host explicitly; loopback is the default.

## Git and releases

- `dev` is the integration branch. Branch features off `dev` and open PRs
  into `dev`, never `main`.
- Each user-facing change gets a changeset.
- Release: on `dev`, `bun run version-packages`; merge `dev` to `main`; tag
  `main` with `vX.Y.Z` and push the tag. The release workflow checks the
  tag matches `package.json` and that the commit is on `main`, then
  typechecks, lints, tests, builds and runs
  `npm publish --provenance --access public` with the `NPM_TOKEN` secret.
- Package name: `ai-providers-mcp` (unscoped; confirm it is still free
  right before the first publish). `bin` entry so
  `npx -y ai-providers-mcp` works in MCP client config.
- License Apache-2.0. Funding link in `package.json` and README follows the
  Ko-fi convention used in `ai-providers`.
- Pin `@richardmcquiston01/ai-providers` to a compatible range (currently
  `^0.5`) and note the version in the changelog when it changes.
- Run a secret scan before the first push; repo history is public.

## README and legal

- Open with what it is, then the note that it is not related to the
  unscoped `ai-providers` npm package.
- Add the disclaimer: not affiliated with or endorsed by Anthropic, Google,
  OpenAI or xAI; Claude, Gemini and other names are trademarks of their
  owners. Repeat it in LICENSE/COPYRIGHT as in `ai-providers`.
- Document: install, Claude Desktop and Claude Code config snippets, every
  env variable, every tool with an example call, the HTTP transport
  security model, and that each user supplies their own provider keys.
- State plainly that prompts and images are sent to whichever hosted
  provider is configured, and stay local with Ollama or another local
  server.

## Open decisions

- HTTP REST endpoints in addition to MCP tools (for non-MCP clients such as
  a browser extension), or MCP only first. Default: MCP over stdio first,
  Streamable HTTP second, plain REST later if needed.
- Whether `generate_text` should offer an optional JSON-output helper
  (validate against a client-supplied JSON Schema, one retry). `ai-providers`
  returns plain text only.
- Image tool payload limits for base64 over MCP.

Never commit secrets or tokens.
