# Claude Code entrypoint

Before doing anything in this repository, read:

1. `AGENTS.md`
2. `BRAND.md`
3. `docs/agent-handoff.md`
4. `README.md`

Then run:

```bash
npm run doctor
```

Use the smallest relevant context and make incremental, tested changes. Never request or expose credentials, cookies, IMEI, QR/session material, OTP/PIN, raw Zalo exports, or real IDs. Never send a live message, publish, deploy, enable systemd, or change credentials without explicit approval.

Verification commands:

```bash
npm test
npm run validate-config
npm run secret-scan
npm run syntax-check
npm run self-check
```

Report real evidence only. `AGENTS.md` is the authoritative repository boundary.
