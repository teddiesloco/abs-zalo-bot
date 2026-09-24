#!/usr/bin/env node
import { parseCliArgs, uninstallHermes } from './hermes-install-lib.js';
import { loadRepoEnv } from './setup-env.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

try {
  const options = parseCliArgs(process.argv.slice(2));
  const sidecar = options.sidecarRoot;
  const envPath = join(sidecar, '.env');
  if (existsSync(envPath)) loadRepoEnv(envPath);

  const result = uninstallHermes(options);
  for (const path of result.removed) console.log(`[REMOVED] ${path}`);
  console.log('Đã giữ nguyên .env, phiên Zalo, SQLite và config.yaml.');
} catch (error) {
  console.error(`[FAIL] ${error?.message || error}`);
  process.exitCode = 1;
}
