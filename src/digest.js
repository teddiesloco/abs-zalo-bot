// Digest + alert pipelines. Always through Policy Guard + Hermes validation.
import { sha256, utcNow } from "./schema.js";
import { buildHermesRequest, callHermes } from "./hermes_client.js";
import { sanitizeForHermes } from "./privacy.js";
import { buildOpsReport, scrubTechJargon } from "./ops_report.js";

export function buildDigestText({
  events,
  windowLabel = "24 giờ",
  accountId,
  stats = {},
}) {
  // Manager-facing ops report (not technical log).
  return buildOpsReport({
    title: "Tổng hợp vận hành — destination đã cấu hình",
    windowLabel: String(windowLabel).replace(/h$/i, " giờ"),
    stats: {
      groups: stats.groups ?? stats.sources ?? 0,
      users: stats.users ?? 0,
      member_links: stats.member_links ?? 0,
      messages_total: stats.messages_total ?? stats.messages ?? 0,
      recent_source_msgs: events.length,
    },
    recentEvents: events,
    autoReplyEnabled: false,
    listening: true,
    note: accountId ? "" : "",
  });
}

async function sendWithRetry({ runtime, targetId, text, threadType = 1, maxRetries = 3 }) {
  let lastErr = null;
  for (let i = 1; i <= maxRetries; i++) {
    try {
      await runtime.sendText(targetId, text, threadType);
      return { ok: true, attempts: i };
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 200 * i));
    }
  }
  return { ok: false, error: lastErr, attempts: maxRetries };
}

export async function sendDigest({
  config,
  store,
  policy,
  hub,
  accountId,
  hours = 24,
  reportType = "manual",
  fetchImpl,
}) {
  const id = String(accountId || config.default_account_id);
  // Do this before reading corpus or calling Hermes: listener-only has zero
  // model/tool cost and zero outbound side effect.
  if (config.listener_only !== false) {
    return { ok: false, reason: "outbound_disabled", event_count: 0, skipped_before_analysis: true };
  }
  const periodEnd = utcNow();
  const periodStart = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const events = store.recentEvents({ accountId: id, limit: 200, sinceIso: periodStart });

  const eligible = events.filter((e) => {
    const p = store.getSource(e.account_id, e.source_id);
    // Under listen-all, include source messages except destination self-loop.
    if (p && p.mode === "off") return false;
    if (p && p.is_allowed === false) return false;
    const destId = store.getDestination(id).group_id;
    if (destId && e.source_id === destId) return false;
    return true;
  });

  const stats = {
    groups: store.listSources(id).length,
    users: store.countUsers(id),
    member_links: store.countSourceMembers(id),
    messages_total: store.countEvents(id),
  };
  let text = buildDigestText({
    events: eligible,
    windowLabel: hours === 24 ? "24 giờ" : `${hours} giờ`,
    accountId: id,
    stats,
  });

  // Prefer local ops format; only accept Hermes rewrite if it stays manager-readable.
  if (eligible.length >= 5) {
    const hermesPayload = buildHermesRequest({
      accountId: id,
      purpose: "ops_report",
      source: { source_type: "multi", source_id: "ops", source_name: "allowlisted" },
      messages: eligible.slice(0, 40),
    });
    const hermes = await callHermes({ config, payload: hermesPayload, fetchImpl });
    if (hermes.ok && hermes.response.action === "send" && hermes.response.message) {
      const safe = sanitizeForHermes(hermes.response.message);
      if (safe.ok) {
        const scrubbed = scrubTechJargon(safe.text);
        if (
          /Trạng thái:|Số liệu hiện có:|Việc tiếp theo:/.test(scrubbed) &&
          !/\b(corpus|digest|READ_ONLY|outbound)\b/i.test(scrubbed)
        ) {
          text = scrubbed;
        }
      }
    } else if (!hermes.ok) {
      store.setHealth("last_hermes_error", hermes.reason || "unknown");
    } else if (hermes.response?.action === "manual_review") {
      const reportId = store.putReport({
        account_id: id,
        destination_source_id: store.getDestination(id).group_id || "",
        report_type: reportType,
        period_start: periodStart,
        period_end: periodEnd,
        content: text,
        sent_status: "manual_review",
        error_message: hermes.response.reason || "manual_review",
      });
      return { ok: false, reason: "manual_review", report_id: reportId, text, event_count: eligible.length };
    }
  }

  const dest = store.getDestination(id);
  const targetId = dest.group_id;
  const decision = policy.evaluateOutbound({
    accountId: id,
    targetId,
    text,
    kind: "digest",
  });

  const reportId = store.putReport({
    account_id: id,
    destination_source_id: targetId || "",
    report_type: reportType,
    period_start: periodStart,
    period_end: periodEnd,
    content: text,
    sent_status: "draft",
  });

  if (!decision.allow) {
    store.logOutbound({
      accountId: id,
      targetId: targetId || "",
      kind: "digest",
      textSha: sha256(text),
      ok: false,
      reason: decision.reason,
    });
    store.updateReport(reportId, {
      sent_status: "blocked",
      error_message: decision.reason,
    });
    return { ok: false, reason: decision.reason, text, event_count: eligible.length, report_id: reportId };
  }

  const runtime = hub.getRuntime(id);
  if (!runtime.api && process.env.ALLOW_FAKE_SEND !== "true") {
    // dry path: keep draft
    store.updateReport(reportId, { sent_status: "draft", error_message: "not_connected" });
    return {
      ok: false,
      reason: "not_connected",
      text,
      event_count: eligible.length,
      report_id: reportId,
      dry_run: true,
    };
  }

  if (process.env.ALLOW_FAKE_SEND === "true" && !runtime.api) {
    store.logOutbound({
      accountId: id,
      targetId,
      kind: "digest",
      textSha: decision.textSha || sha256(text),
      ok: true,
      reason: "fake_sent",
    });
    store.updateReport(reportId, { sent_status: "sent", sent_at: utcNow() });
    return { ok: true, reason: "fake_sent", event_count: eligible.length, report_id: reportId, text };
  }

  const sent = await sendWithRetry({ runtime, targetId, text, threadType: 1, maxRetries: 3 });
  if (!sent.ok) {
    const errs = store.bumpSendError(id, false);
    store.logOutbound({
      accountId: id,
      targetId,
      kind: "digest",
      textSha: decision.textSha || sha256(text),
      ok: false,
      reason: String(sent.error?.message || sent.error || "send_fail"),
    });
    store.updateReport(reportId, {
      sent_status: "error",
      error_message: String(sent.error?.message || sent.error || "send_fail"),
    });
    if (errs >= 5) {
      store.setAccountStatus(id, "paused", { last_error: "consecutive_send_errors" });
      store.setHealth("account_auto_paused", { account_id: id, at: utcNow() });
    }
    return { ok: false, reason: "send_fail", event_count: eligible.length, report_id: reportId };
  }

  store.bumpSendError(id, true);
  store.logOutbound({
    accountId: id,
    targetId,
    kind: "digest",
    textSha: decision.textSha || sha256(text),
    ok: true,
    reason: "sent",
  });
  store.updateReport(reportId, { sent_status: "sent", sent_at: utcNow() });
  return { ok: true, reason: "sent", event_count: eligible.length, report_id: reportId, text };
}

export async function maybeSendAlert({
  config,
  store,
  policy,
  hub,
  event,
  enrichment,
  fetchImpl,
}) {
  // A high-priority-looking inbound message must never become a paid model
  // call or destination alert while the bridge is listener-only.
  if (config.listener_only !== false) {
    return { ok: false, reason: "outbound_disabled", skipped_before_analysis: true };
  }
  const priority = enrichment?.priority || "low";
  const lead = Boolean(enrichment?.lead_flag);
  const risk = Boolean(enrichment?.risk_flag);
  const high = priority === "high" || lead || risk;
  if (!high) return { ok: false, reason: "not_high" };

  const accountId = event.account_id;
  const dest = store.getDestination(accountId);
  const alertKey = `${event.source_id}:${priority}:${lead ? "lead" : ""}:${risk ? "risk" : ""}`;

  const hermesPayload = buildHermesRequest({
    accountId,
    purpose: "alert",
    source: {
      source_type: event.source_type,
      source_id: event.source_id,
      source_name: event.source_name,
    },
    messages: [event],
  });
  const hermes = await callHermes({ config, payload: hermesPayload, fetchImpl, maxRetries: 3 });
  if (!hermes.ok) {
    store.putReport({
      account_id: accountId,
      destination_source_id: dest.group_id || "",
      report_type: "alert",
      period_start: event.created_at,
      period_end: event.created_at,
      content: event.text || "",
      sent_status: "manual_review",
      error_message: hermes.reason || "hermes_fail",
    });
    return { ok: false, reason: hermes.reason || "hermes_fail", manual_review: true };
  }
  if (hermes.response.action !== "send") {
    return { ok: false, reason: hermes.response.action };
  }

  const safe = sanitizeForHermes(hermes.response.message);
  if (!safe.ok) return { ok: false, reason: safe.reason };

  const decision = policy.evaluateOutbound({
    accountId,
    targetId: dest.group_id,
    text: safe.text,
    kind: "alert",
    alertKey,
  });
  if (!decision.allow) return { ok: false, reason: decision.reason };

  const runtime = hub.getRuntime(accountId);
  if (!runtime.api && process.env.ALLOW_FAKE_SEND !== "true") {
    return { ok: false, reason: "not_connected" };
  }
  if (process.env.ALLOW_FAKE_SEND === "true" && !runtime.api) {
    store.setCooldown(accountId, alertKey);
    store.logOutbound({
      accountId,
      targetId: dest.group_id,
      kind: "alert",
      textSha: decision.textSha || sha256(safe.text),
      ok: true,
      reason: "fake_sent",
    });
    return { ok: true, reason: "fake_sent" };
  }

  const sent = await sendWithRetry({
    runtime,
    targetId: dest.group_id,
    text: safe.text,
    maxRetries: 3,
  });
  if (!sent.ok) {
    store.logOutbound({
      accountId,
      targetId: dest.group_id,
      kind: "alert",
      textSha: decision.textSha || sha256(safe.text),
      ok: false,
      reason: String(sent.error?.message || "send_fail"),
    });
    return { ok: false, reason: "send_fail" };
  }
  store.setCooldown(accountId, alertKey);
  store.logOutbound({
    accountId,
    targetId: dest.group_id,
    kind: "alert",
    textSha: decision.textSha || sha256(safe.text),
    ok: true,
    reason: "sent",
  });
  return { ok: true, reason: "sent" };
}
