# Copy-paste prompts for agents

These prompts are for an owner who does not write code. Paste one as-is into Claude Code, Codex CLI, Hermes or a similar agent while sitting in the repo directory.

> **Tiếng Việt:** Mỗi khối dưới đây dán nguyên văn cho agent. Chúng đã kèm sẵn ranh giới an toàn — không in secret, không gửi tin thật, không deploy — nên cứ dùng thẳng, đừng rút gọn.

## First install

```text
Read AGENTS.md, docs/agent-handoff.md and README.md first. Check for Node.js 22.5+. Run bash setup.sh --non-interactive. Never request or print a secret, cookie, IMEI, QR/session, OTP or PIN. Do not log in, do not send messages, do not deploy. Then report the command, the exit code and the next step in plain language I can follow.
```

## Open it up for the owner

```text
Read docs/agent-handoff.md. Run npm run doctor, then start the server in the foreground if doctor passes. Check GET /healthz before telling me the server is ready. Print the dashboard URL but never the token. Walk me through scanning the QR on my own phone; do not enter an OTP/PIN for me. Keep sources on listen_only and send no real messages.
```

## Check the current state

```text
Change nothing and send nothing. Run npm run doctor, npm run status and healthz. Explain: is it connected, is the listener alive, is a destination set, which source mode is active, and where the kill switch is. Do not display a raw session or any secret.
```

## Fix failing tests

```text
Read AGENTS.md and internal/04-VERIFY.md. Run npm test. Open only the files related to the first failing test. Make the smallest fix, then re-run the tests and the public gates. Do not skip tests, do not disable Policy Guard, and do not touch .env, data/ or the session.
```

## Turn on OA

```text
Read docs/official-oa.md and internal/01-SPEC.md. Only verify the example registry, the env variable names, and the webhook signature/normalisation using fixtures. Do not ask me to paste a credential into chat. Do not enable approved_send, do not send a provider message, do not publish or deploy.
```

## Prepare a public release

```text
Read docs/release-checklist.md. Run npm ci, npm test, npm run validate-config, npm run secret-scan, npm run syntax-check, npm run self-check and git diff --check. Report blocked if there is no GitHub auth, remote, or publish receipt — do not assume anything is already public.
```

## Expected report format

```text
Conclusion:
Did:
Evidence:
Impact:
Remaining:
Next step:
```
