#!/usr/bin/env node
/**
 * Offline release gates for the public starter.
 *
 * The scanner intentionally ignores local runtime state (.env, data, sessions,
 * QR images, databases, logs, node_modules). Those paths are checked by the
 * repository ignore rules and must never be staged for a release.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../src/config.js";
import { validateBotRegistry } from "../src/bot_registry.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IGNORED_DIRS = new Set([".git", "node_modules", "data", "coverage"]);
const IGNORED_FILES = new Set([".env", "bots.json"]);
const SAFE_ENV_FILES = new Set([".env.example"]);
const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".service",
  ".sh",
  ".toml",
  ".ts",
  ".txt",
  ".yml",
  ".yaml",
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    if (entry.isFile() && IGNORED_FILES.has(entry.name) && !SAFE_ENV_FILES.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute, out);
    else out.push(absolute);
  }
  return out;
}

function relative(file) {
  return path.relative(ROOT, file) || ".";
}

function publicFiles() {
  return walk(ROOT).filter((file) => {
    const name = path.basename(file);
    if (IGNORED_FILES.has(name) && !SAFE_ENV_FILES.has(name)) return false;
    return true;
  });
}

function readText(file) {
  const ext = path.extname(file).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext) && path.basename(file) !== ".gitignore") return null;
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function fail(message, details = []) {
  const payload = { ok: false, error: message };
  if (details.length) payload.details = details;
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 1;
}

function pass(name, details = {}) {
  console.log(JSON.stringify({ ok: true, check: name, ...details }, null, 2));
}

function validateConfig() {
  const packagePath = path.join(ROOT, "package.json");
  const registryPath = path.join(ROOT, "config", "bots.example.json");
  let pkg;
  let registry;
  try {
    pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  } catch (error) {
    fail("public_config_parse_failed", [String(error?.message || error)]);
    return;
  }

  let normalized;
  let config;
  try {
    normalized = validateBotRegistry(registry);
    config = loadConfig(path.join(ROOT, "config.toml"));
  } catch (error) {
    fail("public_config_validation_failed", [String(error?.message || error)]);
    return;
  }

  const issues = [];
  // This package is intentionally publishable to npm. Instead of forbidding
  // publish outright, enforce that a publish cannot happen half-configured:
  // metadata must be complete and the tarball allowlist must be explicit,
  // so runtime/secret paths can never be shipped by accident.
  if (pkg.private === true) issues.push("package_marked_private_but_publish_metadata_expected");
  if (!pkg.license) issues.push("package_license_required");
  if (!pkg.repository?.url) issues.push("package_repository_url_required");
  if (!Array.isArray(pkg.files) || pkg.files.length === 0) {
    issues.push("package_files_allowlist_required");
  } else {
    const forbidden = ["data", "data/", ".env", "test", "test/", "config/bots.json"];
    const leaked = pkg.files.filter((entry) =>
      forbidden.some((bad) => entry === bad || entry.startsWith(`${bad}/`)),
    );
    if (leaked.length) issues.push(`package_files_must_not_ship_runtime_paths:${leaked.join(",")}`);
  }
  if (config.read_only_source !== true) issues.push("example_must_enable_read_only_source");
  if (config.destination.group_id) issues.push("example_destination_id_must_be_empty");
  if (normalized.bots.some((bot) => bot.policy.mode !== "draft_first")) {
    issues.push("example_oa_policy_must_be_draft_first");
  }
  if (normalized.bots.some((bot) => bot.adapter === "zalo_oa" && !bot.credential)) {
    issues.push("oa_credential_references_missing");
  }
  if (issues.length) {
    fail("public_config_policy_failed", issues);
    return;
  }

  pass("validate-config", {
    package: { name: pkg.name, version: pkg.version, node: pkg.engines?.node || "" },
    registry_bots: normalized.bots.length,
    default_account_id: config.default_account_id,
    destination_configured: Boolean(config.destination.group_id),
    read_only_source: config.read_only_source,
  });
}

function secretScan() {
  const findings = [];
  const files = publicFiles();
  const privateKey = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
  const providerToken = /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/;
  const longNumericId = /\b\d{15,22}\b/;
  const vnPhoneLiteral = /(?<![\d])(?:\+?84|0)\d{8,10}(?!\d)/;
  const assignment = /^\s*(?:DASHBOARD_TOKEN|HERMES_API_SERVER_KEY|HERMES_WEBHOOK_TOKEN|ZALO_OA_WEBHOOK_SECRET)\s*=\s*([^#\s]+)/;
  const allowedPlaceholder = /^(?:$|change-me|<[^>]+>|\[REDACTED\]|\[redacted\]|[A-Za-z0-9._-]*fixture[A-Za-z0-9._-]*)$/i;

  for (const file of files) {
    const text = readText(file);
    if (text == null) continue;
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      if (privateKey.test(line) || providerToken.test(line)) {
        findings.push(`${relative(file)}:${lineNumber}:credential-pattern`);
      }
      if (longNumericId.test(line)) {
        findings.push(`${relative(file)}:${lineNumber}:long-numeric-identifier`);
      }
      if (vnPhoneLiteral.test(line)) {
        findings.push(`${relative(file)}:${lineNumber}:phone-like-literal`);
      }
      const match = line.match(assignment);
      if (match && !allowedPlaceholder.test(match[1])) {
        findings.push(`${relative(file)}:${lineNumber}:non-placeholder-secret-assignment`);
      }
    });
  }

  const envPath = path.join(ROOT, ".env");
  const ignoredRuntimePresent = [];
  if (fs.existsSync(envPath)) ignoredRuntimePresent.push(".env");
  if (fs.existsSync(path.join(ROOT, "data"))) ignoredRuntimePresent.push("data/");

  if (findings.length) {
    fail("public_secret_scan_failed", findings);
    return;
  }
  pass("secret-scan", {
    files_scanned: files.length,
    runtime_paths_ignored: ignoredRuntimePresent,
  });
}

function syntaxCheck() {
  const files = publicFiles().filter((file) => path.extname(file) === ".js");
  const failures = [];
  for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], {
      cwd: ROOT,
      encoding: "utf8",
    });
    if (result.status !== 0) {
      failures.push({ file: relative(file), output: String(result.stderr || result.stdout || "").trim().slice(0, 500) });
    }
  }
  if (failures.length) {
    fail("javascript_syntax_failed", failures);
    return;
  }
  pass("syntax-check", { javascript_files: files.length });
}

const command = process.argv[2] || "";
if (command === "validate-config") validateConfig();
else if (command === "secret-scan") secretScan();
else if (command === "syntax-check") syntaxCheck();
else {
  fail("usage", ["node scripts/public-gate.js validate-config|secret-scan|syntax-check"]);
}
