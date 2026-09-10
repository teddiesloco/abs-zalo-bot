import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { Store } from "../src/store.js";
import { PolicyGuard } from "../src/policy.js";
import { BridgeHub } from "../src/zalo_runtime.js";
import {
  parseMarkdownStyles,
  splitIntoSafeZaloChunks,
  buildZaloStyledMessage,
  capStyles,
  ZALO_STYLES,
} from "../src/zalo_styler.js";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "abs-rich-admin-test-"));
}

async function listen(app) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const address = server.address();
  return { server, base: `http://127.0.0.1:${address.port}` };
}

test("Zalo Rich Text & Auto Styling Engine", async (t) => {
  await t.test("parseMarkdownStyles accurately tokenizes headers, colors and inline tags", () => {
    const input = [
      "# Tiêu đề lớn",
      "Xin chào **bác Khương**, đây là [RED]thông báo đỏ[/RED] và [GREEN]xanh ngọc[/GREEN]!",
      "Nội dung có *nghiêng*, __gạch chân__ và ~~gạch ngang~~.",
    ].join("\n");

    const { text, styles } = parseMarkdownStyles(input);

    assert.ok(!text.includes("# "));
    assert.ok(!text.includes("**"));
    assert.ok(!text.includes("[RED]"));
    assert.ok(!text.includes("[/RED]"));
    assert.ok(!text.includes("[GREEN]"));
    assert.ok(!text.includes("[/GREEN]"));
    assert.ok(!text.includes("__"));
    assert.ok(!text.includes("~~"));

    assert.ok(styles.some((s) => s.st === ZALO_STYLES.HeaderLarge));
    assert.ok(styles.some((s) => s.st === ZALO_STYLES.RubyRed));
    assert.ok(styles.some((s) => s.st === ZALO_STYLES.EmeraldGreen));
    assert.ok(styles.some((s) => s.st === ZALO_STYLES.Bold));
    assert.ok(styles.some((s) => s.st === ZALO_STYLES.Italic));
    assert.ok(styles.some((s) => s.st === ZALO_STYLES.Underline));
    assert.ok(styles.some((s) => s.st === ZALO_STYLES.StrikeThrough));
  });

  await t.test("splitIntoSafeZaloChunks breaks long text into <= 650 char bubbles", () => {
    const longParagraph = "Đoạn văn này được lặp lại để kiểm tra giới hạn bong bóng chat Zalo. ".repeat(25);
    const chunks = splitIntoSafeZaloChunks(longParagraph, 650);

    assert.ok(chunks.length > 1);
    for (const chunk of chunks) {
      assert.ok(chunk.length <= 650, `Chunk length ${chunk.length} should not exceed 650`);
    }
  });

  await t.test("buildZaloStyledMessage formats payload ready for API", () => {
    const msg = buildZaloStyledMessage("Thông báo **khẩn cấp**!");
    assert.equal(msg.msg, "Thông báo khẩn cấp!");
    assert.ok(Array.isArray(msg.styles));
    assert.equal(msg.styles[0].st, "b");
  });

  await t.test("capStyles strictly enforces JSON byte budget while preserving priority", () => {
    // Generate many styles to intentionally overflow 250 characters JSON
    const overflowInput = [
      "# Tiêu đề lớn ưu tiên 1",
      "Đây là [RED]màu đỏ ưu tiên 2[/RED] và [GREEN]xanh ưu tiên 2[/GREEN].",
      "Hàng loạt từ **đậm 1**, **đậm 2**, **đậm 3**, **đậm 4**, **đậm 5**, **đậm 6**, **đậm 7**, **đậm 8**, **đậm 9**, **đậm 10**.",
      "Và các từ *nghiêng 1*, *nghiêng 2*, *nghiêng 3*, *nghiêng 4*, *nghiêng 5*.",
    ].join("\n");

    const fullStyles = parseMarkdownStyles(overflowInput).styles;
    const initialJsonLen = JSON.stringify(fullStyles).length;
    assert.ok(initialJsonLen > 300, `Initial styles JSON length (${initialJsonLen}) should exceed 300`);

    const capped = capStyles(fullStyles, 250);
    const cappedJsonLen = JSON.stringify(capped).length;
    assert.ok(cappedJsonLen <= 250, `Capped styles JSON length (${cappedJsonLen}) must be <= 250`);

    // Ensure high priority (HeaderLarge / Colors) survived pruning over low priority (Italic)
    assert.ok(capped.some((s) => s.st === ZALO_STYLES.HeaderLarge), "HeaderLarge should survive budget pruning");
    assert.ok(capped.some((s) => s.st === ZALO_STYLES.RubyRed), "Color tags should survive budget pruning");
  });
});

test("Zalo Group Administration Endpoints & Runtime", async (t) => {
  const dir = tempDir();
  const configPath = path.join(dir, "config.toml");
  fs.writeFileSync(configPath, 'default_account_id="default"\nretention_days=30\n');
  const config = loadConfig(configPath);
  const store = new Store(dir);
  store.seedFromConfig(config);
  const policy = new PolicyGuard({ config, store });

  const mockApi = {
    changeGroupName: async (name, gid) => ({ error: 0, gid, name }),
    changeGroupAvatar: async (avatarSource, gid) => ({ error: 0, gid, avatarSource }),
    createNote: async (gid, content, pin) => ({ error: 0, gid, content, pin }),
    getPendingGroupMembers: async (gid) => ({ error: 0, data: [{ userId: "pending_1" }] }),
    reviewPendingMemberRequest: async (uid, gid, isApproved) => ({ error: 0, uid, gid, isApproved }),
    addGroupBlockedMember: async (uid, gid) => ({ error: 0, uid, gid }),
    removeGroupBlockedMember: async (uid, gid) => ({ error: 0, uid, gid }),
    getGroupLinkDetail: async (gid) => ({ error: 0, link: `https://zalo.me/g/${gid}` }),
    enableGroupLink: async (gid) => ({ error: 0, enabled: true, gid }),
    disableGroupLink: async (gid) => ({ error: 0, enabled: false, gid }),
    updateGroupSettings: async (settings, gid) => ({ error: 0, settings, gid }),
    sendMessage: async (message, threadId, type) => ({ message, threadId, type }),
  };

  const hub = new BridgeHub({ config, store, policy, clientFactory: {} });
  const runtime = hub.getRuntime("default");
  runtime.api = mockApi;

  const app = createApp({ config, store, policy, hub });
  const { server, base } = await listen(app);

  t.after(() => {
    server.close();
  });

  await t.test("Direct runtime calls for group management", async () => {
    const renameRes = await runtime.renameGroup("g100", "Tên Nhóm Siêu Cấp");
    assert.equal(renameRes.name, "Tên Nhóm Siêu Cấp");

    const avatarRes = await runtime.changeGroupAvatar("g100", "https://example.com/avatar.jpg");
    assert.equal(avatarRes.avatarSource, "https://example.com/avatar.jpg");

    const noteRes = await runtime.createGroupNote("g100", "Nội quy nhóm 2026", true);
    assert.equal(noteRes.content, "Nội quy nhóm 2026");
    assert.equal(noteRes.pin, true);

    const pendingRes = await runtime.getPendingGroupMembers("g100");
    assert.equal(pendingRes.data[0].userId, "pending_1");

    const reviewRes = await runtime.reviewPendingMember("g100", "pending_1", true);
    assert.equal(reviewRes.isApproved, true);

    const blockRes = await runtime.addGroupBlockedMember("g100", "spammer_99");
    assert.equal(blockRes.uid, "spammer_99");

    const unblockRes = await runtime.removeGroupBlockedMember("g100", "spammer_99");
    assert.equal(unblockRes.uid, "spammer_99");

    const linkRes = await runtime.getGroupLink("g100");
    assert.equal(linkRes.link, "https://zalo.me/g/g100");

    const enableRes = await runtime.setGroupLink("g100", true);
    assert.equal(enableRes.enabled, true);

    const disableRes = await runtime.setGroupLink("g100", false);
    assert.equal(disableRes.enabled, false);

    const settingsRes = await runtime.updateGroupSettings("g100", { lockChat: 1 });
    assert.deepEqual(settingsRes.settings, { lockChat: 1 });
  });

  await t.test("HTTP REST API endpoints for group management", async () => {
    // 1. Rename
    const resRename = await fetch(`${base}/api/groups/g100/name`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Cộng Đồng AI VIP" }),
    });
    assert.equal(resRename.status, 200);
    const jsonRename = await resRename.json();
    assert.equal(jsonRename.ok, true);
    assert.equal(jsonRename.result.name, "Cộng Đồng AI VIP");

    // 2. Avatar
    const resAvatar = await fetch(`${base}/api/groups/g100/avatar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ avatar_source: "https://agentsea.vn/logo.png" }),
    });
    assert.equal(resAvatar.status, 200);
    const jsonAvatar = await resAvatar.json();
    assert.equal(jsonAvatar.ok, true);

    // 3. Notes / Announcements
    const resNote = await fetch(`${base}/api/groups/g100/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Ghim thông báo chính thức", pin: true }),
    });
    assert.equal(resNote.status, 200);
    const jsonNote = await resNote.json();
    assert.equal(jsonNote.ok, true);
    assert.equal(jsonNote.result.pin, true);

    // 4. Pending members list
    const resPending = await fetch(`${base}/api/groups/g100/pending-members`);
    assert.equal(resPending.status, 200);
    const jsonPending = await resPending.json();
    assert.equal(jsonPending.ok, true);
    assert.equal(jsonPending.result.data.length, 1);

    // 5. Review pending member
    const resReview = await fetch(`${base}/api/groups/g100/pending-members/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ member_id: "pending_1", approve: true }),
    });
    assert.equal(resReview.status, 200);
    const jsonReview = await resReview.json();
    assert.equal(jsonReview.ok, true);
    assert.equal(jsonReview.result.isApproved, true);

    // 6. Block member
    const resBlock = await fetch(`${base}/api/groups/g100/blocked/add`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ member_id: "spammer_1" }),
    });
    assert.equal(resBlock.status, 200);
    const jsonBlock = await resBlock.json();
    assert.equal(jsonBlock.ok, true);

    // 7. Unblock member
    const resUnblock = await fetch(`${base}/api/groups/g100/blocked/remove`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ member_id: "spammer_1" }),
    });
    assert.equal(resUnblock.status, 200);
    const jsonUnblock = await resUnblock.json();
    assert.equal(jsonUnblock.ok, true);

    // 8. Group link get & toggle
    const resLink = await fetch(`${base}/api/groups/g100/link`);
    assert.equal(resLink.status, 200);
    const jsonLink = await resLink.json();
    assert.equal(jsonLink.ok, true);

    const resLinkEnable = await fetch(`${base}/api/groups/g100/link`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enable: true }),
    });
    assert.equal(resLinkEnable.status, 200);
    const jsonLinkEnable = await resLinkEnable.json();
    assert.equal(jsonLinkEnable.ok, true);
    assert.equal(jsonLinkEnable.result.enabled, true);

    // 9. Update group settings
    const resSettings = await fetch(`${base}/api/groups/g100/settings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: { enableMsgHistory: 1 } }),
    });
    assert.equal(resSettings.status, 200);
    const jsonSettings = await resSettings.json();
    assert.equal(jsonSettings.ok, true);
    assert.equal(jsonSettings.result.settings.enableMsgHistory, 1);
  });
});
