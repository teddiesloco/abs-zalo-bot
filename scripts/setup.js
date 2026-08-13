#!/usr/bin/env node
/**
 * Friendly local setup/doctor entrypoint.
 *
 * Safe by design:
 * - never overwrites .env or config/bots.json;
 * - never asks for or prints secrets;
 * - never logs in, scans QR, enters OTP/PIN, or sends a message;
 * - runs deterministic local verification before telling the operator to start.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildOnboardingInfo } from "../src/onboarding.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIN_NODE = { major: 22, minor: 5 };
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function parseArgs(argv) {
  const flags = new Set();
  let command = "setup";
  for (const arg of argv) {
    if (arg.startsWith("--")) flags.add(arg);
    else if (!command || command === "setup") command = arg;
  }
  return { command, flags };
}

function nodeVersion() {
  const match = process.versions.node.match(/^(\d+)\.(\d+)/);
  return match ? { major: Number(match[1]), minor: Number(match[2]), raw: process.versions.node } : null;
}

function ensureNode() {
  const version = nodeVersion();
  if (!version || version.major < MIN_NODE.major || (version.major === MIN_NODE.major && version.minor < MIN_NODE.minor)) {
    throw new Error(
      `Node.js ${MIN_NODE.major}.${MIN_NODE.minor}+ is required; detected ${version?.raw || process.version}. Install a current Node.js LTS and run setup again.`,
    );
  }
  console.log(`PASS  Node.js ${version.raw}`);
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function ensureDir(relativePath, mode = 0o700) {
  const absolute = path.join(ROOT, relativePath);
  fs.mkdirSync(absolute, { recursive: true, mode });
  try {
    fs.chmodSync(absolute, mode);
  } catch {
    // Windows and restricted filesystems may not support chmod; the directory
    // still exists and the operator gets a concrete path to inspect.
  }
}

function copyIfMissing(sourceRelative, targetRelative, mode = 0o600) {
  const source = path.join(ROOT, sourceRelative);
  const target = path.join(ROOT, targetRelative);
  if (fs.existsSync(target)) {
    console.log(`KEEP  ${targetRelative} already exists (not overwritten)`);
    return false;
  }
  if (!fs.existsSync(source)) throw new Error(`Missing public template: ${sourceRelative}`);
  fs.copyFileSync(source, target);
  try {
    fs.chmodSync(target, mode);
  } catch {
    // Best effort on platforms without POSIX permissions.
  }
  console.log(`CREATE ${targetRelative}`);
  return true;
}

function ensureLocalFiles() {
  copyIfMissing(".env.example", ".env", 0o600);
  copyIfMissing("config/bots.example.json", "config/bots.json", 0o600);
  ensureDir("data", 0o700);
  ensureDir("data/sessions", 0o700);
  ensureDir("data/qr", 0o700);
  ensureDir("data/logs", 0o700);
}

function run(label, command, args, { allowFailure = false } = {}) {
  console.log(`RUN   ${label}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: { ...process.env, FORCE_COLOR: "0" },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  const code = Number.isInteger(result.status) ? result.status : 1;
  console.log(`${code === 0 ? "PASS" : "FAIL"}  ${label} (exit ${code})`);
  if (code !== 0 && !allowFailure) {
    throw new Error(`${label} failed with exit code ${code}`);
  }
  return code;
}

function npmRun(script, options = {}) {
  return run(`npm run ${script}`, npmCommand, ["run", script], options);
}

function checkExpectedFiles() {
  const required = [
    ".env.example",
    "config/bots.example.json",
    "config.toml",
    "public/index.html",
    "package-lock.json",
  ];
  const missing = required.filter((file) => !exists(file));
  if (missing.length) throw new Error(`Missing required files: ${missing.join(", ")}`);
  console.log(`PASS  Required public files (${required.length})`);
}

function readLocalEnvValue(key) {
  if (!exists(".env")) return "";
  const text = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
  const line = text.split(/\r?\n/).find((item) => item.trim().startsWith(`${key}=`));
  if (!line) return "";
  return line.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, "");
}

function localStatus() {
  const envPresent = exists(".env");
  const botsPresent = exists("config/bots.json");
  const dataPresent = exists("data");
  const token = readLocalEnvValue("DASHBOARD_TOKEN");
  const tokenConfigured = Boolean(token && token !== "change-me");
  return { envPresent, botsPresent, dataPresent, tokenConfigured };
}

function printDashboardInfo() {
  const env = exists(".env") ? fs.readFileSync(path.join(ROOT, ".env"), "utf8") : "";
  const readEnv = (key, fallback) => {
    const line = env.split(/\r?\n/).find((item) => item.trim().startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, "") || fallback : fallback;
  };
  const host = readEnv("HOST", "127.0.0.1");
  const port = readEnv("PORT", "3871");
  const token = readEnv("DASHBOARD_TOKEN", "");
  const onboarding = buildOnboardingInfo({
    host,
    port,
    accountId: readEnv("DEFAULT_ACCOUNT_ID", "default"),
    localPort: readEnv("QR_LOCAL_PORT", "13871"),
    sshUser: readEnv("DASHBOARD_SSH_USER", "user"),
    sshHost: readEnv("DASHBOARD_SSH_HOST", "your-vps-host"),
    publicUrl: readEnv("DASHBOARD_PUBLIC_URL", ""),
  });
  console.log(JSON.stringify({
    ok: true,
    bind: `${host}:${port}`,
    dashboard_url: onboarding.dashboard_url,
    connect_url: onboarding.connect_url,
    qr_api_url: onboarding.qr_api_url,
    vps: onboarding.vps,
    dashboard_token_configured: Boolean(token && token !== "change-me"),
    note: "Open connect_url in a browser. URLs only; no QR image or token value is printed.",
  }, null, 2));
}

function doctor() {
  ensureNode();
  checkExpectedFiles();
  const local = localStatus();
  const issues = [];
  if (!local.envPresent) issues.push(".env_missing_run_setup");
  if (!local.botsPresent) issues.push("config/bots.json_missing_run_setup");
  if (!local.dataPresent) issues.push("data_missing_run_setup");
  if (!local.tokenConfigured) issues.push("dashboard_token_not_configured_local_only_warning");
  console.log(JSON.stringify({
    ok: issues.every((issue) => issue.endsWith("warning")),
    local: {
      env_present: local.envPresent,
      bots_config_present: local.botsPresent,
      data_present: local.dataPresent,
      dashboard_token_configured: local.tokenConfigured,
    },
    issues,
  }, null, 2));
  if (issues.some((issue) => issue.includes("missing"))) return 1;

  npmRun("validate-config");
  npmRun("secret-scan");
  npmRun("syntax-check");
  npmRun("self-check");
  return 0;
}

function setup(flags) {
  ensureNode();
  checkExpectedFiles();
  ensureLocalFiles();
  if (!flags.has("--skip-install")) npmRun("install:locked");
  npmRun("test");
  npmRun("validate-config");
  npmRun("secret-scan");
  npmRun("syntax-check");
  npmRun("self-check");
  printDashboardInfo();
  console.log("\nSetup complete. No login, QR scan, OTP/PIN entry, or message send was performed.");
  console.log("Next: npm start, then open the dashboard URL above and scan QR manually if using Personal QR.");
  if (flags.has("--start")) {
    console.log("\nStarting the foreground server. Press Ctrl+C to stop it.");
    return run("npm start", npmCommand, ["start"]);
  }
  return 0;
}

function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  try {
    if (command === "setup" || command === "install") process.exitCode = setup(flags);
    else if (command === "doctor") process.exitCode = doctor();
    else if (command === "dashboard-info") printDashboardInfo();
    else {
      console.error("Usage: node scripts/setup.js [setup|doctor|dashboard-info] [--non-interactive] [--skip-install] [--start]");
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(`\nSETUP BLOCKED: ${String(error?.message || error)}`);
    console.error("No credential, OTP/PIN, QR login, or live message action was attempted.");
    process.exitCode = 1;
  }
}

main();
