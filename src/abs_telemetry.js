// Privacy-minimal Zalo -> ABS adapter.  This is not a reply mechanism and
// does not read, persist, or forward message content.  It records only the
// outcome of an explicit Zalo-to-brain turn, fail-open.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Đường dẫn ledger do người triển khai khai báo qua ABS_LEDGER_PATH.
// Không hardcode đường dẫn máy chủ nào: repo public phải chạy được ở mọi nơi.

function durationBucket(value) {
  const milliseconds = Number(value || 0);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "unknown";
  if (milliseconds < 100) return "lt_100ms";
  if (milliseconds < 1_000) return "lt_1s";
  if (milliseconds < 10_000) return "lt_10s";
  return "gte_10s";
}

function ledgerPath() {
  const configured = process.env.ABS_LEDGER_PATH || "";
  for (const candidate of [configured]) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return "";
}

/**
 * Record a single local-only Zalo brain outcome. Raw source_id is provided only
 * through stdin to the Python ledger, which salts it before SQLite insertion.
 */
export function recordZaloBrainTurn({ event, outcome = "unknown", durationMs, runner = spawnSync }) {
  try {
    const rawChatId = String(event?.source_id || "");
    const conversationType = String(event?.source_type || "unknown");
    const ledger = ledgerPath();
    if (!ledger || !rawChatId || !["dm", "group"].includes(conversationType)) {
      return { ok: false, reason: "telemetry_unavailable" };
    }
    const input = JSON.stringify({
      event_type: "zalo_brain_turn",
      platform: "zalo",
      raw_chat_id: rawChatId,
      conversation_type: conversationType,
      metadata: {
        outcome: outcome === "success" ? "success" : "non_success",
        duration_bucket: durationBucket(durationMs),
      },
    });
    const child = runner("python3", [ledger, "record-stdin"], {
      input,
      encoding: "utf8",
      stdio: ["pipe", "ignore", "ignore"],
      timeout: 2_000,
    });
    return { ok: child?.status === 0, reason: child?.status === 0 ? "recorded" : "telemetry_failed" };
  } catch {
    return { ok: false, reason: "telemetry_failed" };
  }
}
