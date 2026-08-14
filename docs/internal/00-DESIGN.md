# ABS-Zalo-Bot — Design

## Positioning

ABS Zalo Bot is an open-source adapter that packages Zalo as a channel adapter for Hermes Agent, Claude Code, Codex, n8n and other agent runtimes.

One installation can manage several independent bots. Each bot has its own `bot_id`, adapter, tenant, session/credential, allowlist, policy and audit trail.

## Core principles

- **Adapter first, platform second:** every agent runtime uses the same contract. Never patch the core agent.
- **Official first:** Zalo OA is the default production path. Personal QR is an optional adapter, on a dedicated account, with its ToS risk stated openly.
- **Fail-closed:** with no configured bot, token, allowlist or outbound policy, nothing is sent.
- **One listener per account:** never run two listeners on the same personal account.
- **Credential isolation:** tokens and sessions stay in the local runtime — never in Git, prompts, logs, status responses or memory.
- **Human boundary:** drafting is not sending. Publish, broadcast, credential changes and deploys each need their own approval.
- **Deterministic core:** normalisation, dedupe, rate limiting, token refresh, routing and policy are never handed to an LLM.

## Architecture

```text
Claude Code / Codex / n8n / your agent runtime
                         |
              ABS channel contract + MCP
                         |
                 Bot Registry / Tenant
                    /             \
           Personal QR          Zalo OA
           (zca-js)        (official OAuth/webhook)
                |                    |
          session 0600        access token memory
                \                    /
                 Policy + Store + Audit
                         |
             optional Hermes brain / n8n workflow
                         |
                  approved outbound
```

## Onboarding flow

1. The agent reads `AGENTS.md` and `docs/agent-handoff.md`.
2. Create `bots.json` from `config/bots.example.json`. Never write a secret into it.
3. For personal: open the dashboard, generate the QR, the user scans it on their phone, and the session is stored locally with mode 0600.
4. For OA: configure app ID/secret/refresh token through env, then register a public HTTPS webhook.
5. Run the offline self-check first, verify in the foreground next, and enable systemd/Docker 24/7 only after review.

## Scope of v0.1

- The existing Personal QR runtime, a multi-account-ready schema, and the onboarding endpoint.
- OA OAuth refresh, webhook normalisation, and a text-send adapter with fetch injection for offline tests.
- Bot registry/config example, MCP facade, n8n workflow starter, Docker Compose, systemd template.
- Public-safe docs, CI, secret scanning and a deterministic test harness.

## Out of scope for v0.1

- No bypassing Zalo login, CAPTCHA, rate limits or ToS.
- No automated spam or broadcast from a personal account.
- No creating an OA, registering an app, entering an OTP/PIN, or self-approving production.
- No mandatory AI provider in the core. A workflow may use Hermes, Gemini, DeepSeek or any other provider over HTTP.
- No promise of "100% safe". Official OA lowers platform risk; policy and rate limiting remain the deployer's responsibility.

## Definition of done

A clean clone must be able to run `npm ci` → `npm test` → `npm run self-check` → the localhost dashboard; expose its contract to Claude Code/Codex; set up either the personal QR path or the OA token path with no secret in the repo; and produce policy/audit evidence for every outbound message.
