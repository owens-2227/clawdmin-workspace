---
name: reddit-engage
description: "Reddit engagement protocol for persona-based community participation. Covers browsing, commenting, upvoting, and engagement tracking."
metadata:
  openclaw:
    emoji: "📱"
---

# Reddit Engagement Protocol

Guidelines for authentic Reddit community participation using browser automation via AdsPower profiles.

## Engagement Session Flow

### 0. Tab Cleanup Phase
- After connecting via CDP, check how many tabs/pages are open
- Close ALL tabs except one
- Navigate the remaining tab to the target subreddit
- This prevents tab accumulation across sessions

### 1. Browse Phase
- Navigate to assigned subreddit's `/new/` or `/hot/` page
- Snapshot the page to read post titles and previews
- Identify 8-12 candidate posts to evaluate
- Skip: mega-threads (1000+ comments), mod posts, locked threads, posts older than 24h

### 2. Evaluate Phase
For each candidate post:
- Click into the post
- Snapshot to read the full content and existing comments
- Evaluate fit: Does this match your persona's expertise/experience?
- Skip if: topic is outside persona scope, already 100+ comments (your comment won't be seen), controversial/political, potential ban risk

### 3. Engage Phase
- Click the comment input field
- Type your comment (see persona SOUL.md for voice guidelines)
- Review before submitting — check tone, length, authenticity
- Submit the comment
- Upvote the post
- Optionally upvote 1-2 existing comments that are genuinely helpful

### 4. Log Phase
- After all engagement, log activity to BRAIN published-content folder
- Update MEMORY.md with posts commented on (to avoid doubles)
- Note any posts to revisit for replies

## Comment Guidelines

### Humanizer Check (MANDATORY)
Before posting ANY comment, run it through the humanizer filter. See `skills/humanizer/SKILL.md` for the full guide. Quick checklist:

- **No AI vocabulary:** Remove "Additionally", "crucial", "delve", "enhance", "foster", "highlight", "intricate", "landscape", "pivotal", "showcase", "tapestry", "testament", "underscore", "vibrant", "valuable"
- **No rule of three:** Don't force ideas into groups of three ("X, Y, and Z")
- **No negative parallelisms:** Avoid "It's not just X, it's Y" or "Not only...but..."
- **No em dash overuse:** One per comment max, prefer commas or periods
- **No sycophantic openers:** No "Great question!", "That's so true!", "Absolutely!"
- **No promotional language:** No "groundbreaking", "game-changer", "must-try", "stunning"
- **No filler phrases:** Cut "In order to", "It is important to note that", "Due to the fact that"
- **No excessive hedging:** Don't stack "potentially", "possibly", "might", "could"
- **Use simple verbs:** "is/are/has" over "serves as/stands as/boasts/features"
- **Vary sentence length:** Mix short punchy lines with longer ones
- **Have personality:** Include opinions, uncertainty, humor — not robotic neutrality
- **Be specific:** Concrete details over vague claims

Draft the comment → review against this checklist → fix any violations → then post.

### Length
- Most comments: 1-4 sentences
- Occasionally longer (3-5 sentences) for genuine advice or detailed experience sharing
- Never wall-of-text unless the thread specifically calls for detailed responses

### Authenticity Markers
- Reference specific personal experiences (consistent with persona)
- Use the persona's natural language patterns
- Include minor imperfections (casual grammar, trailing thoughts)
- Ask genuine follow-up questions sometimes
- Disagree respectfully when you have a different experience

### What NOT to Do
- Never mention being an AI, bot, or automated
- Never copy-paste the same comment across posts
- Never comment on topics outside your persona's knowledge
- Never use corporate/marketing language
- Never link to external sites unless the thread specifically asks
- Never engage in arguments or controversial political threads
- Never comment on more posts than your persona's per-session limit

## Rate Limits

| Metric | Limit |
|--------|-------|
| Comments per session | 4-8 (varies by persona) |
| Upvotes per session | 8-15 |
| Sessions per day | 3-4 (spread across the day) |
| Min time between comments | 2-3 minutes |
| Max session duration | 30 minutes |

## Timing & Natural Behavior

- Don't blitz through all comments in 2 minutes — space them out
- Spend 1-2 minutes reading a post before commenting
- Scroll through the page naturally (don't jump to comment box immediately)
- Vary your subreddit order each session
- Some sessions should be "light" — mostly browsing and upvoting, 1-2 comments max

## Content Logging Format

Log to `~/.openclaw/workspace/BRAIN/published-content/{agent-id}/YYYY-MM-DD.md`:

```markdown
## YYYY-MM-DD HH:MM Session (morning|midday|afternoon|evening)

### Comments
1. [r/subreddit] "Post Title" — "Your comment text here" — [permalink]
2. [r/subreddit] "Post Title" — "Your comment text here" — [permalink]

### Upvotes
- Total: N posts upvoted

### Replies Received
- (check on next session)

### Notes
- Trending topics observed
- Posts to revisit
- Voice/tone observations
```

## Subreddit-Specific Notes

### General Reddit Etiquette
- Read the subreddit rules before posting (check sidebar)
- Don't self-promote
- Use appropriate flair when required
- Be genuinely helpful — Reddit rewards useful comments with karma
- Participate in the community, don't just broadcast

### Karma Building Strategy
1. **Weeks 1-2**: Comment only, focus on genuinely helpful responses in smaller threads
2. **Weeks 3-4**: Start mixing in occasional original posts (questions work well)
3. **Ongoing**: Balance comments (80%) with occasional posts (20%)
4. **Track**: Which subreddits and comment styles earn the most karma

## Error Handling

- "You're doing that too much" — Immediately stop, wait 10 minutes, reduce comment rate
- "This community requires X karma" — Note and report, skip this subreddit
- CAPTCHA/verification — Screenshot and report to Admin, do NOT attempt to solve
- Login issues — Report to Admin immediately
- Page load failures — Retry once, then report
