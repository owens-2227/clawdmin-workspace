---
name: upvote-button
description: "Finds and clicks the Reddit upvote button on a post or comment via Playwright CDP. Accepts a CDP websocket URL and a target Reddit URL."
metadata:
  openclaw:
    emoji: "⬆️"
---

# Up Button Skill

Clicks the Reddit upvote button on a given post or comment page using browser automation via CDP (Chrome DevTools Protocol).

## When to Use

Call this skill when a workflow requires upvoting a Reddit post or comment. The agent must already have an AdsPower browser profile open with a valid CDP URL.

## Inputs

| Param | Required | Description |
|-------|----------|-------------|
| `cdpUrl` | ✅ | Playwright CDP websocket URL from AdsPower |
| `targetUrl` | ✅ | Reddit post or comment URL to upvote |

## How It Works

1. Connect to the browser via CDP
2. Navigate to the target Reddit URL
3. Wait for the page to fully load
4. Locate the upvote button using Reddit's `<button>` element with `upvote` attribute and `aria-pressed="false"`
5. Click it
6. Verify `aria-pressed` changed to `"true"`
7. Return success/failure

## Reddit Upvote Button Selector

Reddit uses web components (`<shreddit-post>`) with **shadow DOM**. The upvote button is inside the shadow root.

**Best approach — Playwright locator (pierces shadow DOM automatically):**
```typescript
page.getByRole('button', { name: /^upvote$/i }).first()
```

**Alternative CSS selector (also works because Playwright pierces shadow DOM):**
```
shreddit-post button[rpl][aria-pressed="false"]
```

The button:
- Has `aria-pressed="false"` when not voted → changes to `"true"` after clicking
- Text content is "Upvote"
- The upvote arrow turns orange and vote count increments on success

## Implementation

```typescript
import { chromium } from 'playwright';

async function upvotePost(cdpUrl: string, targetUrl: string): Promise<{ success: boolean; error?: string }> {
  const browser = await chromium.connectOverCDP(cdpUrl);
  
  try {
    const contexts = browser.contexts();
    const context = contexts[0];
    const page = context?.pages()[0] || await context.newPage();
    
    // Navigate to the target post
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000); // Let Reddit's JS hydrate
    
    // Use Playwright locator — pierces shadow DOM automatically
    const upvoteBtn = page.getByRole('button', { name: /^upvote$/i }).first();
    
    // Check current state
    const currentState = await upvoteBtn.getAttribute('aria-pressed').catch(() => null);
    
    if (currentState === null) {
      return { success: false, error: 'Upvote button not found' };
    }
    
    if (currentState === 'true') {
      return { success: true, error: 'Already upvoted' };
    }
    
    // Click the upvote button
    await upvoteBtn.click();
    await page.waitForTimeout(3000);
    
    // Verify the vote registered
    const afterState = await upvoteBtn.getAttribute('aria-pressed');
    const verified = afterState === 'true';
    
    return { 
      success: !!verified,
      error: verified ? undefined : 'Click did not register (aria-pressed still false)'
    };
    
  } finally {
    // Don't close the browser — AdsPower manages the lifecycle
  }
}
```

## Usage in a Workflow

```typescript
// 1. Open AdsPower profile
const profileRes = await fetch('http://local.adspower.net:50325/api/v1/browser/start?user_id=k1abonj2');
const { data } = await profileRes.json();
const cdpUrl = data.ws.puppeteer;

// 2. Upvote
const result = await upvotePost(cdpUrl, 'https://www.reddit.com/r/homeautomation/comments/1rwckiw/...');
console.log(result); // { success: true }

// 3. Close profile when done
await fetch('http://local.adspower.net:50325/api/v1/browser/stop?user_id=k1abonj2');
```

## Error Handling

| Error | Cause | Action |
|-------|-------|--------|
| `Upvote button not found` | Page didn't load, Reddit changed DOM, or post is archived | Log and skip |
| `Already upvoted` | Post was previously upvoted by this account | Treat as success |
| `Click did not register` | Rate limit, shadow ban, or JS timing | Retry once after 2s, then skip |
| CDP connection failed | AdsPower profile not open | Open profile first |

## Safety

- **Rate limit**: Don't upvote more than 10 posts per session per account
- **Timing**: Add 2-6 second random delay between upvotes
- **Natural behavior**: Browse the page before upvoting — don't just navigate + click + leave
- **Never upvote your own posts** from the same account (obvious ban risk)
