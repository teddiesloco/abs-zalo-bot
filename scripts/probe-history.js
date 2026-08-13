import { Store } from "../src/store.js";
import { BridgeHub } from "../src/zalo_runtime.js";
import { PolicyGuard } from "../src/policy.js";
import { loadConfig } from "../src/config.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = loadConfig(path.join(root, "config.toml"));
const store = new Store(path.join(root, "data"));
const policy = new PolicyGuard({ config, store });
const hub = new BridgeHub({ config, store, policy });
const rt = hub.getRuntime("default");
await rt.connect({ forceQr: false });
const api = rt.api;
const gid = process.env.ZALO_GROUP_ID || process.argv[2] || "";
if (!gid) {
  console.error("Missing group id. Pass ZALO_GROUP_ID or the group id as the first argument.");
  process.exit(2);
}

const info = await api.getGroupInfo(gid);
const g = info.gridInfoMap[gid];
console.log(
  JSON.stringify(
    {
      name: g?.name,
      totalMember: g?.totalMember,
      memberIds_len: g?.memberIds?.length ?? null,
      memVerList_len: g?.memVerList?.length ?? null,
      memVerList_sample: (g?.memVerList || []).slice(0, 5),
      currentMems_sample: (g?.currentMems || []).slice(0, 2),
      adminIds: g?.adminIds || [],
      creatorId: g?.creatorId || "",
      keys: Object.keys(g || {}),
    },
    null,
    2,
  ),
);

try {
  const h = await api.getGroupChatHistory(gid, 5);
  console.log(
    "history",
    JSON.stringify({
      keys: Object.keys(h || {}),
      msgs: h?.groupMsgs?.length,
      sample: h?.groupMsgs?.[0]
        ? {
            threadId: h.groupMsgs[0].threadId,
            isSelf: h.groupMsgs[0].isSelf,
            dataKeys: Object.keys(h.groupMsgs[0].data || {}),
            msgId: h.groupMsgs[0].data?.msgId,
            contentType: typeof h.groupMsgs[0].data?.content,
          }
        : null,
    }),
  );
} catch (e) {
  console.log("history_err", e?.message || e);
}

// try getGroupMembersInfo with memVerList if present
const ids = (g?.memVerList || g?.memberIds || []).slice(0, 5).map(String);
if (ids.length) {
  try {
    const mi = await api.getGroupMembersInfo(ids);
    console.log("members_info_count", Object.keys(mi?.profiles || {}).length);
  } catch (e) {
    console.log("members_err", e?.message || e);
  }
}

await rt.pause();
store.close();
