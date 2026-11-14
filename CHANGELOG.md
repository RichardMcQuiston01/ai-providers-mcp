# CHANGELOG

## 0.1.0

### Minor Changes

- f0c873f: Add environment-based configuration and a provider registry. Providers are enabled by their API key, `provider` and `model` can only select among configured providers, and local hosts stay on loopback unless listed in `AI_ALLOWED_HOSTS`.
- d7c6004: Add a Dockerfile and docker-compose.yml. The image is multi-stage, runs as a non-root user, holds no keys or `.env`, and reads keys from the environment or from files (`*_FILE`, for Docker secrets). The compose file publishes the port on 127.0.0.1 only, keeps the generated token in a volume, and runs with a read-only root filesystem. New `MCP_ALLOWED_HOSTS` setting accepts extra `Host` header values, so a remapped published port is not rejected.
- 69da3d7: Add the `generate_image` tool. It takes a prompt, optional instructions, input images, provider and mode, and returns an MCP image content block with a short note. Client images are checked by their bytes, `mode` can only be one the provider lists, the real output type comes from the bytes, and outputs over `AI_MAX_OUTPUT_IMAGE_BYTES` (default 16 MiB) are refused.
- 198607b: Add the Streamable HTTP transport (`--http` or `MCP_TRANSPORT=http`). It binds loopback only, requires a bearer token (generated into a 0600 file on first run if `MCP_AUTH_TOKEN` is unset), checks the Host and Origin headers, and serves JSON only.
- 3e846b3: Add the MCP server over stdio with `list_providers` and `generate_text`. Input is validated with Zod and capped by the configured limits, images are checked by their bytes, and every failure comes back as a tool result with `isError: true`.

### Patch Changes

- 022c23a: Require `@richardmcquiston01/ai-providers` `^0.5.4`. Version 0.5.4 is the first release whose `checkImageInput` checks an image's bytes as well as its declared type; this server already checked the bytes itself. The README now shows how to run with `npx` plus the optional provider SDK (`npx -y -p ai-providers-mcp -p @anthropic-ai/sdk ai-providers-mcp`), because `npx` does not install optional peers.
