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

Stages 0 to 5 of `ROADMAP.md` are built: config and providers, MCP over
stdio, Streamable HTTP, `generate_image` and Docker. Stage 6 is the release
(`0.1.0`). Remaining by hand, because they need real keys: `bun run
live-check` (not written yet) against one hosted and one local provider, and
a `claude mcp add` smoke test.

## Tools

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

## Layout

```
src/
  index.ts       entry: --http / MCP_TRANSPORT picks the transport; logs to stderr
  config.ts      the ONLY file that reads process.env (and process signals/exit code); returns Result<ServerConfig>
  providers.ts   builds generators from config with createTextGenerator/createImageGenerator
  server.ts      builds the McpServer and registers the tools
  tools/         one file per tool: schema, handler, registration; imageInput.ts is shared
  transports/    stdio.ts, http.ts (bearer auth, Host/Origin checks, 127.0.0.1 bind), token.ts
  result.ts      re-export Result helpers from ai-providers; do not redefine
test/            node:test + node:assert, run by bun test; fake generators, no network
Dockerfile, docker-compose.yml, docker-entrypoint.sh
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
  crash. `npx` does not install optional peers, so the README tells users to
  add one with `npx -y -p ai-providers-mcp -p <sdk> ai-providers-mcp`. Grok
  text needs `openai`; Grok images, Ollama and the HTTP transport need none.
- **No database in v1.** If persistence is added later, use Prisma with
  singular table names, snake_case columns, UUID primary keys, and
  `created_at` / `updated_at` on non-join tables.
- **JSON only** for any HTTP request and response. No SOAP.

## Configuration

Environment variables (a git-ignored `.env`; Bun loads it). Keep
`.env.example` current and never commit `.env`.

| Variable                                                                      | Purpose                                                                               |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `AI_TEXT_PROVIDER`                                                            | default text provider name (`claude`, `gemini`, ...); required if several are enabled |
| `AI_IMAGE_PROVIDER`                                                           | default image provider name                                                           |
| `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`        | provider keys (a key enables its provider)                                            |
| `CLAUDE_TEXT_MODEL`, `GEMINI_TEXT_MODEL`, `OPENAI_TEXT_MODEL`, `OLLAMA_MODEL` | model overrides (`OLLAMA_MODEL` also enables Ollama)                                  |
| `OLLAMA_HOST`, `AI_ALLOWED_HOSTS`                                             | local server URL; loopback unless the host is in the allow list                       |
| `AI_TIMEOUT_MS`                                                               | per-call timeout                                                                      |
| `AI_MAX_PROMPT_CHARS`, `AI_MAX_IMAGES`, `AI_MAX_IMAGE_BYTES`                  | input limits                                                                          |
| `AI_MAX_OUTPUT_IMAGE_BYTES`                                                   | largest generated image returned                                                      |
| `MCP_TRANSPORT` (or `--http`)                                                 | `stdio` (default) or `http`                                                           |
| `MCP_HTTP_PORT`, `MCP_HTTP_HOST`, `MCP_HTTP_ALLOW_NON_LOOPBACK`               | HTTP bind; non-loopback only inside a container                                       |
| `MCP_AUTH_TOKEN`, `MCP_TOKEN_FILE`                                            | bearer token, or where a generated one is stored (mode 0600)                          |
| `MCP_ALLOWED_ORIGINS`, `MCP_ALLOWED_HOSTS`                                    | exact browser origins; extra `Host` header values (`host:port`)                       |
| `MCP_HOST_PORT`                                                               | docker compose only: the published host port                                          |

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
- Keys arrive as environment variables or Docker secrets at run time
  (`NAME_FILE=/run/secrets/x`, read by `docker-entrypoint.sh`).
- `docker-compose.yml` publishes the port on `127.0.0.1` only.
- To reach Ollama on the host or over Tailscale, pass its URL and allow the
  host explicitly; loopback is the default.
- A published port that differs from the bound one needs `MCP_ALLOWED_HOSTS`
  (compose sets it from `MCP_HOST_PORT`).

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
  `^0.5.4`, the first release whose `checkImageInput` checks the bytes) and note the version in the changelog when it changes.
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
- Image payload limits: decided in Stage 4. Input stays at 4 images and 8 MiB
  each; generated images have their own cap (`AI_MAX_OUTPUT_IMAGE_BYTES`).

Never commit secrets or tokens.
