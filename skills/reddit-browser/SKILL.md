---
name: reddit-browser
description: "Reddit browser automation via Playwright CDP. Handles shadow DOM, Lexical editor, commenting, deleting, and posting through AdsPower profiles."
metadata:
  openclaw:
    emoji: "🌐"
---

# Reddit Browser Automation Skill

Reliable Reddit interactions via Playwright CDP through AdsPower browser profiles. Handles Reddit's shadow DOM and Lexical editor quirks.

## Script Location

`skills/reddit-browser/reddit_browser.py`

## Commands

### Comment on a post
```bash
python3 skills/reddit-browser/reddit_browser.py comment \
  "<cdp_url>" \
  "<post_url>" \
  "<comment_text>"
```

### Delete a specific comment
```bash
python3 skills/reddit-browser/reddit_browser.py delete_comment \
  "<cdp_url>" \
  "<post_url>" \
  "<author_username>"
```
Deletes the FIRST comment by `<author>` on the post. Run multiple times to delete multiple comments.

### Create a text post
```bash
python3 skills/reddit-browser/reddit_browser.py post \
  "<cdp_url>" \
  "<subreddit>" \
  "<title>" \
  "<body>"
```

### Create a text post with image
```bash
python3 skills/reddit-browser/reddit_browser.py post_image \
  "<cdp_url>" \
  "<subreddit>" \
  "<title>" \
  "<body>" \
  "<image_path>"
```

## Key Technical Details

### Why not keyboard.type()?
Reddit's Lexical editor inside shadow DOM eats the first ~30 characters when using `keyboard.type()`. The editor isn't fully focused when typing begins.

**Solution:** `document.execCommand('insertText', false, text)` — injects text directly into the focused contenteditable without keystroke timing issues.

### Shadow DOM Structure
Reddit's new UI nests components 3-4 levels deep:
```
shreddit-comment
  └─ shadowRoot
      └─ shreddit-overflow-menu
          └─ shadowRoot
              └─ button (More options — HIDDEN until hover)
              └─ faceplate-menu
                  └─ li (Delete comment / Edit comment)
```

### Safety: Delete vs Post Delete
The delete function MUST verify it's targeting a comment element, not the post. It checks:
1. The parent element is `shreddit-comment` (not `shreddit-post`)
2. The author matches the expected username
3. Takes a screenshot before confirming

### Comment Composer
```
shreddit-composer[placeholder="Add a comment" or "Join the conversation"]
  └─ (click to expand)
  └─ div[contenteditable="true"][role="textbox"]
      └─ (use insertText here)
```

## Error Handling
- If login is needed: returns error with instructions
- If CAPTCHA appears: returns error, do NOT attempt to solve
- If rate limited: returns error with wait time
- All actions take before/after screenshots for verification

## Testing Protocol
Before using on live content:
1. Create a test post on r/test
2. Comment on it
3. Delete the comment
4. Verify all screenshots
5. Only then use on real subreddits
