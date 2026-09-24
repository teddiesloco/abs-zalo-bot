# Hermes Agent Integration with ABS Zalo Agent Engine

`abs-zalo-bot` turns your Zalo account into an enterprise-grade platform for **Hermes Agent**.

It is engineered for speed, safety, and zero bloat: **full Zalo platform capabilities + full Hermes Agent intelligence**, with standard MCP extensibility for external tools.

---

## ⚡ 1-Click Hermes Installation

Run the automated installer inside your `abs-zalo-bot` directory:

```bash
npm run install:hermes
```

The installer automatically:
1. Detects your Hermes home (`~/.hermes` or `HERMES_HOME`).
2. Atomically merges Hermes `config.yaml` to enable `platforms/zalo` and `zalo-tools`.
3. Installs the dual-tier toolset (`zalo_owner`, `zalo_public`, `zalo_cron`).
4. Generates authenticated bridge tokens and sets up the local environment.

### Verify Health in 1 Second

```bash
npm run doctor
```
Runs an 11-point diagnostic check covering layout, platform plugins, token security, websockets, and bridge connectivity.

---

## 🛡️ Dual-Tier Security Architecture

Hermes Agent receives messages from Zalo and automatically enforces role-based tool authorization:

* **👑 Owner Mode (`zalo_owner`):**
  When the owner (UID configured in `ZALO_ALLOWED_USERS`) messages on Zalo, Hermes Agent unlocks **100% of its native capabilities**:
  - Full **Terminal / Shell execution** (`terminal`).
  - File reading, writing, and patching (`read_file`, `write_file`, `patch`).
  - Web research and extraction (`web_search`, `web_extract`).
  - Background process and scheduled cron tasks (`cron`).
  - Full **Hermes Skills Library** (`~/.hermes/skills/`).
  - Advanced Zalo administration tools (undo, group renaming, kick, member management).

* **👥 Public Mode (`zalo_public`):**
  When strangers or group members chat, Hermes restricts tool access to safe conversational and lookup tools only. **Terminal, shell, and file operations are strictly walled off**, protecting your server and environment from unauthorized execution.

---

## 📊 Hermes Web Dashboard Integration

Every message sent or received via Zalo is natively dispatched to Hermes Agent's session pipeline:
- Appears in real-time on the **Hermes Dashboard / Web UI**.
- Preserves full session history, cognitive loop steps, and token accounting.
- Supports multi-turn memory and context retention.

---

## 🔌 Modular Extensibility via MCP (Zero Core Bloat)

In accordance with minimalist, production-grade engineering principles, `abs-zalo-bot` does **not** bundle gigabytes of heavy external libraries (video downloaders, heavy TTS neural models, image generators).

Instead, user-level tools can be connected on-demand using standard **MCP Servers** or native Hermes tools:
- **TTS / Voice:** Point Hermes to any local TTS provider (e.g. ZeroTTS) or cloud voice API via standard MCP.
- **Media Download:** Use standard CLI tools (`yt-dlp`) or MCP wrappers directly from Hermes Terminal.
- **Deep Research & Web:** Utilize Hermes built-in search or attach specialized research MCPs.

Hermes Agent's lazy-loading mechanism (`tool_search`) loads these tools only when needed, keeping baseline token costs minimal and response times instantaneous.

---

## 🛠️ Alternative Setup Modes

### Mode A: Attach as an MCP Server (Claude Code, Codex, Cursor)
Add to your client's MCP configuration:
```json
{
  "mcpServers": {
    "abs-zalo": {
      "command": "node",
      "args": ["/path/to/abs-zalo-bot/mcp/server.js"],
      "env": {
        "ZALO_BRIDGE_URL": "http://127.0.0.1:3871",
        "ABS_ZALO_TOOL_PACK": "admin"
      }
    }
  }
}
```

### Mode B: Install as a Hermes Skill
```bash
cp -r /path/to/abs-zalo-bot ~/.hermes/skills/abs-zalo-bot
```
Hermes auto-detects `SKILL.md` and equips the agent with Zalo operations expertise.
