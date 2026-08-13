# AGENTS.md — public repository workflow

This file describes the safe contribution boundary for the repository. It is not a production credential store and it must not contain account-specific instructions.

## Scope

- Treat `brand.json` as the canonical Agent Business System (ABS) metadata source; do not invent alternate brand names or watermarks.
- Keep the ABS mark in package/UI/API/docs surfaces only. Do not append it to raw Zalo messages, customer replies, reports, IDs, sessions, or logs unless a workflow explicitly opts in.
- Keep the official Zalo OA adapter and the unofficial personal QR adapter separate.
- Keep deterministic normalization, policy, routing, audit, and redaction in code; do not delegate safety decisions to an LLM.
- Treat every outbound message as a side effect. `draft_first` and an empty recipient allowlist must remain fail-closed.
- Do not add broadcast, spam, friend mutation, group administration, login bypass, OTP/PIN handling, or arbitrary personal sends.

## Local development

```bash
npm ci
npm test
npm run validate-config
npm run secret-scan
npm run syntax-check
npm run self-check
```

`npm run smoke` is a daemon smoke test. Run it only against a deliberately configured local instance. Set `BATTLE_SEND=true` only when an operator has explicitly approved one real destination send.

## Data and secrets

- Never commit `.env`, `data/`, SQLite files, QR images, sessions, logs, cookies, IMEI values, OAuth tokens, or provider payloads.
- Use `config/bots.example.json` as the only public registry example. Put credential *references* there; keep credential values in the environment or a secret manager.
- Tests must use clearly synthetic fixtures such as `*-fixture` and must not contain real phone numbers, user IDs, group IDs, or names.
- Do not paste runtime status, raw message content, session material, or credentials into issues, pull requests, chat, or CI logs.

## Review boundary

Before merging a change, verify:

1. `npm test` is green.
2. Public gates are green.
3. `brand.json`, package metadata, API metadata, dashboard mark, and docs agree on ABS identity.
4. OA webhook parsing remains ingress-only and does not send or call an AI provider.
5. Personal QR remains unofficial, opt-in, and dedicated-account only.
6. No deployment, public publish, credential change, or live message send is performed by CI.
