# Agent Business System (ABS) brand contract

## Canonical identity

- **Brand:** Agent Business System
- **Short name:** ABS
- **Product:** ABS Zalo Bridge
- **Product line:** ABS Channel Intelligence
- **Watermark:** `ABS · Agent Business System`

The canonical machine-readable source is `brand.json`; runtime code reads it through `src/brand.js`.

## Where the mark appears

The ABS mark is intentionally present in:

- package metadata;
- `brand.json` and API metadata;
- `/healthz`, `/api/health`, `/api/status`, and `/api/battle-ready` under a `brand` field;
- dashboard title, `meta` tags, `data-abs-brand`, visible header watermark, and footer watermark;
- README, agent handoff, CLI prompts, and release docs.

## Where the mark does not appear by default

Do **not** automatically append ABS to:

- raw inbound Zalo messages;
- customer-facing replies;
- operational reports sent to a configured destination;
- provider payloads;
- user names, group names, IDs, session files, or database rows;
- credentials, webhook signatures, QR images, or logs.

This keeps branding separate from user data and prevents an internal platform label from leaking into a customer or operator message unexpectedly.

If a workflow explicitly needs a branded outbound footer, it must opt in at that workflow layer and test the exact resulting copy. It must never be added by the low-level adapter or webhook parser.

## Agent rule

Agents may update the central metadata source and surfaces above. They must not invent alternate ABS names, URLs, or watermarks in individual modules. They must not replace the placeholder public URLs with private account URLs or credentials.

## Release rule

Before publishing, verify `brand.json`, `package.json`, UI metadata, API metadata, and docs agree on the same brand/product/short name. Run the normal test and public release gates.
