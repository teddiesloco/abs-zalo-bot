# ABS-Zalo-Bot — Verification Gate

## Local artifact

- [ ] `npm ci` exit 0.
- [ ] `npm test` exits 0, with the test count taken from real output.
- [ ] `npm run self-check` exits 0, and the output contains no cookie, IMEI, token, refresh token, phone number or raw session.
- [ ] `npm run validate-config` checks the example registry and the TOML.
- [ ] `npm run secret-scan` exits 0 across tracked/public files.
- [ ] `node --check` passes on every new `.js` source file.

## OA adapter

- [ ] Fake fetch proves the token URL, form fields, secret header policy, expiry and rotation.
- [ ] Fake fetch proves the send URL, method, `access_token` header and exact JSON body.
- [ ] Provider 4xx/5xx responses are classified, and credential/policy errors are not retried.
- [ ] Webhook normalisation calls no AI or provider and returns a stable event ID.

## Personal QR

- [ ] The QR connect endpoint returns quickly, before the user scans.
- [ ] The session path is outside Git, with mode 0600.
- [ ] `GET /healthz` distinguishes a persisted session from a live listener.
- [ ] The one-listener-per-account rule and the dedicated-account warning appear in the docs.

## Deployment

- [ ] The Dockerfile/Compose parses and its healthcheck points at `/healthz`.
- [ ] systemd is a template only, never enabled.
- [ ] The default bind is localhost, or an authenticated reverse proxy, and no doc exposes the dashboard token through a query string.

## Public release

- [ ] `git ls-files` includes no `data/`, `.env`, session, QR, database or logs.
- [ ] No customer/project identity remains in the default source, config or tests.
- [ ] The README distinguishes official OA from unofficial personal.
- [ ] `git diff --check` is clean.
- [ ] GitHub remote/repo visibility is re-read after publishing; if auth is missing, report blocked rather than faking a publish.
