#!/bin/sh
# Loads secrets from files (Docker secrets) into the environment, then starts
# the server. For each of the variables below, NAME_FILE=/run/secrets/x reads
# the value from that file. Only variable names are ever printed, never values.
set -eu

for name in ANTHROPIC_API_KEY GEMINI_API_KEY OPENAI_API_KEY XAI_API_KEY MCP_AUTH_TOKEN; do
  file_variable="${name}_FILE"
  eval "file_path=\${${file_variable}:-}"
  eval "current_value=\${${name}:-}"
  if [ -n "$file_path" ]; then
    if [ -n "$current_value" ]; then
      echo "docker-entrypoint: both ${name} and ${file_variable} are set; use only one." >&2
      exit 1
    fi
    if [ ! -r "$file_path" ]; then
      echo "docker-entrypoint: ${file_variable} points to ${file_path}, which cannot be read." >&2
      exit 1
    fi
    secret_value="$(cat "$file_path")"
    export "${name}=${secret_value}"
    unset "${file_variable}"
  fi
done

exec "$@"
