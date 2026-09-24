import test from "node:test";
import assert from "node:assert/strict";
import { findMentions, createMemberDirectory } from "../src/zalo_mentions.js";

test("findMentions parses single @mention in text", () => {
  const members = [
    { uid: "u123", name: "Nguyễn Văn A" },
    { uid: "u456", name: "Trần Thị B" },
  ];
  const text = "Xin chào @Nguyễn Văn A bạn khỏe không?";
  const mentions = findMentions(text, members);
  assert.equal(mentions.length, 1);
  assert.equal(mentions[0].uid, "u123");
  assert.equal(mentions[0].pos, 9);
  assert.equal(mentions[0].len, "@Nguyễn Văn A".length);
});

test("findMentions ignores email addresses", () => {
  const members = [{ uid: "u123", name: "gmail" }];
  const text = "Liên hệ info@gmail.com để biết thêm";
  const mentions = findMentions(text, members);
  assert.equal(mentions.length, 0);
});

test("findMentions prefers longer matching name", () => {
  const members = [
    { uid: "u1", name: "Lương Hải" },
    { uid: "u2", name: "Lương Hải Anh" },
  ];
  const text = "Chào @Lương Hải Anh nha!";
  const mentions = findMentions(text, members);
  assert.equal(mentions.length, 1);
  assert.equal(mentions[0].uid, "u2");
  assert.equal(mentions[0].len, "@Lương Hải Anh".length);
});

test("findMentions skips selfUid", () => {
  const members = [
    { uid: "bot_uid", name: "Amon" },
    { uid: "u123", name: "Teddy" },
  ];
  const text = "@Amon và @Teddy";
  const mentions = findMentions(text, members, { selfUid: "bot_uid" });
  assert.equal(mentions.length, 1);
  assert.equal(mentions[0].uid, "u123");
});

test("createMemberDirectory caches and returns group members", async () => {
  let callCount = 0;
  const dir = createMemberDirectory({
    fetchMembers: async (groupId) => {
      callCount++;
      return [{ uid: "1", name: "User 1" }];
    },
    ttlMs: 5000,
  });

  const mems1 = await dir.get("g1");
  assert.equal(mems1.length, 1);
  assert.equal(callCount, 1);

  const mems2 = await dir.get("g1");
  assert.equal(mems2.length, 1);
  assert.equal(callCount, 1); // cached

  dir.clear();
  const mems3 = await dir.get("g1");
  assert.equal(callCount, 2); // fetched after clear
});

test("findMentions parses @All and @all as uid -1", () => {
  const members = [{ uid: "u123", name: "Teddy" }];
  const text = "Thông báo khẩn @All mọi người tập hợp!";
  const mentions = findMentions(text, members);
  assert.equal(mentions.length, 1);
  assert.equal(mentions[0].uid, "-1");
  assert.equal(mentions[0].len, "@All".length);

  const textLower = "Alo @all ơi";
  const mentionsLower = findMentions(textLower, members);
  assert.equal(mentionsLower.length, 1);
  assert.equal(mentionsLower[0].uid, "-1");
});
