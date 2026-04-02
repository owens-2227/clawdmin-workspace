---
name: flint
description: "Manage Flint marketing sites via their Agent Tasks API. Create and monitor background agent tasks that modify sites — generate pages, update content, and track task completion. Use when asked to create, update, or generate pages on a Flint site."
metadata:
  openclaw:
    emoji: "🔥"
---

# Flint Agent Tasks API

Programmatically create and monitor background agent tasks that modify Flint marketing sites.

## Prerequisites

- Flint Enterprise plan
- API key from [Flint team settings](https://app.tryflint.com/app/team)
- Site ID (UUID) for the target site

## Configuration

Store your API key in the workspace `TOOLS.md` or `.env`:

```
FLINT_API_KEY=your-api-key-here
FLINT_BASE_URL=https://app.tryflint.com/api/v1
```

## Authentication

All requests require the API key in the Authorization header:

```bash
curl -H "Authorization: Bearer <FLINT_API_KEY>" \
     -H "Content-Type: application/json" \
     <FLINT_BASE_URL>/agent/tasks
```

## Operations

### 1. Create a Task (Prompt Mode)

Use prompt mode to give the agent free-form instructions:

```bash
curl -X POST "<FLINT_BASE_URL>/agent/tasks" \
  -H "Authorization: Bearer <FLINT_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "siteId": "<SITE_UUID>",
    "prompt": "Add a new pricing page with three tiers: Starter ($9/mo), Pro ($29/mo), and Enterprise (custom). Include feature comparisons and a FAQ section.",
    "callbackUrl": "https://your-webhook.com/flint-callback"
  }'
```

**Response (200):**
```json
{
  "taskId": "task_abc123",
  "status": "in_progress"
}
```

### 2. Create a Task (Generate Pages Command)

Use `generate_pages` to batch-create pages from a template:

```bash
curl -X POST "<FLINT_BASE_URL>/agent/tasks" \
  -H "Authorization: Bearer <FLINT_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "siteId": "<SITE_UUID>",
    "command": "generate_pages",
    "templatePageSlug": "/blog/template",
    "items": [
      {
        "targetPageSlug": "/blog/how-to-start",
        "context": "Write about getting started with our product. Target beginners.",
        "externalId": "post-001"
      },
      {
        "targetPageSlug": "/blog/advanced-tips",
        "context": "Advanced tips for power users. Include performance optimization.",
        "externalId": "post-002"
      }
    ]
  }'
```

**Limits:** Up to 10 items per request.

### 3. Check Task Status

```bash
curl "<FLINT_BASE_URL>/agent/tasks/<TASK_ID>" \
  -H "Authorization: Bearer <FLINT_API_KEY>"
```

**In Progress:**
```json
{
  "taskId": "task_abc123",
  "status": "in_progress"
}
```

**Completed:**
```json
{
  "taskId": "task_abc123",
  "status": "completed",
  "output": {
    "pagesCreated": [
      { "slug": "/pricing", "previewUrl": "https://...", "editUrl": "https://..." }
    ],
    "pagesModified": [],
    "pagesDeleted": []
  }
}
```

**Failed:**
```json
{
  "taskId": "task_abc123",
  "status": "failed",
  "error": "Description of what went wrong"
}
```

## Polling Strategy

Tasks run asynchronously. Poll the GET endpoint until completion:

```bash
# Poll every 5 seconds, up to 5 minutes
TASK_ID="task_abc123"
for i in $(seq 1 60); do
  STATUS=$(curl -s "<FLINT_BASE_URL>/agent/tasks/$TASK_ID" \
    -H "Authorization: Bearer <FLINT_API_KEY>" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
  echo "Attempt $i: $STATUS"
  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then
    break
  fi
  sleep 5
done
```

**Recommended intervals:**
- First 30 seconds: poll every 5s
- After 30 seconds: poll every 10s
- Max wait: 5 minutes before timing out

## Callback Webhooks (Alternative to Polling)

Instead of polling, provide a `callbackUrl` when creating a task. Flint will POST to that URL on completion.

**Requirements:**
- Must be HTTPS
- No localhost or private IPs
- Flint retries up to 3 times with exponential backoff (starting at 5s) on non-2xx responses

**Success callback payload:**
```json
{
  "taskId": "task_abc123",
  "status": "succeeded",
  "pages": [
    { "slug": "/pricing", "previewUrl": "https://..." }
  ],
  "commitHash": "abc123def",
  "timestamp": "2026-03-16T12:00:00Z"
}
```

**Failure callback payload:**
```json
{
  "taskId": "task_abc123",
  "status": "failed",
  "error": "Description of what went wrong",
  "timestamp": "2026-03-16T12:00:00Z"
}
```

## Workflow for Common Tasks

### Generate Blog Posts from a Template

1. Identify the template page slug (e.g., `/blog/template`)
2. Prepare items array with target slugs and context
3. Create task with `generate_pages` command
4. Poll or wait for callback
5. Review generated pages via `previewUrl` links

### Update Existing Pages

1. Get the site ID
2. Create a prompt-mode task describing the changes
3. Poll for completion
4. Review `pagesModified` in the output

### Create a New Page from Scratch

1. Create a prompt-mode task with detailed page description
2. Include layout preferences, content sections, and CTAs in the prompt
3. Poll for completion
4. Review via `previewUrl`

## Error Handling

| Status | Error | Action |
|--------|-------|--------|
| 400 | "Site is missing repository information" | Site needs git repo configured in Flint |
| 400 | "Invalid callback URL" | Must be HTTPS, no localhost/private IPs |
| 404 | "Site not found" | Check site ID is correct |
| 429 | Rate limited | Back off and retry after `Retry-After` header |
| 500 | "Failed to start task" | Retry once, then report |

## Rate Limits

The API is rate-limited. Best practices:
- Don't fire multiple tasks for the same site simultaneously
- Space batch operations at least 10 seconds apart
- Respect 429 responses and `Retry-After` headers
- Use callbacks instead of aggressive polling

## Security Notes

- API keys are organization-scoped and require member role permissions
- Never expose API keys in client-side code or public repos
- Rotate keys periodically via Flint team settings
