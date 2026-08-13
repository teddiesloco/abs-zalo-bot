# Security policy

## Supported versions

Security fixes target the latest release on the default branch. Older snapshots may be unsupported.

## Reporting a vulnerability

Please do not open a public issue for an undisclosed vulnerability.

Use GitHub Security Advisories for this repository, or contact the repository maintainers through the private security channel configured by the hosting organization. Include:

- a short description and impact;
- affected version or commit;
- minimal reproduction steps that do not contain credentials or personal data;
- a suggested mitigation, if known.

Do not attach `.env` files, QR images, session files, cookies, IMEI values, OAuth tokens, database files, or raw Zalo exports. Redact all user IDs, group IDs, phone numbers, and message text before sharing evidence.

## Security boundaries

The personal QR adapter uses an unofficial protocol and can be affected by platform changes or account restrictions. It is not a ban-proof or production-safe substitute for the official OA path. Review the policy, rate limits, destination, and account isolation before enabling outbound behavior.
