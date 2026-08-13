# GitHub Copilot instructions

Read `AGENTS.md` first. Summary of the boundary:

- Every outbound message is a side effect — `draft_first` and an empty allowlist stay fail-closed.
- Safety decisions live in code, not in prompts.
- Do not add broadcast, spam, friend-list mutation, group administration, login bypass, OTP/PIN handling.
- Zalo OA and Zalo personal QR are two separate adapters.
- Never hardcode server paths, endpoints or tokens — use environment variables.

Verify before suggesting a commit: `npm test`, `npm run validate-config`, `npm run secret-scan`.

Tieng Viet: khong tu gui tin ra ngoai, khong hardcode duong dan hay token,
Zalo OA va Zalo ca nhan tach rieng.
