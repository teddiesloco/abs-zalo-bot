#!/usr/bin/env bash
# stdio MCP entrypoint for Hermes / Claude / Cursor
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export ZALO_BRIDGE_URL="${ZALO_BRIDGE_URL:-http://127.0.0.1:3871}"
# Never print to stdout except MCP JSON-RPC (handled by node server)
exec node "$ROOT/mcp/server.js"
