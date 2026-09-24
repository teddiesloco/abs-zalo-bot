#!/usr/bin/env node
import { doctorHermes, parseCliArgs } from './hermes-install-lib.js';
import { loadRepoEnv } from './setup-env.js';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

try {
  const args = parseCliArgs(process.argv.slice(2));
  const sidecar = args.sidecarRoot || resolve(process.cwd());
  const envPath = join(sidecar, '.env');
  if (existsSync(envPath)) loadRepoEnv(envPath);

  const result = doctorHermes(args);
  for (const check of result.checks) console.log(`[${check.ok ? 'PASS' : 'FAIL'}] ${check.name}${check.detail ? ` - ${check.detail}` : ''}`);
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  console.error(`[FAIL] ${error?.message || error}`);
  process.exitCode = 1;
}
