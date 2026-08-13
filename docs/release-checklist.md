# Public release checklist

## Repository hygiene

- [ ] `.env`, `data/`, sessions, QR, SQLite and logs are ignored.
- [ ] `config/bots.json` is ignored; only the example registry is public.
- [ ] No real account/group/user IDs, phone numbers, names, cookies, IMEI or provider payloads.
- [ ] No customer/project identity in default docs/source/tests.
- [ ] No secret in README, tests, CI, issue template or agent handoff.

## Behavior

- [ ] Personal QR and Official OA remain separate.
- [ ] Personal source defaults to read-only/listen-only.
- [ ] Destination is empty until selected.
- [ ] OA example is draft-first/disabled until configured.
- [ ] Empty allowlist fails closed.
- [ ] Webhook only validates/normalizes/acknowledges.
- [ ] No webhook-to-AI or webhook-to-send hidden path.
- [ ] Kill switch and pause paths work.

## Commands

```bash
npm ci
npm test
npm run validate-config
npm run secret-scan
npm run syntax-check
npm run self-check
git diff --check
```

## Live boundary

- [ ] Foreground health checked.
- [ ] QR manually scanned by owner on a dedicated account, if applicable.
- [ ] No CI login or live send.
- [ ] No systemd/Docker enable without approval.
- [ ] If published, GitHub remote/visibility was read back from a real command.
- [ ] If auth/publish is unavailable, report blocked; never claim public release.

## Evidence receipt

Record:

- command;
- exit code;
- test count;
- relevant endpoint/status;
- files changed;
- unresolved blocker;
- next action.

Redact all runtime secrets and personal data.
