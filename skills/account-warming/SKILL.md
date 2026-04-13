# Account Warming Skill v2

Warm new Reddit accounts through AdsPower browser profiles with natural browsing patterns.

## Rebuilt 2026-04-13 — 7-Point Plan

### Key Changes from v1
1. **Shadowban check via DIFFERENT profile** — uses Jess's AdsPower profile to hit `/user/{username}/about.json`. Self-checks from the account's own IP are unreliable.
2. **NO comments in Phase 1-2** — browse + upvote only. No risk on fresh accounts.
3. **Context-aware comments in Phase 3+** — LLM-generated based on post content. No canned templates.
4. **Post filtering** — skip video/image-only posts. Minimum engagement threshold before commenting.
5. **Honest status reporting** — non-200 = ⚠️ unknown, not ✅ clean. Only definitive 404 = shadowbanned.
6. **All canned comment templates DELETED** — no more ULTRA_SHORT_COMMENTS or MEDIUM_COMMENT_TEMPLATES.
7. **CAPTCHA detection + graceful exit** — detects captcha/block pages and aborts cleanly instead of hanging.

## Files

| File | Purpose |
|------|---------|
| `skills/account-warming/warm.py` | Main warming script — Playwright CDP session |
| `skills/account-warming/run-warming.sh` | Runner — opens AdsPower profiles, runs warm.py per account |
| `skills/account-warming/prepare-comments.py` | Finds commentable posts + fetches context for LLM |
| `BRAIN/warming/state.json` | Account state (phase, sessions, status, shadowban results) |
| `BRAIN/warming/check-shadowbans.py` | Shadowban checker — runs via Jess's profile |
| `BRAIN/warming/logs/` | Per-session logs |

## Phases

| Phase | Days | Activities | Comments |
|-------|------|-----------|----------|
| 1 | 1-3 | Browse, upvote (5-8), join subs | None |
| 2 | 4-7 | Browse, upvote (8-12), save | None |
| 3 | 8-14 | Browse, upvote (10-15), save | 2-4 LLM-generated, on posts with 10+ score |
| 4 | 15+ | Full activity | 4-7 LLM-generated, on posts with 5+ score |

## Phase Advancement
The cron agent should advance phases based on day count:
- Days 1-3: Phase 1
- Days 4-7: Phase 2
- Days 8-14: Phase 3
- Days 15+: Phase 4

Update `current_phase` in state.json accordingly.

## Cron Agent Protocol

When the warming cron fires, the agent should:

1. **Read state.json** — check which accounts are active (`status: "warming"`)
2. **Run shadowban check** — `python3 BRAIN/warming/check-shadowbans.py`
   - Opens Jess's profile, checks each warming account, updates state.json
   - If any account is newly shadowbanned, alert Paul immediately
3. **Advance phases** — calculate days since `start_date`, update `current_phase`
4. **For Phase 3+ accounts: Prepare targeted comments** (3-step process):
   a. Run `python3 skills/account-warming/prepare-comments.py --subreddits "sub1,sub2,..." --count 6`
      → outputs JSON array of commentable posts with full context (title, body, top comments)
   b. For each post in the output, generate ONE context-aware comment using your LLM:
      - Read the post title + body + existing top comments
      - Write 1-3 sentences that add genuine value
      - Vary tone per subreddit (casual for memes, thoughtful for advice)
      - NEVER use generic phrases ("this is great", "came here to say this", etc.)
   c. Save the plan as JSON file: `[{"post_url": "...", "comment": "..."}]`
      → Pass to warm.py via `--comment-plan /path/to/plan.json`
5. **Run warming** — `bash skills/account-warming/run-warming.sh --timeout 300`
6. **Review results** — check session log for failures, CAPTCHAs, errors
7. **Report to Paul** — summary with per-account results

### Comment Flow Diagram
```
prepare-comments.py          Cron Agent (LLM)              warm.py
─────────────────           ──────────────────            ─────────
Fetch subreddit posts  →    Read post context       →    Navigate to URL
Filter: text, score,        Generate 1-3 sentence        Post pre-written comment
  comments, not meta        comment per post              Cool-down 30-60s
Fetch top comments     →    Save as plan.json       →    Reject if generic (safety net)
Output JSON to stdout       (no canned templates!)       Report success/failure
```

## State.json Schema

```json
{
  "accounts": {
    "username": {
      "serial": 34,
      "user_id": "k1bc4rcq",        // AdsPower profile ID
      "username": "qwsrbaeoyp",
      "start_date": "2026-04-09",
      "current_phase": 2,
      "subreddits": ["AskReddit", "cats", ...],
      "sessions": [...],
      "total_upvotes": 57,
      "total_comments": 4,
      "last_session": "2026-04-12T19:06:07",
      "status": "warming",           // warming | shadowbanned | suspended | retired
      "last_shadowban_check": "...", 
      "last_shadowban_result": "clean",
      "captcha_count": 0,
      "needs_ip_rotation": false
    }
  }
}
```

## Current Accounts (as of 2026-04-13)

| Username | Serial | Profile ID | Status | Phase | Karma |
|----------|--------|-----------|--------|-------|-------|
| qwsrbaeoyp | 34 | k1bc4rcq | ✅ warming | 2 | 2 |
| ndbmzlayar | 35 | k1bc55n0 | ✅ warming | 2 | 1 |
| lhdqpdftdt | 36 | k1bc5662 | ❌ shadowbanned | — | — |
| vglmtlyrdm | 37 | k1bc56nd | ✅ warming | 1 | 1 |
| cuvuvcljco | 38 | k1bc5757 | ❌ shadowbanned | — | — |

## Commenting Safety Rules (Phase 3+)

- NEVER use canned/template comments
- ALWAYS read the post title + body + top comments before generating a reply
- Skip posts that are: pure images/videos, memes with no text, fewer than 5 comments
- Generated comments must be 1-3 sentences, relevant to the specific post
- Don't start every comment with "I" — vary sentence starters
- Don't comment more than once per subreddit per session
- Cool down 5-10 seconds after each comment
- If CAPTCHA appears at any point, abort the entire session immediately
