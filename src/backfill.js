// Historical + identity corpus backfill. READ_ONLY — never sends.
import { normalizeInboundMessage, utcNow } from "./schema.js";
import { listGroupsDetailed } from "./discovery.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseMemberToken(token) {
  // memVerList entries look like "696878...038_0"
  const s = String(token || "");
  const idx = s.lastIndexOf("_");
  if (idx > 0) return s.slice(0, idx);
  return s;
}

function asMessageLike(groupMsg, groupId) {
  if (groupMsg?.data && groupMsg?.threadId != null) {
    return {
      type: groupMsg.type ?? 1,
      threadId: String(groupMsg.threadId || groupId),
      isSelf: Boolean(groupMsg.isSelf),
      data: groupMsg.data,
    };
  }
  const data = groupMsg?.data || groupMsg || {};
  return {
    type: 1,
    threadId: String(groupId),
    isSelf: false,
    data,
  };
}

async function fetchOldGroupMessages(api, { timeoutMs = 15000, maxPages = 5 } = {}) {
  if (!api?.listener?.requestOldMessages) return [];
  const ThreadTypeGroup = 1;
  try {
    api.listener.start?.({ retryOnClose: true });
  } catch {
    /* already started */
  }
  await sleep(1000);

  const collected = [];
  const seen = new Set();
  let lastId = null;

  for (let page = 0; page < maxPages; page++) {
    const batch = await new Promise((resolve) => {
      let done = false;
      const rows = [];
      const finish = () => {
        if (done) return;
        done = true;
        try {
          api.listener.off("old_messages", onOld);
        } catch {
          /* ignore */
        }
        clearTimeout(timer);
        resolve(rows);
      };
      const onOld = (messages, type) => {
        if (!(type === ThreadTypeGroup || type === 1 || type === "group" || type == null)) return;
        for (const m of Array.isArray(messages) ? messages : []) rows.push(m);
        // settle after first batch for this page
        setTimeout(finish, 1200);
      };
      const timer = setTimeout(finish, Math.max(3000, Math.floor(timeoutMs / maxPages)));
      api.listener.on("old_messages", onOld);
      try {
        api.listener.requestOldMessages(ThreadTypeGroup, lastId);
      } catch {
        finish();
      }
    });

    if (!batch.length) break;
    let newCount = 0;
    for (const m of batch) {
      const mid = String(m?.data?.msgId || m?.data?.cliMsgId || m?.messageId || "");
      const key = `${m?.threadId || ""}:${mid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(m);
      newCount += 1;
      if (mid) lastId = mid;
    }
    if (!newCount) break;
    await sleep(400);
  }
  return collected;
}

/**
 * Full corpus crawl for one account:
 * - groups (id/name/members)
 * - users (id/display)
 * - recent history messages per group (via websocket old_messages when REST history 404)
 */
export async function backfillAccountCorpus({
  api,
  store,
  accountId,
  historyCount = 50,
  maxGroups = 200,
  delayMs = 250,
  groupIds = null,
}) {
  const result = {
    account_id: accountId,
    started_at: utcNow(),
    groups_seen: 0,
    members_seen: 0,
    users_upserted: 0,
    messages_ingested: 0,
    messages_skipped: 0,
    history_method: "none",
    errors: [],
    finished_at: null,
  };

  if (!api) {
    result.errors.push("not_connected");
    result.finished_at = utcNow();
    return result;
  }

  let groups = [];
  try {
    groups = await listGroupsDetailed(api);
  } catch (err) {
    result.errors.push(`list_groups:${String(err?.message || err)}`);
    groups = store.getSetting(`discovered_groups_${accountId}`, []) || [];
  }
  if (Array.isArray(groupIds) && groupIds.length) {
    const allow = new Set(groupIds.map(String));
    groups = groups.filter((g) => allow.has(String(g.source_id)));
  }
  groups = groups.slice(0, maxGroups);
  result.groups_seen = groups.length;
  store.setSetting(`discovered_groups_${accountId}`, groups);

  // One websocket old_messages dump can contain many groups — pull once then partition.
  let sharedOld = [];
  try {
    sharedOld = await fetchOldGroupMessages(api, { timeoutMs: 20000, maxPages: 8 });
    if (sharedOld.length) result.history_method = "ws_old_messages";
    result.ws_old_count = sharedOld.length;
  } catch (err) {
    result.errors.push(`ws_old:${String(err?.message || err)}`);
  }

  const oldByGroup = new Map();
  for (const m of sharedOld) {
    const tid = String(m.threadId || m.data?.idTo || "");
    if (!tid) continue;
    if (!oldByGroup.has(tid)) oldByGroup.set(tid, []);
    oldByGroup.get(tid).push(m);
  }

  for (const g of groups) {
    const gid = String(g.source_id || "");
    if (!gid) continue;
    let gname = String(g.source_name || "");

    store.upsertSource({
      accountId,
      sourceId: gid,
      sourceType: "group",
      sourceName: gname,
      mode: "listen_only",
      isAllowed: true,
    });

    let memberIds = [];
    let adminIds = [];
    let creatorId = "";
    try {
      if (typeof api.getGroupInfo === "function") {
        const info = await api.getGroupInfo(gid);
        const gi = info?.gridInfoMap?.[gid] || {};
        if (gi.name) gname = String(gi.name);
        creatorId = String(gi.creatorId || "");
        adminIds = Array.isArray(gi.adminIds) ? gi.adminIds.map(String) : [];
        if (Array.isArray(gi.memberIds) && gi.memberIds.length) {
          memberIds = gi.memberIds.map(String);
        } else if (Array.isArray(gi.memVerList) && gi.memVerList.length) {
          memberIds = gi.memVerList.map(parseMemberToken).filter(Boolean);
        }
        if (Array.isArray(gi.currentMems)) {
          for (const m of gi.currentMems) {
            const uid = String(m.id || m.uid || m.userId || "");
            if (!uid) continue;
            store.upsertUser({
              accountId,
              userId: uid,
              displayName: m.dName || m.displayName || m.zaloName || "",
              avatar: m.avatar || "",
              globalId: m.globalId || "",
              raw: m,
            });
            result.users_upserted += 1;
          }
        }
        store.upsertSource({
          accountId,
          sourceId: gid,
          sourceType: "group",
          sourceName: gname,
          mode: "listen_only",
          isAllowed: true,
        });
      }
    } catch (err) {
      result.errors.push(`group_info:${gid}:${String(err?.message || err)}`);
    }

    if (creatorId) memberIds.push(creatorId);
    memberIds = [...new Set(memberIds.filter(Boolean))];

    const roleOf = (uid) => {
      if (creatorId && uid === creatorId) return "creator";
      if (adminIds.includes(uid)) return "admin";
      return "member";
    };
    for (const uid of memberIds) {
      store.upsertSourceMember({
        accountId,
        sourceId: gid,
        userId: uid,
        role: roleOf(uid),
      });
      result.members_seen += 1;
    }

    if (memberIds.length && typeof api.getGroupMembersInfo === "function") {
      for (let i = 0; i < memberIds.length; i += 20) {
        const chunk = memberIds.slice(i, i + 20);
        try {
          const res = await api.getGroupMembersInfo(chunk);
          const profiles = res?.profiles || {};
          for (const [uid, p] of Object.entries(profiles)) {
            store.upsertUser({
              accountId,
              userId: uid,
              displayName: p.displayName || p.zaloName || "",
              avatar: p.avatar || "",
              globalId: p.globalId || "",
              accountStatus: p.accountStatus,
              raw: p,
            });
            result.users_upserted += 1;
          }
        } catch (err) {
          result.errors.push(`members_info:${gid}:${String(err?.message || err)}`);
        }
        await sleep(delayMs);
      }
    }

    // History: prefer the current cloud-history adapter, then legacy REST,
    // then the shared websocket dump. Zalo removed the legacy endpoint in
    // August 2026, so the v2 adapter must win when installed.
    let msgs = [];
    if (typeof api.getGroupChatHistoryV2 === "function") {
      try {
        const hist = await api.getGroupChatHistoryV2({ groupId: gid, count: historyCount });
        msgs = Array.isArray(hist?.groupMsgs) ? hist.groupMsgs : [];
        if (msgs.length) result.history_method = "cloud_history_v2";
      } catch (err) {
        result.errors.push(`history_v2:${gid}:${String(err?.message || err).slice(0, 180)}`);
      }
    }
    if (!msgs.length && typeof api.getGroupChatHistory === "function") {
      try {
        const hist = await api.getGroupChatHistory(gid, historyCount);
        msgs = Array.isArray(hist?.groupMsgs) ? hist.groupMsgs : [];
        if (msgs.length) result.history_method = "rest_history";
      } catch (err) {
        result.errors.push(`history_rest:${gid}:404/err`);
      }
    }
    if (!msgs.length) {
      msgs = (oldByGroup.get(gid) || []).slice(0, historyCount);
    }

    for (const m of msgs) {
      try {
        const message = asMessageLike(m, gid);
        if (!message.threadId) message.threadId = gid;
        const event = normalizeInboundMessage({
          accountId,
          message,
          sourceName: gname,
        });
        event.raw_metadata = {
          ...(event.raw_metadata || {}),
          sender_user_id: event.sender_id,
          backfill: true,
        };
        if (event.sender_id) {
          store.upsertUser({
            accountId,
            userId: event.sender_id,
            displayName: event.sender_name || "",
          });
        }
        const inserted = store.putEvent(event);
        if (inserted) result.messages_ingested += 1;
        else result.messages_skipped += 1;
      } catch (err) {
        result.messages_skipped += 1;
        result.errors.push(`msg:${gid}:${String(err?.message || err)}`);
      }
    }

    await sleep(delayMs);
    store.setHealth(`backfill_progress_${accountId}`, {
      at: utcNow(),
      last_group_id: gid,
      groups_done: result.groups_seen,
      messages_ingested: result.messages_ingested,
      users_upserted: result.users_upserted,
      members_seen: result.members_seen,
    });
  }

  try {
    if (typeof api.getAllFriends === "function") {
      const friends = await api.getAllFriends(200, 1);
      const list = Array.isArray(friends) ? friends : friends?.data || friends?.friends || [];
      for (const f of list) {
        const uid = String(f.userId || f.uid || f.id || "");
        if (!uid) continue;
        store.upsertUser({
          accountId,
          userId: uid,
          displayName: f.displayName || f.zaloName || f.dName || "",
          avatar: f.avatar || "",
          globalId: f.globalId || "",
          raw: { friend: true },
        });
        result.users_upserted += 1;
      }
    }
  } catch (err) {
    result.errors.push(`friends:${String(err?.message || err)}`);
  }

  result.finished_at = utcNow();
  store.setHealth(`backfill_${accountId}`, {
    ...result,
    errors: result.errors.slice(-50),
  });
  store.audit({
    accountId,
    actorId: "system",
    action: "corpus_backfill",
    detail: `groups=${result.groups_seen};msgs=${result.messages_ingested};users=${result.users_upserted};members=${result.members_seen}`,
  });
  return result;
}
