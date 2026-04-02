#!/usr/bin/env python3
"""
Reddit browser actions via Playwright CDP.
Handles shadow DOM, Lexical editor, and all the Reddit new UI quirks.

Usage:
  python3 reddit_actions.py comment <cdp_url> <post_url> "<text>"
  python3 reddit_actions.py delete_comments <cdp_url> <post_url> <author>
  python3 reddit_actions.py post <cdp_url> <subreddit> "<title>" "<body>"
"""

import asyncio
import sys
import json
from playwright.async_api import async_playwright


async def _connect(cdp_url):
    pw = await async_playwright().start()
    browser = await pw.chromium.connect_over_cdp(cdp_url)
    context = browser.contexts[0]
    page = context.pages[0]
    return pw, browser, page


async def comment(cdp_url, post_url, text):
    """Post a comment on a Reddit post using clipboard paste."""
    pw, browser, page = await _connect(cdp_url)
    
    try:
        await page.goto(post_url, wait_until="domcontentloaded", timeout=15000)
        await asyncio.sleep(5)
        
        # Scroll down slightly to reveal comment area
        await page.evaluate("window.scrollTo(0, 300)")
        await asyncio.sleep(2)
        
        # Click the composer to expand it
        clicked = await page.evaluate("""() => {
            // Try clicking any "Add a comment" text
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
                if (walker.currentNode.textContent.trim() === 'Add a comment') {
                    walker.currentNode.parentElement.click();
                    return 'clicked_add_comment';
                }
            }
            // Try clicking composer directly
            const composers = document.querySelectorAll('shreddit-composer');
            for (const c of composers) {
                if (c.getAttribute('placeholder')?.includes('conversation') || c.getAttribute('placeholder')?.includes('comment')) {
                    c.click();
                    return 'clicked_composer';
                }
            }
            return 'nothing_found';
        }""")
        print(f"Expand: {clicked}")
        await asyncio.sleep(3)
        
        # Find the visible contenteditable and click it
        found = await page.evaluate("""() => {
            const editors = document.querySelectorAll('div[contenteditable="true"]');
            for (const e of editors) {
                const rect = e.getBoundingClientRect();
                if (rect.width > 100 && rect.height > 10) {
                    e.focus();
                    e.click();
                    return {x: rect.x + rect.width/2, y: rect.y + rect.height/2};
                }
            }
            return null;
        }""")
        
        if not found:
            # Try scrolling more
            await page.evaluate("window.scrollTo(0, 600)")
            await asyncio.sleep(2)
            found = await page.evaluate("""() => {
                const editors = document.querySelectorAll('div[contenteditable="true"]');
                for (const e of editors) {
                    const rect = e.getBoundingClientRect();
                    if (rect.width > 100 && rect.height > 10) {
                        e.focus();
                        e.click();
                        return {x: rect.x + rect.width/2, y: rect.y + rect.height/2};
                    }
                }
                return null;
            }""")
        
        if not found:
            print("ERROR: Could not find comment editor")
            return False
        
        print(f"Editor at: {found}")
        
        # Click to ensure focus
        await page.mouse.click(found['x'], found['y'])
        await asyncio.sleep(1)
        await page.mouse.click(found['x'], found['y'])
        await asyncio.sleep(1)
        
        # Use clipboard paste instead of keyboard.type()
        # This avoids the Lexical editor eating initial keystrokes
        await page.evaluate(f"""(text) => {{
            // Copy text to clipboard via execCommand
            const textarea = document.createElement('textarea');
            textarea.value = text;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
        }}""", text)
        
        # Paste
        await page.keyboard.press("Meta+v")
        await asyncio.sleep(2)
        
        # Verify the text
        editor_text = await page.evaluate("""() => {
            const editors = document.querySelectorAll('div[contenteditable="true"]');
            for (const e of editors) {
                if (e.textContent.length > 5) return e.textContent;
            }
            return '';
        }""")
        print(f"Editor contains: '{editor_text}'")
        
        if not editor_text or len(editor_text) < len(text) * 0.8:
            # Clipboard didn't work, try alternative: set via Lexical
            print("Clipboard paste may have failed, trying insertText...")
            await page.mouse.click(found['x'], found['y'])
            await asyncio.sleep(1)
            # Use document.execCommand insertText
            await page.evaluate(f"""(text) => {{
                document.execCommand('insertText', false, text);
            }}""", text)
            await asyncio.sleep(1)
            
            editor_text = await page.evaluate("""() => {
                const editors = document.querySelectorAll('div[contenteditable="true"]');
                for (const e of editors) {
                    if (e.textContent.length > 5) return e.textContent;
                }
                return '';
            }""")
            print(f"After insertText: '{editor_text}'")
        
        if not editor_text.strip().startswith(text[:10]):
            print(f"WARNING: Text may be wrong. Expected starts with '{text[:20]}', got '{editor_text[:20]}'")
        
        # Submit
        submitted = await page.evaluate("""() => {
            const btns = document.querySelectorAll('button');
            for (const b of btns) {
                if (b.textContent.trim() === 'Comment' && b.type === 'submit') {
                    b.click();
                    return true;
                }
            }
            return false;
        }""")
        print(f"Submit: {submitted}")
        await asyncio.sleep(5)
        
        # Take verification screenshot
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        await asyncio.sleep(2)
        await page.screenshot(path="/tmp/reddit_comment_result.png")
        
        # Verify comment exists
        comments = await page.evaluate("""() => {
            const r = [];
            document.querySelectorAll('shreddit-comment').forEach(c => {
                const ps = c.querySelectorAll('p');
                let t = ''; ps.forEach(p => t += p.textContent + ' ');
                r.push({author: c.getAttribute('author'), text: t.trim()});
            });
            return r;
        }""")
        print("Comments on page:")
        for c in comments:
            print(f"  {c['author']}: {c['text'][:120]}")
        
        return True
        
    finally:
        await pw.stop()


async def delete_comments(cdp_url, post_url, author):
    """Delete all comments by a specific author on a post."""
    pw, browser, page = await _connect(cdp_url)
    
    try:
        await page.goto(post_url, wait_until="domcontentloaded", timeout=15000)
        await asyncio.sleep(5)
        
        # Scroll to show comments
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        await asyncio.sleep(2)
        
        # Count comments by author
        count = await page.evaluate(f"""(author) => {{
            let count = 0;
            document.querySelectorAll('shreddit-comment').forEach(c => {{
                if (c.getAttribute('author') === author) count++;
            }});
            return count;
        }}""", author)
        print(f"Found {count} comments by {author}")
        
        for i in range(count):
            print(f"Deleting comment {i+1}/{count}...")
            
            # Click the overflow menu via JS inside shadow DOM
            menu_clicked = await page.evaluate(f"""(author) => {{
                const comments = document.querySelectorAll('shreddit-comment');
                for (const c of comments) {{
                    if (c.getAttribute('author') === author) {{
                        // Look for overflow menu in shadow root
                        if (c.shadowRoot) {{
                            const menu = c.shadowRoot.querySelector('shreddit-overflow-menu');
                            if (menu) {{
                                // Click the trigger button inside the menu's shadow root
                                if (menu.shadowRoot) {{
                                    const trigger = menu.shadowRoot.querySelector('button');
                                    if (trigger) {{ trigger.click(); return 'clicked_trigger'; }}
                                }}
                                menu.click();
                                return 'clicked_menu';
                            }}
                            // Try finding any button with more/overflow semantics
                            const btns = c.shadowRoot.querySelectorAll('button');
                            for (const b of btns) {{
                                const label = b.getAttribute('aria-label') || b.textContent;
                                if (label && (label.includes('more') || label.includes('overflow') || label.includes('options'))) {{
                                    b.click();
                                    return 'clicked_btn_' + label;
                                }}
                            }}
                        }}
                        return 'no_menu_found';
                    }}
                }}
                return 'no_comment_found';
            }}""", author)
            print(f"  Menu: {menu_clicked}")
            await asyncio.sleep(2)
            
            # Look for Delete in any popup/menu
            deleted = await page.evaluate("""() => {
                // Check regular DOM for menu items
                const items = document.querySelectorAll('*');
                for (const item of items) {
                    if (item.children.length === 0 && item.textContent.trim() === 'Delete') {
                        item.click();
                        return 'clicked_delete';
                    }
                }
                // Check menu-items, li elements
                const menuItems = document.querySelectorAll('menu-item, li, [role="menuitem"]');
                for (const mi of menuItems) {
                    if (mi.textContent.trim().includes('Delete')) {
                        mi.click();
                        return 'clicked_menu_item';
                    }
                }
                return 'delete_not_found';
            }""")
            print(f"  Delete: {deleted}")
            await asyncio.sleep(2)
            
            # Confirm
            confirmed = await page.evaluate("""() => {
                // Look for confirmation dialog
                const btns = document.querySelectorAll('button');
                for (const b of btns) {
                    if (b.textContent.trim() === 'Delete' || b.textContent.trim() === 'Yes') {
                        b.click();
                        return 'confirmed';
                    }
                }
                // Check for shreddit-confirm-modal
                const modals = document.querySelectorAll('shreddit-async-loader, [bundlename="confirm_modal"]');
                for (const m of modals) {
                    if (m.shadowRoot) {
                        const btns = m.shadowRoot.querySelectorAll('button');
                        for (const b of btns) {
                            if (b.textContent.trim() === 'Delete') {
                                b.click();
                                return 'confirmed_shadow';
                            }
                        }
                    }
                }
                return 'no_confirm';
            }""")
            print(f"  Confirm: {confirmed}")
            await asyncio.sleep(3)
        
        await page.screenshot(path="/tmp/reddit_delete_result.png")
        return True
        
    finally:
        await pw.stop()


async def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    
    action = sys.argv[1]
    
    if action == "comment":
        cdp_url, post_url, text = sys.argv[2], sys.argv[3], sys.argv[4]
        await comment(cdp_url, post_url, text)
    elif action == "delete_comments":
        cdp_url, post_url, author = sys.argv[2], sys.argv[3], sys.argv[4]
        await delete_comments(cdp_url, post_url, author)
    else:
        print(f"Unknown action: {action}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
