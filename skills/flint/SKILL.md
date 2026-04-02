---
name: flint
description: "Manage Flint marketing sites via their Agent Tasks API. Create and monitor background agent tasks that modify sites — generate pages, update content, and track task completion. Use when asked to create, update, or generate pages on a Flint site."
metadata:
  openclaw:
    emoji: "🔥"
---

# Flint Agent Tasks API

Programmatically create and monitor background agent tasks that modify Flint marketing sites.

## Config (from TOOLS.md)

```
API key:  ak_E7WFVNH5C0VZGFETBE9S5DSM9JR49D36
Base URL: https://app.tryflint.com/api/v1
Site ID:  12628d27-7872-468a-aa54-c4780cf3284b
```

## Authentication

All requests use the API key in the Authorization header:

```python
headers = {
    "Authorization": "Bearer ak_E7WFVNH5C0VZGFETBE9S5DSM9JR49D36",
    "Content-Type": "application/json"
}
```

---

## Wabi App Landing Page — Complete Schema

The landing page template is `apps/kitty-diabetes` at:
`https://wabi-app-pages-v2.vercel.app/apps/kitty-diabetes`

To create a new app page, send a prompt to Flint saying:
**"Make me a duplicate of the page `apps/kitty-diabetes` with the following details"**
followed by the complete JSON object below.

### Full Page Data Schema

```json
{
  "app": {
    "name": "App Name",
    "category": "Category (e.g. Pet health, Health & Wellness)",
    "icon_url": "https://... (square icon/cover image from Wabi cover_image_url)",
    "screenshot_url": "https://... (app screenshot, hosted on GitHub raw or similar)",
    "screenshot_alt": "Descriptive alt text for the screenshot, ~1 sentence, SEO-friendly",
    "creator_avatar_url": "https://... (optional: creator profile pic)"
  },
  "hero": {
    "headline": "SEO-optimized headline. Format: '[Do X] Without [Pain] with [App Name] on Wabi'",
    "subhead": "1-2 sentence description. What it does + key differentiator (free, no subscription, etc.)",
    "stat": "A real, specific credibility stat. E.g. '1 in 230 cats develops diabetes, and most owners track it manually'"
  },
  "story": {
    "problem": "2-3 sentences. Named creator + their pain point. Specific and personal, not generic.",
    "solution": "2-3 sentences. How the app solves it. End with a concrete outcome."
  },
  "features": [
    {
      "icon": "PhosphorIconName",
      "title": "Feature name (2-4 words)",
      "description": "One sentence, action-oriented. What it lets you DO."
    }
  ],
  "alternatives": [
    {
      "icon": "Table | AppStoreLogo | NotePencil | etc.",
      "name": "Competitor or alternative name",
      "description": "One sentence — what it is",
      "drawback": "Their specific weakness — be concrete, not vague"
    }
  ],
  "faq": [
    {
      "question": "Question phrased as a user would Google it (SEO-targeted)",
      "answer": "2-4 sentences. Mention the app name. Include the key benefit."
    }
  ],
  "community": "2-3 sentences. Who uses it, where they hang out (mention subreddits), emotional context.",
  "related_apps": [
    {
      "name": "Related App Name",
      "slug": "related-app-slug",
      "description": "One sentence."
    }
  ],
  "cta": {
    "app_store_url": "https://wabi.ai/@persona/app-slug?_v=1 (the Wabi share URL)",
    "qr_code_url": "https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=ENCODED_SHARE_URL"
  },
  "trust_signals": [
    { "title": "Free", "subtitle": "No hidden costs" },
    { "title": "No login", "subtitle": "Just open and use" },
    { "title": "Works offline", "subtitle": "No internet needed" },
    { "title": "Built on Wabi", "subtitle": "Open platform" }
  ],
  "seo": {
    "primary_keyword": "main search term (e.g. 'cat diabetes tracker app')",
    "secondary_keywords": ["variant 1", "variant 2", "variant 3", "variant 4", "variant 5"]
  }
}
```

### Section-by-Section Notes

**`hero.headline`**
- Format: "[Verb] [Problem] Without [Pain] with [App Name] on Wabi"
- Example: "Track Your Cat's Diabetes Without Spreadsheets with Kitty Diabetes Tracker on Wabi"
- Must include the app name and platform ("on Wabi") for SEO
- This also becomes the page `<title>` and og:title

**`hero.stat`**
- Must be a REAL, specific data point — not generic social proof like "Used by thousands"
- Pull from Reddit posts, published studies, or industry data
- Bad: "Used by thousands managing anxiety"
- Good: "1 in 230 cats develops diabetes, and most owners track it manually"

**`story`**
- Give the creator a name (real persona name or "Sarah", "Maya", etc.)
- Problem should describe the manual/broken existing workflow in detail
- Solution should end with a concrete outcome ("...no spreadsheets, no desktop required")

**`features`**
- 4-6 features ideal
- Icons use Phosphor icon names: Syringe, ChartLineUp, BowlFood, ClockCounterClockwise, Export, BellRinging, Wind, Timer, Zap, BarChart2, etc.
- Descriptions should start with an action verb

**`alternatives`**
- 3 alternatives: one paid app, one free app/tool, one analog (pen+paper or spreadsheet)
- Drawback must be specific: "$70/year subscription", "No trends, easy to lose" — not "less convenient"

**`faq`**
- 3-5 questions
- Format questions as Google searches: "How do I...", "Is there a free...", "What's the best..."
- Each answer should mention the app name once

**`community`**
- Mention specific subreddits where the target audience hangs out
- Add emotional context ("people who are tired of...", "cat owners who've been managing for years")

**`trust_signals`**
- Keep the 4 standard signals: Free, No login, Works offline, Built on Wabi
- Customize subtitles if needed for the app

**`seo`**
- Primary keyword: "[problem] app" or "[niche] tracker" format
- Secondary keywords: 4-5 variants, long-tail versions of the primary
- These populate the page's `<meta keywords>` and inform the copy

**`cta.qr_code_url`**
- Use: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data={URL_ENCODED_SHARE_URL}`
- URL-encode the Wabi share URL
- This is a free, permanent, always-live QR code — no hosting needed

### Asset URLs

**Icon (app_icon_url):**
- Pull from Wabi API: `GET /app/{remixed_id}` → `data.cover_image_url`
- This is the CloudFront CDN URL for the app's cover image

**Screenshot:**
- Host on GitHub raw: `https://raw.githubusercontent.com/owens-2227/clawdmin-workspace/main/BRAIN/assets/{filename}`
- Commit the screenshot file to the workspace repo first: `git add -f BRAIN/assets/screenshot.png && git commit && git push`
- Note: GitHub raw CDN can take 1-5 minutes to propagate after a new push

**Creator avatar:**
- Optional — use `/assets/profile-picture.png` as default (handled by Flint template)
- Or provide a real URL if available

---

## Prompt Template for New App Page

```
Make me a duplicate of the page `apps/kitty-diabetes` with the following details

{
  ... full JSON object from schema above ...
}

The page slug should be `apps/{app-slug}`. Match the design, layout, and component structure of `apps/kitty-diabetes` exactly — just swap in the new content.
```

---

## API Operations

### Create a Task

```python
import urllib.request, json, urllib.parse

FLINT_API_KEY = "ak_E7WFVNH5C0VZGFETBE9S5DSM9JR49D36"
SITE_ID = "12628d27-7872-468a-aa54-c4780cf3284b"

payload = json.dumps({
    "siteId": SITE_ID,
    "prompt": "<your prompt here>"
}).encode()

req = urllib.request.Request(
    "https://app.tryflint.com/api/v1/agent/tasks",
    method="POST",
    headers={
        "Authorization": f"Bearer {FLINT_API_KEY}",
        "Content-Type": "application/json"
    },
    data=payload
)
result = json.loads(urllib.request.urlopen(req, timeout=30).read())
task_id = result["taskId"]
print(f"Task created: {task_id}")
```

### Poll Task Status

```python
def poll_task(task_id, max_minutes=15):
    import time
    for i in range(max_minutes * 6):
        req = urllib.request.Request(
            f"https://app.tryflint.com/api/v1/agent/tasks/{urllib.parse.quote(task_id, safe='')}",
            headers={"Authorization": f"Bearer {FLINT_API_KEY}"}
        )
        result = json.loads(urllib.request.urlopen(req, timeout=15).read())
        status = result.get("status")
        print(f"[{i*10}s] {status}")
        if status in ("completed", "succeeded", "failed"):
            return result
        time.sleep(10)
    return None
```

**Task typically takes 5-15 minutes.** Don't poll faster than every 10 seconds.

### Response on Completion

```json
{
  "taskId": "...",
  "status": "completed",
  "output": {
    "pagesCreated": [
      { "slug": "/apps/breathwork", "previewUrl": "https://...", "editUrl": "https://..." }
    ],
    "pagesModified": [],
    "pagesDeleted": []
  }
}
```

---

## Error Handling

| Status | Error | Action |
|--------|-------|--------|
| 400 | "Site is missing repository information" | Site needs git repo configured in Flint |
| 400 | "Invalid callback URL" | Must be HTTPS, no localhost/private IPs |
| 404 | "Site not found" | Check site ID is correct |
| 405 | Method Not Allowed on GET /agent/tasks | Expected — endpoint only accepts POST |
| 429 | Rate limited | Back off, retry after `Retry-After` header |
| 500 | "Failed to start task" | Retry once, then report |

## Rate Limits
- Don't fire multiple tasks for the same site simultaneously
- Space batch operations ≥10 seconds apart
- Use polling intervals of 10s minimum
