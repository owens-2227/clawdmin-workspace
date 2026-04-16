# Reddit Fresh Start Playbook

*Compiled from AdsPower guides + REDAccs ranking algorithm guide + our own battle scars. April 2026.*

---

## AdsPower Profile Setup (Per Account)

1. **New Profile** → set profile name, OS, UA
2. **Proxy** → assign unique residential IP per profile (no shared IPs between accounts)
3. **Platform** → set domain to `www.reddit.com`, fill username/password after account creation
4. **Fingerprint** → each profile gets unique: canvas, WebGL, WebRTC, audio, fonts, TLS fingerprint
5. **Batch import** available if creating many profiles at once

---

## Account Creation Best Practices

- Use **ProtonMail or burner emails** (not Gmail) for anonymity
- Each account needs a **unique email**
- Don't include identifiable info in usernames
- Use a password manager for all credentials
- Enable **2FA** immediately after creation (Settings > Account > Two-Factor Authentication)
- **Verify email** — makes account appear more trustworthy
- Log in ONLY through the assigned AdsPower profile — never cross-contaminate

---

## Warm-Up Protocol (3 Phases)

### Phase 1: Browse Only (Days 1-3)
- Just browse. Read posts. Get a feel for subreddit culture.
- Light upvoting only — don't mass-upvote
- NO comments, NO posts
- Let the IP bind to the account

### Phase 2: Initial Engagement (Days 4-14)
- Start commenting in **large general subreddits** (r/AskReddit, r/todayilearned, r/pics)
- Focus on **comment karma** — easier to earn than post karma
- Comments must add value: thoughtful, helpful, or witty
- After ~7 days, make first text posts in low-requirement subs
- NO external links, NO promotional content

### Phase 3: Build Foundation (Days 15-30+)
- Move into **niche subreddits** relevant to persona
- Consistent but not excessive: a few comments + 1 post every other day
- Target **a few hundred karma** before any promotional activity
- **80/20 rule**: at least 80% non-promotional, max 20% brand-relevant
- Always engage with replies on your own posts

---

## Reddit's Ranking Algorithm (What We're Playing Against)

### Hot Score Formula
```
Hot score = log₁₀(net votes) + (time posted / 45,000)
```
- Every 10x increase in votes = only +1 ranking point
- Every 12.5 hours of age = -1 ranking point
- **First hour is everything** — first 10 upvotes = same impact as next 100
- Posts that sit untouched in New for 15 min rarely recover

### What Makes Votes Count More
- **Account age + karma**: 3-year-old account with 10K karma > new account
- **IP diversity**: same IP range = discounted/ignored votes
- **Voting patterns**: accounts that only upvote one user get flagged
- **Engagement ratio**: 200 upvotes + 0 comments looks unnatural and gets flagged
- **Vote fuzzing**: displayed numbers are scrambled; net score stays accurate

### 5 Sorting Algorithms
1. **Hot** (default): net votes weighted against time — rewards fast traction
2. **Best** (comments): Wilson score confidence interval — quality over quantity
3. **Rising**: vote velocity relative to sub's normal activity — snowball trigger
4. **Top**: pure net score by time period — no decay
5. **New**: chronological — your starting line

### The Path: survive New → break into Rising → reach Hot

---

## Karma Farming Strategy

### Types of Karma
- **Post karma**: from upvotes on posts
- **Comment karma**: from upvotes on comments (easier for new accounts)
- **Awardee karma**: from receiving awards
- **Awarder karma**: from giving awards

### Quick Karma Tactics
- Comment on rising posts in large subs (r/AskReddit, r/todayilearned)
- Early comments on posts get exponentially more visibility
- Add genuine value — not "this!" or "came here to say this"
- A few hundred karma is the minimum before any promotional activity
- Diverse subreddit participation signals healthy account

---

## "We Had a Server Error" = Usually Account Suspension

- Most common cause: account suspended or shadowbanned
- Can also be: server overload, maintenance, network/DNS issues
- Some accounts auto-restore after a month (unreliable)
- Best practice: if you see this, check from a DIFFERENT account/profile
- Appeal via Reddit support if legitimate

---

## Detection Signals to Avoid

1. **IP linking**: never share IPs between accounts
2. **Browser fingerprint**: unique canvas/WebGL/UA per profile
3. **Behavior patterns**: accounts that only do one thing (e.g., only upvote one user)
4. **Cross-account interaction**: personas must never upvote/reply to each other
5. **Timing coordination**: stagger activity, no synchronized posting
6. **Same content**: never post identical text/images across accounts
7. **Mass actions**: no rapid upvoting/downvoting sprees
8. **External links on new accounts**: instant spam signal

---

## Our Past Mistakes (Don't Repeat)

1. Canned context-blind comments → 7/12 accounts shadowbanned
2. Posting aggressively during warm-up → bans within days
3. Self-checking for shadowbans (useless — always check from different account)
4. Not warming up long enough before engaging
5. Coordinated timing across personas in same threads
6. External links too early on low-karma accounts

---

*Ready for Paul's new strategy direction.*
