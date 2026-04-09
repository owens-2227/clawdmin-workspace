---
name: account-warming
description: "Automated Reddit account warming via AdsPower + Playwright. Runs daily phases to build natural activity history before deployment."
metadata:
  openclaw:
    emoji: "🔥"
---

# Account Warming Skill

Warms new Reddit accounts through 4 phases over 14 days, building natural browsing/voting/commenting history.

## Architecture

```
SKILL.md              — This file (docs)
warm.py               — Core warming script (Playwright CDP)
state.json            — Per-account phase tracking (auto-created in BRAIN/warming/)
run-warming.sh        — Orchestrator: loops through accounts, opens/closes AdsPower
```

## Phases

| Phase | Days | Browsing | Upvotes | Downvotes | Comments | Comment Style |
|-------|------|----------|---------|-----------|----------|---------------|
| 1 - Silent Observer | 1-3 | 5-10 min | 5-8 | 0 | 0 | — |
| 2 - Lurker | 4-7 | 5-10 min | 8-12 | 1-2 | 1-2 | Ultra-short reactions ("this is great", "needed this") |
| 3 - Light Contributor | 8-11 | 8-12 min | 10-15 | 2-3 | 3-5 | 1-3 sentences, mix top-level + replies |
| 4 - Active Member | 12-14 | 10-15 min | 10-15 | 2-4 | 5-8 | Mix of lengths, at least 1 longer (3+ sentences) |

Day 15+: Account is deployment-ready.

## Usage

### Run warming for all accounts
```bash
bash skills/account-warming/run-warming.sh
```

### Run warming for a single account
```bash
python3 skills/account-warming/warm.py <cdp_url> <username> <phase> [--subreddits "sub1,sub2,sub3"]
```

### Check account status
```bash
cat BRAIN/warming/state.json
```

## State File (BRAIN/warming/state.json)

```json
{
  "accounts": {
    "qwsrbaeoyp": {
      "serial": 34,
      "user_id": "k1bc4rcq",
      "username": "qwsrbaeoyp",
      "start_date": "2026-04-09",
      "current_phase": 1,
      "subreddits": ["AskReddit", "todayilearned", "mildlyinteresting", "Showerthoughts", "LifeProTips"],
      "sessions": [],
      "total_upvotes": 0,
      "total_comments": 0,
      "last_session": null,
      "status": "warming"
    }
  }
}
```

## Safety Rules

- Max 2 accounts active simultaneously
- Stagger sessions 20-30 minutes apart
- Randomize session time ±2 hours from base
- No two accounts interact with the same post
- Weekend sessions lighter (fewer comments)
- If rate-limited or flagged: halt all, report to Paul

## Subreddit Strategy

Phase 1-2: Large default subs (safe, high-traffic, short comments blend in)
- r/AskReddit, r/todayilearned, r/mildlyinteresting, r/Showerthoughts, r/LifeProTips
- r/pics, r/funny, r/gaming, r/movies, r/music

Phase 3-4: Mix of defaults + niche subs relevant to future persona assignment
- Keep 2-3 defaults for variety
- Add 3-5 niche subs matching intended persona topics

## Comment Templates (Phase 2 - Ultra-Short)

These are examples — the script picks randomly and varies:
- "this is great"
- "needed this today"
- "saving this"
- "same here"
- "exactly this"
- "seriously underrated"
- "been looking for this"
- "thanks for sharing"
- "wow didn't know that"
- "this changed my perspective"

## Cron Setup

Run via OpenClaw cron, 2 sessions per day (morning + evening), staggered:
```
# Account 34: 9:00 AM + 7:00 PM PDT
# Account 35: 9:30 AM + 7:30 PM PDT
# Account 36: 10:00 AM + 8:00 PM PDT
# Account 37: 10:30 AM + 8:30 PM PDT
# Account 38: 11:00 AM + 9:00 PM PDT
```

## Shadowban Check

After phase 4, verify each account:
```bash
curl -s "https://www.reddit.com/user/<username>/about.json" -A "Mozilla/5.0"
```
- 200 + JSON = alive
- 404 = shadowbanned
