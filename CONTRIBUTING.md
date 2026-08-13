# Contributing

Thanks for helping improve the bridge.

## Before opening a pull request

```bash
npm ci
npm test
npm run validate-config
npm run secret-scan
npm run syntax-check
npm run self-check
```

Do not run a live send as part of a pull request. The CI workflow never logs in, scans a QR code, calls a provider, or sends a Zalo message.

## Code expectations

- Keep policy and routing deterministic and easy to audit.
- Prefer small pure functions with offline tests.
- Keep official OA and personal QR code paths isolated.
- Preserve fail-closed defaults and explicit approval gates.
- Return stable error codes without provider payloads or credentials.
- Do not add account-specific fixtures, names, IDs, phone numbers, or message text.

## Commit and pull request content

Explain the behavior change, the safety impact, and the verification commands that were run. Use synthetic fixtures only. If a change affects an outbound path, include the exact policy test that proves an unapproved recipient remains blocked.
