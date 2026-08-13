import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("./data/bridge.sqlite3");
const q = (s) => db.prepare(s).get();
const out = {
  messages: q("SELECT COUNT(*) AS c FROM zalo_messages").c,
  users: q("SELECT COUNT(*) AS c FROM zalo_users").c,
  members: q("SELECT COUNT(*) AS c FROM zalo_source_members").c,
  sources: q("SELECT COUNT(*) AS c FROM zalo_sources").c,
  sample_users: db
    .prepare(
      "SELECT user_id, display_name FROM zalo_users WHERE display_name != '' LIMIT 5",
    )
    .all(),
  sample_groups: db
    .prepare("SELECT source_id, source_name FROM zalo_sources LIMIT 8")
    .all(),
  sample_msgs: db
    .prepare(
      "SELECT source_name, sender_display_name, substr(text_redacted,1,100) AS t FROM zalo_messages LIMIT 5",
    )
    .all(),
};
console.log(JSON.stringify(out, null, 2));
