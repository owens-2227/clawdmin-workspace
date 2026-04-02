# Mac Mini Multi-Agent Setup Guide

A step-by-step technical guide to replicating the current OpenClaw multi-agent system on a new Mac Mini.

---

## 1. Current System Reference

| Component | Details |
|-----------|---------|
| OS | macOS 26.1 (Tahoe) |
| Runtime | Node.js v22.22.1 |
| OpenClaw | v2026.3.13 |
| Gateway Port | 18789 |
| Orchestrator Model | `anthropic/claude-opus-4-6` |
| Subagent Model | `anthropic/claude-sonnet-4-6` |
| Channel | Slack (Socket Mode) |
| Anti-Detect Browser | AdsPower Global |
| VPN/Mesh | Tailscale |

---

## 2. Prerequisites

Before starting, have these ready:

- [ ] Mac Mini (Apple Silicon recommended, 16GB+ RAM)
- [ ] macOS updated to latest
- [ ] Anthropic API key (for Claude models)
- [ ] Slack app credentials (Bot Token, App Token) — create a new Slack app or use the same one
- [ ] Brave Search API key (for web search)
- [ ] Tailscale account (for remote access)
- [ ] AdsPower license (for anti-detect browser profiles)
- [ ] Reddit accounts (one per persona agent, already logged in via AdsPower profiles)

---

## 3. Base System Setup

### 3.1 Headless / Always-On Config

```bash
# Install Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Enable SSH (System Settings → General → Sharing → Remote Login)
# Enable Screen Sharing (System Settings → General → Sharing → Screen Sharing)
#   - Set a VNC password under "Computer Settings" for remote access
#   - Note: VNC password is separate from your macOS login password

# Prevent sleep
caffeinate -s &
# For persistence, create a LaunchAgent (see section 3.2)
```

### 3.2 Caffeinate LaunchAgent (Survives Reboots)

Create `~/Library/LaunchAgents/com.local.caffeinate.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.local.caffeinate</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string>
    <string>-s</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.local.caffeinate.plist
```

### 3.3 Tailscale

```bash
# Install from https://tailscale.com/download/mac
# Or via App Store
# Sign in to your Tailnet
# Note the Tailscale IP — this is how you'll SSH/VNC into the machine remotely
```

---

## 4. Install OpenClaw

### 4.1 Install via Script

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
```

This installs Node.js (if missing) and OpenClaw globally, then launches the onboarding wizard.

### 4.2 Or Install Manually

```bash
# Install Node 22+ via Homebrew
brew install node@22

# Install OpenClaw
npm install -g openclaw@latest

# Run onboarding
openclaw onboard --install-daemon
```

### 4.3 Verify

```bash
openclaw --version
# Should output: OpenClaw 2026.x.x

openclaw gateway status
# Should show: running
```

---

## 5. Configure OpenClaw

The main config lives at `~/.openclaw/openclaw.json`. Here's the structure you need:

### 5.1 Core Config Structure

```jsonc
{
  "auth": {
    "anthropic": { "apiKey": "sk-ant-..." }
    // Add other providers as needed
  },
  "agents": {
    "defaults": {
      "model": { "primary": "anthropic/claude-sonnet-4-6" },
      "workspace": "/Users/<you>/.openclaw/workspace",
      "subagents": {
        "maxSpawnDepth": 2,
        "maxConcurrent": 4,
        "runTimeoutSeconds": 1800
      },
      "heartbeat": {
        "every": "15m",
        "activeHours": {
          "start": "07:00",
          "end": "23:00",
          "timezone": "America/Los_Angeles"
        }
      }
    },
    "list": [
      // See Section 5.2 for agent definitions
    ]
  },
  "tools": {
    "profile": "coding",
    "web": {
      "search": {
        "enabled": true,
        "provider": "brave",
        "apiKey": "BSA..."
      }
    }
  },
  "channels": {
    // See Section 5.3 for channel config
  },
  "gateway": {
    "port": 18789,
    "mode": "local",
    "bind": "loopback"
  },
  "cron": { "enabled": true },
  "commands": {
    "native": "auto",
    "nativeSkills": "auto",
    "restart": true
  },
  "session": {
    "dmScope": "per-channel-peer"
  }
}
```

### 5.2 Agent Definitions

You need one **orchestrator** (main) agent and one agent per persona:

```jsonc
{
  "agents": {
    "list": [
      {
        "id": "main",
        "default": true,
        "name": "Clawdmin",          // Your orchestrator name
        "model": { "primary": "anthropic/claude-opus-4-6" },
        "workspace": "/Users/<you>/.openclaw/workspace",
        "identity": { "name": "Clawdmin", "emoji": "🦾" },
        "skills": ["adspower", "reddit-engage"],
        "subagents": {
          "allowAgents": ["jess-m", "owen-b", "maya-chen", "dave-r", "marco-v"]
        }
      },
      {
        "id": "jess-m",
        "name": "Jess M",
        "model": { "primary": "anthropic/claude-sonnet-4-6" },
        "workspace": "/Users/<you>/.openclaw/workspace",
        "identity": { "name": "Jess M", "emoji": "🌱" },
        "skills": ["adspower", "reddit-engage"]
      },
      {
        "id": "owen-b",
        "name": "Owen B",
        "model": { "primary": "anthropic/claude-sonnet-4-6" },
        "workspace": "/Users/<you>/.openclaw/workspace",
        "identity": { "name": "Owen B", "emoji": "💻" },
        "skills": ["adspower", "reddit-engage"]
      },
      {
        "id": "maya-chen",
        "name": "Maya C",
        "model": { "primary": "anthropic/claude-sonnet-4-6" },
        "workspace": "/Users/<you>/.openclaw/workspace",
        "identity": { "name": "Maya C", "emoji": "✨" },
        "skills": ["adspower", "reddit-engage"]
      },
      {
        "id": "dave-r",
        "name": "Dave R",
        "model": { "primary": "anthropic/claude-sonnet-4-6" },
        "workspace": "/Users/<you>/.openclaw/workspace",
        "identity": { "name": "Dave R", "emoji": "🔨" },
        "skills": ["adspower", "reddit-engage"]
      },
      {
        "id": "marco-v",
        "name": "Marco V",
        "model": { "primary": "anthropic/claude-sonnet-4-6" },
        "workspace": "/Users/<you>/.openclaw/workspace",
        "identity": { "name": "Marco V", "emoji": "⚡" },
        "skills": ["adspower", "reddit-engage"]
      }
    ]
  }
}
```

### 5.3 Slack Channel Config

```jsonc
{
  "channels": {
    "slack": {
      "mode": "socket",
      "enabled": true,
      "botToken": "xoxb-...",      // Bot User OAuth Token
      "appToken": "xapp-...",      // App-Level Token (Socket Mode)
      "groupPolicy": "allowlist",
      "dmPolicy": "allowlist",
      "streaming": "off",
      "allowFrom": ["U_YOUR_SLACK_USER_ID"],
      "channels": {
        "C_YOUR_CHANNEL_ID": {
          "allow": true,
          "requireMention": true
        }
      }
    }
  }
}
```

---

## 6. Workspace Structure

The workspace at `~/.openclaw/workspace/` needs these files and directories:

```
~/.openclaw/workspace/
├── .git/                    # Version-controlled
├── AGENTS.md                # Agent behavior rules
├── SOUL.md                  # Orchestrator personality + delegation protocol
├── USER.md                  # Info about you (the human)
├── IDENTITY.md              # Orchestrator identity
├── TOOLS.md                 # Local tool notes (AdsPower IDs, paths, etc.)
├── HEARTBEAT.md             # Heartbeat checklist
├── BRAIN/
│   ├── projects/            # Active project briefs
│   ├── published-content/   # Per-agent engagement logs
│   │   ├── jess-m/
│   │   ├── owen-b/
│   │   └── ...
│   ├── summaries/           # Daily engagement summaries
│   └── assets/              # Shared templates and media
├── memory/                  # Daily memory files (YYYY-MM-DD.md)
└── skills/
    ├── adspower/            # AdsPower browser automation skill
    │   └── SKILL.md
    └── reddit-engage/       # Reddit engagement skill
        └── SKILL.md
```

Copy the workspace files from the existing machine or set up fresh via bootstrap.

### 6.1 Agent Directories

Each agent also needs a directory under `~/.openclaw/agents/`:

```
~/.openclaw/agents/
├── main/agent/              # Orchestrator agent dir
├── jess-m/agent/
├── owen-b/agent/
├── maya-chen/agent/
├── dave-r/agent/
└── marco-v/agent/
```

These are created automatically during onboarding or when you define agents in the config.

---

## 7. Install AdsPower

1. Download AdsPower Global from https://www.adspower.com/download
2. Install and sign in with your license
3. Create browser profiles — one per persona agent
4. Log each profile into its Reddit account
5. Note each profile's `user_id` (visible in AdsPower API or UI)

### 7.1 AdsPower API

AdsPower runs a local API server:

```
Base URL: http://local.adspower.net:50325/api/v1
```

Key endpoints:
```bash
# Start a browser profile
curl -s "http://local.adspower.net:50325/api/v1/browser/start?user_id=<ID>"
# Response contains data.ws.puppeteer — the CDP URL for Playwright

# Check if profile is active
curl -s "http://local.adspower.net:50325/api/v1/browser/active?user_id=<ID>"

# Stop a browser profile
curl -s "http://local.adspower.net:50325/api/v1/browser/stop?user_id=<ID>"
```

### 7.2 Update TOOLS.md

Record each agent's `user_id` mapping in `TOOLS.md`:

```markdown
| Agent | user_id | Profile |
|-------|---------|---------|
| jess-m | <id> | User1 |
| owen-b | <id> | User2 |
| ... | ... | ... |
```

---

## 8. Install Skills

Skills are installed in `~/.openclaw/workspace/skills/`. You need two:

### 8.1 From ClawHub (if published)

```bash
openclaw skill install adspower
openclaw skill install reddit-engage
```

### 8.2 Manual Copy

If the skills aren't published, copy the skill directories from the existing machine:

```bash
# From the existing Mac Mini
scp -r ~/.openclaw/workspace/skills/adspower/ <new-mac>:~/.openclaw/workspace/skills/adspower/
scp -r ~/.openclaw/workspace/skills/reddit-engage/ <new-mac>:~/.openclaw/workspace/skills/reddit-engage/
```

Each skill directory must contain at minimum a `SKILL.md` file.

---

## 9. Gateway Daemon

OpenClaw runs as a persistent background service via launchd.

### 9.1 Start the Gateway

```bash
openclaw gateway start
```

This creates `~/Library/LaunchAgents/ai.openclaw.gateway.plist` and loads it.

### 9.2 Manage the Gateway

```bash
openclaw gateway status    # Check if running
openclaw gateway restart   # Restart after config changes
openclaw gateway stop      # Stop the daemon
```

### 9.3 Logs

```bash
tail -f ~/.openclaw/logs/gateway.log
tail -f ~/.openclaw/logs/gateway.err.log
```

---

## 10. How the Multi-Agent System Works

```
Paul (Slack) → Clawdmin (orchestrator, opus)
                    │
                    ├── Opens AdsPower profile via API
                    ├── Gets CDP (Chrome DevTools Protocol) URL
                    ├── Spawns subagent with persona + CDP URL
                    │       │
                    │       ├── jess-m (sonnet) → Reddit via browser
                    │       ├── owen-b (sonnet) → Reddit via browser
                    │       ├── maya-chen (sonnet) → Reddit via browser
                    │       ├── dave-r (sonnet) → Reddit via browser
                    │       └── marco-v (sonnet) → Reddit via browser
                    │
                    ├── Monitors progress, enforces 30min timeout
                    ├── Closes AdsPower profiles when done
                    └── Reports results back to Paul via Slack
```

### Key Delegation Flow:

1. Paul sends command via Slack DM
2. Clawdmin opens AdsPower profile: `curl .../browser/start?user_id=<ID>`
3. Parses CDP URL from response (`data.ws.puppeteer`)
4. Spawns subagent via `sessions_spawn` with:
   - `agentId`: persona ID
   - `task`: full persona context + CDP URL + instructions
   - `runTimeoutSeconds`: 1800
   - `mode`: "run"
5. Subagent connects to browser via CDP, executes Reddit engagement
6. On completion, Clawdmin closes the browser profile
7. Results logged to `BRAIN/summaries/YYYY-MM-DD.md`

### Safety Rules:

- Max 2 agents on the same subreddit simultaneously
- Stagger spawns 20-30 minutes apart
- 30-minute max per agent session
- Halt all on error/rate-limit/ban risk

---

## 11. Post-Setup Checklist

- [ ] macOS updated, Homebrew installed
- [ ] Node.js 22+ installed
- [ ] OpenClaw installed and onboarded (`openclaw --version`)
- [ ] `~/.openclaw/openclaw.json` configured with all agents, channels, and API keys
- [ ] Gateway running (`openclaw gateway status`)
- [ ] Slack connected (send a test DM)
- [ ] Tailscale connected (note the IP)
- [ ] Screen Sharing enabled with VNC password set
- [ ] SSH enabled
- [ ] `caffeinate` running via LaunchAgent
- [ ] AdsPower installed and signed in
- [ ] All browser profiles created with Reddit accounts logged in
- [ ] Skills installed (`adspower`, `reddit-engage`)
- [ ] Workspace files in place (`AGENTS.md`, `SOUL.md`, `TOOLS.md`, etc.)
- [ ] BRAIN directories created
- [ ] Test: spawn a single subagent and verify it can connect to AdsPower + Reddit
- [ ] Heartbeat working (check logs after 15 minutes)

---

## 12. Troubleshooting

| Issue | Fix |
|-------|-----|
| Gateway won't start | Check `~/.openclaw/logs/gateway.err.log`; verify Node path in plist |
| Slack not connecting | Verify bot/app tokens; ensure Socket Mode is enabled in Slack app settings |
| AdsPower API unreachable | Make sure AdsPower app is running (it must be open, not just installed) |
| Subagent can't connect to browser | Check CDP URL is fresh (they expire when browser closes) |
| VNC password not working | Use dedicated VNC password, not macOS login password |
| Machine sleeping | Verify `caffeinate` is running: `pgrep caffeinate` |

---

*Generated from the live system on 2026-03-16. Adjust paths and credentials for your specific setup.*
