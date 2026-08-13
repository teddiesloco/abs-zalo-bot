// SQLite store — company schema with account_id isolation.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { utcNow, sha256 } from "./schema.js";
import { redactPII, stripSensitiveMetadata } from "./privacy.js";

export class Store {
  constructor(dataDir, options = {}) {
    this.dataDir = path.resolve(dataDir);
    this.retainRawText = options.retainRawText !== false;
    this.redactPhoneEmail = options.redactPhoneEmail !== false;
    fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    this.sessionsDir = path.join(this.dataDir, "sessions");
    fs.mkdirSync(this.sessionsDir, { recursive: true, mode: 0o700 });
    this.dbPath = path.join(this.dataDir, "bridge.sqlite3");
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA journal_mode=WAL;");
    this.db.exec("PRAGMA foreign_keys=ON;");
    this.#migrate();
    try {
      fs.chmodSync(this.dbPath, 0o600);
    } catch {
      /* ignore */
    }
  }

  #migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS zalo_accounts (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'disconnected',
        zalo_user_id TEXT NOT NULL DEFAULT '',
        session_ref TEXT NOT NULL DEFAULT '',
        last_error TEXT NOT NULL DEFAULT '',
        last_seen_at TEXT,
        connected_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        paused INTEGER NOT NULL DEFAULT 0,
        consecutive_send_errors INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS zalo_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'group',
        source_id TEXT NOT NULL,
        source_name TEXT NOT NULL DEFAULT '',
        mode TEXT NOT NULL DEFAULT 'off',
        is_allowed INTEGER NOT NULL DEFAULT 0,
        muted INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(account_id, source_id)
      );

      CREATE TABLE IF NOT EXISTS zalo_messages (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_name TEXT NOT NULL DEFAULT '',
        sender_hash TEXT NOT NULL DEFAULT '',
        sender_display_name TEXT NOT NULL DEFAULT '',
        message_id TEXT NOT NULL,
        message_type TEXT NOT NULL DEFAULT 'text',
        text_redacted TEXT NOT NULL DEFAULT '',
        text_raw_ref TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        is_self INTEGER NOT NULL DEFAULT 0,
        is_mention INTEGER NOT NULL DEFAULT 0,
        priority INTEGER NOT NULL DEFAULT 0,
        ingested_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        dedupe_hash TEXT NOT NULL,
        UNIQUE(account_id, source_id, message_id)
      );

      CREATE TABLE IF NOT EXISTS zalo_enrichments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        topic TEXT NOT NULL DEFAULT '',
        intent TEXT NOT NULL DEFAULT '',
        sentiment TEXT NOT NULL DEFAULT '',
        priority TEXT NOT NULL DEFAULT 'low',
        lead_flag INTEGER NOT NULL DEFAULT 0,
        risk_flag INTEGER NOT NULL DEFAULT 0,
        action_items_json TEXT NOT NULL DEFAULT '[]',
        summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS zalo_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id TEXT NOT NULL,
        destination_source_id TEXT NOT NULL DEFAULT '',
        report_type TEXT NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        sent_status TEXT NOT NULL DEFAULT 'draft',
        sent_at TEXT,
        error_message TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS zalo_permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(account_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS outbound_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        text_sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL,
        ok INTEGER NOT NULL,
        reason TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS alert_cooldowns (
        account_id TEXT NOT NULL,
        alert_key TEXT NOT NULL,
        last_sent_at TEXT NOT NULL,
        PRIMARY KEY(account_id, alert_key)
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS health (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id TEXT NOT NULL DEFAULT '',
        actor_id TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS zalo_users (
        account_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        avatar TEXT NOT NULL DEFAULT '',
        global_id TEXT NOT NULL DEFAULT '',
        account_status INTEGER,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        raw_json TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY(account_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS zalo_source_members (
        account_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        PRIMARY KEY(account_id, source_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_users_account_name ON zalo_users(account_id, display_name);
      CREATE INDEX IF NOT EXISTS idx_members_source ON zalo_source_members(account_id, source_id);
      CREATE INDEX IF NOT EXISTS idx_msg_account_created ON zalo_messages(account_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_msg_dedupe ON zalo_messages(dedupe_hash);
      CREATE INDEX IF NOT EXISTS idx_out_account_created ON outbound_log(account_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_sources_account ON zalo_sources(account_id);
    `);

    // legacy alias table for older code paths during transition
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        account_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'disconnected',
        zalo_user_id TEXT NOT NULL DEFAULT '',
        last_error TEXT NOT NULL DEFAULT '',
        connected_at TEXT,
        updated_at TEXT NOT NULL,
        paused INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  // --- settings / kill switch ---
  getSetting(key, fallback = null) {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(String(key));
    if (!row) return fallback;
    try {
      return JSON.parse(row.value);
    } catch {
      return row.value;
    }
  }

  setSetting(key, value) {
    const raw = typeof value === "string" ? value : JSON.stringify(value);
    this.db
      .prepare(
        `INSERT INTO settings(key, value) VALUES(?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(String(key), raw);
  }

  isGlobalPaused() {
    if (process.env.BRIDGE_PAUSED === "true") return true;
    return Boolean(this.getSetting("global_kill_switch", false));
  }

  setGlobalPaused(paused) {
    this.setSetting("global_kill_switch", Boolean(paused));
  }

  getDestination(accountId) {
    const all = this.getSetting("destinations", {});
    const hit = all[String(accountId)];
    if (hit && (hit.group_id || hit.group_name)) {
      return {
        account_id: String(hit.account_id || accountId),
        group_id: String(hit.group_id || ""),
        group_name: String(hit.group_name || ""),
      };
    }
    return { account_id: String(accountId), group_id: "", group_name: "" };
  }

  setDestination(accountId, groupId, groupName = "") {
    const all = this.getSetting("destinations", {}) || {};
    all[String(accountId)] = {
      account_id: String(accountId),
      group_id: String(groupId || ""),
      group_name: String(groupName || ""),
    };
    this.setSetting("destinations", all);
    return all[String(accountId)];
  }

  // --- accounts ---
  ensureAccount(accountId, displayName = "") {
    const id = String(accountId);
    const now = utcNow();
    this.db
      .prepare(
        `INSERT INTO zalo_accounts(id, display_name, status, session_ref, created_at, updated_at)
         VALUES(?, ?, 'disconnected', ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           display_name=CASE WHEN excluded.display_name != '' THEN excluded.display_name ELSE zalo_accounts.display_name END,
           updated_at=excluded.updated_at`,
      )
      .run(id, displayName || id, this.sessionPath(id), now, now);
    // keep legacy row in sync
    this.db
      .prepare(
        `INSERT INTO accounts(account_id, display_name, status, updated_at)
         VALUES(?, ?, 'disconnected', ?)
         ON CONFLICT(account_id) DO UPDATE SET updated_at=excluded.updated_at`,
      )
      .run(id, displayName || id, now);
    return this.getAccount(id);
  }

  getAccount(accountId) {
    const row = this.db.prepare(`SELECT * FROM zalo_accounts WHERE id = ?`).get(String(accountId));
    if (!row) return null;
    return {
      account_id: row.id,
      display_name: row.display_name,
      status: row.status,
      zalo_user_id: row.zalo_user_id,
      last_error: row.last_error,
      connected_at: row.connected_at,
      updated_at: row.updated_at,
      last_seen_at: row.last_seen_at,
      paused: row.paused,
      consecutive_send_errors: row.consecutive_send_errors,
      session_ref: row.session_ref,
    };
  }

  listAccounts() {
    return this.db
      .prepare(`SELECT * FROM zalo_accounts ORDER BY id`)
      .all()
      .map((row) => this.getAccount(row.id));
  }

  setAccountStatus(accountId, status, extra = {}) {
    const now = utcNow();
    this.ensureAccount(accountId);
    this.db
      .prepare(
        `UPDATE zalo_accounts SET
          status = ?,
          display_name = COALESCE(?, display_name),
          zalo_user_id = COALESCE(?, zalo_user_id),
          last_error = COALESCE(?, last_error),
          connected_at = CASE WHEN ? = 'connected' THEN COALESCE(connected_at, ?) ELSE connected_at END,
          last_seen_at = CASE WHEN ? = 'connected' THEN ? ELSE last_seen_at END,
          paused = CASE WHEN ? = 'paused' THEN 1 WHEN ? IN ('connected','need_scan','reconnecting','disconnected') THEN 0 ELSE paused END,
          updated_at = ?
        WHERE id = ?`,
      )
      .run(
        status,
        extra.display_name ?? null,
        extra.zalo_user_id ?? null,
        extra.last_error ?? null,
        status,
        now,
        status,
        now,
        status,
        status,
        now,
        String(accountId),
      );
    this.db
      .prepare(
        `UPDATE accounts SET status=?, display_name=COALESCE(?,display_name), zalo_user_id=COALESCE(?,zalo_user_id),
         last_error=COALESCE(?,last_error), updated_at=?, paused=CASE WHEN ?= 'paused' THEN 1 ELSE paused END
         WHERE account_id=?`,
      )
      .run(
        status,
        extra.display_name ?? null,
        extra.zalo_user_id ?? null,
        extra.last_error ?? null,
        now,
        status,
        String(accountId),
      );
    return this.getAccount(accountId);
  }

  bumpSendError(accountId, ok) {
    if (ok) {
      this.db
        .prepare(`UPDATE zalo_accounts SET consecutive_send_errors=0, updated_at=? WHERE id=?`)
        .run(utcNow(), String(accountId));
      return 0;
    }
    this.db
      .prepare(
        `UPDATE zalo_accounts SET consecutive_send_errors=consecutive_send_errors+1, updated_at=? WHERE id=?`,
      )
      .run(utcNow(), String(accountId));
    return this.getAccount(accountId)?.consecutive_send_errors || 0;
  }

  sessionPath(accountId) {
    return path.join(this.sessionsDir, `${String(accountId)}.json`);
  }

  saveSession(accountId, credentials) {
    const p = this.sessionPath(accountId);
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(credentials), { mode: 0o600 });
    fs.renameSync(tmp, p);
    fs.chmodSync(p, 0o600);
    this.db
      .prepare(`UPDATE zalo_accounts SET session_ref=?, updated_at=? WHERE id=?`)
      .run(p, utcNow(), String(accountId));
    return p;
  }

  loadSession(accountId) {
    const p = this.sessionPath(accountId);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  }

  hasSession(accountId) {
    return fs.existsSync(this.sessionPath(accountId));
  }

  deleteSession(accountId) {
    const p = this.sessionPath(accountId);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  // --- sources ---
  listSources(accountId = null) {
    if (accountId) {
      return this.db
        .prepare(`SELECT * FROM zalo_sources WHERE account_id=? ORDER BY source_id`)
        .all(String(accountId));
    }
    return this.db.prepare(`SELECT * FROM zalo_sources ORDER BY account_id, source_id`).all();
  }

  getSource(accountId, sourceId) {
    return (
      this.db
        .prepare(`SELECT * FROM zalo_sources WHERE account_id=? AND source_id=?`)
        .get(String(accountId), String(sourceId)) || null
    );
  }

  upsertSource({ accountId, sourceId, sourceType = "group", sourceName = "", mode = "off", isAllowed = null, muted = null }) {
    const now = utcNow();
    const existing = this.getSource(accountId, sourceId);
    const allowed =
      isAllowed == null ? (existing ? existing.is_allowed : mode !== "off" ? 1 : 0) : isAllowed ? 1 : 0;
    const mute = muted == null ? (existing ? existing.muted : 0) : muted ? 1 : 0;
    const finalMode = mode || existing?.mode || "off";
    this.db
      .prepare(
        `INSERT INTO zalo_sources(account_id, source_type, source_id, source_name, mode, is_allowed, muted, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,?)
         ON CONFLICT(account_id, source_id) DO UPDATE SET
           source_type=excluded.source_type,
           source_name=CASE WHEN excluded.source_name != '' THEN excluded.source_name ELSE zalo_sources.source_name END,
           mode=excluded.mode,
           is_allowed=excluded.is_allowed,
           muted=excluded.muted,
           updated_at=excluded.updated_at`,
      )
      .run(
        String(accountId),
        String(sourceType),
        String(sourceId),
        String(sourceName || ""),
        String(finalMode),
        allowed,
        mute,
        now,
        now,
      );
    return this.getSource(accountId, sourceId);
  }

  setSourceMode(accountId, sourceId, mode) {
    return this.upsertSource({
      accountId,
      sourceId,
      mode,
      isAllowed: mode !== "off",
    });
  }

  muteSource(accountId, sourceId, muted = true) {
    const src = this.getSource(accountId, sourceId);
    if (!src) {
      return this.upsertSource({ accountId, sourceId, mode: "off", isAllowed: false, muted });
    }
    return this.upsertSource({
      accountId,
      sourceId,
      sourceType: src.source_type,
      sourceName: src.source_name,
      mode: src.mode,
      isAllowed: src.is_allowed,
      muted,
    });
  }

  // --- permissions ---
  listPermissions(accountId = null) {
    if (accountId) {
      return this.db
        .prepare(`SELECT * FROM zalo_permissions WHERE account_id=? ORDER BY role, user_id`)
        .all(String(accountId));
    }
    return this.db.prepare(`SELECT * FROM zalo_permissions ORDER BY account_id, role, user_id`).all();
  }

  getPermission(accountId, userId) {
    return (
      this.db
        .prepare(`SELECT * FROM zalo_permissions WHERE account_id=? AND user_id=?`)
        .get(String(accountId), String(userId)) || null
    );
  }

  upsertPermission({ accountId, userId, role, displayName = "" }) {
    const now = utcNow();
    this.db
      .prepare(
        `INSERT INTO zalo_permissions(account_id, user_id, display_name, role, created_at, updated_at)
         VALUES(?,?,?,?,?,?)
         ON CONFLICT(account_id, user_id) DO UPDATE SET
           role=excluded.role,
           display_name=CASE WHEN excluded.display_name != '' THEN excluded.display_name ELSE zalo_permissions.display_name END,
           updated_at=excluded.updated_at`,
      )
      .run(String(accountId), String(userId), String(displayName || ""), String(role), now, now);
    return this.getPermission(accountId, userId);
  }

  removePermission(accountId, userId) {
    this.db
      .prepare(`DELETE FROM zalo_permissions WHERE account_id=? AND user_id=?`)
      .run(String(accountId), String(userId));
  }

  roleOf(accountId, userId) {
    const row = this.getPermission(accountId, userId);
    return row?.role || null;
  }

  // --- users / members corpus ---
  upsertUser({
    accountId,
    userId,
    displayName = "",
    avatar = "",
    globalId = "",
    accountStatus = null,
    raw = {},
  }) {
    if (!accountId || !userId) return null;
    const now = utcNow();
    this.db
      .prepare(
        `INSERT INTO zalo_users(account_id, user_id, display_name, avatar, global_id, account_status, first_seen_at, last_seen_at, raw_json)
         VALUES(?,?,?,?,?,?,?,?,?)
         ON CONFLICT(account_id, user_id) DO UPDATE SET
           display_name=CASE WHEN excluded.display_name != '' THEN excluded.display_name ELSE zalo_users.display_name END,
           avatar=CASE WHEN excluded.avatar != '' THEN excluded.avatar ELSE zalo_users.avatar END,
           global_id=CASE WHEN excluded.global_id != '' THEN excluded.global_id ELSE zalo_users.global_id END,
           account_status=COALESCE(excluded.account_status, zalo_users.account_status),
           last_seen_at=excluded.last_seen_at,
           raw_json=CASE WHEN excluded.raw_json != '{}' THEN excluded.raw_json ELSE zalo_users.raw_json END`,
      )
      .run(
        String(accountId),
        String(userId),
        String(displayName || ""),
        String(avatar || ""),
        String(globalId || ""),
        accountStatus,
        now,
        now,
        JSON.stringify(raw || {}),
      );
    return this.getUser(accountId, userId);
  }

  getUser(accountId, userId) {
    return (
      this.db
        .prepare(`SELECT * FROM zalo_users WHERE account_id=? AND user_id=?`)
        .get(String(accountId), String(userId)) || null
    );
  }

  listUsers(accountId, limit = 500) {
    return this.db
      .prepare(
        `SELECT account_id, user_id, display_name, avatar, global_id, account_status, first_seen_at, last_seen_at
         FROM zalo_users WHERE account_id=? ORDER BY last_seen_at DESC LIMIT ?`,
      )
      .all(String(accountId), Math.min(Number(limit) || 500, 5000));
  }

  countUsers(accountId = null) {
    if (accountId) {
      return this.db
        .prepare(`SELECT COUNT(*) AS c FROM zalo_users WHERE account_id=?`)
        .get(String(accountId)).c;
    }
    return this.db.prepare(`SELECT COUNT(*) AS c FROM zalo_users`).get().c;
  }

  upsertSourceMember({ accountId, sourceId, userId, role = "member" }) {
    if (!accountId || !sourceId || !userId) return null;
    const now = utcNow();
    this.db
      .prepare(
        `INSERT INTO zalo_source_members(account_id, source_id, user_id, role, first_seen_at, last_seen_at)
         VALUES(?,?,?,?,?,?)
         ON CONFLICT(account_id, source_id, user_id) DO UPDATE SET
           role=CASE WHEN excluded.role != 'member' THEN excluded.role ELSE zalo_source_members.role END,
           last_seen_at=excluded.last_seen_at`,
      )
      .run(String(accountId), String(sourceId), String(userId), String(role || "member"), now, now);
    return true;
  }

  listSourceMembers(accountId, sourceId, limit = 500) {
    return this.db
      .prepare(
        `SELECT m.*, u.display_name, u.avatar
         FROM zalo_source_members m
         LEFT JOIN zalo_users u
           ON u.account_id=m.account_id AND u.user_id=m.user_id
         WHERE m.account_id=? AND m.source_id=?
         ORDER BY m.role DESC, u.display_name ASC
         LIMIT ?`,
      )
      .all(String(accountId), String(sourceId), Math.min(Number(limit) || 500, 5000));
  }

  countSourceMembers(accountId = null) {
    if (accountId) {
      return this.db
        .prepare(`SELECT COUNT(*) AS c FROM zalo_source_members WHERE account_id=?`)
        .get(String(accountId)).c;
    }
    return this.db.prepare(`SELECT COUNT(*) AS c FROM zalo_source_members`).get().c;
  }

  // --- messages ---
  putEvent(event) {
    const now = utcNow();
    const rawText = String(event.text || "");
    const textRedacted = this.redactPhoneEmail
      ? redactPII(rawText, { phones: true, emails: true })
      : rawText;
    const senderUserId = String(event.sender_id || event.raw_metadata?.sender_user_id || "");
    const senderHash = sha256(`${event.account_id}:${senderUserId || "unknown"}`).slice(0, 24);
    const dedupeHash =
      event.event_id ||
      sha256([event.account_id, event.source_id, event.message_id, textRedacted.slice(0, 80)].join("|"));
    const meta = stripSensitiveMetadata({
      ...(event.raw_metadata || {}),
      sender_user_id: senderUserId || null,
    });
    const textRawRef = this.retainRawText ? rawText : null;

    if (senderUserId) {
      this.upsertUser({
        accountId: event.account_id,
        userId: senderUserId,
        displayName: event.sender_name || "",
      });
      if (event.source_type === "group" && event.source_id) {
        this.upsertSourceMember({
          accountId: event.account_id,
          sourceId: event.source_id,
          userId: senderUserId,
          role: "member",
        });
      }
    }

    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO zalo_messages(
          id, account_id, source_id, source_type, source_name, sender_hash, sender_display_name,
          message_id, message_type, text_redacted, text_raw_ref, metadata_json, is_self, is_mention,
          priority, ingested_at, created_at, dedupe_hash
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        event.event_id || dedupeHash,
        event.account_id,
        event.source_id,
        event.source_type,
        event.source_name || "",
        senderHash,
        event.sender_name || "",
        event.message_id,
        event.message_type || "unknown",
        textRedacted,
        textRawRef,
        JSON.stringify(meta),
        event.is_self ? 1 : 0,
        event.is_mention ? 1 : 0,
        Number(event.priority || 0),
        now,
        event.created_at || now,
        dedupeHash,
      );
    return result.changes === 1;
  }

  recentEvents({ accountId = null, limit = 50, sinceIso = null, sourceId = null } = {}) {
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 500);
    let sql = `SELECT id as event_id, account_id, source_type, source_id, source_name,
      sender_hash as sender_id, sender_display_name as sender_name, message_id, message_type,
      text_redacted as text, is_self, is_mention, priority, created_at, ingested_at as collected_at,
      dedupe_hash
      FROM zalo_messages WHERE 1=1`;
    const params = [];
    if (accountId) {
      sql += ` AND account_id=?`;
      params.push(String(accountId));
    }
    if (sourceId) {
      sql += ` AND source_id=?`;
      params.push(String(sourceId));
    }
    if (sinceIso) {
      sql += ` AND created_at >= ?`;
      params.push(sinceIso);
    }
    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(lim);
    return this.db.prepare(sql).all(...params);
  }

  countEvents(accountId = null) {
    if (accountId) {
      return this.db
        .prepare(`SELECT COUNT(*) AS c FROM zalo_messages WHERE account_id=?`)
        .get(String(accountId)).c;
    }
    return this.db.prepare(`SELECT COUNT(*) AS c FROM zalo_messages`).get().c;
  }

  countInboundRecent(accountId, minutes) {
    const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
    return this.db
      .prepare(`SELECT COUNT(*) AS c FROM zalo_messages WHERE account_id=? AND ingested_at >= ?`)
      .get(String(accountId), since).c;
  }

  putEnrichment(row) {
    this.db
      .prepare(
        `INSERT INTO zalo_enrichments(
          message_id, account_id, topic, intent, sentiment, priority, lead_flag, risk_flag,
          action_items_json, summary, created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        row.message_id,
        row.account_id,
        row.topic || "",
        row.intent || "",
        row.sentiment || "",
        row.priority || "low",
        row.lead_flag ? 1 : 0,
        row.risk_flag ? 1 : 0,
        JSON.stringify(row.action_items || []),
        row.summary || "",
        utcNow(),
      );
  }

  putReport(row) {
    const r = this.db
      .prepare(
        `INSERT INTO zalo_reports(
          account_id, destination_source_id, report_type, period_start, period_end,
          content, sent_status, sent_at, error_message, created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        row.account_id,
        row.destination_source_id || "",
        row.report_type,
        row.period_start,
        row.period_end,
        row.content || "",
        row.sent_status || "draft",
        row.sent_at || null,
        row.error_message || "",
        utcNow(),
      );
    return Number(r.lastInsertRowid);
  }

  updateReport(id, patch) {
    const cur = this.db.prepare(`SELECT * FROM zalo_reports WHERE id=?`).get(id);
    if (!cur) return null;
    this.db
      .prepare(
        `UPDATE zalo_reports SET sent_status=?, sent_at=?, error_message=?, content=COALESCE(?, content) WHERE id=?`,
      )
      .run(
        patch.sent_status ?? cur.sent_status,
        patch.sent_at ?? cur.sent_at,
        patch.error_message ?? cur.error_message,
        patch.content ?? null,
        id,
      );
    return this.db.prepare(`SELECT * FROM zalo_reports WHERE id=?`).get(id);
  }

  listReports({ accountId = null, limit = 20 } = {}) {
    const lim = Math.min(Number(limit) || 20, 100);
    if (accountId) {
      return this.db
        .prepare(`SELECT * FROM zalo_reports WHERE account_id=? ORDER BY id DESC LIMIT ?`)
        .all(String(accountId), lim);
    }
    return this.db.prepare(`SELECT * FROM zalo_reports ORDER BY id DESC LIMIT ?`).all(lim);
  }

  logOutbound({ accountId, targetId, kind, textSha, ok, reason = "" }) {
    this.db
      .prepare(
        `INSERT INTO outbound_log(account_id, target_id, kind, text_sha256, created_at, ok, reason)
         VALUES(?,?,?,?,?,?,?)`,
      )
      .run(String(accountId), String(targetId), String(kind), String(textSha), utcNow(), ok ? 1 : 0, reason);
    this.bumpSendError(accountId, ok);
  }

  countOutbound(accountId, minutes, targetId = null) {
    const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
    if (targetId) {
      return this.db
        .prepare(
          `SELECT COUNT(*) AS c FROM outbound_log
           WHERE account_id=? AND target_id=? AND ok=1 AND created_at >= ?`,
        )
        .get(String(accountId), String(targetId), since).c;
    }
    return this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM outbound_log WHERE account_id=? AND ok=1 AND created_at >= ?`,
      )
      .get(String(accountId), since).c;
  }

  recentOutboundDuplicate(accountId, textSha, withinMinutes = 120) {
    const since = new Date(Date.now() - withinMinutes * 60 * 1000).toISOString();
    const row = this.db
      .prepare(
        `SELECT id FROM outbound_log
         WHERE account_id=? AND text_sha256=? AND ok=1 AND created_at >= ? LIMIT 1`,
      )
      .get(String(accountId), String(textSha), since);
    return Boolean(row);
  }

  getCooldown(accountId, alertKey) {
    return (
      this.db
        .prepare(`SELECT * FROM alert_cooldowns WHERE account_id=? AND alert_key=?`)
        .get(String(accountId), String(alertKey)) || null
    );
  }

  setCooldown(accountId, alertKey) {
    this.db
      .prepare(
        `INSERT INTO alert_cooldowns(account_id, alert_key, last_sent_at) VALUES(?,?,?)
         ON CONFLICT(account_id, alert_key) DO UPDATE SET last_sent_at=excluded.last_sent_at`,
      )
      .run(String(accountId), String(alertKey), utcNow());
  }

  audit({ accountId = "", actorId = "", action, detail = "" }) {
    this.db
      .prepare(
        `INSERT INTO audit_log(account_id, actor_id, action, detail, created_at) VALUES(?,?,?,?,?)`,
      )
      .run(String(accountId), String(actorId), String(action), String(detail).slice(0, 1000), utcNow());
  }

  recentAudit(limit = 50) {
    return this.db
      .prepare(`SELECT * FROM audit_log ORDER BY id DESC LIMIT ?`)
      .all(Math.min(Number(limit) || 50, 200));
  }

  retain(days) {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const r = this.db.prepare(`DELETE FROM zalo_messages WHERE ingested_at < ?`).run(cutoff);
    return r.changes;
  }

  setHealth(key, value) {
    this.db
      .prepare(
        `INSERT INTO health(key, value) VALUES(?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(String(key), typeof value === "string" ? value : JSON.stringify(value));
  }

  getHealth(key) {
    const row = this.db.prepare(`SELECT value FROM health WHERE key = ?`).get(String(key));
    return row ? row.value : null;
  }

  snapshot() {
    return {
      accounts: this.listAccounts().map((a) => ({
        account_id: a.account_id,
        status: a.status,
        display_name: a.display_name,
        has_session: this.hasSession(a.account_id),
        paused: a.paused,
        updated_at: a.updated_at,
      })),
      source_count: this.listSources().length,
      event_count: this.countEvents(),
      user_count: this.countUsers(),
      member_links: this.countSourceMembers(),
      global_paused: this.isGlobalPaused(),
      db_path: this.dbPath,
      sessions_dir: this.sessionsDir,
    };
  }

  seedFromConfig(config) {
    this.ensureAccount(config.default_account_id);
    if (config.phone_label) {
      this.setSetting("phone_label", config.phone_label);
    }
    const cur = this.getDestination(config.default_account_id);
    if (config.destination?.group_id && !cur.group_id) {
      this.setDestination(
        config.destination.account_id || config.default_account_id,
        config.destination.group_id,
        config.destination.group_name || "",
      );
    } else if (!cur.group_id && (config.destination?.group_name || process.env.DESTINATION_GROUP_NAME)) {
      // store name placeholder; group_id filled after QR resolve
      this.setDestination(
        config.destination?.account_id || config.default_account_id,
        "",
        config.destination?.group_name || process.env.DESTINATION_GROUP_NAME || "",
      );
    } else if (cur.group_id && config.destination?.group_name && !cur.group_name) {
      this.setDestination(config.default_account_id, cur.group_id, config.destination.group_name);
    }
    for (const s of config.sources || []) {
      if (!this.getSource(s.account_id, s.source_id)) {
        this.upsertSource({
          accountId: s.account_id,
          sourceId: s.source_id,
          sourceType: s.source_type,
          sourceName: s.source_name,
          mode: s.mode,
          isAllowed: s.mode !== "off",
        });
      }
    }
    for (const role of ["owner", "admin", "operator", "viewer"]) {
      for (const uid of config.roles?.[role] || []) {
        if (!this.getPermission(config.default_account_id, uid)) {
          this.upsertPermission({
            accountId: config.default_account_id,
            userId: uid,
            role,
          });
        }
      }
    }
    const envOwners = String(process.env.OWNER_USER_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const uid of envOwners) {
      this.upsertPermission({
        accountId: config.default_account_id,
        userId: uid,
        role: "owner",
      });
    }
  }

  close() {
    this.db.close();
  }
}
