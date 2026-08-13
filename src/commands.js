// Zalo slash-command router. Unauthorized => silent.
import { isValidMode } from "./policy.js";
import { sendDigest } from "./digest.js";

export function parseCommand(text) {
  const raw = String(text || "").trim();
  if (!raw.startsWith("/")) return null;
  const body = raw.slice(1).trim();
  if (!body) return null;
  const parts = body.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  // /digest now
  if (cmd === "digest" && args[0]?.toLowerCase() === "now") {
    return { command: "digest", args: ["now"], raw };
  }
  // /set destination <id>
  if (cmd === "set" && args[0]?.toLowerCase() === "destination") {
    return { command: "set", args: ["destination", ...args.slice(1)], raw };
  }
  // /allow source <id>
  if (cmd === "allow" && args[0]?.toLowerCase() === "source") {
    return { command: "allow", args: ["source", ...args.slice(1)], raw };
  }
  // /add admin <id> | /remove admin <id>
  if ((cmd === "add" || cmd === "remove") && args[0]?.toLowerCase() === "admin") {
    return { command: cmd, args: ["admin", ...args.slice(1)], raw };
  }
  return { command: cmd, args, raw };
}

export async function handleCommand({
  event,
  store,
  policy,
  hub,
  config,
}) {
  const parsed = parseCommand(event.text);
  if (!parsed) return { handled: false };

  const accountId = event.account_id;
  const senderId = event.sender_id;
  const gate = policy.evaluateCommand({
    accountId,
    senderId,
    command: parsed.command,
    sourceId: event.source_id,
  });
  if (!gate.allow) {
    store.audit({
      accountId,
      actorId: senderId,
      action: "command_denied",
      detail: parsed.raw,
    });
    return { handled: true, silent: true, reason: gate.reason };
  }

  const reply = async (text) => {
    // HARD: only destination group. Never source/DM.
    const dest = store.getDestination(accountId);
    if (!dest.group_id) {
      return { ok: false, reason: "destination_unset", text, local_only: true };
    }
    const targetId = dest.group_id;
    const decision = policy.evaluateOutbound({
      accountId,
      targetId,
      text,
      kind: "command_reply",
    });
    if (!decision.allow) {
      return { ok: false, reason: decision.reason, text };
    }
    try {
      const runtime = hub.getRuntime(accountId);
      if (runtime.api || process.env.ALLOW_FAKE_SEND === "true") {
        if (runtime.api) await runtime.sendText(targetId, text, 1);
      }
      store.logOutbound({
        accountId,
        targetId,
        kind: "command_reply",
        textSha: decision.textSha || "cmd",
        ok: true,
        reason: "sent",
      });
      return { ok: true, text, targetId };
    } catch (err) {
      store.logOutbound({
        accountId,
        targetId,
        kind: "command_reply",
        textSha: "cmd",
        ok: false,
        reason: String(err?.message || err),
      });
      return { ok: false, reason: String(err?.message || err), text };
    }
  };

  let message = "";
  switch (parsed.command) {
    case "help":
      message = [
        "Zalo Personal Intelligence Bridge",
        "/status /pause /resume /digest now /help /whoami",
        "/set destination <group_id>",
        "/allow source <source_id>",
        "/mode <source_id> <mode>",
        "/mute <source_id>",
        "/add admin <user_id> · /remove admin <user_id>",
        "Config nặng nên làm trên dashboard.",
      ].join("\n");
      break;
    case "whoami":
      message = `user=${senderId} role=${policy.roleOf(accountId, senderId) || "none"} account=${accountId}`;
      break;
    case "status": {
      const acc = store.getAccount(accountId);
      const dest = store.getDestination(accountId);
      message = [
        `account=${accountId}`,
        `status=${acc?.status || "unknown"} paused=${Boolean(acc?.paused)}`,
        `global_kill=${store.isGlobalPaused()}`,
        `sources=${store.listSources(accountId).length}`,
        `events=${store.countEvents(accountId)}`,
        `destination=${dest.group_id || "(unset)"}`,
      ].join("\n");
      break;
    }
    case "pause": {
      await hub.getRuntime(accountId).pause();
      store.setGlobalPaused(true);
      store.audit({ accountId, actorId: senderId, action: "pause", detail: "global+account" });
      message = "paused";
      break;
    }
    case "resume": {
      store.setGlobalPaused(false);
      store.setAccountStatus(accountId, "connected");
      store.audit({ accountId, actorId: senderId, action: "resume", detail: "global" });
      message = "resumed (global kill off). Reconnect listener if needed.";
      break;
    }
    case "digest": {
      const result = await sendDigest({
        config,
        store,
        policy,
        hub,
        accountId,
        hours: 24,
        reportType: "manual",
      });
      message = result.ok
        ? `digest sent · events=${result.event_count}`
        : `digest blocked · ${result.reason}`;
      break;
    }
    case "set": {
      if (parsed.args[0] === "destination") {
        const gid = parsed.args[1];
        if (!gid) {
          message = "usage: /set destination <group_id>";
          break;
        }
        store.setDestination(accountId, gid, "");
        store.audit({ accountId, actorId: senderId, action: "set_destination", detail: gid });
        message = `destination=${gid}`;
      } else {
        message = "usage: /set destination <group_id>";
      }
      break;
    }
    case "allow": {
      if (parsed.args[0] === "source") {
        const sid = parsed.args[1];
        if (!sid) {
          message = "usage: /allow source <source_id>";
          break;
        }
        store.upsertSource({
          accountId,
          sourceId: sid,
          mode: "listen_only",
          isAllowed: true,
        });
        store.audit({ accountId, actorId: senderId, action: "allow_source", detail: sid });
        message = `allowed source=${sid} mode=listen_only`;
      } else message = "usage: /allow source <source_id>";
      break;
    }
    case "mode": {
      const sid = parsed.args[0];
      const mode = parsed.args[1];
      if (!sid || !isValidMode(mode)) {
        message =
          "usage: /mode <source_id> <off|listen_only|digest_only|alert_only|mention_only|reply_enabled>";
        break;
      }
      store.setSourceMode(accountId, sid, mode);
      store.audit({ accountId, actorId: senderId, action: "set_mode", detail: `${sid}:${mode}` });
      message = `source=${sid} mode=${mode}`;
      break;
    }
    case "mute": {
      const sid = parsed.args[0];
      if (!sid) {
        message = "usage: /mute <source_id>";
        break;
      }
      store.muteSource(accountId, sid, true);
      store.audit({ accountId, actorId: senderId, action: "mute", detail: sid });
      message = `muted ${sid}`;
      break;
    }
    case "add": {
      if (parsed.args[0] === "admin") {
        const uid = parsed.args[1];
        if (!uid) {
          message = "usage: /add admin <user_id>";
          break;
        }
        store.upsertPermission({ accountId, userId: uid, role: "admin" });
        store.audit({ accountId, actorId: senderId, action: "add_admin", detail: uid });
        message = `admin added ${uid}`;
      } else message = "usage: /add admin <user_id>";
      break;
    }
    case "remove": {
      if (parsed.args[0] === "admin") {
        const uid = parsed.args[1];
        if (!uid) {
          message = "usage: /remove admin <user_id>";
          break;
        }
        const perm = store.getPermission(accountId, uid);
        if (perm?.role === "owner") {
          message = "cannot remove owner via this command";
          break;
        }
        store.removePermission(accountId, uid);
        store.audit({ accountId, actorId: senderId, action: "remove_admin", detail: uid });
        message = `removed ${uid}`;
      } else message = "usage: /remove admin <user_id>";
      break;
    }
    default:
      // unknown command from authorized user: short help, still silent for unauthorized already handled
      message = "unknown command · /help";
  }

  store.audit({
    accountId,
    actorId: senderId,
    action: "command",
    detail: `${parsed.command} -> ${message.slice(0, 200)}`,
  });

  const sent = await reply(message);
  return { handled: true, silent: false, message, sent };
}
