# syntax=docker/dockerfile:1

ARG NODE_VERSION=22
ARG BUN_VERSION=1

# Stage 1: compile TypeScript to dist/ (dev dependencies live only here).
FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN bun run build

# Stage 2: production dependencies, plus the optional provider SDKs.
FROM oven/bun:${BUN_VERSION} AS deps
WORKDIR /app
# SDK peers for the hosted providers (Claude, OpenAI, Gemini). Ollama and Grok
# need none. `--omit=dev` keeps `bun add` from pulling the dev dependencies back in. Build a smaller image with --build-arg PEER_PACKAGES="".
ARG PEER_PACKAGES="@anthropic-ai/sdk@0 openai@7 @richardmcquiston01/gemini-icon-gen@0"
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production \
  && if [ -n "$PEER_PACKAGES" ]; then bun add --omit=dev $PEER_PACKAGES; fi

# Stage 3: the runtime image. No keys, .env or source files are copied in.
FROM node:${NODE_VERSION}-slim AS runtime
ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    MCP_HTTP_HOST=0.0.0.0 \
    MCP_HTTP_ALLOW_NON_LOOPBACK=true \
    MCP_HTTP_PORT=8787 \
    MCP_TOKEN_FILE=/data/token
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# /data holds the generated bearer token. Owned by the unprivileged user.
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh \
  && mkdir /data \
  && chown node:node /data \
  && chmod 0700 /data
USER node
VOLUME ["/data"]
EXPOSE 8787
# TCP check only: the MCP endpoint needs the bearer token, so it cannot be probed unauthenticated.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "require('node:net').connect(Number(process.env.MCP_HTTP_PORT), '127.0.0.1').on('connect', () => process.exit(0)).on('error', () => process.exit(1))"]
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
