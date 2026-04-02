#!/usr/bin/env python3
"""
Reddit Browser Automation via Playwright CDP.
Handles shadow DOM, Lexical editor, commenting, deleting, and posting.

Usage:
  python3 reddit_browser.py comment <cdp_url> <post_url> "<text>"
  python3 reddit_browser.py delete_comment <cdp_url> <post_url> <author>
  python3 reddit_browser.py post <cdp_url> <subreddit> "<title>" "<body>"
  python3 reddit_browser.py post_image <cdp_url> <subreddit> "<title>" "<body>" <image_path>
"""

import asyncio
import sys
import json
import os
import time

# Screenshots go here
SCREENSHOT_DIR = "/tmp/reddit_browser"
os.makedirs(SCREENSHOT_DIR, exist_ok=True)


def screenshot_path(name):
    ts = int(time.time())
    return os.path.join(SCREENSHOT_DIR, f"{name}_{ts}.png")


async def connect(cdp_url):
    from playwright.async_api import async_playwright
    pw = await async_playwright().start()
    browser = await pw.chromium.connect_over_cdp(cdp_url)
    context = browser.contexts[0]
    # Close extra tabs
    pages = context.pages
    if len(pages) > 1:
        for p in pages[1:]:
            await p.close()
    page = pages[0]
    return pw, browser, page


async def wait_and_scroll(page, url, scroll_y=0):
    """Navigate to URL, wait for load, optionally scroll."""
    await page.goto(url, wait_until="domcontentloaded", timeout=20000)
    await asyncio.sleep(5)
    if scroll_y:
        await page.evaluate(f"window.scrollTo(0, {scroll_y})")
        await asyncio.sleep(2)


async def expand_comment_editor(page):
    """Click the comment composer to expand it. Returns True if editor is found."""
    # Try multiple approaches to expand the comment editor
    
    # 1. Look for "Add a comment" text and click it
    expanded = await page.evaluate("""() => {
        // Click any "Add a comment" text
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            const text = walker.currentNode.textContent.trim();
            if (text === 'Add a comment' || text === 'Join the conversation') {
                walker.currentNode.parentElement.click();
                return 'clicked_text';
            }
        }
        // Click shreddit-composer
        const composers = document.querySelectorAll('shreddit-composer');
        for (const c of composers) {
            c.click();
            return 'clicked_composer';
        }
        return 'nothing';
    }""")
    print(f"  Expand editor: {expanded}")
    await asyncio.sleep(3)
    
    # 2. Check if a visible contenteditable appeared
    editor_info = await page.evaluate("""() => {
        const editors = document.querySelectorAll('div[contenteditable="true"]');
        for (const e of editors) {
            const rect = e.getBoundingClientRect();
            if (rect.width > 100 && rect.height > 10) {
                return {x: rect.x + rect.width/2, y: rect.y + rect.height/2, w: rect.width, h: rect.height};
            }
        }
        return null;
    }""")
    
    if not editor_info:
        # 3. Try scrolling to find it
        for scroll in [200, 400, 600, 800]:
            await page.evaluate(f"window.scrollTo(0, {scroll})")
            await asyncio.sleep(1)
            # Re-click composer
            await page.evaluate("""() => {
                const composers = document.querySelectorAll('shreddit-composer');
                for (const c of composers) { c.click(); }
            }""")
            await asyncio.sleep(2)
            editor_info = await page.evaluate("""() => {
                const editors = document.querySelectorAll('div[contenteditable="true"]');
                for (const e of editors) {
                    const rect = e.getBoundingClientRect();
                    if (rect.width > 100 && rect.height > 10) {
                        return {x: rect.x + rect.width/2, y: rect.y + rect.height/2, w: rect.width, h: rect.height};
                    }
                }
                return null;
            }""")
            if editor_info:
                break
    
    return editor_info


async def insert_text_in_editor(page, editor_info, text):
    """Insert text into a contenteditable using clipboard paste (most reliable)."""
    # Click to focus
    await page.mouse.click(editor_info['x'], editor_info['y'])
    await asyncio.sleep(1)
    await page.mouse.click(editor_info['x'], editor_info['y'])
    await asyncio.sleep(1)
    
    # Method 1: Clipboard paste via navigator.clipboard + Meta+V
    await page.evaluate("(text) => { navigator.clipboard.writeText(text).catch(() => {}); }", text)
    await asyncio.sleep(0.5)
    await page.keyboard.press("Meta+v")
    await asyncio.sleep(2)
    
    # Verify
    inserted = await page.evaluate("""() => {
        const editors = document.querySelectorAll('div[contenteditable="true"]');
        for (const e of editors) {
            const rect = e.getBoundingClientRect();
            if (rect.width > 100 && rect.height > 10 && e.textContent.length > 5) {
                return e.textContent;
            }
        }
        return null;
    }""")
    
    if inserted and len(inserted) > len(text) * 0.8:
        return inserted
    
    # Method 2: Fallback to execCommand insertText
    print("  Clipboard paste failed, trying execCommand...")
    await page.mouse.click(editor_info['x'], editor_info['y'])
    await asyncio.sleep(1)
    inserted = await page.evaluate("""(text) => {
        const editors = document.querySelectorAll('div[contenteditable="true"]');
        for (const e of editors) {
            const rect = e.getBoundingClientRect();
            if (rect.width > 100 && rect.height > 10) {
                e.focus();
                document.execCommand('insertText', false, text);
                return e.textContent;
            }
        }
        return null;
    }""", text)
    
    return inserted


async def submit_comment(page):
    """Click the Comment submit button."""
    result = await page.evaluate("""() => {
        const btns = document.querySelectorAll('button');
        for (const b of btns) {
            if (b.textContent.trim() === 'Comment' && b.type === 'submit') {
                // Verify this is a comment button, not something else
                const composer = b.closest('shreddit-composer') || b.closest('form');
                if (composer || b.getAttribute('slot') === 'submit-button') {
                    b.click();
                    return 'clicked';
                }
            }
        }
        return 'not_found';
    }""")
    return result


async def get_comments(page):
    """Get all comments on the current page."""
    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    await asyncio.sleep(2)
    return await page.evaluate("""() => {
        const r = [];
        document.querySelectorAll('shreddit-comment').forEach(c => {
            const ps = c.querySelectorAll('p');
            let t = ''; ps.forEach(p => t += p.textContent + ' ');
            r.push({
                author: c.getAttribute('author'),
                text: t.trim(),
                thingId: c.getAttribute('thingid') || ''
            });
        });
        return r;
    }""")


# ============================================================
# COMMENT
# ============================================================
async def do_comment(cdp_url, post_url, text):
    """Post a comment using insertText (no truncation)."""
    pw, browser, page = await connect(cdp_url)
    
    try:
        print(f"Navigating to {post_url}...")
        await wait_and_scroll(page, post_url, scroll_y=300)
        
        # Screenshot before
        before = screenshot_path("comment_before")
        await page.screenshot(path=before)
        print(f"Before screenshot: {before}")
        
        # Expand editor
        editor_info = await expand_comment_editor(page)
        if not editor_info:
            print("ERROR: Could not find comment editor")
            return {"success": False, "error": "editor_not_found"}
        
        print(f"  Editor found at: {editor_info}")
        
        # Insert text
        inserted = await insert_text_in_editor(page, editor_info, text)
        print(f"  Inserted text: '{inserted}'")
        
        if not inserted or not inserted.strip().startswith(text[:15]):
            print(f"ERROR: Text insertion failed. Expected '{text[:20]}...', got '{(inserted or '')[:20]}...'")
            return {"success": False, "error": "insert_failed", "got": inserted}
        
        # Submit
        submit = await submit_comment(page)
        print(f"  Submit: {submit}")
        await asyncio.sleep(5)
        
        # Verify
        comments = await get_comments(page)
        
        # Screenshot after
        after = screenshot_path("comment_after")
        await page.screenshot(path=after)
        print(f"After screenshot: {after}")
        
        # Check if our comment appears
        found = False
        for c in comments:
            if text[:30] in c['text']:
                found = True
                print(f"  VERIFIED: Comment by {c['author']}: '{c['text'][:80]}...'")
                break
        
        if not found:
            print("WARNING: Comment not found in page after submit. May need to reload.")
            # Sometimes Reddit takes a moment
            await page.reload(wait_until="domcontentloaded")
            await asyncio.sleep(5)
            comments = await get_comments(page)
            for c in comments:
                if text[:30] in c['text']:
                    found = True
                    print(f"  VERIFIED after reload: {c['text'][:80]}...")
                    break
        
        print(f"\nAll comments on page:")
        for c in comments:
            print(f"  {c['author']}: {c['text'][:120]}")
        
        return {"success": found, "screenshot": after, "comments": comments}
        
    finally:
        await pw.stop()


# ============================================================
# DELETE COMMENT
# ============================================================
async def do_delete_comment(cdp_url, post_url, author):
    """Delete the first comment by author. SAFE: verifies target is a comment, not a post."""
    pw, browser, page = await connect(cdp_url)
    
    try:
        print(f"Navigating to {post_url}...")
        await wait_and_scroll(page, post_url)
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        await asyncio.sleep(2)
        
        # Screenshot before
        before = screenshot_path("delete_before")
        await page.screenshot(path=before)
        print(f"Before screenshot: {before}")
        
        # Get comments before
        comments_before = await get_comments(page)
        author_comments = [c for c in comments_before if c['author'] == author]
        print(f"Found {len(author_comments)} comments by {author}")
        
        if not author_comments:
            return {"success": False, "error": "no_comments_by_author"}
        
        # SAFE DELETE: Use the thingId to target EXACTLY the right comment
        thing_id = author_comments[0]['thingId']
        print(f"  Targeting comment thingId: {thing_id}")
        
        # Step 1: Find and click the overflow menu for THIS specific comment
        # Use Playwright locator which pierces shadow DOM
        comment_el = page.locator(f'shreddit-comment[thingid="{thing_id}"]')
        count = await comment_el.count()
        print(f"  Found {count} matching comment elements")
        
        if count == 0:
            # Try without thingid, use author
            comment_el = page.locator(f'shreddit-comment[author="{author}"]').first
            count = await comment_el.count()
        
        # Step 2: Click "Delete comment" via shadow DOM traversal
        # This is the safest approach: we target li elements INSIDE the specific comment's overflow menu
        delete_clicked = await page.evaluate(f"""(author) => {{
            const comments = document.querySelectorAll('shreddit-comment[author="' + author + '"]');
            if (comments.length === 0) return {{step: 'find', error: 'no_comments'}};
            
            const comment = comments[0];
            
            // SAFETY CHECK: Verify this is a shreddit-comment, NOT a shreddit-post
            if (comment.tagName !== 'SHREDDIT-COMMENT') {{
                return {{step: 'safety', error: 'not_a_comment: ' + comment.tagName}};
            }}
            
            if (!comment.shadowRoot) return {{step: 'shadow', error: 'no_shadow_root'}};
            
            // Find overflow menu inside this comment's shadow root
            const menus = comment.shadowRoot.querySelectorAll('shreddit-overflow-menu');
            if (menus.length === 0) {{
                // List what IS in the shadow root for debugging
                const tags = Array.from(comment.shadowRoot.querySelectorAll('*')).map(e => e.tagName);
                return {{step: 'menu', error: 'no_overflow_menu', shadowTags: tags.slice(0, 30)}};
            }}
            
            for (const menu of menus) {{
                if (!menu.shadowRoot) continue;
                
                // Look for "Delete comment" menu item
                const items = menu.shadowRoot.querySelectorAll('li, [role="menuitem"], faceplate-tracker');
                for (const item of items) {{
                    if (item.textContent.trim().includes('Delete comment')) {{
                        // SAFETY: Double-check we're inside a shreddit-comment
                        let parent = item;
                        while (parent) {{
                            if (parent.tagName === 'SHREDDIT-COMMENT') break;
                            if (parent.tagName === 'SHREDDIT-POST') {{
                                return {{step: 'safety2', error: 'would_delete_post!'}};
                            }}
                            parent = parent.parentElement || parent.getRootNode()?.host;
                        }}
                        
                        item.click();
                        return {{step: 'delete', success: true}};
                    }}
                }}
            }}
            
            return {{step: 'find_delete', error: 'delete_item_not_found'}};
        }}""", author)
        
        print(f"  Delete click: {delete_clicked}")
        
        if not isinstance(delete_clicked, dict) or not delete_clicked.get('success'):
            return {"success": False, "error": delete_clicked}
        
        await asyncio.sleep(2)
        
        # Step 3: Confirm deletion
        # The confirmation modal appears in regular DOM or in a shadow loader
        confirm_result = await page.evaluate("""() => {
            // Try regular DOM buttons first
            const btns = document.querySelectorAll('button');
            for (const b of btns) {
                const text = b.textContent.trim();
                // Must be "Delete" in a dialog context, not just any Delete button
                if (text === 'Delete') {
                    const parent = b.closest('[role="dialog"], [role="alertdialog"], .modal, [class*="modal"]');
                    if (parent) {
                        b.click();
                        return {confirmed: true, method: 'dialog_button'};
                    }
                }
            }
            
            // Try any button that says exactly "Delete" (last resort)
            // But NOT if it's inside a shreddit-post (safety)
            for (const b of btns) {
                if (b.textContent.trim() === 'Delete') {
                    let parent = b.parentElement;
                    let safe = true;
                    while (parent) {
                        if (parent.tagName === 'SHREDDIT-POST') { safe = false; break; }
                        parent = parent.parentElement;
                    }
                    if (safe) {
                        b.click();
                        return {confirmed: true, method: 'safe_button'};
                    }
                }
            }
            
            return {confirmed: false};
        }""")
        
        print(f"  Confirm: {confirm_result}")
        await asyncio.sleep(3)
        
        if not confirm_result.get('confirmed'):
            # Try Playwright locator as last resort
            try:
                delete_btn = page.get_by_role("button", name="Delete").last
                await delete_btn.click(force=True, timeout=3000)
                print("  Confirmed via Playwright locator")
            except:
                print("  WARNING: Could not confirm deletion")
                return {"success": False, "error": "confirm_failed"}
        
        # Step 4: Verify deletion
        await page.reload(wait_until="domcontentloaded")
        await asyncio.sleep(5)
        comments_after = await get_comments(page)
        
        after = screenshot_path("delete_after")
        await page.screenshot(path=after)
        print(f"After screenshot: {after}")
        
        author_after = [c for c in comments_after if c['author'] == author]
        deleted_count = len(author_comments) - len(author_after)
        
        print(f"\nComments after deletion:")
        for c in comments_after:
            print(f"  {c['author']}: {c['text'][:120]}")
        
        return {
            "success": deleted_count > 0,
            "deleted": deleted_count,
            "remaining_by_author": len(author_after),
            "screenshot": after
        }
        
    finally:
        await pw.stop()


# ============================================================
# POST
# ============================================================
async def do_post(cdp_url, subreddit, title, body, image_path=None):
    """Create a text post (optionally with image)."""
    pw, browser, page = await connect(cdp_url)
    
    try:
        sub = subreddit.replace('r/', '').replace('/', '')
        url = f"https://www.reddit.com/r/{sub}/submit?type=TEXT"
        print(f"Navigating to {url}...")
        await wait_and_scroll(page, url)
        
        before = screenshot_path("post_before")
        await page.screenshot(path=before)
        print(f"Before screenshot: {before}")
        
        # Fill title — click the faceplate-textarea-input area
        print("Filling title...")
        await page.mouse.click(520, 270)  # Approximate title area
        await asyncio.sleep(1)
        
        # Use insertText for title too
        title_result = await page.evaluate(f"""(title) => {{
            // Find the title textarea inside faceplate-textarea-input shadow DOM
            const ftis = document.querySelectorAll('faceplate-textarea-input');
            for (const fti of ftis) {{
                if (fti.shadowRoot) {{
                    const textarea = fti.shadowRoot.querySelector('textarea');
                    if (textarea) {{
                        textarea.focus();
                        textarea.value = title;
                        textarea.dispatchEvent(new Event('input', {{bubbles: true}}));
                        return textarea.value;
                    }}
                }}
            }}
            // Fallback: click and type
            return null;
        }}""", title)
        
        if not title_result:
            # Fallback: use keyboard
            await page.keyboard.type(title, delay=10)
            await asyncio.sleep(1)
        
        print(f"  Title: {title_result or 'typed via keyboard'}")
        
        # Fill body
        print("Filling body...")
        body_editor = page.locator('div[aria-label="Post body text field"]').first
        try:
            await body_editor.click(timeout=5000)
            await asyncio.sleep(1)
        except:
            # Click by coordinates
            await page.mouse.click(520, 480)
            await asyncio.sleep(1)
        
        # Insert body via clipboard paste (most reliable)
        await page.evaluate("(text) => { navigator.clipboard.writeText(text).catch(() => {}); }", body)
        await asyncio.sleep(0.5)
        await page.keyboard.press("Meta+v")
        await asyncio.sleep(2)
        
        body_result = await page.evaluate("""() => {
            const editor = document.querySelector('div[aria-label="Post body text field"]');
            if (editor && editor.textContent.length > 5) return editor.textContent.substring(0, 80);
            const editors = document.querySelectorAll('div[contenteditable="true"]');
            for (const e of editors) {
                if (e.textContent.length > 5) return e.textContent.substring(0, 80);
            }
            return null;
        }""")
        print(f"  Body: {body_result or 'FAILED'}")
        
        if not body_result:
            return {"success": False, "error": "body_insert_failed"}
        
        # Upload image if provided
        if image_path and os.path.exists(image_path):
            print(f"Uploading image: {image_path}")
            try:
                file_input = page.locator('input[type="file"]').first
                await file_input.set_input_files(image_path, timeout=5000)
                print("  Image uploaded")
                await asyncio.sleep(3)
            except Exception as e:
                print(f"  Image upload failed: {e}")
        
        # Screenshot before submit
        pre_submit = screenshot_path("post_pre_submit")
        await page.screenshot(path=pre_submit)
        print(f"Pre-submit screenshot: {pre_submit}")
        
        # Submit
        print("Submitting...")
        post_btn = page.locator('button:has-text("Post")').last
        try:
            await post_btn.click(timeout=10000)
        except:
            # Force via JS
            await page.evaluate("""() => {
                const btns = document.querySelectorAll('button');
                for (const b of btns) {
                    if (b.textContent.trim() === 'Post') { b.click(); return true; }
                }
            }""")
        
        await asyncio.sleep(8)
        
        post_url = page.url
        print(f"Post URL: {post_url}")
        
        after = screenshot_path("post_after")
        await page.screenshot(path=after)
        print(f"After screenshot: {after}")
        
        return {
            "success": "/comments/" in post_url,
            "url": post_url,
            "screenshot": after
        }
        
    finally:
        await pw.stop()


# ============================================================
# MAIN
# ============================================================
async def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    
    action = sys.argv[1]
    
    if action == "comment" and len(sys.argv) >= 5:
        result = await do_comment(sys.argv[2], sys.argv[3], sys.argv[4])
    elif action == "delete_comment" and len(sys.argv) >= 5:
        result = await do_delete_comment(sys.argv[2], sys.argv[3], sys.argv[4])
    elif action == "post" and len(sys.argv) >= 6:
        result = await do_post(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
    elif action == "post_image" and len(sys.argv) >= 7:
        result = await do_post(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], sys.argv[6])
    else:
        print(f"Unknown action or missing args: {action}")
        print(__doc__)
        sys.exit(1)
    
    print(f"\n=== RESULT ===")
    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    asyncio.run(main())
