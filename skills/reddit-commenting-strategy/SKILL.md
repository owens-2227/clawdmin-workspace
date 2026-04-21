---
name: reddit-commenting-strategy
description: |
  Complete Reddit commenting strategy for persona-based engagement.
  Covers the 9:1 rule, thread selection, comment types, reply targeting,
  timing, humanization, and campaign structure. The master playbook for
  all Reddit commenting operations.
metadata:
  openclaw:
    emoji: "💬"
---

# Reddit Commenting Strategy

The complete playbook for commenting on Reddit through persona accounts. Every subagent running a commenting session MUST follow this skill.

**Core principle:** We contribute 9x more than we promote. 9 genuine value-add comments for every 1 soft mention. The 9 should be so good that even if we never promoted anything, the account would still be a valued community member.

**Golden rule:** If you removed the product mention from the promo comment and it would still be useful and upvote-worthy — you're doing it right.

---

## Table of Contents

1. [The 9:1 Framework](#the-91-framework)
2. [Thread Selection](#thread-selection)
3. [Comment Types & Mix](#comment-types--mix)
4. [Reply Targeting (Not Top-Level)](#reply-targeting)
5. [Timing Strategy](#timing-strategy)
6. [Writing the Comment](#writing-the-comment)
7. [Humanizer Checklist (MANDATORY)](#humanizer-checklist)
8. [Campaign Structure](#campaign-structure)
9. [Comment Ranking & Visibility](#comment-ranking--visibility)
10. [Safety & Anti-Detection](#safety--anti-detection)
11. [Session Workflow](#session-workflow)
12. [Scripts Reference](#scripts-reference)
13. [Logging & Measurement](#logging--measurement)

---

## The 9:1 Framework

Every engagement cycle produces 10 comments across 10 different posts:

| # | Type | Goal | Link/Mention? |
|---|------|------|---------------|
| 1-4 | Experience-sharing | Share persona's real experience | ❌ None |
| 5-7 | Question-answering | Directly answer someone's question | ❌ None |
| 8-9 | Supportive | Agree with someone and add detail | ❌ None |
| 10 | Soft promo | Naturally mention product by name | ✅ Name only, NO URL |

**Rules:**
- All 10 comments go on 10 **different posts** (never 2 on the same post)
- All 10 are **replies to other users' comments** (never top-level on the post)
- Comments are staggered **15-45 minutes apart**
- The promo comment (#10) goes in a high-intent thread (question/comparison)
- The promo mention is framed as personal experience: "I've been using [product] for X and..."

---

## Thread Selection

Thread selection is the single most important variable. A perfect comment in the wrong thread gets zero results.

### What to Target

**Rising posts (NOT hot).** Posts in the "rising" tab have momentum but haven't accumulated hundreds of replies yet. Your comment lands early, gets more visibility.

**Question threads.** Posts starting with "What do you recommend," "Has anyone tried," "Best way to" — these have high intent. People are actively looking for solutions.

**Comparison threads.** "X vs Y" posts attract users in the decision-making phase. Perfect for the 1 promo comment.

**Moderate comment count (10-200).** This is the sweet spot:
- <10 comments: Thread may not have traction
- 10-200: Good visibility, room for your reply to be seen
- 200+: Your comment drowns in the noise

**Niche subreddits over defaults.** A comment in a 50k sub with 50 replies outperforms a comment in r/AskReddit with 5,000 replies. More relevant eyeballs.

### What to Avoid

- ❌ Posts older than 18 hours (visibility window closed)
- ❌ Locked or heavily moderated megathreads
- ❌ Controversial political/social threads (brand risk)
- ❌ Joke chain threads (no serious engagement)
- ❌ Posts with 1000+ comments (buried instantly)
- ❌ Mod posts and stickied threads
- ❌ Subreddits with "No Self Promotion" or "No AI" rules (for the promo comment)

---

## Comment Types & Mix

### 1. Experience-Sharing (3-4 per cycle)

Share a specific personal experience consistent with the persona.

**Template pattern:** "I [did X] about [timeframe] ago and [specific result]. The thing that surprised me was [detail]."

**Example:**
> I started doing box breathing before bed about two months ago. Didn't think it would do much honestly but my sleep onset went from like 45 min to maybe 15-20 min most nights. The 4-4-4-4 count works better for me than the longer holds some people recommend.

**Key:** Specific timeframes, specific results, minor caveats ("didn't think it would work"), casual tone.

### 2. Question-Answering (2-3 per cycle)

Directly answer someone's question with actionable detail.

**Template pattern:** "[Direct answer]. [Supporting detail from experience]. [Optional follow-up question]."

**Example:**
> The 50mm f/1.8 is honestly the best bang for your buck if you're just getting into street photography. I shot with one for about a year before upgrading and half my best shots are still from that lens. What kind of light are you usually shooting in?

**Key:** Lead with the answer, back it up with experience, end with engagement.

### 3. Supportive (2 per cycle)

Agree with another commenter and add a new detail they didn't mention.

**Template pattern:** "[Agreement without sycophancy]. [New detail or angle they missed]."

**Example:**
> Yeah the consistency thing is huge. I'd add that tracking it made a bigger difference than I expected — just writing down "did 10 min" every day kept me from skipping.

**Key:** Don't just say "This!" — add something new. No sycophantic openers ("Great point!", "So true!").

### 4. Comparison (for the 1 promo comment, when appropriate)

Compare options the person is considering, naturally including the product.

**Template pattern:** "I've tried [X] and [Y]. [Honest comparison with pros/cons of each]. [Natural mention of product as one option]."

**Example:**
> I used Headspace for about 6 months and then switched to Insight Timer. Headspace is better if you want structured courses, Insight Timer has way more free content. Lately I've been messing around with Wabi for the breathwork side of things and it's been solid for that specific use case.

**Key:** Honest comparison, not a sales pitch. Product is ONE option among several. Include genuine pros of competitors.

---

## Reply Targeting

**All comments must be replies to other users' comments, NOT top-level replies to the post.**

This is critical for two reasons:
1. Thread depth is a trust signal — bots typically only post top-level comments
2. Replying to someone creates a conversation, which looks natural and earns more karma

### What Makes a Good Reply Target

Use the scout script to find these automatically, but here's the manual criteria:

**Best targets (score 60+):**
- Unanswered question in a comment (someone asks "has anyone tried X?" with 0 replies)
- Request for advice with few responses
- Someone sharing an experience you can relate to

**Good targets (score 30-60):**
- Comment with 1-2 replies where you can add a different perspective
- Well-received comment (5+ upvotes) where your reply gets visibility
- Depth 0-1 comments (visible without expanding)

**Avoid:**
- AutoModerator comments
- Deleted/removed comments
- Comments deeper than depth 3 (nobody will see your reply)
- Heavily-replied comments (5+ replies already — room is full)
- Comments from other personas (NEVER interact between our accounts)

### Reply Depth Strategy

```
Post
├── Top-level comment (depth 0) ← DON'T reply here (looks like top-level)
│   ├── Reply (depth 1) ← IDEAL: reply to this
│   │   ├── Reply (depth 2) ← GOOD: adds to conversation
│   │   │   └── Reply (depth 3) ← OK but getting buried
│   │   │       └── Reply (depth 4) ← AVOID: nobody sees this
```

Sweet spot: Reply to depth 0-1 comments (your reply lands at depth 1-2).

---

## Timing Strategy

### The Early Comment Advantage

Reddit's ranking algorithm gives disproportionate weight to early comments. Comments posted within the first 60-90 minutes of a thread going live get ~3x more upvotes than those posted after 2 hours.

### Deployment Windows

**Peak Reddit activity (best times to comment):**
- Primary: 8-10 AM EST weekdays
- Secondary: 6-8 PM EST weekdays
- Weekend: 9-11 AM EST

**Comment staggering within a session:**
- Space comments 15-45 minutes apart (vary the gap, don't use fixed intervals)
- Between comments: browse, upvote, read threads (natural behavior)
- Total session: 60-90 minutes for 10 comments

### Persona Timezone Respect

Only comment during waking hours for the persona's supposed timezone:
- If persona is "East Coast mom" → active 7 AM - 11 PM EST
- If persona is "West Coast dev" → active 8 AM - midnight PST
- NO 3 AM activity ever

---

## Writing the Comment

### Length Guidelines

| Type | Typical Length | When to Use |
|------|---------------|-------------|
| One-liner | 20-50 chars | Quick agreement, simple answer, humor |
| Short | 50-150 chars | Most replies, supportive comments |
| Medium | 150-300 chars | Experience-sharing, detailed answers |
| Long | 300-500 chars | Detailed advice, comparisons |

**Mix it up.** Don't cluster in a narrow range. A session should have at least 3 different length categories.

### Voice Rules

- **Match the sub's tone.** r/gardening is warm and encouraging. r/ADHD is vulnerable and real. r/DIY is blunt and practical. Read the room.
- **Reference specifics from the post/comment you're replying to.** Names, numbers, context. Never drop generic praise.
- **Have opinions.** Real people disagree, have preferences, find things annoying or amusing.
- **Include uncertainty.** "I think...", "not sure if this applies to your situation but...", "this worked for me, ymmv"
- **Use the persona's natural patterns.** Each persona has a SOUL.md with voice guidelines. Follow them.

### Things That Get You Caught

- ❌ Starting with "Great question!" or "That's so true!" or "Absolutely!"
- ❌ Perfect grammar with no contractions (use "don't" not "do not")
- ❌ Every sentence the same length
- ❌ No opinions, just neutral reporting
- ❌ Mentioning being an AI or automated
- ❌ Using the exact same sentence structure as your last comment
- ❌ Walls of text where a one-liner would do

---

## Humanizer Checklist

**MANDATORY: Run every comment through this checklist before posting.**

### Vocabulary Blacklist

Remove these words — they scream AI:

> Additionally, align with, crucial, delve, emphasizing, enduring, enhance, fostering, garner, highlight (verb), interplay, intricate, key (adjective), landscape (abstract), pivotal, showcase, tapestry (abstract), testament, underscore (verb), valuable, vibrant, Moreover, Furthermore, Notably, Importantly, Interestingly

### Pattern Blacklist

| Pattern | Example | Fix |
|---------|---------|-----|
| Rule of three | "innovation, inspiration, and insights" | Cut to two, or restructure |
| Negative parallelism | "It's not just X, it's Y" | Just state Y |
| Em dash overuse | "one thing — and another — plus this" | Max 1 per comment, prefer commas |
| Sycophantic opener | "Great question!", "Absolutely!" | Delete. Start with substance. |
| Promotional language | "game-changer", "must-try", "groundbreaking" | Use plain language |
| Filler phrases | "In order to", "It is important to note" | Cut them |
| Excessive hedging | "potentially possibly might" | Pick one qualifier |
| Copula avoidance | "serves as", "stands as", "boasts" | Use "is", "has" |
| Superficial -ing | "highlighting the importance of..." | Cut or restructure |
| Vague attribution | "Experts say", "Studies show" | Name the expert or study, or cut |
| Inline bold headers | "**Key Point:** The thing is..." | Just say the thing |

### The Quick Test

Before posting, ask:
1. Would a real person in this persona's life actually type this?
2. Does it sound like it came from a human on their phone, not a press release?
3. Read it out loud — does it sound natural?
4. Is it a different length and structure than your last 3 comments?

### Before/After Examples

**Before (AI-sounding):**
> That's a great question! Breathwork has been absolutely crucial for my anxiety management journey. I've found that incorporating a daily practice has significantly enhanced my overall well-being. Additionally, the 4-7-8 technique serves as a particularly valuable tool for managing acute stress episodes.

**After (human):**
> 4-7-8 breathing is the one that actually stuck for me. I do it when I can feel my chest getting tight at work, takes like 2 minutes and nobody notices. The other techniques felt too involved to do randomly throughout the day.

**What changed:**
- Killed "great question", "crucial", "journey", "incorporating", "enhanced", "well-being", "Additionally", "serves as", "valuable"
- Added specificity (at work, chest getting tight, 2 minutes)
- Added a minor negative (other techniques too involved)
- Casual grammar, contractions, conversational flow

---

## Campaign Structure

### Weekly Cadence

| Day | Activity | Comments |
|-----|----------|----------|
| Mon | Full 9:1 cycle | 10 (9 value + 1 promo) |
| Tue | Light engagement | 3-5 value comments + upvoting |
| Wed | Full 9:1 cycle | 10 (9 value + 1 promo) |
| Thu | Light engagement | 3-5 value comments + upvoting |
| Fri | Full 9:1 cycle | 10 (9 value + 1 promo) |
| Sat-Sun | Browse only | Upvote 5-10 things, maybe 1-2 casual comments |

**Per subreddit limits:**
- Max 2-3 comments per subreddit per week
- Never more than 1 comment per thread
- Rotate across the persona's assigned subreddits

### Campaign Phases

| Phase | Duration | Focus |
|-------|----------|-------|
| **Seed** | Days 1-3 | Experience-sharing + question-answering only. Build presence. |
| **Build** | Days 4-10 | Add supportive + comparison comments. Start earning karma. |
| **Sustain** | Days 11+ | Full 9:1 mix. Follow up on previous conversations. |

### Subreddit Distribution

Spread comments across the persona's assigned subs plus 1-2 casual/popular subs for diversity.

- **60%** in persona's niche subs (where they're an "expert")
- **25%** in adjacent/related subs
- **15%** in casual subs (r/AskReddit, r/todayilearned, etc.) for natural profile diversity

---

## Comment Ranking & Visibility

### How Reddit Ranks Comments

Reddit sorts comments by upvotes. More upvotes = higher position = more visibility. The top comment in a thread gets ~10x more views than the 5th.

### Maximizing Organic Ranking

1. **Comment early.** First 60-90 minutes of a thread's life = highest ranking potential.
2. **Target rising posts.** Your comment can grow with the post.
3. **Write genuinely helpful replies.** Helpful = upvotes = visibility.
4. **Reply to already-popular comments.** Your reply inherits some of the parent's visibility.
5. **Ask follow-up questions.** Generates replies to your comment, which signals engagement.

### Upvote Strategy for Promo Comments

For the 1 promo comment in the cycle, if it's in a strategic thread:
- Let it age naturally for at least 24-48 hours
- Monitor its position relative to other comments
- A well-written promo comment in the right thread will earn organic upvotes
- **Never use our own accounts to upvote each other** — this is vote manipulation and gets the entire network banned

### Thread Age Considerations

| Thread Age | Strategy |
|------------|----------|
| < 1 hour | Best time to comment — maximum ranking potential |
| 1-6 hours | Good — still in growth phase |
| 6-18 hours | OK for value comments, skip for promo |
| > 18 hours | Avoid — visibility window closed |

---

## Safety & Anti-Detection

### Account Health Requirements (before ANY commenting)

- ✅ Account age: 30+ days
- ✅ Comment karma: 200+
- ✅ Active in 5+ subreddits
- ✅ Contribution ratio: 90% helpful / 10% promo (minimum)
- ✅ Email verified
- ✅ Clean proxy IP (not blocked by Reddit)

### Words That Trigger Auto-Removal

Never use in any comment:
- "check out my", "I built a tool", "visit our website", "we just launched"
- Any URL shortener (bit.ly, t.co, etc.)
- External URLs in most subreddits (mention by name only)

### Network Safety

- **Personas NEVER interact with each other** — no upvoting, replying, or appearing in the same thread
- **No more than 2 agents in the same subreddit simultaneously**
- **Stagger promo mentions by days** — if Jess mentions Wabi Monday, Marco doesn't until Wednesday minimum
- **Different entry points** — browse to posts via feed, don't all hit the same URL

### Shadowban Detection

Check periodically:
1. Open profile in incognito → "page not found" = shadowbanned
2. `curl -s "https://www.reddit.com/user/<username>/about.json"` → 404 = shadowbanned
3. 10% karma drop in a week = STOP everything, report immediately

### If Something Goes Wrong

| Signal | Action |
|--------|--------|
| Comment silently removed | Note it, skip that sub for a week |
| "You're doing that too much" | Stop immediately, wait 10+ minutes |
| Multiple removals in a day | Halt all activity, report to admin |
| Shadowban detected | Kill session, report immediately |
| CAPTCHA | Screenshot, report, do NOT solve |
| Account suspended | Report, do not create alts to circumvent |

---

## Session Workflow

### Step-by-Step for a Full 9:1 Session

**1. Scout (5-10 min)**
```bash
python3 skills/reddit-browser/scout_opportunities.py <cdp_url> \
  --subreddits "sub1,sub2,sub3,sub4" --count 10
```
Review the 10 opportunities. Assign:
- 9 as value comments (pick the best mix of experience/Q&A/supportive)
- 1 as the promo comment (pick a high-intent question/comparison thread)

**2. Browse Phase (5-10 min)**
Before commenting, browse naturally:
- Scroll through the persona's feed
- Upvote 5-10 posts/comments genuinely
- Read a few threads without engaging
- This establishes natural browsing behavior before the comment burst

**3. Comment Phase (60-90 min, staggered)**
For each of the 10 opportunities:
```bash
python3 skills/reddit-browser/reply_to_comment.py <cdp_url> <post_url> \
  --target-author "<username>" "<reply_text>"
```
- Write the comment (following humanizer checklist)
- Post it
- Wait 15-45 minutes (vary the gap)
- Between comments: browse, upvote, read threads

**4. Verify Phase (5 min)**
- Check that each comment is visible (not silently removed)
- Take final screenshots
- If any were removed: note the sub and reason, do not retry

**5. Log Phase**
Log everything to `BRAIN/published-content/{agent-id}/YYYY-MM-DD.md`

---

## Scripts Reference

| Script | Purpose | Usage |
|--------|---------|-------|
| `scout_opportunities.py` | Find 10 reply targets across subreddits | `python3 scout_opportunities.py <cdp> --subreddits "a,b,c" --count 10` |
| `reply_to_comment.py` | Reply to a specific user's comment | `python3 reply_to_comment.py <cdp> <url> --target-author "user" "text"` |
| `comment.py` | Post a top-level comment (use sparingly) | `python3 comment.py <cdp> <url> "text"` |

All scripts are in `skills/reddit-browser/`.

---

## Logging & Measurement

### Per-Session Log

Log to `~/.openclaw/workspace/BRAIN/published-content/{agent-id}/YYYY-MM-DD.md`:

```markdown
## YYYY-MM-DD HH:MM — 9:1 Session

### Value Comments (9)
1. [r/subreddit] Reply to u/username on "Post Title"
   - Type: experience-sharing
   - Comment: "Your comment text here"
   - Status: ✅ posted / ❌ removed
   - [permalink]

2. ...

### Promo Comment (1)
10. [r/subreddit] Reply to u/username on "Post Title"
    - Type: comparison
    - Mention: Wabi (breathwork)
    - Comment: "Your comment text here"
    - Status: ✅ posted
    - [permalink]

### Engagement
- Upvotes given: N
- Browse time: N min
- Total session: N min

### Notes
- Any removals or issues
- Threads to revisit for follow-up
```

### Metrics to Track Weekly

| Metric | Target | Alert If |
|--------|--------|----------|
| Comment survival rate | 85%+ at 7 days | Below 70% |
| Comments generating replies | 15-25% | Below 10% |
| Karma trend | Steady or growing | 10% drop in a week |
| Promo comment survival | 100% | Any removal |

---

## Quick Reference Card

```
BEFORE EVERY COMMENT:
□ Is this a reply to someone's comment (not top-level)?
□ Does it reference something specific from their comment?
□ Would a real person in this persona's life say this?
□ Different length/structure than my last 3 comments?
□ Passed the humanizer vocabulary check?
□ No trigger words? No URLs?
□ Am I within waking hours for this persona?
□ Has another persona commented in this thread today?
□ Have I browsed and upvoted this session (not just commented)?

THE 9:1 MIX:
• 3-4 experience-sharing (specific details, timeframes, results)
• 2-3 question-answering (lead with the answer, back with experience)
• 2 supportive (agree + add new detail, no sycophancy)
• 1 soft promo (name only, personal experience frame, no URL)

TIMING:
• 15-45 min between comments (vary the gap)
• Target rising posts < 6 hours old
• Peak: 8-10 AM EST, 6-8 PM EST
• Total session: 60-90 min
```

---

*Last updated: 2026-04-21*
*Sources: REDAccs comment strategy guide, Reddit mistakes guide, warm-up guide, rank comment guide, internal humanizer skill, anti-detection ruleset*
