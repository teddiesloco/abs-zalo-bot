# Hermes Agent Integration with ABS Zalo Bot

ABS Zalo Bot is natively optimized for Hermes Agent and the Agent Business System.

## Option 1 — Install as a Skill

```bash
git clone https://github.com/teddiesloco/abs-zalo-bot.git
cp -r abs-zalo-bot ~/.hermes/skills/abs-zalo-bot
```

Hermes reads `SKILL.md` at the repo root and automatically loads full Zalo capabilities when interacting with Zalo tasks.

## Option 2 — Attach as an MCP Server (Recommended)

Register the ABS Zalo MCP server in Hermes MCP configuration:

```json
{
  "mcpServers": {
    "abs-zalo": {
      "command": "node",
      "args": ["/root/Claude/AgentWork/oss-build/abs-zalo-bot/mcp/server.js"],
      "env": {
        "ZALO_BRIDGE_URL": "http://127.0.0.1:3871"
      }
    }
  }
}
```

## Security Guarantees & Policy

- **Side-effects gated by code**: Outbound messages and destructive actions (kick, transfer ownership) require verification.
- **Fail-closed default**: Inbound events are listener-only until explicitly configured.
- **Session safety**: Credentials and tokens are stored in strict-permission local storage, never leaked into model context.
