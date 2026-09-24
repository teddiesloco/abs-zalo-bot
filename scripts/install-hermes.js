#!/usr/bin/env node
import { installHermes, parseCliArgs } from './hermes-install-lib.js';
import { loadRepoEnv } from './setup-env.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

try {
  const options = parseCliArgs(process.argv.slice(2));
  const sidecar = options.sidecarRoot;
  const envPath = join(sidecar, '.env');
  if (existsSync(envPath)) loadRepoEnv(envPath);

  const result = await installHermes(options);
  for (const check of result.checks) console.log(`[PASS] ${check.name}${check.detail ? ` - ${check.detail}` : ''}`);
  console.log('\nCài đặt hoàn tất. Chạy `npm start`, mở http://127.0.0.1:3872 để quét QR, rồi xác lập UID chủ nhân theo README.');
  console.log('Sau khi đăng nhập, khởi động hoặc khởi động lại Hermes gateway theo cách máy này đang quản lý dịch vụ.');
} catch (error) {
  console.error(`[FAIL] ${error?.message || error}`);
  process.exitCode = 1;
}
