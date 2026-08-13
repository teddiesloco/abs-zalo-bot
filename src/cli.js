#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { Store } from "./store.js";
import { PolicyGuard } from "./policy.js";
import { BridgeHub, ensureDataLayout } from "./zalo_runtime.js";
import { createApp } from "./server.js";
import { sendDigest } from "./digest.js";
import { redactSecrets } from "./schema.js";
import { publicBrandMetadata } from "./brand.js";
import { onboardingFromEnv } from "./onboarding.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadEnvFile() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] == null) process.env[k] = v;
  }
}

function boot() {
  loadEnvFile();
  const configPath = process.env.CONFIG_PATH || path.join(ROOT, "config.toml");
  const config = loadConfig(configPath);
  const dataDir = path.resolve(ROOT, process.env.DATA_DIR || "data");
  ensureDataLayout(dataDir);
  const store = new Store(dataDir, {
    retainRawText: process.env.RETAIN_RAW_TEXT !== "false",
    redactPhoneEmail: process.env.REDACT_PII !== "false",
  });
  store.ensureAccount(config.default_account_id);
  store.seedFromConfig(config);
  const policy = new PolicyGuard({ config, store });
  const hub = new BridgeHub({ config, store, policy });
  return { config, store, policy, hub, dataDir, configPath };
}

async function main() {
  const cmd = process.argv[2] || "serve";
  const ctx = boot();

  if (cmd === "self-check") {
    const issues = [];
    const dbSources = ctx.store.listSources(ctx.config.default_account_id);
    const dest = ctx.store.getDestination(ctx.config.default_account_id);
    if (!dbSources.length) issues.push("allowlist_empty_fail_closed_ok");
    if (!dest.group_id) issues.push("destination_unset_ok");
    if (!fs.existsSync(path.join(ROOT, "public", "index.html"))) issues.push("dashboard_missing");
    const snap = ctx.store.snapshot();
    console.log(
      JSON.stringify(
        {
          ok: issues.every((i) => i.endsWith("_ok") || i.includes("empty") || i.includes("unset")),
          brand: publicBrandMetadata(),
          issues,
          default_account_id: ctx.config.default_account_id,
          source_count: dbSources.length,
          global_paused: ctx.store.isGlobalPaused(),
          snapshot: redactSecrets(snap),
        },
        null,
        2,
      ),
    );
    ctx.store.close();
    process.exit(0);
  }

  if (cmd === "status") {
    console.log(
      JSON.stringify(
        redactSecrets({
          brand: publicBrandMetadata(),
          accounts: ctx.hub.listStatus(),
          destination: ctx.store.getDestination(ctx.config.default_account_id),
          sources: ctx.store.listSources().length,
          events: ctx.store.countEvents(),
          global_paused: ctx.store.isGlobalPaused(),
        }),
        null,
        2,
      ),
    );
    ctx.store.close();
    return;
  }

  if (cmd === "qr" || cmd === "onboarding") {
    console.log(
      JSON.stringify(
        {
          ok: true,
          ...onboardingFromEnv(process.env),
          note: "Open connect_url in a browser, then press Kết nối / lấy QR. No QR image, token, or session is printed.",
        },
        null,
        2,
      ),
    );
    ctx.store.close();
    return;
  }

  if (cmd === "digest") {
    const hours = Number(process.argv[3] || 24);
    const result = await sendDigest({
      config: ctx.config,
      store: ctx.store,
      policy: ctx.policy,
      hub: ctx.hub,
      accountId: ctx.config.default_account_id,
      hours,
    });
    console.log(JSON.stringify(result, null, 2));
    ctx.store.close();
    return;
  }

  if (cmd === "backfill") {
    const accountId = ctx.config.default_account_id;
    const historyCount = Number(process.argv[3] || 50);
    const runtime = ctx.hub.getRuntime(accountId);
    // ensure connected via session
    if (!runtime.api) {
      try {
        await runtime.connect({ forceQr: false });
      } catch (err) {
        console.error(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        ctx.store.close();
        process.exit(1);
      }
    }
    const { backfillAccountCorpus } = await import("./backfill.js");
    const result = await backfillAccountCorpus({
      api: runtime.api,
      store: ctx.store,
      accountId,
      historyCount,
      maxGroups: Number(process.env.BACKFILL_MAX_GROUPS || 200),
      delayMs: Number(process.env.BACKFILL_DELAY_MS || 250),
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          result: { ...result, errors: (result.errors || []).slice(0, 40) },
          corpus: {
            messages: ctx.store.countEvents(accountId),
            users: ctx.store.countUsers(accountId),
            member_links: ctx.store.countSourceMembers(accountId),
            sources: ctx.store.listSources(accountId).length,
          },
        },
        null,
        2,
      ),
    );
    try {
      await runtime.pause();
    } catch {
      /* ignore */
    }
    // wait a tick so listener error callbacks don't hit closed db
    await new Promise((r) => setTimeout(r, 300));
    ctx.store.close();
    process.exit(0);
  }

  if (cmd === "serve" || cmd === "start") {
    const { KeepaliveSupervisor, loadKeepaliveOptions } = await import("./keepalive.js");
    const keepaliveOpts = loadKeepaliveOptions(process.env);
    const keepalive = new KeepaliveSupervisor({
      config: ctx.config,
      store: ctx.store,
      policy: ctx.policy,
      hub: ctx.hub,
      accountId: ctx.config.default_account_id,
      options: keepaliveOpts,
    });
    // Expose for health endpoints
    ctx.keepalive = keepalive;

    const app = createApp(ctx);
    const host = process.env.HOST || ctx.config.dashboard_bind || "127.0.0.1";
    const port = Number(process.env.PORT || ctx.config.dashboard_port || 3871);
    const server = app.listen(port, host, () => {
      console.log(
        JSON.stringify({
          event: "listening",
          host,
          port,
          account: ctx.config.default_account_id,
          sources: ctx.config.sources.length,
          destination_set: Boolean(ctx.config.destination.group_id),
          keepalive: true,
        }),
      );
    });

    // 24/7: auto-connect session + reconnect on drop. No deep-scroll.
    keepalive.start();

    const digestMinutes = Number(process.env.DIGEST_INTERVAL_MINUTES || 0);
    let timer = null;
    if (ctx.config.listener_only === false && digestMinutes > 0) {
      timer = setInterval(() => {
        sendDigest({
          config: ctx.config,
          store: ctx.store,
          policy: ctx.policy,
          hub: ctx.hub,
          accountId: ctx.config.default_account_id,
          hours: Math.max(1, digestMinutes / 60),
        }).catch((err) => {
          ctx.store.setHealth("last_digest_error", String(err?.message || err));
        });
      }, digestMinutes * 60 * 1000);
    }

    const shutdown = () => {
      try {
        keepalive.stop();
      } catch {
        /* ignore */
      }
      if (timer) clearInterval(timer);
      server.close(() => {
        ctx.store.close();
        process.exit(0);
      });
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    return;
  }

  console.error(`unknown command: ${cmd}`);
  process.exit(2);
}

// server.js re-export helper for tests that import createApp only
export { createApp };

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect || process.argv[1]?.endsWith("cli.js") || process.argv[1]?.endsWith("server.js")) {
  // If invoked as server.js without cmd, serve.
  if (path.basename(process.argv[1] || "") === "server.js" && !process.argv[2]) {
    process.argv[2] = "serve";
  }
  main().catch((err) => {
    console.error(String(err?.stack || err));
    process.exit(1);
  });
}
