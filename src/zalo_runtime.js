// Zalo adapter. Live zca-js is lazy-loaded. Tests inject a fake client.
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { normalizeInboundMessage, utcNow } from "./schema.js";
import { stageHermesMedia } from "./hermes_media.js";
import { buildZaloStyledMessage, splitIntoSafeZaloChunks } from "./zalo_styler.js";

const PERSONAL_ACTIONS = new Set([
  "send_message", "send_sticker", "send_voice", "send_video", "forward_message", "typing",
  "create_group", "rename_group", "leave_group", "disperse_group", "update_group_settings",
  "create_note", "change_avatar", "block_member", "unblock_member", "review_pending",
  "group_link_enable", "group_link_disable", "send_card", "send_bank_card",
  "friend_accept", "friend_reject", "friend_request", "friend_request_undo", "friend_remove",
  "user_block", "user_unblock"
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
    this.api.listener.start({ retryOnClose: true });
  }

  async sendText(targetId, text, threadType = 1) {
    if (!this.api?.sendMessage) throw new Error("not_connected");
    // Final defense-in-depth gate; no caller can bypass PolicyGuard merely by
    // holding a runtime reference.
    const outbound = this.policy.evaluateOutbound({
      accountId: this.accountId,
      targetId,
      text,
      kind: "runtime_send",
    });
    if (!outbound.allow) throw new Error(outbound.reason || "outbound_disabled");
    // Final hard gate: never send outside destination when READ_ONLY_SOURCE.
    const dest = this.store.getDestination(this.accountId);
    if (!dest.group_id || String(targetId) !== String(dest.group_id)) {
      throw new Error("blocked_non_destination_send");
    }
    // Never send to source groups even if mis-called with group thread type.
    return this.api.sendMessage(String(text), String(targetId), 1);
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

  async undoMessage(dest, threadId, threadType = 1) {
    if (!this.api?.undo) throw new Error("not_connected");
    return this.api.undo(dest, String(threadId), threadType);
  }

  async getGroupInfo(groupId) {
    if (!this.api?.getGroupInfo) throw new Error("not_connected");
    return this.api.getGroupInfo(String(groupId));
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

  async performPersonalAction(action, payload = {}) {
    const name = String(action || "").trim();
    if (!PERSONAL_ACTIONS.has(name)) throw new Error("unsupported_personal_action");
    if (!this.api) throw new Error("not_connected");
    const api = this.api;
    const target = () => required(payload.thread_id || payload.target_id, "thread_id");
    switch (name) {
      case "send_message": {
        if (typeof api.sendMessage !== "function") break;
        let textContent = String(payload.text || "");
        let styles = Array.isArray(payload.styles) ? payload.styles : undefined;
        if (!styles && (payload.styled || payload.parse_markdown || /[*_~#\[]/.test(textContent))) {
          const parsed = buildZaloStyledMessage(textContent);
          textContent = parsed.msg;
          styles = parsed.styles;
        }
        const message = { msg: textContent.slice(0, 4000) };
        if (!message.msg && !payload.attachment_path) throw new Error("text_or_attachment_required");
        if (payload.quote) message.quote = payload.quote;
        if (Array.isArray(payload.mentions)) message.mentions = payload.mentions.slice(0, 50);
        if (payload.attachment_path) message.attachments = controlledAttachment(payload.attachment_path);
        if (styles) message.styles = styles;
        return api.sendMessage(message, target(), threadType(payload.thread_type));
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
      default: break;
    }
    throw new Error(`provider_action_unavailable:${name}`);
  }

  async pause() {
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
