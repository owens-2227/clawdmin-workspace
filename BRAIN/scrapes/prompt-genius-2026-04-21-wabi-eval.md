# ChatGPT Prompt Genius → Wabi Mini App Evaluation
**Week of April 14–20, 2026** | Scraped 25 posts, 24 passed basic filter

## 🟢 Strong Wabi Mini App Candidates

### 1. "AI Trust Gap Calculator" (21↑)
**App concept:** Interactive quiz/calculator that scores where a user stands on the AI trust spectrum. Uses AI content client for analysis, persistent KV store for tracking over time, push notifications for periodic re-checks.
**Wabi fit:** ⭐⭐⭐⭐⭐ — Perfect. Structured entity generation + KV persistence + simple UI (sliders, scores, charts). No external APIs needed.

### 2. "Dietitian Meal Prep Prompt" (43↑)
**App concept:** Personalized meal planner that uses AI to generate weekly meal plans based on preferences, dietary restrictions, budget. Integrates Apple Health (nutrition/activity data), Google Calendar (meal prep scheduling), persistent storage for tracking.
**Wabi fit:** ⭐⭐⭐⭐⭐ — AI content client for plan generation, Apple Health for context, Calendar for reminders, KV store for history. All native Wabi capabilities.

### 3. "Weekly Plan Reality Check" (35↑)
**App concept:** Paste your week plan, AI identifies what you'll actually skip and why. Integrates Google Calendar for real schedule data, persistent tracking of prediction accuracy over time.
**Wabi fit:** ⭐⭐⭐⭐⭐ — Calendar API + AI content client + KV persistence. Time-based triggers for Monday morning check-ins. Push notifications.

### 4. "Content 1→10 Multiplier" (14↑)
**App concept:** Paste one piece of content, AI repurposes into 10 formats (tweet thread, LinkedIn post, newsletter, etc.). Stored in persistent library.
**Wabi fit:** ⭐⭐⭐⭐ — AI long text generation + structured entities + KV store. No external APIs needed. Great for creators.

### 5. "AI Value Gap Audit" (8↑)
**App concept:** Team/individual assessment tool that scores actual AI ROI vs. perceived value. Weekly check-ins, trend tracking, actionable recommendations.
**Wabi fit:** ⭐⭐⭐⭐ — Structured entity generation + KV persistence + scheduled triggers for periodic audits + push notifications.

### 6. "Legal Doc → Plain English" (24↑)
**App concept:** Paste legal text, get plain-English breakdown with key obligations, deadlines, and red flags highlighted. Save analyzed docs for reference.
**Wabi fit:** ⭐⭐⭐⭐ — AI long text + structured entities. KV store for document library. Simple UI. High utility.

### 7. "Email Tone Fixer" (12↑)
**App concept:** Draft emails with AI that matches your actual tone. Could integrate Gmail API to learn from sent emails, then generate/rewrite drafts.
**Wabi fit:** ⭐⭐⭐⭐ — Gmail integration + AI content client + KV persistence for tone profiles. Native Wabi capabilities.

### 8. "Prompt Self-Roast" (26↑)
**App concept:** Paste your prompts, get brutal honest feedback on what's weak and how to fix them. Track improvement over time.
**Wabi fit:** ⭐⭐⭐ — Fun concept but thin as a standalone app. AI content client + KV store. Could work as a lightweight utility.

## 🟡 Possible But Thin

- **"Jagged Intelligence Audit"** (10↑) — AI capability mapper. Could work but niche.
- **"AI Memory Audit"** (8↑) — Check what AI remembers about you. Interesting concept but may be too meta for a standalone app.
- **"Research Credibility Checker"** (6↑) — Needs web access to verify claims → blocks on Wabi's no-arbitrary-HTTP constraint. Could work if limited to pasted text analysis only.

## 🔴 Not Viable as Wabi Apps

- **"Lied to ChatGPT"** (466↑) — Prompting technique, not an app concept
- **"50+ unlock prompts tested"** (193↑) — Jailbreak comparison, not an app
- **"AI reading list"** (77↑) — Curated links, not an app
- **"Better prompt structure"** (24↑) — Tips article, not an app
- **"Telling model what NOT to do"** (28↑) — Prompting advice, not an app
- **"One small addition fixed outputs"** (27↑) — Prompting tip, not an app
- **"LEAN vs JSON vs YAML benchmark"** (12↑) — Dev tooling comparison, not an app
- **"AI portfolio management"** (9↑) — Meta question about workflow showcasing
- **"Use Codex securely"** (6↑) — Dev security question
- **"Prompt generator"** (5↑) — Meta tool, too generic
- **"Reducing LLM context"** (5↑) — Dev technique, not consumer app
- **"Fixed ChatGPT acting dumb"** (5↑) — Prompting tips article

## 📊 Summary

| Category | Count |
|----------|-------|
| Strong Wabi candidates | 7 |
| Possible but thin | 3 |
| Not viable (tips/articles, not apps) | 15 |

**Top 3 recommendations for immediate prototyping:**
1. **Meal Prep AI** — Highest utility, uses Apple Health + Calendar + AI generation
2. **Weekly Reality Check** — Sticky daily-use habit, Calendar integration, push notifications
3. **Legal → Plain English** — High value, simple UX, clear use case
