---
name: flint
description: "Manage Flint marketing sites via their Agent Tasks API. Create and monitor background agent tasks that modify sites — generate pages, update content, and track task completion. Use when asked to create, update, or generate pages on a Flint site."
metadata:
  openclaw:
    emoji: "🔥"
---

# Flint Agent Tasks API — Wabi App Landing Pages

## Config

```
API key:  ak_E7WFVNH5C0VZGFETBE9S5DSM9JR49D36
Base URL: https://app.tryflint.com/api/v1
Site ID:  12628d27-7872-468a-aa54-c4780cf3284b
Template: apps/kitty-diabetes-final
```

---

## AEO/SEO Page Architecture

These pages are optimized for AI answer engines (ChatGPT, Perplexity) AND traditional search. The goal: when someone asks an AI "how do I [pain point]?", this page gets cited.

### Core principles (from Paul's brief)

1. **Headline is problem-first, not product-first.** The H1 answers a real question.
   - Bad: "Breathwork on Wabi — Visual Breathing Guide"
   - Good: "Stop Letting Anxiety Win with a Free Breathing Exercise App"
   - The title answers: "How do I calm anxiety without paying for Calm?"
   - Do NOT include "on Wabi" in the H1/title

2. **No template feel.** Vary H2/H3 headings per page — pick 4-7 from a pool (see below). Don't reuse the same heading structure across every app.

3. **Copy must be useful first.** Pages that answer real questions outperform product pages. Every section should be extractable by an LLM as a standalone answer.

4. **Use the Humanizer skill on all copy before submitting to Flint.** No em dashes, no AI vocabulary, no rule-of-three, no -ing ending phrases. Apply `skills/humanizer/SKILL.md` rules.

5. **Word count discipline.** Don't pad. Each section should say what it needs to say and stop.

6. **Every page gets 3 remix ideas, placed as FAQ entries** (not a dedicated section). Each remix idea becomes a question like "What if I want [variation]?" with the answer explaining what to change and mentioning the Remix button. Pick ideas that show range: one functional change, one audience shift, one vibe/aesthetic change. Keep them specific to the app, not generic.

7. **The app icon_url must be the app's own cover image** (from Wabi `cover_image_url`), not a persona avatar.

8. **Creator names must be neutral** — use first name + last initial only (e.g. "Maya C", "Sarah K"). Never full surnames.

9. **Do NOT include `related_apps` in the JSON payload** unless the template explicitly has that section. Flint creates sections from any data you send — sending `related_apps` will add the section even if the template doesn't have it. Current template (`kitty-diabetes-final`) has NO related apps section, so omit this field entirely.

---

## Page Schema (Complete)

Send this JSON in the Flint prompt. All fields required.

```json
{
  "app": {
    "name": "App Name",
    "category": "Category",
    "icon_url": "WABI_COVER_IMAGE_URL (from cover_image_url field in Wabi API)",
    "screenshot_url": "PUBLIC_URL (Catbox, Imgur, or GitHub raw from public repo)",
    "screenshot_alt": "Descriptive, keyword-rich alt text. ~1 sentence. E.g. 'Breathwork app showing visual breathing circle, session timer, and speed controls for anxiety relief'",
    "creator": "First name + last initial only. E.g. Maya C"
  },
  "hero": {
    "headline": "Problem-first H1. Answers a real search query. No 'on Wabi'. ~10 words.",
    "subhead": "1-2 sentences. What it does + key differentiator. No em dashes. No 'Not just X, it's Y'.",
    "stat": "A real, specific, sourced claim. E.g. '1 in 230 cats develops diabetes' or a clinical study finding. NOT vague social proof like 'Used by thousands'."
  },
  "problem_block": {
    "body": "First 150 words of the page body. CRITICAL for AEO. Must: (1) state the pain in plain language that mirrors how people ask ChatGPT, (2) include a specific statistic or verifiable claim, (3) be self-contained — an LLM should be able to extract this paragraph verbatim as the answer. No promotional language. No em dashes."
  },
  "story": {
    "problem": "2-3 sentences. Named creator (first name + last initial) + their specific broken workflow. Concrete, not generic.",
    "solution": "2-3 sentences. How the app fixes it. End with a concrete outcome."
  },
  "features": [
    {
      "icon": "PhosphorIconName",
      "title": "Feature name (2-4 words)",
      "description": "One sentence starting with an action verb. What it lets you DO."
    }
  ],
  "alternatives_section_heading": "How people solve this today",
  "alternatives_section_subhead": "Before [App Name], these were the most common options.",
  "alternatives": [
    {
      "icon": "Table",
      "name": "A spreadsheet or workaround",
      "description": "One sentence — what the workaround is (e.g. Google Sheets, notes app, journal).",
      "drawback": "Why it fails for this use case. Specific, not vague."
    },
    {
      "icon": "AppStoreLogo",
      "name": "A paid app (real name)",
      "description": "One sentence — what it is and how much it costs.",
      "drawback": "Specific weakness — pricing, complexity, missing feature."
    },
    {
      "icon": "NotePencil",
      "name": "An analog method (short name)",
      "description": "One sentence — e.g. pen and paper, counting in your head, sticky notes.",
      "drawback": "Why it doesn't scale or fails over time."
    }
  ],

  "// ALTERNATIVES CHARACTER LIMITS (must fit card layout)": {
    "name": "max ~25 chars (1 line ideal, 2 lines max at ~30)",
    "description": "max ~55 chars (keep to 1 line)",
    "drawback": "max ~65 chars (keep to 1 line, 90 absolute max)"
  },
  "faq": [
    {
      "question": "Phrased exactly as someone would type it into ChatGPT or Google. Starts with How/Is/What/Does.",
      "answer": "2-4 sentences. Mentions app name once. States the benefit concretely. No hedging."
    },
    {
      "question": "What if I want [remix variation]? — 3 remix ideas as FAQ entries. Format: 'What if I want X instead?' Answer: explain the change + mention tapping Remix in Wabi.",
      "answer": "Describe what to change and how. End with: 'Tap Remix in Wabi to start with this app and make it yours.'"
    }
  ],
  "community": "2-3 sentences. Names specific subreddits. Describes who uses it emotionally, not demographically.",
  "related_apps": [
    {
      "name": "Related App Name (same category/niche)",
      "slug": "related-app-slug",
      "description": "One sentence."
    }
  ],
  "cta": {
    "app_store_url": "https://wabi.ai/@persona/app-slug?_v=1",
    "qr_code_url": "https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=URL_ENCODED_SHARE_URL"
  },

  "trust_signals": [
    { "title": "Free", "subtitle": "No subscription ever" },
    { "title": "No login", "subtitle": "Just open and use" },
    { "title": "Works offline", "subtitle": "No internet needed" },
    { "title": "Built on Wabi", "subtitle": "Open platform" }
  ],
  "seo": {
    "title_tag": "Problem-first, ~60 chars. Answers a question. No 'on Wabi'.",
    "meta_description": "~155 chars. Includes primary keyword. Reads like a human wrote it.",
    "primary_keyword": "main search term",
    "secondary_keywords": ["variant 1", "variant 2", "variant 3", "variant 4", "variant 5"],
    "primary_keyword_density": "Use primary keyword 3-5x in body copy naturally",
    "secondary_keyword_density": "Each secondary keyword 1-2x"
  }
}
```

---

## H2/H3 Heading Pool

Pick 4-7 per page. Vary them — don't use the same set on every app page. Headings should be sentence case, not Title Case.

**Problem/Context headings:**
- "Why [common solution] doesn't work"
- "What most people get wrong about [problem]"
- "The real cost of [workaround]"
- "Why [problem] is harder than it sounds"

**Solution/How-it-works headings:**
- "How [app name] works"
- "What you can do in [app name]"
- "[App name] in practice"
- "Getting started in under 2 minutes"

**Credibility/Community headings:**
- "Who uses [app name]"
- "Built for [community name]"
- "What [community] says"
- "Why this works (the science)"

**Comparison headings:**
- ⚠️ The alternatives section heading is FIXED: always "How people solve this today"
- The subhead is FIXED: always "Before [App Name], these were the most common options."
- Do NOT use "How it compares" or "Alternatives" as the heading — those were wrong

**FAQ headings:**
- "Common questions"
- "Things people ask about [problem]"

**Note:** Remix ideas go into the FAQ section as additional Q&A entries, not as a separate section.

---

## Exclusion List — Words and Phrases to Never Use

Apply these rules to all copy. These are the most common AI tells:

**Banned words:** additionally, align with, crucial, delve, emphasizing, enduring, enhance, fostering, garner, highlight (verb), interplay, intricate, key (as adjective), landscape (abstract), pivotal, showcase, tapestry, testament, underscore, valuable, vibrant, comprehensive, seamless, robust, innovative, leverage, utilize, streamline

**Banned constructions:**
- Em dashes (—) — replace with a comma, period, or rewrite
- "Not just X, it's Y" / "It's not just about X, it's..."
- "Whether you're X or Y" openers
- Rule of three: "X, Y, and Z" lists feel algorithmic — use 2 or 4 items instead
- -ing phrase tacked onto a sentence end: "...ensuring that users can..."
- "This is a testament to..."
- "In today's [adjective] world"
- "Built for people who..."
- Rhetorical questions as section openers ("Ever wondered why...?")
- Curly quotes — use straight quotes

**Transitions to avoid:** Moreover, Furthermore, Additionally, In conclusion, It's worth noting that, It's important to note that, Notably

---

## Stat Research Protocol

Every page needs a real, specific stat in the hero and/or problem block. Research before writing:

1. Check our pain point database (MongoDB) — the `description` field often contains engagement data from Reddit
2. Search for: "[condition] prevalence statistics" or "[problem] survey data"
3. Prefer: clinical studies, industry surveys, published research
4. Acceptable: well-known niche surveys (BookBrowse, pet health databases, etc.)
5. Cite the source in the stat: "According to [source], X% of..." or "A [year] study found..."
6. Not acceptable: vague claims like "millions of people" or "most users"

---

## Asset Pipeline

### Icon URL
Pull from Wabi API:
```python
GET /app/{remixed_id}  →  data.cover_image_url
```
This CloudFront URL is the app's visual identity. Use it for `icon_url`.

### Screenshot URL

**Source: Notion's Screenshot property field.** Do NOT take your own screenshot of the Wabi share page. The screenshot is provided by the app's creator in the Notion database.

**Step 1: Get the screenshot from Notion**

The Notion app database has a `Screenshot` property (field key `VbDU`, type `files`). Extract the attachment reference:

```python
import subprocess, json

# Load page data from Notion public API
page_id = "PAGE_ID_HERE"
result = subprocess.run([
    "curl", "-s", "https://silver-face-9c4.notion.site/api/v3/loadPageChunk",
    "-H", "Content-Type: application/json",
    "-d", json.dumps({
        "page": {"id": page_id},
        "limit": 100,
        "cursor": {"stack": []},
        "chunkNumber": 0,
        "verticalColumns": False
    })
], capture_output=True, text=True, timeout=15)

data = json.loads(result.stdout)
blocks = data.get("recordMap", {}).get("block", {})
for bid, bdata in blocks.items():
    val = bdata.get("value", {})
    inner = val.get("value", val) if isinstance(val, dict) else {}
    props = inner.get("properties", {})
    if "VbDU" in props:
        # props["VbDU"] = [["filename.png", [["a", "attachment:UUID:filename.png"]]]]
        attachment_ref = props["VbDU"][0][1][0][1]  # e.g. "attachment:UUID:filename.png"
        break
```

**Step 2: Download via Notion's image proxy**

```python
import urllib.parse
encoded_ref = urllib.parse.quote(attachment_ref)
url = f"https://silver-face-9c4.notion.site/image/{encoded_ref}?id={page_id}&table=block"
# curl -sL to follow the 302 redirect to img.notionusercontent.com
subprocess.run(["curl", "-sL", url, "-o", "/tmp/screenshot.png"], timeout=30)
```

**Step 3: Upload to Catbox for a permanent public URL**

```python
import urllib.request
boundary = 'BOUNDARY123456'
with open('/tmp/screenshot.png', 'rb') as f:
    img_bytes = f.read()
body = (
    f'--{boundary}\r\nContent-Disposition: form-data; name="reqtype"\r\n\r\nfileupload\r\n'
    f'--{boundary}\r\nContent-Disposition: form-data; name="fileToUpload"; filename="screenshot.png"\r\nContent-Type: image/png\r\n\r\n'
).encode() + img_bytes + f'\r\n--{boundary}--\r\n'.encode()
req = urllib.request.Request('https://catbox.moe/user/api.php', method='POST',
    headers={'Content-Type': f'multipart/form-data; boundary={boundary}'}, data=body)
url = urllib.request.urlopen(req, timeout=60).read().decode().strip()
# Returns: https://files.catbox.moe/xxxxxx.png
```

**⚠️ If the Screenshot field is empty/missing:** STOP and warn Paul. Do not substitute a screenshot from the Wabi share page or take your own. The creator-provided screenshot is required.

### QR Code URL
Use qrserver.com — no hosting needed, always live:
```python
import urllib.parse
qr_url = f"https://api.qrserver.com/v1/create-qr-code/?size=300x300&data={urllib.parse.quote(share_url)}"
```

---

## Flint Prompt Template

```
Update the page `apps/{slug}` using `apps/kitty-diabetes-final` as the design template with the following content:

{full JSON object}

The page slug is `apps/{slug}`. Match the layout and component structure of `apps/kitty-diabetes-final` exactly. Use the heading variants specified (not the same H2s as other app pages). The screenshot at {SCREENSHOT_URL} must be displayed as the main app preview image.
```

---

## API Operations

### Create/update a task

```python
import urllib.request, json, urllib.parse

FLINT_API_KEY = "ak_E7WFVNH5C0VZGFETBE9S5DSM9JR49D36"
SITE_ID = "12628d27-7872-468a-aa54-c4780cf3284b"

payload = json.dumps({"siteId": SITE_ID, "prompt": prompt}).encode()
req = urllib.request.Request(
    "https://app.tryflint.com/api/v1/agent/tasks",
    method="POST",
    headers={"Authorization": f"Bearer {FLINT_API_KEY}", "Content-Type": "application/json"},
    data=payload
)
result = json.loads(urllib.request.urlopen(req, timeout=30).read())
task_id = result["taskId"]
```

### Poll status (tasks take 5-15 min)

```python
def poll_task(task_id, max_minutes=15):
    import time
    for i in range(max_minutes * 6):
        req = urllib.request.Request(
            f"https://app.tryflint.com/api/v1/agent/tasks/{urllib.parse.quote(task_id, safe='')}",
            headers={"Authorization": f"Bearer {FLINT_API_KEY}"}
        )
        result = json.loads(urllib.request.urlopen(req, timeout=15).read())
        if result.get("status") in ("completed", "succeeded", "failed"):
            return result
        time.sleep(10)
```

### Completed response

```json
{
  "status": "completed",
  "output": {
    "pagesCreated": [{"slug": "/apps/breathwork", "previewUrl": "https://..."}]
  }
}
```

---

## Pre-flight Checklist

Before firing the Flint task:

- [ ] H1 is problem-first, not product-first
- [ ] H1 does NOT contain "on Wabi"
- [ ] Stat is real and sourced (not vague social proof)
- [ ] Copy has been run through Humanizer rules (no em dashes, no banned words)
- [ ] `icon_url` is the app's Wabi `cover_image_url` (not a persona avatar)
- [ ] Creator name is First + Last initial only (e.g. "Maya C")
- [ ] Screenshot is from Notion's Screenshot property (NOT a self-taken screenshot of the share page)
- [ ] If Screenshot field is empty in Notion: STOP and alert Paul
- [ ] Screenshot URL returns HTTP 200 (test with HEAD request before firing)
- [ ] Related apps are category-relevant (same niche, not random)
- [ ] H2/H3s are picked from the pool above and varied from other pages
- [ ] Primary keyword used 3-5x in body copy
- [ ] Exclusion list words checked and removed
- [ ] QR code URL is correct (test it opens in browser)
- [ ] 3 remix ideas are included as FAQ entries ("What if I want [variation]?" format)
- [ ] Remix FAQ entries show range: functional change, audience shift, and vibe/aesthetic change
