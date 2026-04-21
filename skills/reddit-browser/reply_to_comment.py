#!/usr/bin/env python3
"""
Reddit Reply-to-Comment Script

Replies to a specific user's comment on a Reddit post via Playwright CDP through AdsPower profiles.
Unlike comment.py (which posts top-level comments), this finds a specific comment by author/text
and clicks its Reply button to post a nested reply.

Usage:
    python3 reply_to_comment.py <cdp_url> <post_url> --target-author "<username>" "<reply_text>"
    python3 reply_to_comment.py <cdp_url> <post_url> --target-text "<partial_text>" "<reply_text>"
    python3 reply_to_comment.py <cdp_url> <post_url> --target-id "<thing_id>" "<reply_text>"

Returns JSON result to stdout with success/failure, screenshot paths, and comment details.
"""

import asyncio
import sys
import json
import os
import time
import random
import argparse


async def human_type(page, text):
    """Type text with human-like timing — variable delays, slight pauses between words."""
    for i, char in enumerate(text):
        await page.keyboard.press(char if len(char) == 1 else char)
        delay = random.uniform(0.06, 0.12)
        if char in '.!?,;:':
            delay += random.uniform(0.15, 0.4)
        elif char == ' ':
            delay += random.uniform(0.03, 0.12)
        elif random.random() < 0.05:
            delay += random.uniform(0.1, 0.25)
        await asyncio.sleep(delay)


SCREENSHOT_DIR = "/tmp/reddit_comments"
os.makedirs(SCREENSHOT_DIR, exist_ok=True)


def ss(name):
    """Generate a timestamped screenshot path."""
    return os.path.join(SCREENSHOT_DIR, f"{name}_{int(time.time())}.png")


async def dismiss_modals(page):
    """Dismiss stale modals (Save Draft?, welcome popups, etc.)"""
    for _ in range(3):
        discard_pos = await page.evaluate("""() => {
            const btns = document.querySelectorAll('button');
            for (const b of btns) {
                if (b.textContent.trim() === 'Discard') {
                    const r = b.getBoundingClientRect();
                    if (r.width > 0) return {x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2)};
                }
            }
            return null;
        }""")
        if discard_pos:
            await page.mouse.click(discard_pos["x"], discard_pos["y"])
            await asyncio.sleep(2)
            continue

        closed = await page.evaluate("""() => {
            const close = document.querySelector('button[aria-label="Close"]');
            if (close) { const r = close.getBoundingClientRect(); if (r.width > 0) { close.click(); return true; } }
            return false;
        }""")
        if closed:
            await asyncio.sleep(1)
            continue
        break


async def find_target_comment(page, target_author=None, target_text=None, target_id=None):
    """Find the target comment element and return its info.

    Returns dict with thingId, author, text, and bounding rect of the comment element.
    """
    result = await page.evaluate("""(opts) => {
        const comments = document.querySelectorAll('shreddit-comment');
        for (const c of comments) {
            const author = c.getAttribute('author') || '';
            const thingId = c.getAttribute('thingid') || '';
            const ps = c.querySelectorAll('p');
            let text = '';
            ps.forEach(p => text += p.textContent + ' ');
            text = text.trim();

            let match = false;
            if (opts.targetId && thingId === opts.targetId) match = true;
            if (opts.targetAuthor && author.toLowerCase() === opts.targetAuthor.toLowerCase()) match = true;
            if (opts.targetText && text.toLowerCase().includes(opts.targetText.toLowerCase())) match = true;

            if (match) {
                const r = c.getBoundingClientRect();
                return {
                    thingId: thingId,
                    author: author,
                    text: text.substring(0, 200),
                    rect: {x: r.x, y: r.y, width: r.width, height: r.height}
                };
            }
        }
        return null;
    }""", {
        "targetId": target_id,
        "targetAuthor": target_author,
        "targetText": target_text,
    })
    return result


async def expand_more_replies(page):
    """Click 'more replies' / 'View more comments' buttons to load deeper threads."""
    for _ in range(3):
        clicked = await page.evaluate("""() => {
            // Look for "more reply" / "more replies" / "View more comments" buttons
            const btns = document.querySelectorAll('button, faceplate-partial');
            for (const b of btns) {
                const text = (b.textContent || '').trim().toLowerCase();
                if ((text.includes('more repl') || text.includes('view more') || text.includes('more comment'))
                    && !text.includes('award')) {
                    const r = b.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) {
                        b.scrollIntoView({block: 'center'});
                        b.click();
                        return true;
                    }
                }
            }
            return false;
        }""")
        if clicked:
            await asyncio.sleep(3)
        else:
            break


async def reply_to_comment(cdp_url: str, post_url: str, reply_text: str,
                           target_author=None, target_text=None, target_id=None) -> dict:
    from playwright.async_api import async_playwright

    pw = await async_playwright().start()
    browser = await pw.chromium.connect_over_cdp(cdp_url)
    ctx = browser.contexts[0]

    pages = ctx.pages
    if len(pages) > 1:
        for p in pages[1:]:
            await p.close()
    page = pages[0]

    try:
        # 1. Navigate to post
        await page.goto(post_url, wait_until="domcontentloaded", timeout=20000)
        await asyncio.sleep(5)
        await dismiss_modals(page)

        # 2. Try to expand more replies if needed
        await expand_more_replies(page)

        # 3. Find target comment
        target = await find_target_comment(page, target_author, target_text, target_id)

        if not target:
            # Scroll down and try again — comment might be below fold
            for scroll in [500, 1000, 2000, 3000]:
                await page.evaluate(f"window.scrollTo(0, {scroll})")
                await asyncio.sleep(2)
                await expand_more_replies(page)
                target = await find_target_comment(page, target_author, target_text, target_id)
                if target:
                    break

        if not target:
            err_ss = ss("target_not_found")
            await page.screenshot(path=err_ss)
            return {
                "success": False,
                "error": "target_comment_not_found",
                "target_author": target_author,
                "target_text": target_text,
                "target_id": target_id,
                "screenshot": err_ss,
            }

        print(f"Found target: {target['author']} — \"{target['text'][:80]}...\"", file=sys.stderr)

        # 4. Scroll target comment into view
        await page.evaluate("""(thingId) => {
            const c = document.querySelector('shreddit-comment[thingid="' + thingId + '"]');
            if (c) c.scrollIntoView({block: 'center'});
        }""", target["thingId"])
        await asyncio.sleep(1)

        # 5. Find and click the Reply button for this specific comment
        # The reply button is inside the comment's shadow DOM
        reply_clicked = await page.evaluate("""(thingId) => {
            const comment = document.querySelector('shreddit-comment[thingid="' + thingId + '"]');
            if (!comment) return {error: 'comment_element_not_found'};

            // Method 1: Look for reply button in the comment's action bar
            // The reply button is typically a <button> with aria-label containing "Reply"
            // or text content "Reply" inside the comment element
            const btns = comment.querySelectorAll('button');
            for (const b of btns) {
                const ariaLabel = (b.getAttribute('aria-label') || '').toLowerCase();
                const text = b.textContent.trim().toLowerCase();
                if (ariaLabel.includes('reply') || text === 'reply') {
                    const r = b.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) {
                        return {x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), method: 'button'};
                    }
                }
            }

            // Method 2: Check shadow DOM of the comment
            if (comment.shadowRoot) {
                const shadowBtns = comment.shadowRoot.querySelectorAll('button');
                for (const b of shadowBtns) {
                    const ariaLabel = (b.getAttribute('aria-label') || '').toLowerCase();
                    const text = b.textContent.trim().toLowerCase();
                    if (ariaLabel.includes('reply') || text === 'reply') {
                        const r = b.getBoundingClientRect();
                        if (r.width > 0 && r.height > 0) {
                            return {x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), method: 'shadow_button'};
                        }
                    }
                }

                // Method 3: Look for shreddit-comment-action-row inside shadow DOM
                const actionRows = comment.shadowRoot.querySelectorAll('shreddit-comment-action-row');
                for (const row of actionRows) {
                    if (row.shadowRoot) {
                        const rowBtns = row.shadowRoot.querySelectorAll('button');
                        for (const b of rowBtns) {
                            const ariaLabel = (b.getAttribute('aria-label') || '').toLowerCase();
                            const text = b.textContent.trim().toLowerCase();
                            if (ariaLabel.includes('reply') || text === 'reply') {
                                const r = b.getBoundingClientRect();
                                if (r.width > 0 && r.height > 0) {
                                    return {x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), method: 'action_row_shadow'};
                                }
                            }
                        }
                    }
                    // Also check regular DOM inside action row
                    const rowBtns2 = row.querySelectorAll('button');
                    for (const b of rowBtns2) {
                        const ariaLabel = (b.getAttribute('aria-label') || '').toLowerCase();
                        const text = b.textContent.trim().toLowerCase();
                        if (ariaLabel.includes('reply') || text === 'reply') {
                            const r = b.getBoundingClientRect();
                            if (r.width > 0 && r.height > 0) {
                                return {x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), method: 'action_row'};
                            }
                        }
                    }
                }
            }

            // Method 4: Use Playwright-visible buttons near the comment
            // Collect all visible reply-like buttons with their positions
            const allBtns = document.querySelectorAll('button');
            const commentRect = comment.getBoundingClientRect();
            let closest = null;
            let closestDist = Infinity;
            for (const b of allBtns) {
                const text = b.textContent.trim().toLowerCase();
                const ariaLabel = (b.getAttribute('aria-label') || '').toLowerCase();
                if (ariaLabel.includes('reply') || text === 'reply') {
                    const r = b.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) {
                        // Find the reply button closest to the bottom of this comment
                        const dist = Math.abs(r.y - (commentRect.y + commentRect.height));
                        if (dist < closestDist && dist < 200) {
                            closestDist = dist;
                            closest = {x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), method: 'proximity', dist: dist};
                        }
                    }
                }
            }
            if (closest) return closest;

            return {error: 'reply_button_not_found'};
        }""", target["thingId"])

        if isinstance(reply_clicked, dict) and reply_clicked.get("error"):
            # Last resort: try Playwright locator to pierce shadow DOM
            try:
                comment_loc = page.locator(f'shreddit-comment[thingid="{target["thingId"]}"]')
                reply_btn = comment_loc.get_by_role("button", name="Reply").first
                await reply_btn.scroll_into_view_if_needed(timeout=3000)
                await reply_btn.click(timeout=3000)
                reply_clicked = {"method": "playwright_locator"}
            except Exception as e:
                err_ss = ss("reply_btn_not_found")
                await page.screenshot(path=err_ss)
                return {
                    "success": False,
                    "error": "reply_button_not_found",
                    "target": target,
                    "detail": str(reply_clicked),
                    "screenshot": err_ss,
                }

        if "x" in reply_clicked:
            await page.mouse.click(reply_clicked["x"], reply_clicked["y"])

        print(f"Reply button clicked via: {reply_clicked.get('method', 'unknown')}", file=sys.stderr)
        await asyncio.sleep(3)

        # 6. Find the nested reply editor that appeared
        # After clicking Reply, a new comment-composer appears nested under the target comment
        ed = await page.evaluate("""(thingId) => {
            // Look for contenteditable editors that appeared after clicking reply
            // The reply editor should be near/inside the target comment
            const comment = document.querySelector('shreddit-comment[thingid="' + thingId + '"]');
            if (!comment) return null;

            const commentRect = comment.getBoundingClientRect();

            // Find all visible contenteditable editors
            const eds = document.querySelectorAll('div[contenteditable="true"]');
            let best = null;
            let bestDist = Infinity;
            for (const e of eds) {
                const r = e.getBoundingClientRect();
                if (r.width > 50 && r.height > 5) {
                    // Pick the editor closest to (and below) the target comment
                    const dist = Math.abs(r.y - (commentRect.y + commentRect.height));
                    if (dist < bestDist) {
                        bestDist = dist;
                        best = {x: Math.round(r.x + 10), y: Math.round(r.y + 10), dist: dist, w: r.width, h: r.height};
                    }
                }
            }
            return best;
        }""", target["thingId"])

        if not ed:
            # Maybe need to wait more for editor to expand
            await asyncio.sleep(3)
            ed = await page.evaluate("""() => {
                const eds = document.querySelectorAll('div[contenteditable="true"]');
                for (const e of eds) {
                    const r = e.getBoundingClientRect();
                    if (r.width > 50 && r.height > 5) {
                        return {x: Math.round(r.x + 10), y: Math.round(r.y + 10), w: r.width, h: r.height};
                    }
                }
                return null;
            }""")

        if not ed:
            err_ss = ss("reply_editor_not_found")
            await page.screenshot(path=err_ss)
            return {
                "success": False,
                "error": "reply_editor_not_expanded",
                "target": target,
                "screenshot": err_ss,
            }

        # 7. Click editor and type reply
        await page.mouse.click(ed["x"], ed["y"])
        await asyncio.sleep(0.5)
        await human_type(page, reply_text)
        await asyncio.sleep(1)

        # 8. Verify text was inserted
        content = await page.evaluate("""() => {
            const eds = document.querySelectorAll('div[contenteditable="true"]');
            for (const e of eds) {
                const r = e.getBoundingClientRect();
                if (r.width > 50 && r.height > 5 && e.textContent.length > 5) return e.textContent;
            }
            return '';
        }""")

        if reply_text[:20] not in (content or ""):
            err_ss = ss("text_not_inserted")
            await page.screenshot(path=err_ss)
            return {
                "success": False,
                "error": "text_not_inserted",
                "editor_content": content,
                "screenshot": err_ss,
            }

        before_ss = ss("before_submit")
        await page.screenshot(path=before_ss)

        # 9. Find and click submit button for the reply editor
        # The reply's submit button is inside a shreddit-composer near the target comment
        btn_pos = await page.evaluate("""(thingId) => {
            const comment = document.querySelector('shreddit-comment[thingid="' + thingId + '"]');
            if (!comment) return null;
            const commentRect = comment.getBoundingClientRect();

            // Find all shreddit-composers and pick the one near our comment
            const composers = document.querySelectorAll('shreddit-composer');
            for (const composer of composers) {
                const cRect = composer.getBoundingClientRect();
                // Must be below or overlapping the target comment
                if (Math.abs(cRect.y - commentRect.y) < 800) {
                    const btn = composer.querySelector('button[slot="submit-button"]');
                    if (btn) {
                        const r = btn.getBoundingClientRect();
                        if (r.width > 0 && r.height > 0) {
                            return {x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), method: 'composer_submit'};
                        }
                    }
                }
            }

            // Fallback: find any visible "Comment" submit button closest to comment
            const allBtns = document.querySelectorAll('button[type="submit"], button[slot="submit-button"]');
            let best = null;
            let bestDist = Infinity;
            for (const b of allBtns) {
                const text = b.textContent.trim();
                if (text === 'Comment' || text === 'Reply') {
                    const r = b.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) {
                        const dist = Math.abs(r.y - (commentRect.y + commentRect.height));
                        if (dist < bestDist) {
                            bestDist = dist;
                            best = {x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), method: 'fallback_submit'};
                        }
                    }
                }
            }
            return best;
        }""", target["thingId"])

        if not btn_pos:
            err_ss = ss("submit_not_found")
            await page.screenshot(path=err_ss)
            return {
                "success": False,
                "error": "reply_submit_button_not_found",
                "screenshot": err_ss,
            }

        await page.mouse.click(btn_pos["x"], btn_pos["y"])
        await asyncio.sleep(6)

        # 10. Verify reply appeared
        after_ss = ss("reply_after_submit")
        await page.screenshot(path=after_ss)

        comments = await page.evaluate("""() => {
            const results = [];
            document.querySelectorAll('shreddit-comment').forEach(c => {
                const author = c.getAttribute('author');
                const parentId = c.getAttribute('parentid') || '';
                const thingId = c.getAttribute('thingid') || '';
                const depth = c.getAttribute('depth') || '0';
                const ps = c.querySelectorAll('p');
                let t = '';
                ps.forEach(p => t += p.textContent + ' ');
                results.push({author, text: t.trim(), thingId, parentId, depth: parseInt(depth)});
            });
            return results;
        }""")

        found = any(reply_text[:30] in c["text"] for c in comments)

        if not found:
            await page.reload(wait_until="domcontentloaded")
            await asyncio.sleep(5)
            comments = await page.evaluate("""() => {
                const results = [];
                document.querySelectorAll('shreddit-comment').forEach(c => {
                    const author = c.getAttribute('author');
                    const parentId = c.getAttribute('parentid') || '';
                    const thingId = c.getAttribute('thingid') || '';
                    const depth = c.getAttribute('depth') || '0';
                    const ps = c.querySelectorAll('p');
                    let t = '';
                    ps.forEach(p => t += p.textContent + ' ');
                    results.push({author, text: t.trim(), thingId, parentId, depth: parseInt(depth)});
                });
                return results;
            }""")
            found = any(reply_text[:30] in c["text"] for c in comments)
            after_ss = ss("reply_after_reload")
            await page.screenshot(path=after_ss)

        our_reply = [c for c in comments if reply_text[:20] in c.get("text", "")]

        return {
            "success": found,
            "screenshot": after_ss,
            "target_comment": target,
            "our_reply": our_reply,
            "url": page.url,
        }

    except Exception as e:
        err_ss = ss("error")
        try:
            await page.screenshot(path=err_ss)
        except:
            pass
        return {"success": False, "error": str(e), "screenshot": err_ss}

    finally:
        await pw.stop()


async def main():
    parser = argparse.ArgumentParser(description="Reply to a specific Reddit comment")
    parser.add_argument("cdp_url", help="CDP WebSocket URL from AdsPower")
    parser.add_argument("post_url", help="Full Reddit post URL")
    parser.add_argument("reply_text", help="Text of the reply to post")
    parser.add_argument("--target-author", help="Username of the comment to reply to")
    parser.add_argument("--target-text", help="Partial text match of the comment to reply to")
    parser.add_argument("--target-id", help="thingId of the comment to reply to")

    args = parser.parse_args()

    if not any([args.target_author, args.target_text, args.target_id]):
        print("ERROR: Must specify at least one of --target-author, --target-text, or --target-id", file=sys.stderr)
        sys.exit(1)

    result = await reply_to_comment(
        args.cdp_url,
        args.post_url,
        args.reply_text,
        target_author=args.target_author,
        target_text=args.target_text,
        target_id=args.target_id,
    )
    print(json.dumps(result, indent=2))
    sys.exit(0 if result.get("success") else 1)


if __name__ == "__main__":
    asyncio.run(main())
