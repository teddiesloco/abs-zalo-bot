# ABS-Zalo-Bot — Offline Harness

## Goal

Tests need no QR, no Zalo credential, no Gemini/DeepSeek/Hermes API key, no n8n server and no real network.

## Fakes

- `fakeFetch`: records method, URL, headers and form/body; returns token/provider fixtures.
- `fakeClientFactory`: simulates the QR callback, session login and listener.
- `tmpDir`: a temporary SQLite runtime, cleaned up by the test runner.
- `fakeClock`: tests token expiry and cooldown using injected timestamps.

## Required fixtures

1. A successful OA token refresh.
2. A still-valid OA access token that is not refreshed again.
3. An OAuth 401/invalid response that is not blindly retried.
4. Refresh-token rotation that writes no secret to the output.
5. A valid OA user text event.
6. A non-text OA event, and a payload with missing fields.
7. A valid and an invalid webhook signature, when enabled.
8. A personal empty allowlist being blocked.
9. Multi-bot/account with no cross-tenant sending.
10. Duplicate, over-long, secret-looking bodies and a paused policy all being blocked.
11. MCP starting while the daemon is down, reporting the error only on stderr.
12. The QR endpoint returning a QR but never a cookie, IMEI or session.

## Commands

```bash
npm ci
npm test
npm run self-check
npm run secret-scan
npm run validate-config
```

## Evidence format

Every command must record its real exit code and stdout/stderr. `npm run smoke` is a live daemon smoke test — run it only after the operator has deliberately logged in, and never conclude "live" from a stale database.
