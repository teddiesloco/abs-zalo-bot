## What changed?

<!-- Describe the behavior change and why it is needed. -->

## Safety impact

- [ ] No outbound behavior changed.
- [ ] If outbound behavior changed, an explicit policy test proves unapproved recipients remain blocked.
- [ ] OA and personal QR paths remain isolated.
- [ ] No live account, credential, QR, session, raw message, or personal data was added.

## Verification

```text
npm test
npm run validate-config
npm run secret-scan
npm run syntax-check
npm run self-check
```

<!-- Paste exit codes and concise output. Redact all sensitive values. -->
