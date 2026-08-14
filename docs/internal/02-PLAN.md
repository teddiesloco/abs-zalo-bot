# ABS-Zalo-Bot — Incremental Build Plan

## Build order

### T1 — Public-safe baseline
- Replace customer-specific defaults in docs, config, source comments and tests.
- Add `AGENTS.md`, MIT license, security policy, issue templates and CI.
- Acceptance: a repository scan finds no customer/project identity, real IDs, or phone-like defaults.

### T2 — Bot registry
- Add schema validator and example `config/bots.example.json`.
- Acceptance: valid registry loads; invalid IDs, duplicate bot IDs and missing adapter fail closed.

### T3 — OA adapter tracer bullet
- Test token refresh, expiry cache, rotated refresh token and text send with fake fetch.
- Implement `src/oa_adapter.js` with no network on import.
- Acceptance: offline tests prove exact method/URL/body/headers and bounded error handling.

### T4 — OA webhook
- Test user text normalization, malformed payload, signature gate and event ID.
- Add route to Express app, return fast acknowledgement.
- Acceptance: no provider call is made by webhook parser; malformed event is safe.

### T5 — Personal adapter boundary
- Keep QR/session runtime; expose generic status labels and remove hard-coded destination assumptions.
- Acceptance: existing personal tests remain green; no session appears in output.

### T6 — Integrations and deployment
- Add n8n starter workflow, Hermes MCP config, Claude/Codex handoff, Docker Compose, healthcheck and systemd template.
- Acceptance: JSON/YAML parse, `npm ci`, tests, self-check and container build check pass where Docker is available.

### T7 — Release gate
- Secret scan, public-file inventory, package metadata, git diff review.
- Acceptance: no runtime data tracked; README states OA/personal boundaries; GitHub publish remains blocked until auth exists.

## Out of scope

- Do not merge a minified third-party n8n package into the runtime.
- Do not auto-send messages from the OA webhook in the core.
- Do not add broadcast, friend-list mutation, group administration, or arbitrary personal sends.
- Do not enable systemd on this machine during the productization task.
- Do not make the repo public before the secret scan and test evidence are clean.
