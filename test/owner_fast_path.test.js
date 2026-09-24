import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PolicyGuard } from "../src/policy.js";
import { Store } from "../src/store.js";
import { parseBotCommand } from "../src/inbound_router.js";

function makeEnv() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "abs-fastpath-test-"));
  const store = new Store(tmp, 30);
  const config = {
    default_account_id: "default",
    listen_all_groups: true,
    listen_dms: true,
    listener_only: false,
    read_only_source: false,
    owner_uid: "owner-123",
  };
  const policy = new PolicyGuard({ config, store });
  store.setDestination("default", "dest-grp", "Main Group");
  store.upsertPermission({ accountId: "default", userId: "owner-123", role: "owner" });
  return { store, policy };
}

test("Owner sending zalo.me/g link activates owner_join_link action in any group or DM", () => {
  const { policy } = makeEnv();

  const inGroup = policy.evaluateInbound({
    account_id: "default",
    source_id: "some-other-group",
    source_type: "group",
    sender_id: "owner-123",
    text: "Mời bot tham gia https://zalo.me/g/abc123xyz nhé",
  });
  assert.equal(inGroup.allow, true);
  assert.equal(inGroup.reason, "owner_join_link");
  assert.deepEqual(inGroup.actions, ["owner_action"]);

  const inDm = policy.evaluateInbound({
    account_id: "default",
    source_id: "owner-123",
    source_type: "dm",
    sender_id: "owner-123",
    text: "zalo.me/g/def456",
  });
  assert.equal(inDm.allow, true);
  assert.equal(inDm.reason, "owner_join_link");
  assert.deepEqual(inDm.actions, ["owner_action"]);
});

test("Owner sending undo / thu hồi activates owner_undo action", () => {
  const { policy } = makeEnv();

  const undoGroup = policy.evaluateInbound({
    account_id: "default",
    source_id: "some-group",
    source_type: "group",
    sender_id: "owner-123",
    text: "thu hồi tin này đi",
  });
  assert.equal(undoGroup.allow, true);
  assert.equal(undoGroup.reason, "owner_undo");
  assert.deepEqual(undoGroup.actions, ["owner_action"]);

  const undoDm = policy.evaluateInbound({
    account_id: "default",
    source_id: "owner-123",
    source_type: "dm",
    sender_id: "owner-123",
    text: "/undo",
  });
  assert.equal(undoDm.allow, true);
  assert.equal(undoDm.reason, "owner_undo");
  assert.deepEqual(undoDm.actions, ["owner_action"]);
});

test("Owner DM chat is not blocked into silence", () => {
  const { policy } = makeEnv();

  const dmChat = policy.evaluateInbound({
    account_id: "default",
    source_id: "owner-123",
    source_type: "dm",
    sender_id: "owner-123",
    text: "Tổng hợp tình hình hôm nay giúp anh",
  });
  assert.equal(dmChat.allow, true);
  assert.equal(dmChat.reason, "owner_dm_ask");
  assert.deepEqual(dmChat.actions, ["destination_ask"]);
});

test("Non-owner in DM remains stored only without triggering actions", () => {
  const { policy } = makeEnv();

  const strangerDm = policy.evaluateInbound({
    account_id: "default",
    source_id: "stranger-999",
    source_type: "dm",
    sender_id: "stranger-999",
    text: "https://zalo.me/g/scamlink",
  });
  assert.equal(strangerDm.allow, true);
  assert.equal(strangerDm.reason, "dm_store_only");
  assert.deepEqual(strangerDm.actions, ["store"]);
});
