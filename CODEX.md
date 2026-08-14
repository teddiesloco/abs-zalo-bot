# Codex CLI entrypoint


Start with:

```bash
node --version
npm run doctor
```

For user installation, use:

```bash
bash setup.sh --non-interactive
```

For code changes, use test-first incremental work and run the public gates before reporting done. Do not ask for secrets in chat, do not enter OTP/PIN, and do not perform live send/publish/deploy/systemd actions without explicit approval.

Required final checks:

```bash
npm test
npm run validate-config
npm run secret-scan
npm run syntax-check
npm run self-check
```

Return command, exit code, artifact/file, and remaining blocker. Never fabricate runtime evidence.
