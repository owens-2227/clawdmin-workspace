# Account Warming Skill v3

Warm purchased Reddit accounts (REDAccs) through AdsPower browser profiles with natural browsing patterns.

## Rebuilt 2026-04-15 — Fresh Start

### What Changed from v2
- **Purchased accounts (REDAccs)** — these come with existing karma history and cookies. Different warm-up approach than brand-new accounts.
- **Slower Phase 1** — REDAccs guide says 8-10 hours browse-only before ANY posting. Our old approach was too aggressive (started commenting at day 4).
- **Keep old posts** — DO NOT delete the account's existing karma posts. Only delete after you have 10-20 new posts of your own.
- **Don't change password for 24h** — per REDAccs guide. Change email password instead if needed. Add 2FA after 24h.
- **Don't change email** — ever. Only update the email password. Changing email is high-risk.
- **No profile images** — skip the SFW image posting step. Keep profiles clean.
- **No external links during warm-up** — NO wabi.ai links, NO any-domain links until Phase 4.
- **No mass upvoting/downvoting** — keep it light and natural, especially in Phase 1-2.
- **US residential proxies** — accounts were created in the US. Decodo city proxies assigned per profile.

### Lessons from Our Shadowban Massacre (April 2026)
- 7 of 12 accounts shadowbanned because:
  1. **Canned comments** — "came here to say this" on random posts = instant death
  2. **Commenting too early** — Phase 1-2 accounts should NEVER comment
  3. **Self-checking shadowbans** — useless. Always check from a different profile.
  4. **Posting on r/test** — triggers spam filters on low-karma accounts
  5. **Same content across subs** — Reddit flags identical titles/images as spam
  6. **External links on new-ish accounts** — spam filters catch promo links instantly
  7. **Coordinated timing** — multiple accounts in same thread = cluster detection

## Current Setup (2026-04-15)

- **22 AdsPower profiles**: reddit-01 through reddit-22
- **Proxies**: city.decodo.com ports 21001-21022 (HTTP, session-duration-60)
- **Domain**: www.reddit.com ONLY — no other tabs
- **Cookies**: Imported from REDAccs spreadsheet (10-13 cookies per account)
- **32 reserve accounts**: accounts 23-54 not yet assigned to profiles

## Files

| File | Purpose |
|------|---------|
| `skills/account-warming/warm.py` | Main warming script — Playwright CDP session |
| `skills/account-warming/run-warming.sh` | Runner — opens AdsPower profiles, runs warm.py per account |
| `skills/account-warming/prepare-comments.py` | Finds commentable posts + fetches context for LLM |
| `BRAIN/warming/state.json` | Account state (phase, sessions, status, shadowban results) |
| `BRAIN/warming/check-shadowbans.py` | Shadowban checker — runs via a different profile |
| `BRAIN/warming/logs/` | Per-session logs |
| `BRAIN/credentials/reddit-accounts-fresh-2026-04-15.json` | Full account data with cookies |
| `BRAIN/rules/anti-detection-commenting.md` | Detection avoidance rules |
| `BRAIN/rules/reddit-fresh-start-playbook.md` | AdsPower guides + algorithm research |

## Warm-Up Phases

| Phase | Timing | Activities | Comments | Links |
|-------|--------|-----------|----------|-------|
| 1 | First 8-10h | Browse ONLY. No upvoting. No joining subs. Just scroll and read. | NONE | NONE |
| 2 | Days 1-3 | Browse, upvote (5-8), save posts, join more subs | NONE | NONE |
| 3 | Days 4-7 | Browse, upvote (8-12) | 2-3 per day — REPLY to existing comments (not top-level) in big subs. LLM-generated. | NONE |
| 4 | Days 8-14 | Diversify into niche subs. 3-5 comments/day. | LLM-generated, context-aware. Add genuine value. | NONE — still no external links |
| 5 | Days 15-30 | Full organic activity. Build to few hundred karma. | 5-8 comments/day across diverse subs. | Internal Reddit links OK. No external links yet. |
| 6 | Day 30+ | Operational. 80/20 rule. | Unlimited (within anti-detection limits) | External links OK — sparingly, naturally |

### Phase Rules (STRICT)
- **Phase 1**: Zero everything. Browse only. No upvotes, no joins, no clicks beyond scrolling.
- **Phase 2**: Browse + light upvoting + join subs. Still zero comments, zero posts.
- **Phase 3**: First comments as REPLIES to existing comments (not top-level) in big subs (r/AskReddit, r/todayilearned, r/pics). Focus on comment karma. Max 2-3 comments/day. No profile images.
- **Phase 4**: Move into more subs. Still no external links. Keep old posts from REDAccs.
- **Phase 5**: Can delete old REDAccs posts ONLY after 10-20 new posts of your own. Still no external links.
- **Phase 6**: Operational. 80% organic, 20% max promotional. External links allowed naturally.

## Phase Advancement
Calculate from `first_login_date` in state.json:
- Hours 0-10: Phase 1
- Days 1-3: Phase 2
- Days 4-7: Phase 3
- Days 8-14: Phase 4
- Days 15-30: Phase 5
- Day 30+: Phase 6

## Reddit's Algorithm (Key Intel)

### Hot Score
```
Hot score = log₁₀(net votes) + (time posted / 45,000)
```
- First 10 upvotes = same impact as next 100 (logarithmic)
- Posts lose 1 ranking point every 12.5 hours
- **First hour decides everything** — posts that sit untouched in New for 15 min rarely recover

### What Makes Votes Count More
- **Account age + karma**: 3-year account with 10K karma > new account
- **IP diversity**: same IP range = discounted/ignored votes
- **Voting patterns**: accounts that only upvote one user get flagged
- **Engagement ratio**: upvotes with zero comments looks unnatural
- **Vote fuzzing**: displayed numbers are scrambled, net score stays accurate

### The Path: survive New → break into Rising → reach Hot

## Cron Agent Protocol

When the warming cron fires:

1. **Read state.json** — check which accounts are active
2. **Run shadowban check** — from a DIFFERENT profile (not the account itself)
   - If any account is newly shadowbanned, alert Paul immediately and STOP that account
3. **Advance phases** — calculate days since `first_login_date`, update `current_phase`
4. **For Phase 3+ accounts: Prepare targeted comments** (3-step process):
   a. Run `prepare-comments.py` to find commentable posts with context
   b. Generate context-aware comments via LLM (1-3 sentences, genuine value)
   c. Run through Reddit Comment Humanizer checklist
   d. **Skip sensitive posts** — grief, loss, crisis, mental health emergencies
   e. Save plan as JSON → pass to warm.py
5. **Run warming sessions** — stagger 20-30 min apart per account
6. **Review results** — check for CAPTCHAs, errors, removed comments
7. **Report to Paul** — summary with per-account status

## Anti-Detection Rules (MUST FOLLOW)

### Language & Content
- Reference specific details from the post — names, numbers, context
- No promotional language: "highly recommend", "game changer", "you need this"
- Vary sentence structure across comments — no templates
- Match the sub's tone (r/gardening = warm, r/ADHD = vulnerable, r/DIY = blunt)
- Add substance: specific experience, data point, counter-perspective, or question

### Behavioral Patterns
- Max 3 comments per session, spread over 15-30 minutes
- Vary comment length: mix one-liners (20-40 chars) with medium (100-200) and long (300+)
- Every session: upvote 5-10 posts AND browse without engaging
- Reply to replies 30%+ of the time — thread depth avoidance is a bot signal
- Only during waking hours for a US timezone
- No more than 2 accounts in same subreddit simultaneously

### Account Health
- Build organic history FIRST — diverse subreddit participation before any promo
- Keep removal rate low — fewer quality comments > many filtered ones
- Never coordinate timing — if account A comments, no other account touches that thread for 2+ hours
- Vary subs — sprinkle casual comments in popular subs for natural diversity
- Check for shadow-filtering periodically from a different profile

### Network Graph
- Accounts NEVER interact with each other — no upvoting, replying, same threads
- Stagger campaign posts by DAYS, not hours
- Different entry points — browse feed, search, not all via direct URL

## Commenting Safety Rules (Phase 3+)

- NEVER use canned/template comments
- ALWAYS read the post title + body + top comments before generating a reply
- Skip posts that are: pure images/videos with no discussion, memes, fewer than 5 comments
- **Always reply to an existing comment, not top-level** — find a comment you can meaningfully add to and reply to THAT. Top-level comments on big posts are more visible and more scrutinized. Nested replies look natural.
- Skip grief/loss/crisis posts — tone-deaf and suspicious on a warming account
- Generated comments: 1-3 sentences, relevant to the specific post
- Don't start every comment with "I" — vary sentence starters
- Don't comment more than once per subreddit per session
- Cool down 30-60 seconds between actions
- If CAPTCHA appears, abort the entire session immediately
- Never post the same content/title across different subreddits

## Humanizer Checklist (EVERY comment)

1. No em dashes — replace with commas, periods, or "and"
2. No formal openers — "Interesting that", "It's worth noting" are AI tells
3. Casual structure — fragments OK, starting with "But" or "Yeah" is fine
4. First-person vulnerability — "that'd bug me", "still not great at it"
5. Reference something specific from the post/comments
6. No blog-post voice — if it sounds like Medium, rewrite it
7. No puffery — "genuinely impressive", "incredibly powerful" = dead giveaways
8. No curly quotes — straight quotes only
9. Read it out loud — would a real person type this in a Reddit comment box?

Full reference: `skills/reddit-comment-humanizer/SKILL.md`

## State.json Schema

```json
{
  "accounts": {
    "reddit-01": {
      "profile_num": 1,
      "user_id": "k1bjmrjf",
      "reddit_username": "Suasan-Vyse",
      "proxy_port": 21001,
      "first_login_date": null,
      "current_phase": 0,
      "subreddits_joined": [],
      "sessions": [],
      "total_upvotes": 0,
      "total_comments": 0,
      "total_posts": 0,
      "own_posts_count": 0,
      "last_session": null,
      "status": "ready",
      "last_shadowban_check": null,
      "last_shadowban_result": null,
      "captcha_count": 0,
      "password_changed": false,
      "twofa_enabled": false,
      "notes": ""
    }
  }
}
```

Status values: `ready` | `warming` | `operational` | `shadowbanned` | `suspended` | `retired`

## REDAccs-Specific Rules

1. **Don't change password** for 24 hours after first login
2. **Don't change email** — only update email password. Add 2FA after 24h.
3. **Keep old posts** from REDAccs — delete only after 10-20 new posts of your own
4. **48-hour guarantee** — report login issues to REDAccs within 48h of delivery
5. **No VPNs** — use residential proxies only (VPNs are usually blacklisted)
6. **US IPs required** — accounts were created/used in the US
7. **No profile images** — keep profiles clean, don't post images to profile
8. **No redgifs or link-hosting platforms** for warm-up content — post directly to subreddits

---

*Last updated: 2026-04-15*
*Sources: AdsPower guides, REDAccs how-to-use, REDAccs ranking algorithm, our own shadowban post-mortem*
