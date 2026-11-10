---
'ai-providers-mcp': minor
---

Add a Dockerfile and docker-compose.yml. The image is multi-stage, runs as a non-root user, holds no keys or `.env`, and reads keys from the environment or from files (`*_FILE`, for Docker secrets). The compose file publishes the port on 127.0.0.1 only, keeps the generated token in a volume, and runs with a read-only root filesystem. New `MCP_ALLOWED_HOSTS` setting accepts extra `Host` header values, so a remapped published port is not rejected.
