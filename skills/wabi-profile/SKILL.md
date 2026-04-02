---
name: wabi-profile
description: "Replicate Reddit personas on Wabi, search/launch/remix/edit apps, publish and get share URLs for Reddit posts/comments."
metadata:
  openclaw:
    emoji: "🔗"
---

# Wabi Profile to Reddit Profile Link Tool

Mirrors Reddit personas onto Wabi, finds relevant apps, launches + remixes them under the persona's Wabi account, optionally edits, then publishes to get share URLs for use in Reddit posts/comments.

## When to Use

| Trigger | Steps |
|---------|-------|
| Paul creates a new Reddit persona and asks to replicate on Wabi | **Step 1** — Create Wabi user |
| Paul identifies an app that fits a persona (by name or ID) | **Steps 2 → 3 → 4** — Search (if needed) → Launch → Remix |
| Paul asks to edit the app (title, description, icon) | **Step 5** — Edit app settings |
| Paul asks to create content / get a share link | **Step 6** — Publish + Get URL |

## Config

```
Base URL: https://api.wabi.ai/api/v1
Internal API Key: o|088%tx7ZL1beJ5yPZaKclb|L0?RQWn?%u*?vy$x5ESdKnkj69qR~kgK3FP|Sx0fR1acfk3Rk3~yBQ2EinipR2Db|SrxEO$BYg
Admin user id: 6998c40ee0bfec37743cf811
```

## Authentication

Use test tokens for all API calls in prod:
```
Authorization: Bearer test_{user_id}
X-Api-Key: o|088%tx7ZL1beJ5yPZaKclb|L0?RQWn?%u*?vy$x5ESdKnkj69qR~kgK3FP|Sx0fR1acfk3Rk3~yBQ2EinipR2Db|SrxEO$BYg
```

**Important:** Use Python `urllib` or `requests` for API calls — the API key has special shell characters (`|`, `%`, `$`, `~`, etc.) that get mangled by bash/curl.

---

## Step 1: Replicate Wabi User

```
POST /api/v1/admin/user/create
```

Auth: None (unprotected endpoint).

```json
{ "display_name": "Maya C", "email": "maya@example.com" }
```

Save the `data.id` → becomes auth token: `test_{id}`

---

## Step 2: Search Apps (if no app ID given)

### Full-text search
```
POST /api/v1/social/es-search
```
```json
{ "query": "meal planner", "limit": 5, "search_type": "apps" }
```

### Browse by section
```
GET /api/v1/social/explore/list?section=popular&limit=20
```

Sections: `popular`, `featured`, `recently_added`, `following_users`

**Skip this step if you already have the app ID.**

---

## Step 3: Launch an App

**Required before remixing.** Adds app to user's homescreen and creates a personal copy.

```
POST /api/v1/app/launch?id={app_id}
```

`app_id` = the explore/search ID or the ID Paul provides.

Response `data.id` = the **launched copy ID**. Use THIS for remix.

---

## Step 4: Remix the App

```
POST /api/v1/social/apps/{launched_id}/remix
```

`launched_id` = the ID from Step 3 (NOT the original app ID).

Response `data.id` = the **remixed copy ID**. Use this for editing and publishing.

---

## Step 5: Edit App (optional)

### 5a. Update settings (recommended)
```
PATCH /api/v1/app/{remixed_id}/settings
```
```json
{
  "main_data": {
    "title": "My Custom Title",
    "description": "Updated description"
  }
}
```

### 5b. Update main data (legacy)
```
POST /api/v1/app/update-main-data?id={remixed_id}
```
```json
{
  "title": "New Title",
  "description": "New description",
  "main_color": "#3498DB"
}
```

### 5c. Regenerate icon
```
POST /api/v1/app/regenerate-image?id={remixed_id}&save=true
```
```json
{ "override_prompt": "a colorful breathing exercise icon" }
```

---

## Step 6: Publish & Get Share URL

```
POST /api/v1/app/publish?app_id={remixed_id}
```

Response: `data.url_v3` = share URL (e.g. `https://wabi.ai/@maya_chen_travel/breathwork-1040544?_v=1`)

---

## Full Flow (Python)

```python
import urllib.request, json

API_KEY = 'o|088%tx7ZL1beJ5yPZaKclb|L0?RQWn?%u*?vy$x5ESdKnkj69qR~kgK3FP|Sx0fR1acfk3Rk3~yBQ2EinipR2Db|SrxEO$BYg'
BASE = 'https://api.wabi.ai/api/v1'

def api(method, path, user_id, data=None):
    headers = {
        'Authorization': f'Bearer test_{user_id}',
        'X-Api-Key': API_KEY,
        'Content-Type': 'application/json',
    }
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(f'{BASE}{path}', method=method, headers=headers, data=body)
    resp = urllib.request.urlopen(req)
    return json.loads(resp.read())

# 1. Create user
user = api('POST', '/admin/user/create', '', data={"display_name": "Maya C"})
user_id = user['data']['id']

# 3. Launch app (skip step 2 if we have the app ID)
launched = api('POST', f'/app/launch?id={APP_ID}', user_id)
launched_id = launched['data']['id']

# 4. Remix
remixed = api('POST', f'/social/apps/{launched_id}/remix', user_id)
remixed_id = remixed['data']['id']

# 5. (optional) Edit
api('PATCH', f'/app/{remixed_id}/settings', user_id, data={
    "main_data": {"title": "My App", "description": "Custom description"}
})

# 6. Publish
published = api('POST', f'/app/publish?app_id={remixed_id}', user_id)
share_url = published['data']['url_v3']
```

---

## Persona ↔ Wabi User Mapping

| Reddit Persona | Reddit Username | Wabi User ID | Wabi Username | Status |
|---------------|----------------|--------------|---------------|--------|
| Maya C | u/tiolenssesg | 69bb185d479eb73002fd69a9 | maya_chen_travel | ✅ Created |
| Jess M | u/Known-Train2059 | — | — | Not created |
| Owen B | u/portraftwerb | — | — | Not created |
| Dave R | u/ofexfrog | — | — | Not created |
| Marco V | u/unjuvals | — | — | Not created |

## Maya's Apps

| App | Original ID | Remixed ID | Share URL |
|-----|------------|------------|-----------|
| Breathwork | 696c53807c5a4fa5f4c38b4d | 69bb2a3a4dc8e9e70ad576a5 | https://wabi.ai/@maya_chen_travel/breathwork-1040544?_v=1 |

---

## Error Handling

| Error | Cause | Action |
|-------|-------|--------|
| `Test tokens are not valid in prod` | Missing or wrong X-Api-Key | Check API key |
| 404 on remix | Didn't launch first, or used wrong ID | Must launch → use launched ID for remix |
| 401 Unauthorized | Bad token format | Use `test_{user_id}` format |
| App not found in search | Wrong query | Try broader terms or browse sections |
