# Operations runbook

## Start

```bash
npm run doctor
npm start
```

Check:

```bash
curl -s http://127.0.0.1:3871/healthz
```

Expected basic fields include `ok: true`, a status, and `listener` state. A persisted session alone is not a live listener.

## Stop safely

1. turn on Kill switch if outbound must stop immediately;
2. press `Ctrl+C` for foreground;
3. verify the process has exited;
4. do not delete `data/` as a substitute for stopping.

## Emergency pause

Dashboard: **Kill switch ON**.

API:

```bash
curl -X POST http://127.0.0.1:3871/api/kill-switch \
  -H 'content-type: application/json' \
  -d '{"paused":true}'
```

Resume only after checking destination, allowlist, account and recent audit.

## Daily check

```bash
npm run doctor
npm run status
curl -s http://127.0.0.1:3871/healthz
```

Look for:

- connected account/listener;
- destination configured and expected;
- source modes unchanged;
- global pause state;
- no recent listener error;
- no unexpected outbound receipt.

## Data hygiene

- raw text retention is local policy, not a default sharing channel;
- redact phone/email before AI/report paths;
- retain only what the project needs;
- never upload `data/` to an issue or public repo;
- session and QR are credentials/temporary auth material.

## 24/7 boundary

A systemd file is a template, not evidence of a running service. Before enabling a persistent service, verify:

1. foreground startup;
2. health endpoint;
3. listener heartbeat;
4. pause/resume;
5. restart behavior;
6. logs do not expose secrets;
7. rollback/disconnect.

Use a dedicated account and explicit approval. CI never enables systemd.
