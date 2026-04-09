---
name: reddit-browser
description: "Reddit browser automation via Playwright CDP. Handles shadow DOM, commenting, and posting through AdsPower profiles."
metadata:
  openclaw:
    emoji: "🌐"
---

# Reddit Browser Automation Skill

Reddit interactions via Playwright CDP through AdsPower browser profiles.

## Scripts

| Script | Purpose |
|--------|---------|
| `skills/reddit-browser/comment.py` | Post a comment on a Reddit post (rebuilt 2026-04-09) |
| `skills/reddit-browser/reddit_browser.py` | Legacy: delete comments, create posts (use with caution) |

## Comment Script (Primary)

### Usage
```bash
python3 skills/reddit-browser/comment.py <cdp_url> <post_url> "<comment_text>"
```

### Returns
JSON to stdout:
```json
{
  "success": true,
  "screenshot": "/tmp/reddit_comments/after_submit_123.png",
  "comments": [{"author": "username", "text": "..."}],
  "url": "https://www.reddit.com/r/..."
}
```

### How It Works
1. Navigates to the post URL
2. Dismisses stale modals (Save Draft?, welcome popups)
3. Clicks `comment-composer-host` to expand the editor
4. Finds the visible `div[contenteditable="true"]` and clicks to focus
5. Types using `keyboard.type()` with human-like randomized delays
6. Finds submit button via `button[slot="submit-button"]` inside `shreddit-composer`
7. Clicks submit, waits, verifies comment appeared on page
8. Takes before/after screenshots

### Key Technical Details

**Why `keyboard.type()` and not `execCommand` or clipboard paste?**
Reddit's Lexical editor inside shadow DOM rejects `execCommand('insertText')` — text appears in DOM but the editor state doesn't register it. Clipboard paste (`navigator.clipboard` + Meta+V) is unreliable in CDP contexts. `keyboard.type()` with a delay works consistently because it fires real key events that Lexical processes.

**Human-like typing:**
- 60-120ms base delay per keystroke
- Extra 200-500ms pause after punctuation (. ! ? , ; :)
- Slight pause between words (50-150ms)
- Random micro-pauses mid-word (6% chance, 150-350ms)
- ~300 char comment takes ~40-50 seconds to type

**Comment composer structure (as of April 2026):**
```
comment-composer-host (visible, ~540x17 collapsed)
  └─ shadowRoot
      └─ faceplate-form
          └─ shreddit-composer (0x0 until expanded)
              └─ shadowRoot
                  └─ reddit-rte
                      └─ shadowRoot
                          └─ div.order-2 (contains "Join the conversation" placeholder)
                              └─ slot → div[contenteditable="true"]
```

The key insight: `shreddit-composer` itself is 0x0 and invisible. You must click `comment-composer-host` (the outer wrapper) to expand the editor. Then find the visible `contenteditable` in the regular DOM.

**Submit button:** Lives as a direct child of `shreddit-composer` with `slot="submit-button"`. Find it with:
```js
document.querySelector('shreddit-composer').querySelector('button[slot="submit-button"]')
```

**Modal handling:** Reddit shows a "Save Draft?" modal if a previous comment was abandoned. The script checks for and clicks "Discard" before attempting to type.

## Pre-Comment Checklist (For Subagents)

Before posting ANY comment through this script:

1. **Humanizer check** — Run the comment text through `skills/humanizer/SKILL.md` checklist. No AI vocabulary, no rule of three, no sycophantic openers.
2. **Persona voice** — Comment must match the persona's voice, knowledge areas, and personal experience.
3. **Account safety** — Only use email-verified, aged accounts. New/unverified accounts get shadowbanned instantly.
4. **Proxy check** — Verify the proxy IP isn't blocked before engaging. Test with: `curl -s --proxy <proxy> -o /dev/null -w '%{http_code}' https://www.reddit.com/` — must return 200.
5. **Browse first** — Join relevant subreddits and browse naturally before commenting. Don't go straight to commenting.
6. **Type slow** — The script handles this, but verify ~40-50s for a typical comment.

## Account Requirements

**Accounts WILL get banned if:**
- No email verification
- Brand new (< 1 week old) with immediate engagement
- Commenting within minutes of first login

**Safe accounts have:**
- ✅ Verified email
- ✅ Age > 1 month (ideally 3+)
- ✅ Some existing karma
- ✅ Clean proxy IP (not blocked by Reddit)

## Proxy Health Check

Check if a proxy IP is blocked by Reddit:
```bash
curl -s --proxy http://user:pass@isp.decodo.com:<port> -o /dev/null -w '%{http_code}' https://www.reddit.com/
# 200 = OK, 403/429/503 = BLOCKED
```

Check all Account A proxies:
```bash
for port in $(seq 10001 10012); do
  ip=$(curl -s --proxy http://sp1seut7gn:3=wJje7xe98vAiXzVh@isp.decodo.com:$port --max-time 10 https://api.ipify.org)
  status=$(curl -s --proxy http://sp1seut7gn:3=wJje7xe98vAiXzVh@isp.decodo.com:$port --max-time 10 -o /dev/null -w '%{http_code}' https://www.reddit.com/)
  echo "Port $port | $ip | HTTP $status"
  sleep 1
done
```

## Shadowban Detection

Check from outside the account (API method):
```bash
curl -s -A "Mozilla/5.0" "https://www.reddit.com/user/<username>/about.json"
```
- HTTP 200 + full JSON = alive
- `"is_suspended": true` = suspended
- HTTP 404 or empty = shadowbanned/deleted

For definitive check: open a DIFFERENT AdsPower profile and visit the user's profile page. If it shows "This account has been banned" — it's gone.

## Bot Detection

AdsPower passes all 31 sannysoft.com bot detection tests (verified 2026-04-09):
- `navigator.webdriver` = false ✅
- Chrome object present ✅
- All PhantomJS/headless/Selenium checks pass ✅

The automation is undetectable. Bans come from account reputation, not fingerprinting.

## Error Handling

- **"Save Draft?" modal** — Script auto-dismisses by clicking "Discard"
- **Editor not expanding** — Script scrolls `comment-composer-host` into view and retries
- **Submit button not found** — Returns error JSON with screenshot
- **Comment not verified after submit** — Reloads page and checks again
- **CAPTCHA** — Cannot be solved. Screenshot and report to admin.
- **Rate limit ("you're doing that too much")** — Stop immediately, wait 10+ minutes

## Legacy Script

`reddit_browser.py` still handles delete and post operations:
```bash
# Delete a comment
python3 skills/reddit-browser/reddit_browser.py delete_comment "<cdp_url>" "<post_url>" "<author>"

# Create a text post
python3 skills/reddit-browser/reddit_browser.py post "<cdp_url>" "<subreddit>" "<title>" "<body>"
```

These have not been rebuilt yet and may have the same issues the old comment code had. Use with caution.
