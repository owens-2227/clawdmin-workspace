---
name: adspower
description: "Manage AdsPower anti-detect browser profiles via local API. Open/close browser sessions and get CDP connection URLs for Playwright automation."
metadata:
  openclaw:
    emoji: "🌐"
---

# AdsPower Browser Management

Control AdsPower browser profiles via its local REST API. Each Reddit persona has a dedicated AdsPower profile with unique browser fingerprint.

## API Base URL

```
http://127.0.0.1:50325/api/v1
```

**Important:** Must use `127.0.0.1`, NOT `local.adspower.net`. Auth header required: `Authorization: Bearer <api-key>`

## Profile Mapping

| Agent      | AdsPower Serial # | Description |
|------------|-------------------|-------------|
| jess-m     | 1                 | Jess M - New mom persona |
| owen-b     | 2                 | Owen B - WFH remote worker persona |
| maya-chen  | 3                 | Maya C - Young professional persona |

## Operations

### Open a Browser Profile

```bash
curl -s "http://local.adspower.net:50325/api/v1/browser/start?serial_number=1"
```

**Response** (success):
```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "ws": {
      "puppeteer": "ws://127.0.0.1:XXXXX/devtools/browser/GUID",
      "selenium": "127.0.0.1:XXXXX"
    },
    "debug_port": "XXXXX"
  }
}
```

**Key fields**:
- `data.ws.puppeteer` — WebSocket URL for Playwright/Puppeteer CDP connection
- `data.debug_port` — CDP debug port number

### Check if Profile is Active

```bash
curl -s "http://local.adspower.net:50325/api/v1/browser/active?serial_number=1"
```

**Response**:
```json
{
  "code": 0,
  "data": {
    "status": "Active"
  }
}
```

Status values: `"Active"` or `"Inactive"`

### Close a Browser Profile

```bash
curl -s "http://local.adspower.net:50325/api/v1/browser/stop?serial_number=1"
```

### Check AdsPower API Status

```bash
curl -s "http://local.adspower.net:50325/api/v1/status"
```

## Workflow for Admin Agent

1. **Before delegating**: Open the target agent's AdsPower profile
2. **Parse response**: Extract `data.ws.puppeteer` CDP URL
3. **Pass to subagent**: Include CDP URL in the `sessions_spawn` task parameter
4. **After completion**: Close the AdsPower profile to free resources

## Workflow for Subagents

1. **Receive CDP URL** in task instructions from Admin
2. **Connect browser tool** to the CDP endpoint
3. **Navigate and interact** with Reddit via the browser tool
4. **Do NOT close** the AdsPower profile — Admin handles lifecycle

## Error Handling

- If `code` is not `0`, the operation failed — check `msg` for details
- If profile fails to open, wait 10 seconds and retry once
- If profile is already active, use the existing session (call active check first)
- Common error: "Profile is being used" — another process has it open
- If AdsPower API is unreachable, report to Admin/operator immediately

## Important Notes

- Only one session per profile at a time
- Always close profiles after use to avoid resource leaks
- AdsPower must be running locally before any API calls
- Each profile has its own cookies, fingerprint, and proxy settings
- Do NOT modify profile settings via API — only open/close
