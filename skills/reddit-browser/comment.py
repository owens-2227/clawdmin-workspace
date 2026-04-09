#!/usr/bin/env python3
"""
Reddit Comment Script — Clean rebuild.

Posts a comment on a Reddit post via Playwright CDP through AdsPower profiles.

Usage:
    python3 comment.py <cdp_url> <post_url> "<comment_text>"

Returns JSON result to stdout with success/failure and screenshot paths.
"""

import asyncio
import sys
import json
import os
import time
import random


async def human_type(page, text):
    """Type text with human-like timing — variable delays, slight pauses between words."""
    for i, char in enumerate(text):
        await page.keyboard.press(char if len(char) == 1 else char)
        # Base delay 60-120ms per character
        delay = random.uniform(0.06, 0.12)
        # Longer pause after punctuation
        if char in '.!?,;:':
            delay += random.uniform(0.15, 0.4)
        # Slight pause between words
        elif char == ' ':
            delay += random.uniform(0.03, 0.12)
        # Occasional micro-pause mid-word (thinking)
        elif random.random() < 0.05:
            delay += random.uniform(0.1, 0.25)
        await asyncio.sleep(delay)

SCREENSHOT_DIR = "/tmp/reddit_comments"
os.makedirs(SCREENSHOT_DIR, exist_ok=True)


def ss(name):
    """Generate a timestamped screenshot path."""
    return os.path.join(SCREENSHOT_DIR, f"{name}_{int(time.time())}.png")


async def comment(cdp_url: str, post_url: str, text: str) -> dict:
    from playwright.async_api import async_playwright

    pw = await async_playwright().start()
    browser = await pw.chromium.connect_over_cdp(cdp_url)
    ctx = browser.contexts[0]

    # Use first page, close extras
    pages = ctx.pages
    if len(pages) > 1:
        for p in pages[1:]:
            await p.close()
    page = pages[0]

    try:
        # 1. Navigate
        await page.goto(post_url, wait_until="domcontentloaded", timeout=20000)
        await asyncio.sleep(5)

        # Dismiss any stale modals/popups (Save Draft?, welcome popups, etc.)
        for _ in range(3):
            # Check for "Discard" button (Save Draft modal)
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
            
            # Check for any modal close buttons
            closed = await page.evaluate("""() => {
                // rpl-modal-card close buttons
                const close = document.querySelector('button[aria-label="Close"]');
                if (close) { const r = close.getBoundingClientRect(); if (r.width > 0) { close.click(); return true; } }
                return false;
            }""")
            if closed:
                await asyncio.sleep(1)
                continue
            break

        await asyncio.sleep(0.5)

        # 2. Find and click comment-composer-host to expand editor
        pos = await page.evaluate("""() => {
            const hosts = document.querySelectorAll('comment-composer-host');
            for (const h of hosts) {
                const r = h.getBoundingClientRect();
                if (r.width > 100) {
                    h.scrollIntoView({block: 'center'});
                    return null; // scroll first
                }
            }
            return null;
        }""")
        await asyncio.sleep(1)

        pos = await page.evaluate("""() => {
            const hosts = document.querySelectorAll('comment-composer-host');
            for (const h of hosts) {
                const r = h.getBoundingClientRect();
                if (r.width > 100) {
                    return {x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2)};
                }
            }
            return null;
        }""")

        if not pos:
            return {"success": False, "error": "comment_composer_host_not_found"}

        await page.mouse.click(pos["x"], pos["y"])
        await asyncio.sleep(2)

        # 3. Find expanded contenteditable editor
        ed = await page.evaluate("""() => {
            const eds = document.querySelectorAll('div[contenteditable="true"]');
            for (const e of eds) {
                const r = e.getBoundingClientRect();
                if (r.width > 100 && r.height > 10) {
                    return {x: Math.round(r.x + 10), y: Math.round(r.y + 10)};
                }
            }
            return null;
        }""")

        if not ed:
            return {"success": False, "error": "editor_not_expanded"}

        # 4. Click editor, type comment
        await page.mouse.click(ed["x"], ed["y"])
        await asyncio.sleep(0.5)
        await human_type(page, text)
        await asyncio.sleep(1)

        # 5. Verify text was inserted
        content = await page.evaluate("""() => {
            const eds = document.querySelectorAll('div[contenteditable="true"]');
            for (const e of eds) {
                const r = e.getBoundingClientRect();
                if (r.width > 100 && r.height > 10) return e.textContent;
            }
            return '';
        }""")

        if text[:20] not in (content or ""):
            return {"success": False, "error": "text_not_inserted", "editor_content": content}

        # Screenshot before submit
        before_ss = ss("before_submit")
        await page.screenshot(path=before_ss)

        # 6. Find and click the Comment submit button
        btn_pos = await page.evaluate("""() => {
            // Primary: button with slot="submit-button" inside shreddit-composer
            const composer = document.querySelector('shreddit-composer');
            if (composer) {
                const btn = composer.querySelector('button[slot="submit-button"]');
                if (btn) {
                    const r = btn.getBoundingClientRect();
                    if (r.width > 0) return {x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2)};
                }
            }
            // Fallback: visible submit button with text "Comment"
            const btns = document.querySelectorAll('button[type="submit"]');
            for (const b of btns) {
                if (b.textContent.trim() === 'Comment') {
                    const r = b.getBoundingClientRect();
                    if (r.width > 0) return {x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2)};
                }
            }
            return null;
        }""")

        if not btn_pos:
            return {"success": False, "error": "submit_button_not_found", "screenshot": before_ss}

        await page.mouse.click(btn_pos["x"], btn_pos["y"])
        await asyncio.sleep(6)

        # 7. Verify comment appeared
        after_ss = ss("after_submit")
        await page.screenshot(path=after_ss)

        comments = await page.evaluate("""() => {
            const results = [];
            document.querySelectorAll('shreddit-comment').forEach(c => {
                const author = c.getAttribute('author');
                const ps = c.querySelectorAll('p');
                let t = '';
                ps.forEach(p => t += p.textContent + ' ');
                results.push({author: author, text: t.trim()});
            });
            return results;
        }""")

        found = any(text[:30] in c["text"] for c in comments)

        if not found:
            # Retry: reload and check again (Reddit can be slow)
            await page.reload(wait_until="domcontentloaded")
            await asyncio.sleep(5)
            comments = await page.evaluate("""() => {
                const results = [];
                document.querySelectorAll('shreddit-comment').forEach(c => {
                    const author = c.getAttribute('author');
                    const ps = c.querySelectorAll('p');
                    let t = '';
                    ps.forEach(p => t += p.textContent + ' ');
                    results.push({author: author, text: t.trim()});
                });
                return results;
            }""")
            found = any(text[:30] in c["text"] for c in comments)
            after_ss = ss("after_reload")
            await page.screenshot(path=after_ss)

        return {
            "success": found,
            "screenshot": after_ss,
            "comments": [c for c in comments if text[:20] in c.get("text", "")],
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
    if len(sys.argv) < 4:
        print(f"Usage: python3 {sys.argv[0]} <cdp_url> <post_url> <comment_text>")
        sys.exit(1)

    cdp_url = sys.argv[1]
    post_url = sys.argv[2]
    text = sys.argv[3]

    result = await comment(cdp_url, post_url, text)
    print(json.dumps(result, indent=2))

    sys.exit(0 if result.get("success") else 1)


if __name__ == "__main__":
    asyncio.run(main())
