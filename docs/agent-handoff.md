# Agent handoff — read this before doing anything

This is the context packet for Claude Code, Codex CLI, Hermes, OpenCode or any other agent. An agent has no authority to speak or act for the owner in any public action. Work only inside the approved boundary.

> **Tiếng Việt:** Đọc `AGENTS.md` trước, chạy `npm run doctor`, chỉ mở file liên quan. Không nhập OTP/PIN, không gửi tin thật, không deploy. Nói "xong" thì phải kèm bằng chứng chạy thật (command + exit code).

## Required boot sequence

```bash
pwd
node --version
npm run doctor
```

Then read only what the task touches:

1. `AGENTS.md` — non-negotiable rules.
2. `README.md` — user flow.
3. `internal/00-DESIGN.md` — architecture.
4. `internal/01-SPEC.md` — contract.
5. `internal/02-PLAN.md` — task order.
6. `internal/04-VERIFY.md` — evidence gate.
7. `docs/` — specific guides.

Do not load the whole source tree when the task touches one module.

## Default goals

- make it usable by an owner who does not write code;
- prefer wizards, clear docs, and commands with stable output;
- keep Personal QR and Official OA separate;
- run deterministic safety before any AI/provider call;
- test offline before live verification.

## Allowed and forbidden

An agent may:

- read and edit source in the repo;
- write docs, tests and example config;
- run `npm test`, the public gates, and self-check;
- run the local server in foreground or background with a health check;
- create drafts or synthetic test fixtures.

An agent must never do these on its own:

- enter an OTP/PIN, cookie, IMEI, refresh token or API secret;
- ask the owner to paste a secret into chat;
- send a real message, broadcast, spam, publish, deploy, or enable systemd;
- change credentials or access rights;
- delete `data/`, a session, the database, or files in bulk;
- claim "ran / live / published" without real output.

If a decision changes scope, money, permissions, public exposure, or is hard to roll back: ask the owner exactly one question, with a recommended option.

## Standard task flows

### Install/setup

```bash
bash setup.sh --non-interactive
npm run doctor
```

If Node is missing, report the exact version present and give install instructions. Do not install system software without permission.

### Code change

```text
read contract -> write/fix test -> run test -> smallest fix -> run test again -> gates -> report evidence
```

Never weaken safety behaviour just to make a test pass.

### Server/background

If running in the background:

1. start it with the environment's process manager;
2. check `GET /healthz`;
3. check `GET /api/health` behind the auth boundary;
4. continue only when output confirms the server is ready;
5. stop the process afterwards if it was only for a test.

### QR/login

Stop at the UI checkpoint. Walk the owner through scanning the QR and confirming on their phone themselves. Never read or display session material.

### OA

The OA webhook only ingests, normalises and acknowledges. Do not wire AI or send into the webhook without approval, a queue, a policy, and separate outbound tests.

## Safe commands

```bash
npm run doctor
npm test
npm run validate-config
npm run secret-scan
npm run syntax-check
npm run self-check
npm run status
npm run smoke
```

`npm run smoke` does not send for real by default. `BATTLE_SEND=true` is a separate side effect and is never enabled automatically.

## Required report format

Every time you report back:

```text
Conclusion:  one sentence
Did:         specific files/commands
Evidence:    exit code, test count, endpoint or real artifact
Impact:      if any
Remaining:   real blockers/uncertainty
Next step:   one clear action
```

Never put a secret, raw message, cookie, QR, database or real ID into a report.

## If the user only says "install it for me"

Use the default flow:

1. local setup;
2. run tests and gates;
3. start the dashboard on localhost;
4. walk them through the QR manually;
5. stay on `listen_only`;
6. ask exactly one question when a destination must be chosen;
7. send no real messages.

## If the user does not write code

Do not make them read a stack trace. Translate the error into:

- what did not finish;
- what it affects;
- what they need to click or type;
- what you verified.

## Release / public repo

Before proposing to make anything public:

```bash
npm ci
npm test
npm run validate-config
npm run secret-scan
npm run syntax-check
npm run self-check
git diff --check
```

Without GitHub auth, a remote, and a publish receipt, report `publish blocked`. Never assume it is public.
