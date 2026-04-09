---
name: subscribe-subreddit
description: "Subscribe (join) a subreddit via Playwright CDP through an AdsPower browser profile. Handles welcome popups automatically."
metadata:
  openclaw:
    emoji: "📌"
---

# Subscribe Subreddit Skill

Joins a subreddit by clicking the "Join" button on the subreddit page. Handles post-subscribe welcome popups automatically.

## When to Use

Call this skill when a workflow requires subscribing/joining a subreddit. The agent must already have an AdsPower browser profile open with a valid CDP URL.

## Inputs

| Param | Required | Description |
|-------|----------|-------------|
| `cdpUrl` | ✅ | Playwright CDP websocket URL from AdsPower |
| `subreddits` | ✅ | Array of subreddit names (without r/ prefix) |

## Implementation

```javascript
const { chromium } = require('playwright');

async function subscribeSubreddits(cdpUrl, subreddits) {
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.newPage();

  const results = [];

  for (const sub of subreddits) {
    console.log(`Subscribing to r/${sub}...`);
    await page.goto(`https://www.reddit.com/r/${sub}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await page.waitForTimeout(3000 + Math.random() * 1000);

    // Check if already joined
    const alreadyJoined = page.getByRole('button', { name: /^joined$/i }).first();
    if (await alreadyJoined.isVisible().catch(() => false)) {
      console.log(`Already subscribed to r/${sub}`);
      results.push({ sub, status: 'already_joined' });
      continue;
    }

    // Click Join
    const joinBtn = page.getByRole('button', { name: /^join$/i }).first();
    if (await joinBtn.isVisible().catch(() => false)) {
      await joinBtn.click();
      await page.waitForTimeout(2000 + Math.random() * 1000);

      // *** DISMISS WELCOME POPUP ***
      // Many subreddits show a "Welcome to our subreddit!" modal after joining.
      // It has a "Got It" button that must be dismissed before continuing.
      await dismissWelcomePopup(page);

      // Verify
      const joined = page.getByRole('button', { name: /^joined$/i }).first();
      const success = await joined.isVisible().catch(() => false);
      console.log(success ? `✅ Subscribed to r/${sub}` : `⚠️ r/${sub} state unclear`);
      results.push({ sub, status: success ? 'joined' : 'unclear' });
    } else {
      console.log(`❌ No Join button found on r/${sub}`);
      results.push({ sub, status: 'no_join_button' });
    }

    // Browse briefly after subscribing (natural behavior)
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(2000 + Math.random() * 2000);
  }

  return results;
}

// Dismiss any post-subscribe welcome popup
async function dismissWelcomePopup(page) {
  const gotItBtn = page.getByRole('button', { name: /got it/i }).first();
  const visible = await gotItBtn.isVisible().catch(() => false);
  if (visible) {
    await gotItBtn.click();
    await page.waitForTimeout(1000);
    console.log('  Dismissed welcome popup');
  }
}
```

## Popup Handling

After clicking "Join", Reddit may show a welcome modal:
- **Content:** "Welcome to our subreddit, u/USERNAME!" from the mod team
- **Button:** "Got It" (dismisses the modal)
- **Must be dismissed** or it blocks further interaction with the page

The `dismissWelcomePopup()` helper checks for and dismisses this automatically.

## Selectors

| Element | Selector |
|---------|----------|
| Join button | `page.getByRole('button', { name: /^join$/i }).first()` |
| Joined state | `page.getByRole('button', { name: /^joined$/i }).first()` |
| Welcome popup dismiss | `page.getByRole('button', { name: /got it/i }).first()` |

## Safety

- **Pace:** Add 3-5 second delays between subreddit joins
- **Limit:** Don't join more than 5-10 subreddits per session
- **Natural behavior:** Scroll the feed briefly after each subscribe
- **Don't mass-subscribe** to dozens of subs at once — looks bot-like

## Error Handling

| Error | Cause | Action |
|-------|-------|--------|
| No Join button | Private sub, banned, or already joined | Check for "Joined" state, skip if private |
| Welcome popup blocks page | Didn't dismiss modal | Run `dismissWelcomePopup()` |
| Page timeout | Sub doesn't exist or Reddit is slow | Log and skip |
