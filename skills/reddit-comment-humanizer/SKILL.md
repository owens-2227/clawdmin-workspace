---
name: reddit-comment-humanizer
version: 1.0.0
description: |
  Generate and humanize Reddit comments for account warming. Combines AI writing
  pattern detection (from the humanizer skill) with Reddit-specific culture,
  algorithm awareness, and community adaptation. Every comment must pass both
  the "AI detector" test AND the "would a real Redditor actually type this" test.
---

# Reddit Comment Humanizer

Generate comments that real Redditors would actually respect. This skill combines AI-pattern removal with Reddit-specific voice, structure, and community adaptation.

## Core Principle

Reddit has an almost supernatural ability to detect inauthenticity. Fake organic content is users' #1 turnoff (49.5% — higher than obvious promotion at 20.4%). The goal isn't to "sound human." It's to actually participate like a human who cares about the conversation.

---

## PART 1: COMMENT STRUCTURE

### The Acknowledge → Contribute → Invite Framework

The highest-performing Reddit comments follow this implicit structure:

1. **Acknowledge** — Show you actually read the post. Quote specific text, reference a detail, or relate to their situation. This is the "I see you" moment.
2. **Contribute** — Add something genuinely new. A data point, personal experience, counterexample, unexpected angle, or specific recommendation. This is the value.
3. **Invite** — Close with an open-ended question or thought that gives others a reason to respond. This sparks the thread.

You don't need all three every time. Short replies in casual threads can skip the invite. But top-level comments on advice/discussion posts should hit all three.

### Examples

**Weak (no structure):**
> Yeah I switched to a flat plate and it worked.

**Strong (acknowledge → contribute → invite):**
> My cat used to do the same thing, scooping wet food onto the floor like some kind of protest. Switched to a flat plate and she stopped within two days. You don't need a fancy one either, just a small dinner plate. Has yours always been a messy eater or did it start recently?

### Opening Hooks That Work

- Start with a relatable experience: "I dealt with this exact problem last year"
- Lead with a counterintuitive claim: "Hot take: most people overthink this"
- Front-load a specific useful fact
- Use in-media-res storytelling: "So there I was at 2am trying to..."

### Opening Hooks That Don't Work

- "Interesting that..." (formal, AI-coded)
- "It's worth noting that..." (essay voice)
- "As someone who..." (often sounds like marketing)
- Starting every comment with "I" (vary your starters)

---

## PART 2: VOICE

### The Target: Conversational Authority + Vulnerability

Write as if explaining something to a knowledgeable friend over coffee. Not presenting to a boardroom. Not texting a teenager. The sweet spot is casual enough to feel human, authoritative enough to be worth reading.

### Specificity Is the #1 Trust Signal

**Weak:** "Svelte is better for performance"
**Strong:** "I switched from React to Svelte and our bundle size dropped from 847KB to 212KB"

Concrete details, exact numbers, and specific personal experiences communicate authenticity in a way no amount of tone-matching can replicate. When generating comments:
- Use specific product names, not categories
- Reference real timeframes ("two days", "about a month")
- Mention real details from the post back to them
- If sharing experience, include the outcome

### The Pratfall Effect: Vulnerability as a Superpower

Small, honest admissions of imperfection make competent people more likeable. Reddit's anonymity lowers the social cost of honesty, so sharing failures and struggles builds trust (it's the opposite of what marketers do).

**Use:**
- "still not great at it but..."
- "I might be wrong about this but..."
- "took me way too long to figure out that..."
- "honestly I'm not sure if it was the X or the Y that made the difference"

**Don't overdo it.** Chronic self-disparagement without competence erodes credibility. Vulnerability only works when anchored to demonstrated knowledge.

### Humor

Self-deprecating humor works especially well on Reddit. Brief, dry, observational. Not trying-too-hard funny. If a joke doesn't come naturally from the context, don't force it.

---

## PART 3: AI PATTERN REMOVAL

Every comment must be scrubbed for these patterns before use.

### Kill List (immediate rewrites)

| Pattern | Why It's Bad | Fix |
|---------|-------------|-----|
| Em dashes (—) | AI overuses them. Pattern #13 from Wikipedia AI cleanup | Use commas, periods, or "and" |
| "Genuinely" / "incredibly" / "honestly" as intensifiers | Puffery. Real people don't write "genuinely impressive" | Cut the intensifier or use casual alternatives ("wild", "insane", "pretty solid") |
| Formal openers: "Interesting that", "Curious whether", "It's worth noting" | Essay voice. Nobody opens a Reddit comment like this | Start with the substance directly, or a casual hook |
| Rule of three: "X, Y, and Z" lists of adjectives | AI default structure | Pick the one that matters most. Two is fine. Three is suspicious. |
| Perfect parallel structure | Every sentence same length/pattern = algorithmic | Vary rhythm. Short punch. Then a longer one that wanders. Fragment. |
| Hedging stacks: "could potentially possibly" | Over-qualifying | One hedge max. "might" or "probably", not both. |
| Sycophantic openings: "Great question!", "That's a really good point" | Chatbot artifact. Dead giveaway. | Skip it entirely. Just answer. |
| Marketing vocabulary: "leverage", "optimize", "game-changer", "streamline" | Corporate infiltration detected | Use normal words. "use", "improve", "useful", "simplify" |
| Curly quotes (" ") | ChatGPT artifact | Use straight quotes (" ") only |
| Bolded inline headers with colons | AI list formatting | Write in flowing prose or use Reddit's native formatting |

### Voice Checks

After removing AI patterns, verify:

1. **Read it out loud.** Would you actually say this to someone? If it sounds like a blog post or a Medium article, rewrite it.
2. **Check sentence starters.** If more than one sentence starts with "I", vary them. If the comment opens with "I", try restructuring.
3. **Check for "essay flow."** Real Reddit comments are messy. They have fragments. They start sentences with "But" and "And." They trail off. They use parenthetical asides (like this). If your comment reads like a clean five-paragraph essay, roughen it up.
4. **Check length vs. context.** Casual threads: 1-3 sentences. Advice threads: can go longer but needs formatting. If it's more than 2-3 paragraphs, add line breaks or bullet points.
5. **Would this get upvoted or just... exist?** A comment that's technically fine but adds nothing will be invisible. Every comment needs to contribute something the thread doesn't already have.

---

## PART 4: SUBREDDIT ADAPTATION

Your core personality stays consistent. Your register — formality, humor, detail depth — shifts per community.

### Community Types

**Hobby & interest subs** (r/cats, r/cooking, r/houseplants, r/homeautomation)
- Enthusiastic, supportive tone
- Personal experience is king
- Share failures alongside successes
- "Here's what worked for me" format
- Specific product recommendations welcome

**Advice & support subs** (r/CatAdvice, r/personalfinance, r/Anxiety)
- Empathetic first, practical second
- Acknowledge their situation before giving advice
- Specific actionable steps > vague encouragement
- For sensitive posts: read the room. Grief ≠ advice opportunity.

**Discussion & opinion subs** (r/AskReddit, r/Showerthoughts, r/productivity)
- Short and sharp wins
- One strong insight > paragraphs of analysis
- Humor and wit rewarded
- Hot takes are fine if you back them up

**Tech & knowledge subs** (r/homeautomation, r/iphone, r/MechanicalKeyboards)
- Precision and specificity expected
- Include model numbers, versions, settings
- "Works for me" anecdotes less valued than "here's why it works"
- Link to documentation or sources when relevant

**Niche subs under 50K members**
- Members recognize each other. Tone is more intimate.
- Inside jokes and recurring references signal belonging
- Generic advice doesn't work — deep knowledge is the entry fee
- Be a regular, not a drive-by commenter

### Sensitive Posts: When NOT to Comment

Skip entirely:
- Grief/loss posts ("my cat didn't make it", "RIP", memorial posts)
- Crisis/mental health emergencies
- Posts tagged Sensitive/Seeking Support with bad news
- Heated political/culture war threads
- Posts where OP is clearly venting and not seeking advice

A warming account commenting on someone's dead pet is tone-deaf, suspicious, and morally gross. Just don't.

---

## PART 5: ALGORITHMIC AWARENESS

### Wilson Score: Approval Ratio > Raw Volume

A comment with 10 upvotes / 1 downvote outranks 100 upvotes / 50 downvotes. Write comments that deliver value without courting controversy.

### Timing Is Exponential

Reddit's ranking is logarithmic: 1→10 upvotes = same weight as 10→100 = same as 100→1,000. Early comments on rising posts compound. Target posts sorted by **Rising** or **New**, not just Hot.

### Comment > Upvote

Comments carry 1.5-1.8x the algorithmic weight of upvotes. Being a commenter (not just a voter) is itself a strategic advantage.

### CQS (Contributor Quality Score)

Reddit's hidden trust metric since 2023. Affects AutoModerator filtering. Build it by:
- Verifying email + enabling 2FA on warming accounts
- Commenting more than posting
- Engaging across multiple subreddits (not just 1-2)
- Never having content removed or reported
- CQS cannot be gamed through volume — behavioral quality is what matters

---

## PART 6: COMPLETE CHECKLIST

Before finalizing any comment for the warming plan:

- [ ] Does it acknowledge something specific from the post?
- [ ] Does it contribute something new (experience, detail, question)?
- [ ] Is it free of em dashes?
- [ ] Is it free of formal openers?
- [ ] Is it free of AI intensifiers (genuinely, incredibly, absolutely)?
- [ ] Is it free of marketing vocabulary?
- [ ] Is it free of sycophantic openings?
- [ ] Does it use straight quotes, not curly?
- [ ] Are sentence starters varied (not all starting with "I")?
- [ ] Does it match the subreddit's tone and formality level?
- [ ] Is the length appropriate for the thread type?
- [ ] Would a real person actually type this in a Reddit comment box?
- [ ] Does it avoid sensitive/grief/crisis posts?
- [ ] Does it include at least one specific detail (product name, timeframe, number)?
- [ ] Read out loud: does it sound like a blog post? If yes, rewrite.
