import test from "node:test";
import assert from "node:assert/strict";

import { evaluateOaOutbound } from "../src/oa_policy.js";

function bot(mode, allow_user_ids = []) {
  return {
    bot_id: "demo-oa",
    tenant_id: "demo",
    enabled: true,
    policy: { mode, allow_user_ids, max_messages_per_hour: 20 },
  };
}

test("draft_first is a hard outbound block", () => {
  const decision = evaluateOaOutbound({
    bot: bot("draft_first"),
    recipientId: "user-1",
    text: "hello",
  });
  assert.deepEqual(decision, { allow: false, reason: "outbound_requires_approval", mode: "draft_first" });
});

test("approved_send permits only an explicit allowlist when configured", () => {
  assert.deepEqual(
    evaluateOaOutbound({
      bot: bot("approved_send", ["user-1"]),
      recipientId: "user-1",
      text: "hello",
    }),
    { allow: true, reason: "approved", mode: "approved_send" },
  );
  assert.deepEqual(
    evaluateOaOutbound({
      bot: bot("approved_send", ["user-1"]),
      recipientId: "user-2",
      text: "hello",
    }),
    { allow: false, reason: "recipient_not_allowlisted", mode: "approved_send" },
  );
});

test("approved_send with an empty allowlist is fail-closed", () => {
  const decision = evaluateOaOutbound({
    bot: bot("approved_send", []),
    recipientId: "user-1",
    text: "hello",
  });
  assert.equal(decision.allow, false);
  assert.equal(decision.reason, "recipient_allowlist_empty");
});

test("disabled and paused bots cannot send", () => {
  assert.equal(evaluateOaOutbound({ bot: { ...bot("approved_send"), enabled: false }, recipientId: "u", text: "x" }).reason, "bot_disabled");
  assert.equal(evaluateOaOutbound({ bot: bot("paused"), recipientId: "u", text: "x" }).reason, "bot_paused");
  assert.equal(evaluateOaOutbound({ bot: bot("disabled"), recipientId: "u", text: "x" }).reason, "bot_disabled");
});

test("invalid recipient and oversized/empty text are rejected before provider access", () => {
  assert.equal(evaluateOaOutbound({ bot: bot("approved_send", ["u"]), recipientId: "", text: "x" }).reason, "recipient_required");
  assert.equal(evaluateOaOutbound({ bot: bot("approved_send", ["u"]), recipientId: "u", text: "" }).reason, "text_required");
  assert.equal(evaluateOaOutbound({ bot: bot("approved_send", ["u"]), recipientId: "u", text: "x".repeat(3501) }).reason, "text_too_long");
});

void assert;
