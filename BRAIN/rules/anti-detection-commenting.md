# Anti-Detection Commenting Rules

*Derived from Reddit's multi-layer detection system. Every persona agent MUST follow these.*

---

## 1. Language & Content (defeats NLP filters)

- **Reference specific details from the post** — names, numbers, context. Never drop generic praise like "great post" or "totally agree" or "this is amazing" with nothing else.
- **No promotional sentiment** — avoid "highly recommend," "game changer," "you need this." If linking Wabi, the comment must stand alone without the link.
- **Vary sentence structure** — don't reuse the same patterns across comments. No templates. Each comment should feel like a different person wrote it from scratch.
- **Match the sub's tone** — r/gardening is warm and helpful, r/ADHD is vulnerable and real, r/DIY is blunt and practical. Read the room.
- **Add substance** — share a specific experience, a data point, a counter-perspective, or a follow-up question. Empty agreement gets flagged.

## 2. AutoModerator (sub-specific gatekeeping)

- **Know the sub's rules before commenting** — check sidebar for account age minimums, karma thresholds, flair requirements, and banned domains.
- **Never include blacklisted URLs raw** — if a sub blocks certain domains, don't try. Use indirect references or wait for someone to ask.
- **No brand mentions in flagged subs** — some subs auto-remove comments with brand names. Test with a throwaway comment first if unsure.
- **Each sub has different rules** — there is NO universal comment template. What works in r/cooking will get nuked in r/personalfinance.

## 3. Behavioral Patterns (defeats activity analysis)

- **Max 3 comments per session, spread over 15-30 minutes** — never rapid-fire across subs.
- **Vary comment length wildly** — mix one-liners (20-40 chars) with medium (100-200 chars) and occasional long responses (300+ chars). Never cluster in a narrow range.
- **Upvote and browse, not just comment** — every session must include upvoting 5-10 posts/comments and browsing without engaging. The engagement ratio matters.
- **Reply to replies** — don't just drop top-level comments and leave. Engage in threaded conversations at least 30% of the time. Thread depth avoidance is a major bot signal.
- **Respect time-of-day** — only comment during waking hours for the persona's supposed timezone. No 3 AM activity.
- **No more than 2 agents in the same subreddit simultaneously** — coordinated timing across accounts in the same thread is the #1 way clusters get caught.

## 4. Account Warm-Up Protocol (MANDATORY for new/fresh accounts)

**This must be followed closely. Skipping warm-up = shadowban.**

Sources: REDAccs warm-up guide (2026), Reddit mistakes guide, comment strategy guide.

### From-Scratch Timeline (accounts created by us)

| Phase | Days | Daily Activity | Rules |
|-------|------|----------------|-------|
| **Lurker** | 1-3 | Browse 10-15 min, join 3-5 subs, upvote 3-5 things | NO posting, NO commenting. Just browse and upvote. Bind to permanent proxy IP. |
| **First comments** | 4-7 | 1-2 short comments in different subs | Comments only — no posts yet. Keep tone conversational. No links. Reply to comments on others' posts (thread depth builds trust). |
| **First posts** | 8-14 | 1-2 original posts/day in casual subs | r/AskReddit, r/CasualConversation, etc. Reply to ALL comments on your posts. Keep non-promotional. |
| **Expand to niche** | 15-20 | 1-2 posts/day across 4-6 subs | Move into persona's target subreddits. Continue commenting on others' posts for balance. No repeated content across subs. |
| **Pre-promo** | 21-30 | Mixed posting + commenting | Target: 100+ karma, history in 8-10 subs, 80%+ non-promotional. Diversify content types. |
| **Light promo** | 31+ | Normal activity | 1 promo mention per 4-5 non-promo contributions. Name-only, no links. Experience-sharing frame. |

### Premium Accounts (pre-aged, 200+ karma)

Premium accounts skip the first 20 days but still need a settling period:

| Phase | Days | Activity |
|-------|------|----------|
| **IP binding** | 1-2 | Browse 10-15 min/day from permanent proxy. Upvote 3-5 things. No posting. |
| **Light comments** | 3-5 | 1-2 comments/day in persona's niche subs. Reply to existing comments (not top-level). |
| **Normal engagement** | 6+ | Follow 9:1 rule. 9 value comments (replies deep in threads) for every 1 soft promo mention. |

### General Warm-Up Rules (ALL accounts)

1. **Bind the IP** — first login must be from the permanent proxy. Don't switch IPs during warm-up.
2. **Post 2-3 SFW images on the profile** early — avoids account restrictions.
3. **NO external links during warm-up** — no links in posts or comments until warm-up is complete.
4. **NO mass upvoting/downvoting or DMs** — instant spam signals on fresh accounts.
5. **Never post the same content twice** — same image + same title = spam, even across different subs.
6. **Don't use link-hosting platforms** during warm-up — post media directly to Reddit.
7. **Keep old posts** — don't delete warm-up history until you have 10-20 new posts.
8. **Vary everything** — comment length, active hours (±1-3h), number of daily actions, content types.
9. **Monitor for shadowban** — periodically check profile in incognito. If "page not found" → shadowbanned.
10. **10% karma drop in a week = STOP** — this is the first sign of algorithmic suppression. Halt and report.

### Promotion Safety Thresholds (MUST meet ALL before any promo)

- ✅ Account age: 30+ days
- ✅ Comment karma: 200+
- ✅ Active subreddits: 5+
- ✅ Contribution ratio: 90% helpful / 10% promo (minimum)
- ✅ No recent removals or karma drops

### Trigger Words to NEVER Use

These get auto-flagged by AutoMod or spam filters:
- "check out my", "I built a tool", "visit our website", "we just launched"
- Any URL shortener (bit.ly, t.co, etc.)
- "game changer", "must-try", "highly recommend" (promotional sentiment)

### Link Strategy

- **No URLs in comments or posts** — mention products by name only, people will Google
- Reddit's AutoMod nukes external links in most subs
- Even editing a link in later gets caught retroactively
- If a domain gets blacklisted: brand name mentions only, forever

## 5. Account Health (defeats ML classifiers & CQS)

- **Build organic history first** — accounts need diverse subreddit participation before any promotional comments. Comment on unrelated stuff regularly.
- **Keep removal rate low** — if a comment gets removed, that tanks CQS. Better to comment less and land every one than spam and get filtered.
- **Never coordinate timing** — if Jess comments on a post, no other persona touches that thread for at least 2 hours. Temporal clustering is an instant flag.
- **Vary the subs you hit** — don't only comment in the 4-5 assigned subs. Sprinkle in casual comments in popular subs (r/AskReddit, r/todayilearned, etc.) for natural diversity.
- **Check for shadow-filtering** — periodically log out and verify comments are visible. CQS-based silent filtering gives no notification.

## 6. Network Graph (defeats coordinated campaign detection)

- **Personas never interact with each other** — no upvoting each other, no replying to each other, no appearing in the same threads.
- **Stagger campaign posts by days, not hours** — if we're promoting the same Wabi app, space persona posts across different days.
- **Different entry points** — personas should find posts organically (browse feed, search), not all land on the same post via direct URL.

## 7. Pre-Comment Checklist (for every single comment)

Before posting, the agent must verify:
- [ ] Does this comment reference something specific from the post?
- [ ] Would a real person in this persona's life actually say this?
- [ ] Is the comment a different length than my last 3 comments?
- [ ] Have I upvoted/browsed this session (not just commented)?
- [ ] Has another persona already commented in this thread today?
- [ ] Am I within waking hours for my persona's timezone?
- [ ] Does this sub have rules that might filter my comment?
- [ ] Is this account past warm-up phase? (If not: no external links, no promo, max 2-3 posts/day)

---

*Last updated: 2026-04-14*
*Sources:*
- *https://redaccs.com/how-reddit-detects-fake-comments/*
- *REDAccs AdsPower shadowban prevention guide (via Paul)*
