#!/usr/bin/env node
/**
 * Cold battle smoke — proves bridge + MCP surface can do real work.
 * READ_ONLY defaults. Does not spam source groups.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BRIDGE = process.env.ZALO_BRIDGE_URL || "http://127.0.0.1:3871";

async function j(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  return { status: res.status, ok: res.ok, data };
}

function pass(name, detail = "") {
  console.log(`PASS  ${name}${detail ? " · " + detail : ""}`);
}
function fail(name, detail = "") {
  console.error(`FAIL  ${name}${detail ? " · " + detail : ""}`);
  process.exitCode = 1;
}

async function main() {
  console.log("=== Zalo Personal MCP battle smoke ===");
  console.log("bridge", BRIDGE);

  // 1 health
  let r = await j(`${BRIDGE}/healthz`);
  if (r.ok) pass("healthz");
  else return fail("healthz", String(r.status));

  // 2 battle-ready
  r = await j(`${BRIDGE}/api/battle-ready`);
  if (!r.ok) return fail("battle-ready endpoint", r.status);
  const br = r.data;
  console.log(JSON.stringify({ battle_ready: br.battle_ready, account: br.account, destination: br.destination, corpus: br.corpus, safety: br.safety }, null, 2));
  if (br.battle_ready) pass("battle_ready");
  else fail("battle_ready", "not connected or destination/safety incomplete");

  // 3 reconnect session if needed
  if (br.account?.status !== "connected") {
    r = await j(`${BRIDGE}/api/accounts/default/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (r.ok && r.data?.status?.status === "connected") pass("reconnect session");
    else fail("reconnect session", JSON.stringify(r.data).slice(0, 200));
  } else pass("already connected");

  // 4 corpus
  r = await j(`${BRIDGE}/api/corpus/summary`);
  if (r.ok) pass("corpus_summary", `msgs=${r.data.messages} users=${r.data.users} groups=${r.data.sources}`);
  else fail("corpus_summary");

  // 5 sources list
  r = await j(`${BRIDGE}/api/sources`);
  if (r.ok && Array.isArray(r.data.sources) && r.data.sources.length > 0) {
    pass("list_groups", String(r.data.sources.length));
  } else fail("list_groups");

  // 6 policy: wrong outbound blocked via ask with empty dest would fail; use status safety
  r = await j(`${BRIDGE}/api/status`);
  const safety = r.data?.safety || {};
  if (safety.READ_ONLY_SOURCE && safety.auto_reply_disabled && safety.dm_reply_disabled) {
    pass("READ_ONLY_SOURCE safety flags");
  } else fail("safety flags", JSON.stringify(safety));

  // 7 dry ask path (may send to configured destination if explicitly enabled)
  // Use a soft question; Policy Guard still destination-only.
  const doSend = process.env.BATTLE_SEND === "true";
  if (doSend) {
    r = await j(`${BRIDGE}/api/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "tóm tắt nhanh corpus hiện có?", hours: 24 }),
    });
    if (r.ok) pass("ask_destination", r.data?.reason || r.data?.ok);
    else fail("ask_destination", JSON.stringify(r.data).slice(0, 300));
  } else {
    pass("ask_destination skipped (set BATTLE_SEND=true to send real report)");
  }

  // 8 MCP server boots
  await new Promise((resolve) => {
    const child = spawn("node", [path.join(root, "mcp/server.js")], {
      env: { ...process.env, ZALO_BRIDGE_URL: BRIDGE },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let err = "";
    child.stderr.on("data", (d) => {
      err += d.toString();
    });
    setTimeout(() => {
      child.kill("SIGTERM");
      if (err.includes("running") || err.includes("bridge health")) pass("mcp_server_boot", err.trim().split("\n").slice(-2).join(" | "));
      else fail("mcp_server_boot", err.slice(0, 300) || "no stderr");
      resolve();
    }, 1500);
  });

  console.log(process.exitCode ? "=== SMOKE FAILED ===" : "=== SMOKE OK — battle surface ready ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
