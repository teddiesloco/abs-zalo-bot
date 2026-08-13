# ABS-Zalo-Bot — Verification Gate

## Local artifact

- [ ] `npm ci` exit 0.
- [ ] `npm test` exit 0, test count ghi từ output thật.
- [ ] `npm run self-check` exit 0; output không có cookie, imei, token, refresh token, phone hoặc raw session.
- [ ] `npm run validate-config` kiểm tra example registry và TOML.
- [ ] `npm run secret-scan` exit 0 trên tracked/public files.
- [ ] `node --check` cho mọi `.js` source mới.

## OA adapter

- [ ] Fake fetch chứng minh token URL, form fields, secret header policy, expiry và rotation.
- [ ] Fake fetch chứng minh send URL, method, `access_token` header, exact JSON body.
- [ ] Provider 4xx/5xx được phân loại; không retry credential/policy.
- [ ] Webhook normalize không gọi AI/provider và trả event ID ổn định.

## Personal QR

- [ ] QR connect endpoint trả nhanh trước khi user quét.
- [ ] session path nằm ngoài Git, mode 0600.
- [ ] `GET /healthz` phân biệt persisted session với live listener.
- [ ] one-listener/account và dedicated-account warning hiện trong docs.

## Deployment

- [ ] Dockerfile/Compose parse và healthcheck trỏ `/healthz`.
- [ ] systemd chỉ là template, không enabled.
- [ ] bind mặc định localhost hoặc reverse proxy có auth; không expose dashboard token qua query trong docs.

## Public release

- [ ] `git ls-files` không gồm `data/`, `.env`, session, QR, database, logs.
- [ ] Không còn customer/project identity trong default source/config/test.
- [ ] README phân biệt OA official và personal unofficial.
- [ ] `git diff --check` sạch.
- [ ] GitHub remote/repo visibility đọc lại sau publish; nếu auth thiếu thì báo blocked, không giả publish.
