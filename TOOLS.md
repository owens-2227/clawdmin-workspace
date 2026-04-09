# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## AdsPower

API base: `http://127.0.0.1:50325/api/v1`
Auth: `Authorization: Bearer 0d599e9255deef1bcc503d735da537160085c443c76f1c30`
Note: Must use `127.0.0.1`, NOT `local.adspower.net` or `local.adspower.com`

| # | Agent | user_id | Reddit | Proxy Port |
|---|-------|---------|--------|------------|
| 1 | jess-m | k1abonj2 | Known-Train2059 | 10001 |
| 2 | owen-b | k1adu606 | portraftwerb | 10002 |
| 3 | maya-chen | k1adu8q5 | tiolenssesg | 10003 |
| 4 | dave-r | k1adu8q6 | ofexfrog | 10004 |
| 5 | marco-v | k1adu8q7 | unjuvals | 10005 |
| 6 | nora-p | k1adu8q8 | flordeta | 10006 |
| 7 | raj-s | k1bc3ttk | glamavub | 10004 |
| 8 | claire-t | k1adu8qa | rethighlin | 10008 |
| 9 | ty-m | k1adu8qb | raispherog | 10009 |
| 10 | priya-k | k1adu8qc | Perfect_Cricket_9114 | 10010 |
| 11 | marcus-j | k1adu8qd | Low-Bath-946 | 10011 |
| 12 | elise-c | k1adu8qe | Over_Rise2921 | 10012 |

```bash
# Open profile
curl -s "http://local.adspower.net:50325/api/v1/browser/start?user_id=<user_id>"
# Check status
curl -s "http://local.adspower.net:50325/api/v1/browser/active?user_id=<user_id>"
# Close profile
curl -s "http://local.adspower.net:50325/api/v1/browser/stop?user_id=<user_id>"
```

Response contains `data.ws.puppeteer` — the CDP URL to pass to the subagent.

## BRAIN Paths

| Path | Purpose |
|------|---------|
| `~/.openclaw/workspace/BRAIN/projects/` | Active project briefs |
| `~/.openclaw/workspace/BRAIN/published-content/<agent-id>/` | Per-agent engagement logs |
| `~/.openclaw/workspace/BRAIN/summaries/` | Daily engagement summaries |
| `~/.openclaw/workspace/BRAIN/assets/` | Shared templates and media |

## Notion

API secret: `REDACTED_NOTION`
Version header: `Notion-Version: 2022-06-28`

| Resource | ID |
|----------|----|
| Social Signals Reddit (page) | 31b66005-ab52-800d-9c49-fbc517921ae3 |
| Openclaw Management (page) | 32666005-ab52-8032-9338-df9720ae0f45 |
| 🧪 Reddit Experiments (database) | 32666005-ab52-81f8-9bbe-f50add0099a4 |

## Ahrefs

API base: `https://api.ahrefs.com/v3`
API key: `dA9_1pSIRzFFuVRJoevHngbGYicG11VQsTbxg417`
Auth header: `Authorization: Bearer dA9_1pSIRzFFuVRJoevHngbGYicG11VQsTbxg417`
Docs: https://docs.ahrefs.com/api/docs/introduction
Skill: `skills/ahrefs/SKILL.md`

## GitHub

Repo: https://github.com/owens-2227/clawdmin-workspace (private)
Token: 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
Account: owens-2227
Remote: already configured on main branch

To host an asset (screenshot, image):
1. Copy file to ~/.openclaw/workspace/BRAIN/assets/
2. `git add . && git commit -m "Add asset" && git push`
3. Raw URL: https://raw.githubusercontent.com/owens-2227/clawdmin-workspace/main/BRAIN/assets/filename.png

## Flint

API base: `https://app.tryflint.com/api/v1`
API key: `ak_E7WFVNH5C0VZGFETBE9S5DSM9JR49D36`

| Site | Site ID | Description |
|------|---------|-------------|
| Main | 12628d27-7872-468a-aa54-c4780cf3284b | Primary site |

## sessions_spawn — Subagent Delegation

Key params when spawning a persona agent:
- `agentId`: "jess-m" | "owen-b" | "maya-chen" | "dave-r" | "marco-v"
- `task`: MUST include full persona voice guidelines + CDP URL + log path
- `label`: e.g. "jess-morning-2026-03-14"
- `runTimeoutSeconds`: 1800
- `mode`: "run"
