# Flint Agent Tasks API — Quick Reference

## Base URL

```
https://app.tryflint.com/api/v1
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/agent/tasks` | Create a new agent task |
| GET | `/agent/tasks/{taskId}` | Get task status and results |

## Create Task — Request Body

### Prompt Mode

```json
{
  "siteId": "uuid",           // Required — target site
  "prompt": "string",         // Required* — free-form instructions
  "callbackUrl": "string"     // Optional — HTTPS webhook URL
}
```

### Command Mode (generate_pages)

```json
{
  "siteId": "uuid",                    // Required
  "command": "generate_pages",         // Required
  "templatePageSlug": "/path/to/template",  // Optional — template page
  "items": [                           // Required — max 10 items
    {
      "targetPageSlug": "/blog/my-post",    // Required
      "context": "Content instructions",     // Required
      "externalId": "optional-tracking-id"   // Optional
    }
  ],
  "callbackUrl": "string"             // Optional
}
```

*`prompt` is required when not using command mode.

## Task Status Values

| Status | Meaning |
|--------|---------|
| `in_progress` | Task is running |
| `completed` | Task finished successfully |
| `failed` | Task encountered an error |

## Output Object (on completion)

```json
{
  "pagesCreated": [{ "slug": "/path", "previewUrl": "...", "editUrl": "..." }],
  "pagesModified": [{ "slug": "/path", "previewUrl": "...", "editUrl": "..." }],
  "pagesDeleted": [{ "slug": "/path", "previewUrl": null, "editUrl": null }]
}
```

## Callback Payload

**Success:**
```json
{
  "taskId": "string",
  "status": "succeeded",
  "pages": [{ "slug": "string", "previewUrl": "string" }],
  "commitHash": "string",
  "timestamp": "ISO 8601"
}
```

**Failure:**
```json
{
  "taskId": "string",
  "status": "failed",
  "error": "string",
  "timestamp": "ISO 8601"
}
```

## Error Codes

| Code | Meaning |
|------|---------|
| 400 | Bad request (missing repo, invalid callback URL) |
| 404 | Site or task not found |
| 429 | Rate limited — respect Retry-After |
| 500 | Server error — retry once |

## Auth Header

```
Authorization: Bearer <API_KEY>
Content-Type: application/json
```
