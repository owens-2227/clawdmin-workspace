# Wabi Mini App Viability — r/ChatGPTPromptGenius Top Weekly (2026-04-17)

**Source:** 25 posts scraped, 24 flagged viable by script. Below is AI evaluation against Wabi SDK constraints.

---

## 🟢 HIGH VIABILITY (strong SDK fit)

### 1. Weight Loss Coach (#8, 34pts)
**Concept:** AI coaching app with HALT framework, emotional eating detection, weekly reframing.
**SDK fit:** ⭐⭐⭐⭐⭐ — Apple Health (weight, steps, workouts), AI content client for coaching, scheduled triggers for daily check-ins, push notifications for accountability, KV store for user profile/goals, TTS for motivational nudges.
**Why it's great:** Multi-surface SDK usage. Health data makes it genuinely useful vs just a prompt wrapper.

### 2. Email Tone Fixer / Smart Email Writer (#13, 13pts)
**Concept:** Context-aware email composer that takes goal + tone + objections and produces direct replies.
**SDK fit:** ⭐⭐⭐⭐⭐ — Gmail send/search integration, AI content client, KV store for saved templates/preferences, rich UI (tabs for drafts, tone picker).
**Why it's great:** Direct Gmail bridge is a killer feature no ChatGPT prompt can match.

### 3. Prompt Workflow Builder (#5, 46pts)
**Concept:** Chain prompts into reusable multi-step systems (hooks → content → repurpose).
**SDK fit:** ⭐⭐⭐⭐ — AI content client (streaming for each step), KV store for saved workflows, rich UI (step builder, tabs), could add scheduled content generation.
**Why it's great:** Sticky product — users build and save their workflows.

---

## 🟡 MODERATE VIABILITY (good fit, simpler execution)

### 4. Communication & Relationship Coach (#12, 13pts)
**Concept:** Research-based advice using Gottman/Edmondson/NVC frameworks. Practical phrasing.
**SDK fit:** ⭐⭐⭐⭐ — AI content client, KV store for conversation history/progress, scheduled reminders ("daily boundary practice"), push notifications, TTS for roleplay practice.

### 5. Thinking Coach / Mental Model Builder (#7, 42pts)
**Concept:** Meta-cognition trainer. Iterative refinement of beliefs and reasoning.
**SDK fit:** ⭐⭐⭐⭐ — AI content client, KV store for journaling/belief tracking over time, scheduled reflection prompts.

### 6. Strategic Advisor / Brutally Honest Mirror (#6, 41pts)
**Concept:** No-fluff advisor that challenges assumptions, exposes blind spots, gives prioritized plans.
**SDK fit:** ⭐⭐⭐ — AI content client (core), KV store for decision log. Simple but the prompt quality could differentiate it.

### 7. Knowledge Structure Generator (#10, 20pts)
**Concept:** Produces strict hierarchical category → subcategory → topic maps in YAML.
**SDK fit:** ⭐⭐⭐ — AI structured entities, KV store for saved maps, rich UI for tree visualization.

### 8. AI Trust Gap Calculator (#11, 14pts)
**Concept:** Personal quiz mapping where you fall on the AI trust spectrum + action plan.
**SDK fit:** ⭐⭐⭐ — AI content client, rich UI (survey components, date pickers), KV store for results over time.

### 9. E-Commerce Copy Generator (#19, 6pts)
**Concept:** Product descriptions, abandoned cart emails, ad copy with psychology-based frameworks.
**SDK fit:** ⭐⭐⭐ — AI content client, Gmail for email drafts, KV store for product catalog/brand voice.

---

## 🔴 NOT VIABLE AS MINI APPS

- **#1 Anthropic Prompting Playbook** (1035pts) — Discussion/resource list, not an app concept
- **#2 Lying to ChatGPT** (374pts) — Technique anecdote, no app structure
- **#3 Natural Writing Prompt** (214pts) — Single prompt, too thin for standalone app
- **#4 Universal Expert Prompt** (83pts) — Single prompt, no SDK surface beyond AI client
- **#9 Prompt Roasting** (25pts) — Fun but no persistent value / SDK leverage
- **#15 LEAN vs JSON Benchmark** (9pts) — Technical research, not user-facing
- **#16 AI Memory Audit** (8pts) — Requires external API access (ChatGPT memory), SDK can't do this
- **#18 AI Portfolio Showcase** (5pts) — Needs arbitrary web hosting, outside SDK scope
- **#20-25** — Too niche, support questions, or jailbreak discussions

---

## 🎯 TOP 3 RECOMMENDATIONS

| Rank | App Concept | Source Post | Why |
|------|------------|-------------|-----|
| 1 | **Weight Loss Coach** | #8 (34pts) | Deepest SDK integration (Health + triggers + notifications + TTS). Real utility beyond prompt wrapper. |
| 2 | **Smart Email Writer** | #13 (13pts) | Gmail bridge is unique value prop. High daily-use potential. |
| 3 | **Prompt Workflow Builder** | #5 (46pts) | High engagement (46pts), sticky product, showcases streaming + persistence. |

---

*Evaluated against Wabi SDK capabilities: AI content client, Gmail, Calendar, Apple Health, Composio, MongoDB KV + Zustand, WabiChat, TTS, triggers, push notifications, rich UI. Excluded concepts requiring arbitrary HTTP, filesystem, camera, or unbundled npm packages.*
