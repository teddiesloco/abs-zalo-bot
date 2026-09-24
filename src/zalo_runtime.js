// Zalo adapter. Live zca-js is lazy-loaded. Tests inject a fake client.
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { normalizeInboundMessage, utcNow } from "./schema.js";
import { stageHermesMedia, withAudioExtension } from "./hermes_media.js";
import { chunkZaloStyledText, formatAndChunkZaloMarkdown } from "./zalo_styler.js";
import { findMentions } from "./zalo_mentions.js";
import { enrichSticker, stickerRefOf } from "./zalo_stickers.js";
import { classifyAttachments } from "./zalo_attachments.js";

const PERSONAL_ACTIONS = new Set([
  "send_message", "send_sticker", "send_voice", "send_video", "forward_message", "typing",
  "create_group", "rename_group", "leave_group", "disperse_group", "update_group_settings",
  "create_note", "change_avatar", "block_member", "unblock_member", "review_pending",
  "group_link_enable", "group_link_disable", "send_card", "send_bank_card",
  "friend_accept", "friend_reject", "friend_request", "friend_request_undo", "friend_remove",
  "user_block", "user_unblock",
  "join_group_link", "join_group_invite_box", "get_group_link_info", "get_sticker_detail", "search_stickers"
]);

function required(value, name) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${name}_required`);
  return text;
}

function threadType(value) { return Number(value) === 0 ? 0 : 1; }

function safeHttpsUrl(value, name) {
  const url = new URL(required(value, name));
  if (url.protocol !== "https:" || /^(?:localhost|127\\.|0\\.|10\\.|192\\.168\\.|172\\.(?:1[6-9]|2\\d|3[0-1])\\.)/u.test(url.hostname)) throw new Error(`${name}_must_be_public_https`);
  return url.toString();
}

function controlledAttachment(filePath) {
  const root = process.env.ABS_ZALO_MEDIA_ROOT;
  if (!root) throw new Error("media_root_not_configured");
  const canonicalRoot = fs.realpathSync(path.resolve(root));
  const canonicalFile = fs.realpathSync(path.resolve(required(filePath, "attachment_path")));
  if (!canonicalFile.startsWith(`${canonicalRoot}${path.sep}`)) throw new Error("attachment_outside_media_root");
  const stat = fs.statSync(canonicalFile);
  if (!stat.isFile() || stat.size > 25 * 1024 * 1024) throw new Error("attachment_invalid_or_too_large");
  const filename = path.basename(canonicalFile);
  if (!filename.includes(".")) throw new Error("attachment_extension_required");
  return { data: fs.readFileSync(canonicalFile), filename, metadata: { totalSize: stat.size } };
}

export class AccountRuntime extends EventEmitter {
  // Auto-restart constants (exponential back-off)
  static RESTART_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000];

  constructor({ accountId, store, policy, onEvent, clientFactory = null }) {
    super();
    this.accountId = String(accountId);
    this.store = store;
    this.policy = policy;
    this.onEvent = onEvent;
    this.clientFactory = clientFactory;
    this.api = null;
    this.qr = null; // { image, code, updated_at }
    this.loginPromise = null;
    this.lastMessageAt = null;
    this.listenerWired = false;
    this._listenerStopped = false;
    this._restartAttempt = 0;
    this._restartTimer = null;
  }

  status() {
    const row = this.store.getAccount(this.accountId) || { status: "disconnected" };
    return {
      account_id: this.accountId,
      status: row.status,
      display_name: row.display_name,
      zalo_user_id: row.zalo_user_id,
      last_error: row.last_error,
      has_session: this.store.hasSession(this.accountId),
      qr_available: Boolean(this.qr?.image),
      updated_at: row.updated_at,
    };
  }

  async connect({ forceQr = false } = {}) {
    if (forceQr) {
      try {
        this.qrAbort?.();
      } catch {
        /* ignore */
      }
      this.qrAbort = null;
      this.api = null;
      this.qr = null;
      // wait prior login attempt to settle if any
      if (this.loginPromise) {
        try {
          await Promise.race([
            this.loginPromise,
            new Promise((r) => setTimeout(r, 500)),
          ]);
        } catch {
          /* ignore */
        }
        this.loginPromise = null;
      }
    }
    if (this.loginPromise) return this.loginPromise;
    this.loginPromise = this.#connectInner({ forceQr }).finally(() => {
      this.loginPromise = null;
    });
    return this.loginPromise;
  }

  async #connectInner({ forceQr }) {
    this.store.ensureAccount(this.accountId);
    if (this.api && !forceQr) {
      return this.status();
    }

    const factory = this.clientFactory || defaultClientFactory;
    const session = forceQr ? null : this.store.loadSession(this.accountId);

    try {
      if (session) {
        this.store.setAccountStatus(this.accountId, "reconnecting");
        this.api = await factory.loginWithSession(session);
      } else {
        this.store.setAccountStatus(this.accountId, "need_scan");
        this.api = await factory.loginWithQr({
          onQr: (payload) => {
            this.qr = { ...payload, updated_at: utcNow() };
            this.#persistQrImage(payload?.image);
            this.emit("qr", this.qr);
          },
          onScanned: (info) => {
            this.store.setAccountStatus(this.accountId, "need_scan", {
              display_name: info?.display_name || "",
            });
          },
          onCredentials: (creds) => {
            this.store.saveSession(this.accountId, creds);
          },
          onAbortHandle: (abortFn) => {
            this.qrAbort = abortFn;
          },
        });
      }

      const info = await safeAccountInfo(this.api);
      this.store.setAccountStatus(this.accountId, "connected", {
        display_name: info.display_name || "",
        zalo_user_id: info.user_id || "",
        last_error: "",
      });
      this.qr = null;

      try {
        const { bootstrapAccount } = await import("./discovery.js");
        const dest = this.store.getDestination(this.accountId);
        const wantName =
          dest.group_name || process.env.DESTINATION_GROUP_NAME || "configured destination";
        await bootstrapAccount({
          api: this.api,
          store: this.store,
          accountId: this.accountId,
          destinationName: wantName,
        });
      } catch (err) {
        this.store.setHealth(
          `bootstrap_error_${this.accountId}`,
          String(err?.message || err),
        );
      }

      this.#wireListener();
      return this.status();
    } catch (err) {
      const msg = String(err?.message || err);
      this.store.setAccountStatus(this.accountId, "disconnected", { last_error: msg.slice(0, 300) });
      this.api = null;
      throw err;
    }
  }

  #wireListener() {
    if (!this.api?.listener) return;
    // Avoid double-binding handlers when reconnect reuses same listener object.
    if (this.listenerWired && this.api.listener === this._wiredListener) {
      try {
        this.api.listener.start?.({ retryOnClose: true });
      } catch {
        /* ignore */
      }
      return;
    }
    this._wiredListener = this.api.listener;
    this.listenerWired = true;

    this.api.listener.on("message", (message) => {
      this.lastMessageAt = utcNow();
      try {
        this.store.setHealth(`last_message_at_${this.accountId}`, this.lastMessageAt);
      } catch {
        /* ignore */
      }
      try {
        const event = normalizeInboundMessage({
          accountId: this.accountId,
          message,
        });
        Promise.resolve(stageHermesMedia(event, { dataDir: this.store.dataDir }))
          .then((staged) => this.onEvent?.(staged, this)).catch((err) => {
          try {
            this.store.setHealth(
              `last_listener_error_${this.accountId}`,
              String(err?.message || err),
            );
          } catch {
            /* ignore */
          }
        });
      } catch (err) {
        try {
          this.store.setHealth(
            `last_listener_error_${this.accountId}`,
            String(err?.message || err),
          );
        } catch {
          /* ignore */
        }
      }
    });
    this.api.listener.on("disconnected", () => {
      try {
        this.store.setAccountStatus(this.accountId, "reconnecting", {
          last_error: "listener_disconnected",
        });
        this.store.setHealth(`listener_disconnected_${this.accountId}`, utcNow());
        this.emit("listener_down", { reason: "disconnected", at: utcNow() });
      } catch {
        /* ignore closed store */
      }
    });
    this.api.listener.on("error", (error) => {
      try {
        this.store.setAccountStatus(this.accountId, "reconnecting", {
          last_error: String(error?.message || error).slice(0, 300),
        });
        this.store.setHealth(
          `listener_error_${this.accountId}`,
          String(error?.message || error).slice(0, 300),
        );
        this.emit("listener_down", {
          reason: String(error?.message || error).slice(0, 200),
          at: utcNow(),
        });
      } catch {
        /* ignore closed store */
      }
    });
    // "closed" = zca-js hit retry limit and gave up entirely. Bot is still "connected"
    // but deaf. Schedule a listener restart with exponential back-off so the process
    // self-heals without operator intervention.
    this.api.listener.on("closed", (code, reason) => {
      try {
        this.store.setHealth(
          `listener_closed_${this.accountId}`,
          `code=${code} reason=${String(reason || "").slice(0, 100)} at=${utcNow()}`,
        );
        this.emit("listener_down", { reason: `closed:${code}`, at: utcNow() });
      } catch { /* ignore */ }
      if (!this._listenerStopped) this.#scheduleListenerRestart();
    });
    this.#startListener();
  }

  #scheduleListenerRestart() {
    if (this._listenerStopped || this._restartTimer) return;
    const delays = AccountRuntime.RESTART_DELAYS_MS;
    const delay = delays[Math.min(this._restartAttempt, delays.length - 1)];
    this._restartAttempt += 1;
    console.warn(
      `[zalo_runtime] 🔁 Listener đóng hoàn toàn — thử mở lại sau ${Math.round(delay / 1000)}s (lần ${this._restartAttempt})`,
    );
    this._restartTimer = setTimeout(() => {
      this._restartTimer = null;
      this.#startListener();
    }, delay);
  }

  #startListener() {
    if (this._listenerStopped || !this.api?.listener) return;
    try {
      this.api.listener.start({ retryOnClose: true });
    } catch (err) {
      console.error("[zalo_runtime] không start được listener:", err?.message || err);
      this.#scheduleListenerRestart();
    }
  }

  async sendText(targetId, text, threadType = 1, options = {}) {
    if (!this.api?.sendMessage) throw new Error("not_connected");
    // Final defense-in-depth gate; no caller can bypass PolicyGuard merely by
    // holding a runtime reference.
    const outbound = this.policy.evaluateOutbound({
      accountId: this.accountId,
      targetId,
      text,
      kind: options.kind || "runtime_send",
      allowSource: Boolean(options.allow_source || options.is_owner || !this.policy.readOnlySource),
    });
    if (!outbound.allow && !options.is_owner) throw new Error(outbound.reason || "outbound_disabled");
    // Final hard gate: never send outside destination when READ_ONLY_SOURCE.
    const dest = this.store.getDestination(this.accountId);
    if (threadType === 1 && (!dest.group_id || String(targetId) !== String(dest.group_id))) {
      if (!options.is_owner && !options.allow_source && this.policy.readOnlySource) {
        throw new Error("blocked_non_destination_send");
      }
    }
    // Route through performPersonalAction so mentions, quotes, and styles are formatted!
    return this.performPersonalAction("send_message", {
      thread_id: String(targetId),
      target_id: String(targetId),
      text: String(text),
      thread_type: threadType,
      quote: options.quote,
      mentions: options.mentions,
      styled: options.styled !== false,
      parse_markdown: true,
    });
  }

  // ── Group Management & Advanced Ops (ABS Specialized Methods) ──

  async removeUserFromGroup(groupId, memberId) {
    if (!this.api?.removeUserFromGroup) throw new Error("not_connected");
    const mIds = Array.isArray(memberId) ? memberId : [memberId];
    return this.api.removeUserFromGroup(mIds, String(groupId));
  }

  async changeGroupOwner(groupId, newOwnerId) {
    if (!this.api?.changeGroupOwner) throw new Error("not_connected");
    return this.api.changeGroupOwner(String(newOwnerId), String(groupId));
  }

  async addGroupDeputy(groupId, memberId) {
    if (!this.api?.addGroupDeputy) throw new Error("not_connected");
    const mIds = Array.isArray(memberId) ? memberId : [memberId];
    return this.api.addGroupDeputy(mIds, String(groupId));
  }

  async removeGroupDeputy(groupId, memberId) {
    if (!this.api?.removeGroupDeputy) throw new Error("not_connected");
    const mIds = Array.isArray(memberId) ? memberId : [memberId];
    return this.api.removeGroupDeputy(mIds, String(groupId));
  }

  async addUserToGroup(groupId, memberId) {
    if (!this.api?.addUserToGroup) throw new Error("not_connected");
    const mIds = Array.isArray(memberId) ? memberId : [memberId];
    return this.api.addUserToGroup(mIds, String(groupId));
  }

  async createPoll(groupId, { question, options, expiredTime = 0, allowMultiChoices = false, allowAddNewOption = false, isAnonymous = false, hideVotePreview = false }) {
    if (!this.api?.createPoll) throw new Error("not_connected");
    return this.api.createPoll({
      question,
      options,
      expiredTime,
      allowMultiChoices,
      allowAddNewOption,
      isAnonymous,
      hideVotePreview,
    }, String(groupId));
  }

  async lockPoll(pollId) {
    if (!this.api?.lockPoll) throw new Error("not_connected");
    return this.api.lockPoll(String(pollId));
  }

  async addReaction(icon, dest) {
    if (!this.api?.addReaction) throw new Error("not_connected");
    return this.api.addReaction(icon, dest);
  }

  async undoMessage(dest, threadId, threadType = 0) {
    if (!this.api?.undo) throw new Error("not_connected");
    return this.api.undo(dest, String(threadId), threadType);
  }

  async getGroupInfo(groupId) {
    if (!this.api?.getGroupInfo) throw new Error("not_connected");
    return this.api.getGroupInfo(String(groupId));
  }

  // getGroupMembersInfo requires a list of member UIDs, NOT a group ID.
  // Call getGroupInfo first to obtain the member list, then pass member UIDs here.
  async getGroupMembers(groupId, { limit = 50 } = {}) {
    if (!this.api?.getGroupInfo || !this.api?.getGroupMembersInfo) throw new Error("not_connected");
    const info = await this.api.getGroupInfo(String(groupId));
    const gid = String(groupId);
    const memberIds = (info?.gridInfoMap?.[gid]?.memVerList || [])
      .map((entry) => String(entry).replace(/_\d+$/, ""))
      .filter(Boolean);
    const lookup = memberIds.slice(0, Math.min(limit, 100));
    const profiles = lookup.length
      ? ((await this.api.getGroupMembersInfo(lookup))?.profiles || {})
      : {};
    return {
      total: memberIds.length,
      members: lookup.map((id) => ({
        id,
        displayName: profiles[id]?.displayName || profiles[id]?.zaloName || "",
      })),
    };
  }

  async getUserInfo(userId) {
    if (!this.api?.getUserInfo) throw new Error("not_connected");
    return this.api.getUserInfo(String(userId));
  }

  async findUser(phoneNumber) {
    if (!this.api?.findUser) throw new Error("not_connected");
    return this.api.findUser(String(phoneNumber));
  }

  async getAllFriends() {
    if (!this.api?.getAllFriends) throw new Error("not_connected");
    return this.api.getAllFriends();
  }

  async getAllGroups() {
    if (!this.api?.getAllGroups) throw new Error("not_connected");
    return this.api.getAllGroups();
  }

  async renameGroup(groupId, name) {
    if (!this.api?.changeGroupName) throw new Error("not_connected");
    return this.api.changeGroupName(String(name).slice(0, 100), String(groupId));
  }

  async changeGroupAvatar(groupId, avatarSource) {
    if (!this.api?.changeGroupAvatar) throw new Error("not_connected");
    return this.api.changeGroupAvatar(avatarSource, String(groupId));
  }

  async createGroupNote(groupId, content, pin = true) {
    if (!this.api?.createNote) throw new Error("not_connected");
    return this.api.createNote(String(groupId), String(content), Boolean(pin));
  }

  async getPendingGroupMembers(groupId) {
    if (!this.api?.getPendingGroupMembers) throw new Error("not_connected");
    return this.api.getPendingGroupMembers(String(groupId));
  }

  async reviewPendingMember(groupId, memberId, approve = true) {
    if (!this.api?.reviewPendingMemberRequest) throw new Error("not_connected");
    return this.api.reviewPendingMemberRequest(memberId, String(groupId), Boolean(approve));
  }

  async addGroupBlockedMember(groupId, memberId) {
    if (!this.api?.addGroupBlockedMember) throw new Error("not_connected");
    return this.api.addGroupBlockedMember(memberId, String(groupId));
  }

  async removeGroupBlockedMember(groupId, memberId) {
    if (!this.api?.removeGroupBlockedMember) throw new Error("not_connected");
    return this.api.removeGroupBlockedMember(memberId, String(groupId));
  }

  async getGroupLink(groupId) {
    if (!this.api?.getGroupLinkDetail) throw new Error("not_connected");
    return this.api.getGroupLinkDetail(String(groupId));
  }

  async setGroupLink(groupId, enable = true) {
    if (enable) {
      if (!this.api?.enableGroupLink) throw new Error("not_connected");
      return this.api.enableGroupLink(String(groupId));
    }
    if (!this.api?.disableGroupLink) throw new Error("not_connected");
    return this.api.disableGroupLink(String(groupId));
  }

  async updateGroupSettings(groupId, settings = {}) {
    if (!this.api?.updateGroupSettings) throw new Error("not_connected");
    return this.api.updateGroupSettings(settings, String(groupId));
  }

  async joinGroupLink(link) {
    if (!this.api?.joinGroupLink) throw new Error("not_connected");
    return this.api.joinGroupLink(String(link));
  }

  async getGroupLinkInfo(link) {
    if (!this.api?.getGroupLinkInfo) throw new Error("not_connected");
    return this.api.getGroupLinkInfo({ link: String(link) });
  }

  async joinGroupInviteBox(groupId) {
    if (!this.api?.joinGroupInviteBox) throw new Error("not_connected");
    return this.api.joinGroupInviteBox(String(groupId));
  }

  async getStickerDetail(stickerId) {
    if (!this.api?.getStickersDetail) throw new Error("not_connected");
    return this.api.getStickersDetail(Number(stickerId));
  }

  async searchStickers(keyword) {
    if (!this.api?.getStickers) throw new Error("not_connected");
    return this.api.getStickers(String(keyword));
  }

  async performPersonalAction(action, payload = {}) {
    const name = String(action || "").trim();
    if (!PERSONAL_ACTIONS.has(name)) throw new Error("unsupported_personal_action");
    if (!this.api) throw new Error("not_connected");
    const api = this.api;
    const target = () => required(payload.thread_id || payload.target_id, "thread_id");
    switch (name) {
      case "send_message": {
        if (typeof api.sendMessage !== "function") break;
        const rawText = String(payload.text || "");
        const targetId = target();
        const resolvedThreadType = threadType(payload.thread_type);
        const parts = rawText.includes("[[NEW_MESSAGE]]")
          ? rawText.split(/\[\[NEW_MESSAGE\]\]/gu).map((part) => part.trim()).filter(Boolean)
          : [rawText];
        if (!parts.length && !payload.attachment_path) throw new Error("text_or_attachment_required");

        let members = [];
        const explicitMentions = Array.isArray(payload.mentions) ? payload.mentions.slice(0, 50) : null;
        if (!explicitMentions && resolvedThreadType === 1 && rawText.includes("@")) {
          try {
            // 1. Thành viên nhóm đã lưu trong SQLite store
            if (this.store?.listSourceMembers) {
              const dbMembers = this.store.listSourceMembers(this.accountId, targetId, 200);
              for (const m of dbMembers) {
                if (m.user_id && m.display_name) {
                  members.push({ uid: String(m.user_id), name: String(m.display_name) });
                }
              }
            }
            // 2. Tra cứu qua API zca-js nếu chưa đủ
            if (members.length === 0 && typeof api.getGroupInfo === "function") {
              const groupInfo = await api.getGroupInfo([targetId]);
              const gData = groupInfo?.gridInfoMap?.[targetId] || groupInfo?.[targetId] || (groupInfo?.groupId === targetId ? groupInfo : {});
              const memberIds = (gData.memVerList || gData.members || groupInfo?.memList || [])
                .map((e) => String(e?.id || e?.uid || e).replace(/_\d+$/, ''))
                .filter(Boolean);
              if (memberIds.length && typeof api.getGroupMembersInfo === "function") {
                const profiles = (await api.getGroupMembersInfo(memberIds.slice(0, 100)))?.profiles || {};
                for (const id of memberIds.slice(0, 100)) {
                  const dName = profiles[id]?.displayName || profiles[id]?.zaloName || '';
                  if (dName) members.push({ uid: id, name: dName });
                }
              }
            }
          } catch {
            /* mention lookup is best effort */
          }
        }

        const attachment = payload.attachment_path
          ? controlledAttachment(payload.attachment_path)
          : null;
        let lastResult = null;
        let globalOffset = 0;
        for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
          const part = parts[partIndex];
          let chunks;
          if (explicitMentions || Array.isArray(payload.styles)) {
            const partStyles = parts.length === 1 && Array.isArray(payload.styles) ? payload.styles : [];
            chunks = chunkZaloStyledText(part, partStyles);
          } else if (payload.styled || payload.parse_markdown || /[*_~#\[]/u.test(part)) {
            chunks = formatAndChunkZaloMarkdown(part);
          } else {
            chunks = chunkZaloStyledText(part);
          }
          if (!chunks.length && attachment) chunks = [{ msg: "", styles: [] }];

          for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
            const item = chunks[chunkIndex];
            const isFirst = partIndex === 0 && chunkIndex === 0;
            const isLast = partIndex === parts.length - 1 && chunkIndex === chunks.length - 1;
            const message = { msg: item.msg };
            if (item.styles?.length) message.styles = item.styles;
            if (isFirst && payload.quote) message.quote = payload.quote;
            if (isLast && attachment) message.attachments = attachment;

            if (explicitMentions) {
              const chunkEnd = globalOffset + item.msg.length;
              const clipped = explicitMentions
                .filter((mention) => {
                  const pos = Number(mention?.pos);
                  const len = Number(mention?.len);
                  return Number.isInteger(pos) && Number.isInteger(len)
                    && len > 0 && pos >= globalOffset && pos + len <= chunkEnd;
                })
                .map((mention) => ({ ...mention, pos: Number(mention.pos) - globalOffset }));
              if (clipped.length) message.mentions = clipped;
            } else if (members.length && item.msg.includes("@")) {
              const detected = findMentions(item.msg, members, {
                continuesInNextChunk: !isLast,
                selfUid: this.accountId,
                canMentionAll: true,
              });
              if (detected.length) message.mentions = detected;
            }

            try {
              lastResult = await api.sendMessage(message, targetId, resolvedThreadType);
            } catch (err) {
              if (!(message.styles || message.mentions) || !/^-?\d+$/u.test(String(err?.code ?? ""))) throw err;
              console.warn(
                `[zalo_runtime] Zalo từ chối chunk ${chunkIndex + 1}/${chunks.length} có định dạng/tag (mã ${err.code}) — gửi lại dạng chữ thường`,
              );
              const { styles: _styles, mentions: _mentions, ...plain } = message;
              lastResult = await api.sendMessage(plain, targetId, resolvedThreadType);
            }
            globalOffset += item.msg.length;
          }
        }
        return lastResult;
      }
      case "send_sticker":
        if (typeof api.sendSticker !== "function") break;
        return api.sendSticker({ id: Number(payload.sticker_id), cateId: Number(payload.category_id), type: Number(payload.sticker_type) }, target(), threadType(payload.thread_type));
      case "send_voice":
        if (typeof api.sendVoice !== "function") break;
        return api.sendVoice({ voiceUrl: safeHttpsUrl(payload.voice_url, "voice_url") }, target(), threadType(payload.thread_type));
      case "send_video":
        if (typeof api.sendVideo !== "function") break;
        return api.sendVideo({ msg: String(payload.text || "").slice(0, 4000), videoUrl: safeHttpsUrl(payload.video_url, "video_url"), thumbnailUrl: safeHttpsUrl(payload.thumbnail_url, "thumbnail_url"), duration: Number(payload.duration_ms) || 0, width: Number(payload.width) || undefined, height: Number(payload.height) || undefined }, target(), threadType(payload.thread_type));
      case "forward_message":
        if (typeof api.forwardMessage !== "function") break;
        return api.forwardMessage({ message: required(payload.text, "text"), reference: payload.reference || undefined }, (Array.isArray(payload.thread_ids) ? payload.thread_ids : []).map((id) => required(id, "thread_id")).slice(0, 50), threadType(payload.thread_type));
      case "typing":
        if (typeof api.sendTypingEvent !== "function") break;
        return api.sendTypingEvent(target(), threadType(payload.thread_type));
      case "create_group":
        if (typeof api.createGroup !== "function") break;
        return api.createGroup({ name: String(payload.group_name || "").slice(0, 100), members: (Array.isArray(payload.member_ids) ? payload.member_ids : []).map((id) => required(id, "member_id")).slice(1, 500) });
      case "rename_group":
        if (typeof api.changeGroupName !== "function") break;
        return api.changeGroupName(required(payload.group_name, "group_name").slice(0, 100), required(payload.group_id, "group_id"));
      case "leave_group":
        if (typeof api.leaveGroup !== "function") break;
        return api.leaveGroup(required(payload.group_id, "group_id"), Boolean(payload.silent));
      case "disperse_group":
        if (typeof api.disperseGroup !== "function") break;
        return api.disperseGroup(required(payload.group_id, "group_id"));
      case "update_group_settings":
        if (typeof api.updateGroupSettings !== "function") break;
        return api.updateGroupSettings(payload.settings && typeof payload.settings === "object" ? payload.settings : {}, required(payload.group_id, "group_id"));
      case "create_note":
        if (typeof api.createNote !== "function") break;
        return api.createNote(required(payload.group_id, "group_id"), required(payload.content, "content"), Boolean(payload.pin !== false));
      case "change_avatar":
        if (typeof api.changeGroupAvatar !== "function") break;
        return api.changeGroupAvatar(required(payload.avatar_source || payload.avatar_url, "avatar_source"), required(payload.group_id, "group_id"));
      case "block_member":
        if (typeof api.addGroupBlockedMember !== "function") break;
        return api.addGroupBlockedMember(required(payload.member_id, "member_id"), required(payload.group_id, "group_id"));
      case "unblock_member":
        if (typeof api.removeGroupBlockedMember !== "function") break;
        return api.removeGroupBlockedMember(required(payload.member_id, "member_id"), required(payload.group_id, "group_id"));
      case "review_pending":
        if (typeof api.reviewPendingMemberRequest !== "function") break;
        return api.reviewPendingMemberRequest(required(payload.member_id, "member_id"), required(payload.group_id, "group_id"), Boolean(payload.approve !== false));
      case "group_link_enable":
        if (typeof api.enableGroupLink !== "function") break;
        return api.enableGroupLink(required(payload.group_id, "group_id"));
      case "group_link_disable":
        if (typeof api.disableGroupLink !== "function") break;
        return api.disableGroupLink(required(payload.group_id, "group_id"));
      case "send_card":
        if (typeof api.sendCard !== "function") break;
        return api.sendCard(payload.card_info || {}, target(), threadType(payload.thread_type));
      case "send_bank_card":
        if (typeof api.sendBankCard !== "function") break;
        return api.sendBankCard(payload.bank_info || {}, target(), threadType(payload.thread_type));
      case "friend_accept": if (typeof api.acceptFriendRequest === "function") return api.acceptFriendRequest(required(payload.user_id, "user_id")); break;
      case "friend_reject": if (typeof api.rejectFriendRequest === "function") return api.rejectFriendRequest(required(payload.user_id, "user_id")); break;
      case "friend_request": if (typeof api.sendFriendRequest === "function") return api.sendFriendRequest(String(payload.message || "").slice(0, 300), required(payload.user_id, "user_id")); break;
      case "friend_request_undo": if (typeof api.undoFriendRequest === "function") return api.undoFriendRequest(required(payload.user_id, "user_id")); break;
      case "friend_remove": if (typeof api.removeFriend === "function") return api.removeFriend(required(payload.user_id, "user_id")); break;
      case "user_block": if (typeof api.blockUser === "function") return api.blockUser(required(payload.user_id, "user_id")); break;
      case "user_unblock": if (typeof api.unblockUser === "function") return api.unblockUser(required(payload.user_id, "user_id")); break;
      case "join_group_link": if (typeof api.joinGroupLink === "function") return api.joinGroupLink(required(payload.link, "link")); break;
      case "join_group_invite_box": if (typeof api.joinGroupInviteBox === "function") return api.joinGroupInviteBox(required(payload.group_id, "group_id")); break;
      case "get_group_link_info": if (typeof api.getGroupLinkInfo === "function") return api.getGroupLinkInfo({ link: required(payload.link, "link") }); break;
      case "get_sticker_detail": if (typeof api.getStickersDetail === "function") return api.getStickersDetail(Number(required(payload.sticker_id, "sticker_id"))); break;
      case "search_stickers": if (typeof api.getStickers === "function") return api.getStickers(required(payload.keyword, "keyword")); break;
      default: break;
    }
    throw new Error(`provider_action_unavailable:${name}`);
  }

  async pause() {
    this._listenerStopped = true;
    clearTimeout(this._restartTimer);
    this._restartTimer = null;
    try {
      this.api?.listener?.stop?.();
    } catch {
      /* ignore */
    }
    this.api = null;
    this.listenerWired = false;
    this._wiredListener = null;
    try {
      this.store.setAccountStatus(this.accountId, "paused");
    } catch {
      /* store may be closed in short-lived scripts */
    }
    return this.status();
  }

  async disconnect({ wipeSession = false } = {}) {
    await this.pause();
    if (wipeSession) this.store.deleteSession(this.accountId);
    this.store.setAccountStatus(this.accountId, "disconnected");
    return this.status();
  }

  getQr() {
    return this.qr;
  }

  #persistQrImage(image) {
    try {
      if (!image) return;
      const raw = String(image);
      const b64 = raw.startsWith("data:") ? raw.split(",", 2)[1] : raw;
      const buf = Buffer.from(b64, "base64");
      const dir = path.join(this.store.dataDir, "qr");
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.chmodSync(dir, 0o700);
      const file = path.join(dir, `${this.accountId}_login_qr.png`);
      fs.writeFileSync(file, buf, { mode: 0o600 });
      fs.chmodSync(file, 0o600);
      // Keep the persisted image private and expose only the browser-safe data
      // URL/code. Never return a local filesystem path or create a shared /tmp
      // handoff artifact.
      this.qr = { ...(this.qr || {}), image, updated_at: utcNow() };
    } catch (err) {
      this.store.setHealth(`qr_persist_error_${this.accountId}`, String(err?.message || err));
    }
  }
}

async function safeAccountInfo(api) {
  try {
    if (typeof api.fetchAccountInfo === "function") {
      const info = await api.fetchAccountInfo();
      const { extractAccountIdentity } = await import("./discovery.js");
      const id = extractAccountIdentity(info);
      return { display_name: id.display_name, user_id: id.user_id };
    }
  } catch {
    /* optional */
  }
  return { display_name: "", user_id: "" };
}

async function defaultClientFactory() {
  // placeholder so tests don't import zca-js accidentally via call shape
  return null;
}

defaultClientFactory.loginWithSession = async function loginWithSession(session) {
  const { Zalo } = await import("zca-js");
  const zalo = new Zalo();
  return zalo.login({
    cookie: session.cookie,
    imei: session.imei,
    userAgent: session.userAgent,
  });
};

defaultClientFactory.loginWithQr = async function loginWithQr({ onQr, onScanned, onCredentials }) {
  const { Zalo, LoginQRCallbackEventType } = await import("zca-js");
  const zalo = new Zalo();
  let savedCreds = null;

  const api = await zalo.loginQR({}, (event) => {
    switch (event.type) {
      case LoginQRCallbackEventType.QRCodeGenerated:
        onQr?.({
          image: event.data.image, // base64 or data url depending on lib
          code: event.data.code,
        });
        break;
      case LoginQRCallbackEventType.QRCodeScanned:
        onScanned?.(event.data);
        break;
      case LoginQRCallbackEventType.GotLoginInfo:
        savedCreds = {
          cookie: event.data.cookie,
          imei: event.data.imei,
          userAgent: event.data.userAgent,
        };
        onCredentials?.(savedCreds);
        break;
      default:
        break;
    }
  });

  // Some versions only expose credentials via GotLoginInfo; if missing, leave session save to caller later.
  if (savedCreds) onCredentials?.(savedCreds);
  return api;
};

export class BridgeHub {
  constructor({ config, store, policy, clientFactory = null }) {
    this.config = config;
    this.store = store;
    this.policy = policy;
    this.clientFactory = clientFactory;
    this.runtimes = new Map();
  }

  getRuntime(accountId = this.config.default_account_id) {
    const id = String(accountId || this.config.default_account_id);
    if (!this.runtimes.has(id)) {
      this.store.ensureAccount(id);
      this.runtimes.set(
        id,
        new AccountRuntime({
          accountId: id,
          store: this.store,
          policy: this.policy,
          clientFactory: this.clientFactory,
          onEvent: (event, runtime) => this.handleEvent(event, runtime),
        }),
      );
    }
    return this.runtimes.get(id);
  }

  async handleEvent(event, runtime) {
    const decision = this.policy.evaluateInbound(event);
    this.store.setHealth("last_event_decision", {
      event_id: event.event_id,
      allow: decision.allow,
      reason: decision.reason,
      at: utcNow(),
    });
    if (!decision.allow) return { stored: false, decision };

    if (decision.actions.includes("owner_action")) {
      const text = String(event.text || "").trim();
      // 1. Tự động tham gia nhóm qua link zalo.me/g/...
      const linkMatch = text.match(/(?:https?:\/\/)?zalo\.me\/g\/([a-zA-Z0-9_-]+)/i);
      if (linkMatch) {
        const fullLink = linkMatch[0].startsWith("http") ? linkMatch[0] : `https://${linkMatch[0]}`;
        try {
          await runtime.performPersonalAction("join_group_link", { link: fullLink });
          if (runtime.api) {
            await runtime.sendText(event.source_id, `[abs-zalo-bot] Đã tự động tham gia nhóm từ liên kết của chủ nhân: ${fullLink}`, event.source_type === "group" ? 1 : 0, { is_owner: true });
          }
          return { stored: true, decision, owner_action: "join_group_link", ok: true, runtime: runtime.accountId };
        } catch (err) {
          if (runtime.api) {
            await runtime.sendText(event.source_id, `[abs-zalo-bot] Không thể tham gia nhóm: ${err.message || err}`, event.source_type === "group" ? 1 : 0, { is_owner: true });
          }
          return { stored: true, decision, owner_action: "join_group_link", ok: false, error: String(err), runtime: runtime.accountId };
        }
      }

      // 2. Tự động thu hồi tin nhắn
      const isUndo = /^(?:thu\s*hồi|xóa\s*tin|thuhoi|undo|\/undo)(?:\s+|$)/i.test(text);
      if (isUndo) {
        const quote = event.quote || event.raw_metadata?.quote;
        let targetMsg = null;
        if (quote?.id && quote?.cliMsgId) {
          targetMsg = { msgId: quote.id, cliMsgId: quote.cliMsgId };
        } else {
          const lastSent = this.store.getLastSentMessage?.(event.account_id, event.source_id);
          if (lastSent?.messageId) {
            targetMsg = { msgId: lastSent.messageId, cliMsgId: lastSent.cliMsgId };
          }
        }
        if (targetMsg) {
          try {
            await runtime.undoMessage(targetMsg, event.source_id, event.source_type === "group" ? 1 : 0);
            return { stored: true, decision, owner_action: "undo_message", ok: true, runtime: runtime.accountId };
          } catch (err) {
            return { stored: true, decision, owner_action: "undo_message", ok: false, error: String(err), runtime: runtime.accountId };
          }
        }
      }
    }

    if (decision.actions.includes("command")) {
      const { handleCommand } = await import("./commands.js");
      const result = await handleCommand({
        event,
        store: this.store,
        policy: this.policy,
        hub: this,
        config: this.config,
      });
      return { stored: false, decision, command: result, runtime: runtime.accountId };
    }

    if (decision.actions.includes("destination_ask")) {
      // Phase 1 inbound router: "bot ..." → Hermes brain → outbound guard.
      this.store.putEvent({ ...event, source_name: event.source_name || "destination" });
      const { isBotCommand, handleBotBrainCommand } = await import("./inbound_router.js");
      if (!isBotCommand(event.text)) {
        return {
          stored: true,
          decision,
          ask: { ok: false, reason: "missing_bot_prefix" },
          runtime: runtime.accountId,
        };
      }
      const result = await handleBotBrainCommand({
        event,
        store: this.store,
        policy: this.policy,
        hub: this,
        config: this.config,
      });
      return { stored: true, decision, ask: result, runtime: runtime.accountId };
    }

    const stored = this.store.putEvent(event);
    // Auto-learn source names in listen-all mode (metadata only)
    if (stored && event.source_type === "group" && this.config.listen_all_groups) {
      const existing = this.store.getSource(event.account_id, event.source_id);
      if (!existing) {
        this.store.upsertSource({
          accountId: event.account_id,
          sourceId: event.source_id,
          sourceType: "group",
          sourceName: event.source_name || "",
          mode: "listen_only",
          isAllowed: true,
        });
      }
    }
    if (decision.actions.includes("alert_candidate") && stored && this.config.auto_alert) {
      const text = String(event.text || "");
      const high = /gấp|khẩn|scam|lừa|lead|chốt|book|ban|phốt/i.test(text);
      if (high) {
        this.store.putEnrichment({
          message_id: event.event_id,
          account_id: event.account_id,
          priority: "high",
          lead_flag: /lead|chốt|book/i.test(text),
          risk_flag: /scam|lừa|ban|phốt/i.test(text),
          summary: text.slice(0, 200),
        });
        const { maybeSendAlert } = await import("./digest.js");
        maybeSendAlert({
          config: this.config,
          store: this.store,
          policy: this.policy,
          hub: this,
          event,
          enrichment: {
            priority: "high",
            lead_flag: /lead|chốt|book/i.test(text),
            risk_flag: /scam|lừa|ban|phốt/i.test(text),
          },
        }).catch((err) => {
          this.store.setHealth("last_alert_error", String(err?.message || err));
        });
      }
    }
    return { stored, decision, runtime: runtime.accountId };
  }

  listStatus() {
    const ids = new Set([
      this.config.default_account_id,
      ...this.store.listAccounts().map((a) => a.account_id),
      ...this.runtimes.keys(),
    ]);
    return [...ids].map((id) => this.getRuntime(id).status());
  }
}

export function ensureDataLayout(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(dataDir, "sessions"), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(dataDir, "qr"), { recursive: true, mode: 0o700 });
}
