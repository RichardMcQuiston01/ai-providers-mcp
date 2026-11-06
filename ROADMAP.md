# ROADMAP

Multi-stage, multi-agent plan for `ai-providers-mcp`. Derived from [CLAUDE.md](CLAUDE.md), which remains the source of truth for rules.

## How to use this plan

- Each stage is one `feature/<name>` branch off `dev`, merged back to `dev` by PR (merge commit, no squash). Conventional Commits, subject 50 characters or fewer. Each user-facing change gets a changeset.
- Within a stage, **agents** run in parallel when their file ownership does not overlap. A stage is done only when its **gate** passes.
- Gate for every stage: `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test` all green; no `console.log`; no `process` outside `src/config.ts`; no credentials in code, logs or errors.
- Agents return `Result<T>` values and never throw across module boundaries.

## Agent roles

| Agent        | Owns                                                 | Responsibility                                                     |
| ------------ | ---------------------------------------------------- | ------------------------------------------------------------------ |
| **Builder**  | `src/**`                                             | Implements the stage's modules against the stated interfaces.      |
| **Tester**   | `test/**`                                            | Fake `TextGenerator` / `ImageGenerator`; no network, no real keys. |
| **Security** | review only (+ `eslint` rules)                       | Audits auth, input limits, secret handling, stdout hygiene.        |
| **Docs**     | `README.md`, `.env.example`, `CHANGELOG`, changesets | Keeps docs and env table current with the code.                    |
| **DevOps**   | `Dockerfile`, `docker-compose.yml`, `.github/**`     | Build, CI and release workflows.                                   |
| **Reviewer** | review only                                          | Independent read of the diff against CLAUDE.md rules before merge. |

Builder and Tester start together from an agreed interface; Security and Reviewer run after both finish; Docs runs last and verifies examples against real behavior.

## Stage 0: Repository foundation

Branch: `feature/scaffold`

| Agent    | Tasks                                                                                                                                                                  |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Builder  | `package.json` (bin, funding, `ai-providers@^0.5`, optional peers), strict `tsconfig` per CLAUDE.md, Zod and MCP SDK deps, `src/result.ts` re-export.                  |
| DevOps   | ESLint (block `process` outside `config.ts`, block `console.log`), Prettier, Bun scripts, CI workflow (typecheck, lint, format:check, test, build), Changesets config. |
| Tester   | `node:test` harness run by `bun test`, shared fake generators.                                                                                                         |
| Security | Secret scan before first push; confirm `.gitignore` covers `.env`.                                                                                                     |

Gate: empty server builds and CI is green on `dev`.

## Stage 1: Config and providers

Branch: `feature/config-providers`

| Agent    | Tasks                                                                                                                                                                                                                                                                                                                                                                                  |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Builder  | `src/config.ts` (only reader of `process.env`, returns `Result<ServerConfig>`, loopback-only local hosts unless allowed); `src/providers.ts` using `createTextGenerator` / `createImageGenerator`; unknown name error lists `TEXT_PROVIDERS` / `IMAGE_PROVIDERS`; missing peer returns a `Result` error naming the package; default Claude model `claude-sonnet-5-5`, effort `medium`. |
| Tester   | Config matrix (missing/invalid/valid env), unknown provider, missing peer, key masking in startup log.                                                                                                                                                                                                                                                                                 |
| Docs     | `.env.example`, README configuration table check.                                                                                                                                                                                                                                                                                                                                      |
| Security | Verify keys never reach logs or error strings.                                                                                                                                                                                                                                                                                                                                         |

Gate: config and provider tests pass with zero network access.

## Stage 2: MCP over stdio

Branch: `feature/stdio-text-tools`

| Agent    | Tasks                                                                                                                                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Builder  | `src/index.ts` transport selection; `src/transports/stdio.ts`; `src/tools/listProviders.ts`, `src/tools/generateText.ts` (Zod schema, handler, registration); prompt size cap and `timeoutMs`; provider failures become `isError: true` results. |
| Tester   | In-memory MCP client tests: success, validation failure, provider failure, provider/model not configured, oversize prompt.                                                                                                                       |
| Security | Confirm stdout carries only protocol messages; clients cannot supply keys or hosts.                                                                                                                                                              |
| Docs     | Claude Desktop and Claude Code snippets, tool examples.                                                                                                                                                                                          |

Gate: manual smoke test from Claude Code via `claude mcp add`. **Milestone: `0.1.0` candidate (text over stdio).**

## Stage 3: Streamable HTTP transport

Branch: `feature/http-transport`

| Agent    | Tasks                                                                                                                                                                                                                              |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Builder  | `src/transports/http.ts`: bind `127.0.0.1`, bearer auth (constant-time compare), `Origin` allow list, JSON only; first-run token generation stored with restrictive file permissions, location printed to stderr, never the token. |
| Tester   | Missing/wrong token, bad origin, valid request, non-loopback bind refused, token never in logs.                                                                                                                                    |
| Security | Threat-model pass: DNS rebinding, CSRF from browsers, token storage, request size limits.                                                                                                                                          |
| Docs     | HTTP security model section.                                                                                                                                                                                                       |

Gate: Security signs off before merge. Resolves the REST open decision (default: MCP only; REST deferred).

## Stage 4: Image generation

Branch: `feature/generate-image`

| Agent    | Tasks                                                                                                                                               |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Builder  | `src/tools/generateImage.ts`; image content (base64) plus MIME type; caps on image count and bytes (input and output); decide base64 payload limit. |
| Tester   | Fake `ImageGenerator`; oversize and bad-MIME inputs; `mode` handling.                                                                               |
| Security | Validate MIME and magic bytes of client-supplied images.                                                                                            |
| Docs     | `generate_image` example and limits.                                                                                                                |

Gate: limits documented; `bun run live-check` (opt-in, uses `.env`) passes for at least one hosted and one local provider.

## Stage 5: Containerization

Branch: `feature/docker`

| Agent    | Tasks                                                                                                                                                                                                                        |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DevOps   | Multi-stage `Dockerfile`, non-root user, no `.env` or keys in image (`.dockerignore`); `docker-compose.yml` publishing on `127.0.0.1` only; env/secrets at run time; Ollama host/Tailscale example with explicit host allow. |
| Security | Inspect image layers for secrets; verify non-root and port binding.                                                                                                                                                          |
| Docs     | Docker section.                                                                                                                                                                                                              |

Gate: container starts, answers `list_providers`, and `docker history` shows no secrets.

## Stage 6: Release

Branch: `feature/release-0.1.0`

| Agent    | Tasks                                                                                                                                                                                                                             |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docs     | Final README pass (disclaimer, privacy, every env var, every tool), LICENSE/COPYRIGHT disclaimer, changelog note of the pinned `ai-providers` version.                                                                            |
| DevOps   | Release workflow: tag must match `package.json`, commit must be on `main`, then typecheck, lint, test, build, `npm publish --provenance --access public` with `NPM_TOKEN`. Confirm package name `ai-providers-mcp` is still free. |
| Security | Final secret scan of full history.                                                                                                                                                                                                |
| Reviewer | Whole-repo review against CLAUDE.md.                                                                                                                                                                                              |

Release steps: on `dev` run `bun run version-packages`; PR `dev` to `main` (merge commit); tag `main` `v0.1.0` and push the tag.

## Later (post 0.1.0, unscheduled)

- Optional JSON-output helper for `generate_text` (validate against a client-supplied JSON Schema, one retry).
- Plain REST endpoints for non-MCP clients, only if needed.
- Streaming text responses.
- Per-client rate limiting and usage logging (no prompt content).
- Persistence, only if required: Prisma, singular table names, snake_case columns, UUID keys, `created_at` / `updated_at`.

## Open decisions

| Decision                          | Default                          | Decide by |
| --------------------------------- | -------------------------------- | --------- |
| REST endpoints in addition to MCP | MCP stdio, then HTTP; REST later | Stage 3   |
| JSON-output helper                | Defer                            | Post 0.1  |
| Base64 image payload limits       | Set conservative caps            | Stage 4   |
