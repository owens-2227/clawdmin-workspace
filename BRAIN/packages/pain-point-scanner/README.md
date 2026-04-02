# Pain Point Scanner — Deployment Package

**Purpose:** Scan Reddit subreddits for actionable pain points using AdsPower browser profiles, and write results directly to a shared MongoDB Atlas database.

## Quick Start

1. Copy this entire `pain-point-scanner/` directory into your OpenClaw workspace
2. Add `SCAN-INSTRUCTIONS.md` as a reference for your scan cron job
3. Create the cron job (see below)
4. Map your persona agents to their AdsPower profiles and subreddits

## What's Included

| File | Purpose |
|------|---------|
| `README.md` | This file — setup guide |
| `SCAN-INSTRUCTIONS.md` | The master scan instructions given to each subagent |
| `personas-account-b.md` | All 10 Account B persona definitions with subreddit assignments |
| `category-mapping.md` | Persona ↔ subreddit ↔ category mapping for all Account B subs |
| `mongo-schema.md` | MongoDB Atlas connection info, database schema, and write examples |
| `cron-setup.md` | How to set up the daily scan cron job in OpenClaw |
| `scan-orchestrator-prompt.md` | The prompt your main agent should use to dispatch all 10 subagents |

## Architecture

```
Your OpenClaw Agent (main)
  ├── Cron fires at scheduled time
  ├── Opens 10 AdsPower profiles (one per persona)
  ├── Spawns 10 subagents with CDP URLs
  ├── Each subagent:
  │   ├── Browses 4-5 assigned subreddits via real browser
  │   ├── Analyzes posts for pain points
  │   ├── Writes results directly to MongoDB Atlas
  │   └── Reports completion
  └── Closes all AdsPower profiles
```

## Key Differences from Account A

- **No dashboard API dependency** — agents write directly to MongoDB Atlas
- **Python-based writes** — uses `pymongo` instead of HTTP API calls
- **Same database, same schema** — results merge seamlessly with Account A data
- **Different subreddits** — no overlap (except r/personalfinance, r/xxfitness shared with Account A)

## Prerequisites

- OpenClaw running with AdsPower integration
- AdsPower with Account B profiles (13-22) configured
- Python 3 with `pymongo` installed (`pip3 install 'pymongo[srv]'`)
- Network access to MongoDB Atlas (outbound port 27017)
