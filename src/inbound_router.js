// Zalo inbound router — bridge is the channel, Hermes is the brain.
// Phase 1 (hard): configured destination + authorized operator only + prefix "bot" + no DM/global.

import { buildOpsReport, scrubTechJargon } from "./ops_report.js";
import { callHermesBrain } from "./hermes_client.js";
import { sanitizeForHermes } from "./privacy.js";
import { sha256, utcNow } from "./schema.js";
import { recordZaloBrainTurn } from "./abs_telemetry.js";

const BOT_PREFIX_RE = /^(?:bot|@bot)\s+/i;

export function parseBotCommand(text) {
  const raw = String(text || "").trim();
  if (!raw) return { ok: false, reason: "empty" };
  const m = raw.match(BOT_PREFIX_RE);
  if (!m) return { ok: false, reason: "missing_bot_prefix" };
  const body = raw.slice(m[0].length).trim();
  if (!body) return { ok: false, reason: "empty_command" };
  return { ok: true, prefix: m[0].trim(), body, raw };
}

export function isBotCommand(text) {
  return parseBotCommand(text).ok;
}

function collectStats(store, accountId, events) {
  return {
    groups: store.listSources(accountId).length,
    users: store.countUsers(accountId),
    member_links: store.countSourceMembers(accountId),
    messages_total: store.countEvents(accountId),
    recent_source_msgs: events.length,
  };
}

function buildFallbackReport({ body, stats, events, hours }) {
  const windowLabel = hours === 24 ? "24 giờ" : `${hours} giờ`;
  return buildOpsReport({
    title: "Tổng hợp vận hành — destination đã cấu hình",
    windowLabel,
    stats,
    recentEvents: events,
    autoReplyEnabled: false,
    listening: true,
    note: body ? `Lệnh: ${String(body).slice(0, 120)}` : "",
  });
}

function buildBrainPrompt({ body, stats, events, hours, senderName }) {
  const samples = events
    .slice(0, 20)
    .map((e) => {
      const who = e.sender_name || "ai đó";
      const src = e.source_name || e.source_id || "nhóm";
      const t = String(e.text || "").replace(/\s+/g, " ").trim().slice(0, 160);
      return t ? `- [${src}] ${who}: ${t}` : null;
    })
    .filter(Boolean)
    .join("\n");

  return [
    "Bạn là Hermes Agent — não xử lý kênh Zalo cá nhân (channel adapter, không phải bot public).",
    "Viết ĐÚNG 1 tin điều hành tiếng Việt gửi vào destination đã cấu hình.",
    "Format bắt buộc:",
    "Tổng hợp vận hành — destination đã cấu hình",
    "",
    "Trạng thái:",
    "...",
    "",
    "Số liệu hiện có:",
    "...",
    "",
    "Hoạt động gần đây:",
    "...",
    "",
    "Nhận xét:",
    "...",
    "",
    "Việc tiếp theo:",
    "...",
    "",
    "Quy tắc cứng:",
    "- Ngắn, rõ, người quản lý đọc hiểu ngay.",
    "- Không dùng từ kỹ thuật: corpus, digest, ask, outbound, READ_ONLY, bridge, MCP, webhook, event_id.",
    "- Không bịa khi thiếu dữ liệu. Dữ liệu mỏng thì nói mức hệ thống/dữ liệu, không tổng hợp vận hành sâu.",
    "- Không DM, không nhắn group khác, không kêu gọi spam.",
    "- Trả lời thuần text, không markdown code fence.",
    "",
    `Người ra lệnh: ${senderName || "owner"}`,
    `Lệnh: ${body}`,
    `Cửa sổ: ${hours} giờ`,
    `Số liệu: ${stats.groups} nhóm, ${stats.users} người dùng, ${stats.member_links} liên kết, ${stats.messages_total} tin đã lưu, ${stats.recent_source_msgs} tin nguồn gần đây`,
    samples ? `Tin nguồn gần đây:\n${samples}` : "Tin nguồn gần đây: chưa có",
  ].join("\n");
}

/**
 * Phase-1 destination brain path:
 * inbound already policy-approved → Hermes brain → outbound guard → send destination only.
 */
export async function handleBotBrainCommand({
  event,
  store,
  policy,
  hub,
  config,
  hours = 24,
  fetchImpl,
}) {
  const accountId = event.account_id;
  const dest = store.getDestination(accountId);
  if (!dest.group_id || String(event.source_id) !== String(dest.group_id)) {
    return { ok: false, reason: "not_destination", silent: true };
  }

  const parsed = parseBotCommand(event.text);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason, silent: true };
  }

  // Authorized: role OR same logged-in Zalo account.
  const role = policy.roleOf(accountId, event.sender_id);
  const account = store.getAccount(accountId);
  const isBridgeSelf =
    event.is_self ||
    (account?.zalo_user_id && String(account.zalo_user_id) === String(event.sender_id));
  if (!role && !isBridgeSelf) {
    store.audit({
      accountId,
      actorId: event.sender_id,
      action: "bot_cmd_denied",
      detail: event.text?.slice(0, 120) || "",
    });
    return { ok: false, reason: "unauthorized_silent", silent: true };
  }

  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const events = store
    .recentEvents({ accountId, limit: 120, sinceIso: since })
    .filter((e) => e.source_id !== dest.group_id);
  const stats = collectStats(store, accountId, events);

  store.audit({
    accountId,
    actorId: event.sender_id,
    action: "bot_cmd_inbound",
    detail: JSON.stringify({
      body: parsed.body.slice(0, 160),
      source_id: event.source_id,
      msg_id: event.message_id || event.event_id,
    }),
  });

  let answer = buildFallbackReport({
    body: parsed.body,
    stats,
    events,
    hours,
  });
  let brainMeta = { used: false, reason: "fallback_local" };

  const prompt = buildBrainPrompt({
    body: parsed.body,
    stats,
    events,
    hours,
    senderName: event.sender_name,
  });

  const brainStartedAt = Date.now();
  const brain = await callHermesBrain({
    config,
    prompt,
    fetchImpl,
    maxRetries: 2,
  });
  // Telemetry is local, pseudonymous, and fail-open. It observes an explicit
  // Brain turn only; the adapter extracts only source_id/type, outcome,
  // and duration. It never serializes message text or sender data.
  recordZaloBrainTurn({
    event,
    outcome: brain.ok ? "success" : "non_success",
    durationMs: Date.now() - brainStartedAt,
  });

  if (brain.ok && brain.text) {
    const safe = sanitizeForHermes(brain.text);
    if (safe.ok) {
      const scrubbed = scrubTechJargon(safe.text);
      // Accept if manager-readable; otherwise keep local fallback.
      if (
        scrubbed.length >= 40 &&
        !/\b(corpus|digest|READ_ONLY|outbound|webhook|event_id)\b/i.test(scrubbed)
      ) {
        answer = scrubbed.slice(0, 3200);
        brainMeta = { used: true, reason: brain.reason || "hermes_brain", attempts: brain.attempts };
      } else {
        brainMeta = { used: false, reason: "brain_format_rejected" };
      }
    } else {
      brainMeta = { used: false, reason: safe.reason || "sanitize_fail" };
    }
  } else {
    brainMeta = { used: false, reason: brain.reason || "brain_fail", manual_review: brain.manual_review };
  }

  const decision = policy.evaluateOutbound({
    accountId,
    targetId: dest.group_id,
    text: answer,
    kind: "ask_reply",
  });
  if (!decision.allow) {
    store.logOutbound({
      accountId,
      targetId: dest.group_id,
      kind: "ask_reply",
      textSha: sha256(answer),
      ok: false,
      reason: decision.reason,
    });
    store.audit({
      accountId,
      actorId: event.sender_id,
      action: "bot_cmd_outbound_blocked",
      detail: decision.reason,
    });
    return { ok: false, reason: decision.reason, answer, brain: brainMeta };
  }

  const runtime = hub.getRuntime(accountId);
  if (!runtime.api && process.env.ALLOW_FAKE_SEND !== "true") {
    return { ok: false, reason: "not_connected", answer, dry_run: true, brain: brainMeta };
  }
  if (process.env.ALLOW_FAKE_SEND === "true" && !runtime.api) {
    store.logOutbound({
      accountId,
      targetId: dest.group_id,
      kind: "ask_reply",
      textSha: decision.textSha || sha256(answer),
      ok: true,
      reason: "fake_sent",
    });
    store.audit({
      accountId,
      actorId: event.sender_id,
      action: "bot_cmd_fake_sent",
      detail: parsed.body.slice(0, 120),
    });
    return { ok: true, reason: "fake_sent", answer, brain: brainMeta };
  }

  try {
    await runtime.sendText(dest.group_id, answer, 1);
    store.logOutbound({
      accountId,
      targetId: dest.group_id,
      kind: "ask_reply",
      textSha: decision.textSha || sha256(answer),
      ok: true,
      reason: "sent",
    });
    store.putReport({
      account_id: accountId,
      destination_source_id: dest.group_id,
      report_type: "bot_cmd",
      period_start: since,
      period_end: utcNow(),
      content: answer,
      sent_status: "sent",
      sent_at: utcNow(),
    });
    store.audit({
      accountId,
      actorId: event.sender_id,
      action: "bot_cmd_sent",
      detail: JSON.stringify({
        body: parsed.body.slice(0, 120),
        brain: brainMeta,
        target: dest.group_id,
      }),
    });
    return { ok: true, reason: "sent", answer, brain: brainMeta };
  } catch (err) {
    store.logOutbound({
      accountId,
      targetId: dest.group_id,
      kind: "ask_reply",
      textSha: decision.textSha || sha256(answer),
      ok: false,
      reason: String(err?.message || err),
    });
    return { ok: false, reason: String(err?.message || err), answer, brain: brainMeta };
  }
}
