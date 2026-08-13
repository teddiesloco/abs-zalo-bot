#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Node.js is not installed. Install Node.js 22.5+ and run this file again.' >&2
  exit 1
fi

exec node scripts/setup.js "$@"
