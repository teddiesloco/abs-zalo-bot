// Auto-discover Zalo group IDs + owner uid after QR. No secrets logged.
import { utcNow } from "./schema.js";

export function extractAccountIdentity(info) {
  // fetchAccountInfo → { profile: User } or flat shapes
  const p = info?.profile || info?.userInfo || info || {};
  return {
    user_id: String(p.userId || p.uid || p.user_id || info?.userId || info?.uid || ""),
    display_name: String(p.displayName || p.display_name || p.zaloName || p.zalo_name || p.name || ""),
    phone: String(p.phoneNumber || p.phone || ""),
  };
}

export async function listGroupsDetailed(api) {
  if (!api || typeof api.getAllGroups !== "function") return [];
  const raw = await api.getAllGroups();
  const ids = raw?.gridVerMap
    ? Object.keys(raw.gridVerMap)
    : Array.isArray(raw)
      ? raw.map((g) => String(g.groupId || g.id || "")).filter(Boolean)
      : Object.keys(raw || {}).filter((k) => k !== "version" && k !== "gridVerMap");

  const out = [];
  // batch getGroupInfo when available
  if (typeof api.getGroupInfo === "function" && ids.length) {
    const chunkSize = 20;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      try {
        const info = await api.getGroupInfo(chunk.length === 1 ? chunk[0] : chunk);
        const map = info?.gridInfoMap || {};
        for (const id of chunk) {
          const g = map[id] || {};
          out.push({
            source_id: String(id),
            source_name: String(g.name || g.groupName || ""),
            total_member: Number(g.totalMember || 0),
            source_type: "group",
          });
        }
      } catch {
        for (const id of chunk) {
          out.push({ source_id: String(id), source_name: "", total_member: 0, source_type: "group" });
        }
      }
    }
    return out;
  }

  return ids.map((id) => ({
    source_id: String(id),
    source_name: "",
    total_member: 0,
    source_type: "group",
  }));
}

export function matchGroupByName(groups, groupName) {
  const want = String(groupName || "").trim().toLowerCase();
  if (!want) return null;
  const exact = groups.find((g) => String(g.source_name || "").trim().toLowerCase() === want);
  if (exact) return exact;
  const partial = groups.find((g) => String(g.source_name || "").toLowerCase().includes(want));
  return partial || null;
}

/**
 * After connect: owner uid, destination resolve, optional source catalog.
 */
export async function bootstrapAccount({ api, store, accountId, destinationName = "configured destination" }) {
  const result = {
    account_id: accountId,
    owner_user_id: "",
    owner_display_name: "",
    groups_found: 0,
    destination: null,
    sources_seeded: 0,
    at: utcNow(),
  };

  let info = null;
  try {
    if (typeof api.fetchAccountInfo === "function") info = await api.fetchAccountInfo();
  } catch {
    info = null;
  }
  const identity = extractAccountIdentity(info || {});
  result.owner_user_id = identity.user_id;
  result.owner_display_name = identity.display_name;

  if (identity.user_id) {
    store.setAccountStatus(accountId, "connected", {
      zalo_user_id: identity.user_id,
      display_name: identity.display_name || "",
      last_error: "",
    });
    // logged-in account is owner for ops asks
    store.upsertPermission({
      accountId,
      userId: identity.user_id,
      role: "owner",
      displayName: identity.display_name || "zalo-owner",
    });
    store.audit({
      accountId,
      actorId: "system",
      action: "auto_owner",
      detail: identity.user_id,
    });
  }

  let groups = [];
  try {
    groups = await listGroupsDetailed(api);
  } catch (err) {
    store.setHealth(`discover_groups_error_${accountId}`, String(err?.message || err));
    groups = [];
  }
  result.groups_found = groups.length;
  store.setSetting(`discovered_groups_${accountId}`, groups);
  store.setHealth(`discovered_groups_count_${accountId}`, String(groups.length));

  // seed listen_only catalog for visibility (listen_all_groups already stores all)
  for (const g of groups) {
    if (!g.source_id) continue;
    const existing = store.getSource(accountId, g.source_id);
    if (!existing) {
      store.upsertSource({
        accountId,
        sourceId: g.source_id,
        sourceType: "group",
        sourceName: g.source_name || "",
        mode: "listen_only",
        isAllowed: true,
      });
      result.sources_seeded += 1;
    } else if (g.source_name && !existing.source_name) {
      store.upsertSource({
        accountId,
        sourceId: g.source_id,
        sourceType: "group",
        sourceName: g.source_name,
        mode: existing.mode || "listen_only",
        isAllowed: existing.is_allowed,
        muted: existing.muted,
      });
    }
  }

  const want =
    destinationName ||
    store.getDestination(accountId).group_name ||
    process.env.DESTINATION_GROUP_NAME ||
    "configured destination";
  const hit = matchGroupByName(groups, want);
  if (hit?.source_id) {
    store.setDestination(accountId, hit.source_id, hit.source_name || want);
    store.audit({
      accountId,
      actorId: "system",
      action: "auto_resolve_destination",
      detail: `${hit.source_name}:${hit.source_id}`,
    });
    result.destination = {
      group_id: hit.source_id,
      group_name: hit.source_name || want,
    };
  } else {
    // keep name placeholder
    const cur = store.getDestination(accountId);
    if (!cur.group_id) store.setDestination(accountId, "", want);
    result.destination = { group_id: "", group_name: want, unresolved: true };
  }

  store.setHealth(`bootstrap_${accountId}`, result);
  return result;
}

// keep name used by older connect path
export async function resolveDestinationByName(api, groupName) {
  const groups = await listGroupsDetailed(api);
  const hit = matchGroupByName(groups, groupName);
  if (!hit) return null;
  return { group_id: hit.source_id, group_name: hit.source_name || groupName };
}
