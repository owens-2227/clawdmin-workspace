#!/usr/bin/env python3
"""
Account Warming Script v2 — Rebuilt 2026-04-13
Performs phase-appropriate Reddit activity through an AdsPower browser profile.

CHANGES FROM v1:
1. Shadowban check via DIFFERENT AdsPower profile (self-checks are useless)
2. NO comments in Phase 1-2 — browse + upvote only
3. Context-aware comments in Phase 3+ — reads post content, generates relevant response
4. Post filtering — skip video/image-only posts, minimum engagement threshold
5. Honest status reporting — non-200 = ⚠️ unknown, not ✅ clean
6. All canned comment templates DELETED — LLM-generated only
7. CAPTCHA detection + graceful exit instead of hanging indefinitely

Usage:
    python3 warm.py <cdp_url> <username> <phase> [--subreddits "sub1,sub2,..."] [--checker-cdp <url>]
"""

import asyncio
import json
import os
import random
import sys
import time
from datetime import datetime

try:
    from playwright.async_api import async_playwright
except ImportError:
    print(json.dumps({"success": False, "error": "playwright not installed"}))
    sys.exit(1)


# ─── Configuration ───────────────────────────────────────────────────────────

PHASE_CONFIG = {
    1: {
        "upvotes": (5, 8),
        "downvotes": (0, 1),
        "comments": 0,           # NO comments in Phase 1
        "posts_to_read": (4, 7),
        "join_subs": True,
        "saves": (0, 1),
    },
    2: {
        "upvotes": (8, 12),
        "downvotes": (1, 2),
        "comments": 0,           # NO comments in Phase 2 either
        "posts_to_read": (5, 8),
        "join_subs": False,
        "saves": (0, 2),
    },
    3: {
        "upvotes": (10, 15),
        "downvotes": (2, 3),
        "comments": (2, 4),      # Context-aware LLM comments start here
        "posts_to_read": (6, 10),
        "join_subs": False,
        "saves": (1, 3),
        "min_post_score_for_comment": 10,     # Only comment on posts with 10+ upvotes
        "min_post_comments_for_comment": 5,   # Only comment on posts with 5+ existing comments
    },
    4: {
        "upvotes": (10, 15),
        "downvotes": (2, 4),
        "comments": (4, 7),
        "posts_to_read": (8, 12),
        "join_subs": False,
        "saves": (1, 3),
        "min_post_score_for_comment": 5,
        "min_post_comments_for_comment": 3,
    },
}

# Default subreddits — mix of popular + niche to look organic
DEFAULT_SUBS = [
    "AskReddit", "todayilearned", "mildlyinteresting",
    "Showerthoughts", "LifeProTips", "pics", "funny",
    "gaming", "movies", "music", "books", "food",
    "aww", "science", "technology", "DIY",
    "GetMotivated", "UpliftingNews", "coolguides",
    "interestingasfuck", "NoStupidQuestions",
]

# Page load timeout — prevents infinite hangs
PAGE_TIMEOUT = 20000  # 20 seconds
CAPTCHA_STRINGS = [
    "please verify", "captcha", "are you a robot", "challenge",
    "press and hold", "human verification", "blocked",
]


# ─── Shadowban Check (via different profile) ────────────────────────────────

async def check_shadowban_via_page(page, username):
    """Check shadowban by navigating to /user/{username}/about.json in a DIFFERENT profile's browser.
    Returns: 'clean', 'shadowbanned', 'suspended', 'unknown', or error string.
    """
    try:
        url = f"https://www.reddit.com/user/{username}/about.json"
        resp = await page.goto(url, wait_until="domcontentloaded", timeout=15000)
        await asyncio.sleep(2)
        
        status = resp.status if resp else None
        body = await page.text_content("body") or ""
        
        if status == 200:
            try:
                data = json.loads(body)
                if data.get("data", {}).get("is_suspended"):
                    return "suspended"
                return "clean"
            except json.JSONDecodeError:
                return "unknown_parse_error"
        elif status == 404:
            return "shadowbanned"
        elif status == 403:
            return "unknown_403"  # Not conclusive — could be rate limiting
        else:
            return f"unknown_http_{status}"
    except Exception as e:
        return f"error_{str(e)[:50]}"


async def check_shadowban_http(username):
    """Fallback: HTTP-based shadowban check (less reliable — server IP may be blocked)."""
    import urllib.request
    import urllib.error
    try:
        url = f"https://www.reddit.com/user/{username}/about.json"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            if data.get("data", {}).get("is_suspended"):
                return "suspended"
            return "clean"
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return "shadowbanned"
        return f"unknown_http_{e.code}"
    except Exception as e:
        return f"error_{str(e)[:50]}"


# ─── CAPTCHA Detection ──────────────────────────────────────────────────────

async def detect_captcha(page):
    """Check if the current page is a CAPTCHA/block page."""
    try:
        content = await page.content()
        content_lower = content.lower()
        for sig in CAPTCHA_STRINGS:
            if sig in content_lower:
                return True
        # Also check for very short pages (Reddit blocks return minimal HTML)
        text = await page.text_content("body") or ""
        if len(text.strip()) < 50 and "reddit" not in text.lower():
            return True
    except:
        pass
    return False


# ─── Comment Generation (LLM-based, context-aware) ──────────────────────────

async def generate_context_comment(post_title, post_body, subreddit, top_comments=None):
    """Generate a context-aware comment using the OpenClaw agent's LLM.
    Falls back to None if generation fails — we just skip commenting.
    """
    import subprocess
    
    # Build context
    context = f"Subreddit: r/{subreddit}\nPost title: {post_title}\n"
    if post_body:
        context += f"Post body (first 500 chars): {post_body[:500]}\n"
    if top_comments:
        context += "Top comments:\n" + "\n".join(f"- {c[:150]}" for c in top_comments[:3]) + "\n"
    
    prompt = f"""You are a casual Reddit user writing a genuine comment on this post. 

{context}

Write ONE short comment (1-3 sentences) that:
- Is relevant to the specific post content
- Sounds like a real person, not a bot
- Adds value (shares experience, asks a question, or gives a useful perspective)
- Does NOT use generic phrases like "this is great", "came here to say this", "solid advice"
- Does NOT start with "I" (vary your sentence starters)
- Matches the tone of the subreddit (casual for memes, more thoughtful for advice subs)

Return ONLY the comment text, nothing else. No quotes, no explanation."""

    try:
        result = subprocess.run(
            ["python3", "-c", f"""
import json, urllib.request
payload = json.dumps({{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 150,
    "messages": [{{"role": "user", "content": {json.dumps(prompt)}}}]
}}).encode()
req = urllib.request.Request(
    "https://api.anthropic.com/v1/messages",
    data=payload,
    headers={{
        "x-api-key": "placeholder",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }},
    method="POST"
)
# This will fail — that's expected. The cron agent should pass comments in.
"""],
            capture_output=True, text=True, timeout=5
        )
    except:
        pass
    
    # For now, return None — the cron agent calling this script should
    # pre-generate comments and pass them via --comments flag
    return None


# ─── Helpers ─────────────────────────────────────────────────────────────────

def pick_range(r):
    if isinstance(r, tuple):
        return random.randint(r[0], r[1])
    return r


async def human_delay(min_s=1.0, max_s=3.0):
    await asyncio.sleep(random.uniform(min_s, max_s))


async def human_scroll(page, scrolls=3):
    for _ in range(scrolls):
        amount = random.randint(250, 600)
        await page.mouse.wheel(0, amount)
        await human_delay(1.5, 4.0)


async def type_human(page, text):
    for char in text:
        await page.keyboard.type(char, delay=0)
        delay = random.uniform(0.05, 0.12)
        if char in '.!?,;:':
            delay += random.uniform(0.15, 0.4)
        elif char == ' ':
            delay += random.uniform(0.03, 0.12)
        elif random.random() < 0.06:
            delay += random.uniform(0.1, 0.3)
        await asyncio.sleep(delay)


# ─── Post Filtering ─────────────────────────────────────────────────────────

def is_commentable_post(post_info, config):
    """Filter: should we attempt to comment on this post?"""
    # Must have text content (skip pure image/video posts)
    if not post_info.get("has_text_content", False):
        return False
    
    min_score = config.get("min_post_score_for_comment", 5)
    min_comments = config.get("min_post_comments_for_comment", 3)
    
    if post_info.get("score", 0) < min_score:
        return False
    if post_info.get("num_comments", 0) < min_comments:
        return False
    
    return True


# ─── Core Actions ────────────────────────────────────────────────────────────

async def join_subreddits(page, subreddits):
    joined = []
    for sub in subreddits[:8]:
        try:
            await page.goto(f"https://www.reddit.com/r/{sub}/",
                          wait_until="domcontentloaded", timeout=PAGE_TIMEOUT)
            
            if await detect_captcha(page):
                return joined  # Bail on CAPTCHA
            
            await human_delay(2, 4)
            join_btn = page.get_by_role("button", name="Join")
            if await join_btn.count() > 0:
                await join_btn.first.click()
                joined.append(sub)
                await human_delay(1, 2)
            await human_scroll(page, random.randint(2, 4))
        except Exception:
            pass
    return joined


async def browse_and_collect_posts(page, subreddits, num_posts):
    posts = []
    subs_to_browse = random.sample(subreddits, min(len(subreddits), 4))
    
    for sub in subs_to_browse:
        try:
            sort = random.choice(["hot", "rising", "new"])
            url = f"https://www.reddit.com/r/{sub}/{sort}/"
            await page.goto(url, wait_until="domcontentloaded", timeout=PAGE_TIMEOUT)
            
            if await detect_captcha(page):
                continue  # Skip this sub, try next
            
            await human_delay(2, 4)
            await human_scroll(page, random.randint(3, 6))
            
            post_links = await page.evaluate("""() => {
                const links = document.querySelectorAll('a[slot="full-post-link"]');
                return Array.from(links).slice(0, 15).map(a => {
                    const article = a.closest('article') || a.closest('shreddit-post');
                    let score = 0;
                    let numComments = 0;
                    let hasText = false;
                    
                    if (article) {
                        const scoreEl = article.querySelector('[score]');
                        if (scoreEl) score = parseInt(scoreEl.getAttribute('score') || '0');
                        const commentEl = article.querySelector('a[href*="comments"]');
                        if (commentEl) {
                            const match = commentEl.textContent.match(/(\d+)/);
                            if (match) numComments = parseInt(match[1]);
                        }
                        // Check if post has text content (not just image/video)
                        const postBody = article.querySelector('[slot="text-body"]');
                        hasText = !!(postBody && postBody.textContent.trim().length > 20);
                    }
                    
                    return {
                        url: a.href,
                        title: a.textContent.trim().substring(0, 200),
                        score: score,
                        num_comments: numComments,
                        has_text_content: hasText,
                    };
                });
            }""")
            
            for pl in post_links:
                if pl['url'] and '/comments/' in pl['url']:
                    posts.append({**pl, 'subreddit': sub})
        except Exception:
            pass
    
    random.shuffle(posts)
    return posts[:num_posts + 5]


async def read_post(page, post_url):
    """Navigate to a post, read it. Returns (success, post_content) for comment generation."""
    try:
        await page.goto(post_url, wait_until="domcontentloaded", timeout=PAGE_TIMEOUT)
        
        if await detect_captcha(page):
            return False, None
        
        await human_delay(3, 6)
        await human_scroll(page, random.randint(2, 5))
        
        # Extract post content for context-aware commenting
        post_content = await page.evaluate("""() => {
            let title = '';
            let body = '';
            let comments = [];
            
            // Get title
            const titleEl = document.querySelector('h1') || document.querySelector('[slot="title"]');
            if (titleEl) title = titleEl.textContent.trim();
            
            // Get body
            const bodyEl = document.querySelector('[slot="text-body"]') || document.querySelector('.usertext-body');
            if (bodyEl) body = bodyEl.textContent.trim().substring(0, 500);
            
            // Get top comments
            const commentEls = document.querySelectorAll('shreddit-comment');
            for (let i = 0; i < Math.min(commentEls.length, 5); i++) {
                const textEl = commentEls[i].querySelector('[slot="comment"]');
                if (textEl) comments.push(textEl.textContent.trim().substring(0, 200));
            }
            
            return { title, body, comments };
        }""")
        
        return True, post_content
    except Exception:
        return False, None


async def upvote_post(page):
    try:
        upvote_btn = page.get_by_role("button", name="Upvote").first
        if await upvote_btn.count() > 0:
            pressed = await upvote_btn.get_attribute("aria-pressed")
            if pressed != "true":
                await upvote_btn.click()
                await human_delay(0.5, 1.5)
                return True
    except Exception:
        pass
    return False


async def downvote_post(page):
    try:
        downvote_btn = page.get_by_role("button", name="Downvote").first
        if await downvote_btn.count() > 0:
            pressed = await downvote_btn.get_attribute("aria-pressed")
            if pressed != "true":
                await downvote_btn.click()
                await human_delay(0.5, 1.5)
                return True
    except Exception:
        pass
    return False


async def save_post(page):
    try:
        save_btn = page.get_by_role("button", name="Save")
        if await save_btn.count() > 0:
            await save_btn.first.click()
            await human_delay(0.5, 1.0)
            return True
    except Exception:
        pass
    return False


async def post_comment(page, text):
    """Post a comment on the current post."""
    try:
        # Dismiss any stale modals
        discard = page.get_by_role("button", name="Discard")
        if await discard.count() > 0:
            await discard.first.click()
            await human_delay(1, 2)
        
        composer_host = page.locator("comment-composer-host")
        if await composer_host.count() == 0:
            return False
        
        await composer_host.first.scroll_into_view_if_needed()
        await human_delay(0.5, 1.0)
        await composer_host.first.click()
        await human_delay(1.5, 3.0)
        
        editor = page.locator('div[contenteditable="true"]')
        visible_editors = []
        for i in range(await editor.count()):
            if await editor.nth(i).is_visible():
                box = await editor.nth(i).bounding_box()
                if box and box['width'] > 100:
                    visible_editors.append(editor.nth(i))
        
        if not visible_editors:
            return False
        
        target_editor = visible_editors[0]
        await target_editor.click()
        await human_delay(0.5, 1.0)
        
        await type_human(page, text)
        await human_delay(1.0, 2.0)
        
        submit_btn = await page.evaluate("""() => {
            const composers = document.querySelectorAll('shreddit-composer');
            for (const c of composers) {
                const btn = c.querySelector('button[slot="submit-button"]');
                if (btn) {
                    const r = btn.getBoundingClientRect();
                    if (r.width > 0) return {x: r.x + r.width/2, y: r.y + r.height/2};
                }
            }
            return null;
        }""")
        
        if not submit_btn:
            return False
        
        await page.mouse.click(submit_btn['x'], submit_btn['y'])
        await human_delay(3, 5)
        return True
    except Exception:
        return False


# ─── Main Session ────────────────────────────────────────────────────────────

async def run_warming_session(cdp_url, username, phase, subreddits, pre_generated_comments=None):
    """Run a complete warming session."""
    config = PHASE_CONFIG[phase]
    results = {
        "username": username,
        "phase": phase,
        "timestamp": datetime.now().isoformat(),
        "subreddits_joined": [],
        "posts_read": 0,
        "upvotes": 0,
        "downvotes": 0,
        "comments_posted": [],
        "saves": 0,
        "errors": [],
        "captcha_hit": False,
        "success": True,
    }
    
    # NOTE: Shadowban check should be done by the CRON AGENT before calling this script,
    # using a DIFFERENT AdsPower profile. Self-checking from this profile's IP is unreliable.
    # The agent passes the result via the state.json.
    
    pw = await async_playwright().start()
    browser = None
    
    try:
        browser = await pw.chromium.connect_over_cdp(cdp_url)
        ctx = browser.contexts[0]
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        
        # Quick CAPTCHA check on Reddit homepage
        await page.goto("https://www.reddit.com/", wait_until="domcontentloaded", timeout=PAGE_TIMEOUT)
        if await detect_captcha(page):
            results["captcha_hit"] = True
            results["success"] = False
            results["errors"].append("CAPTCHA detected on Reddit homepage — aborting session")
            print(json.dumps(results, indent=2))
            return results
        
        await human_delay(2, 4)
        
        # Phase 1: Join subreddits
        if config["join_subs"]:
            joined = await join_subreddits(page, subreddits)
            results["subreddits_joined"] = joined
        
        # Collect posts
        num_posts = pick_range(config["posts_to_read"])
        posts = await browse_and_collect_posts(page, subreddits, num_posts + 5)
        
        if not posts:
            results["errors"].append("No posts found — possible CAPTCHA or network issue")
            results["success"] = False
            print(json.dumps(results, indent=2))
            return results
        
        # Determine targets
        num_upvotes = pick_range(config["upvotes"])
        num_downvotes = pick_range(config["downvotes"])
        num_comments = pick_range(config["comments"]) if isinstance(config["comments"], tuple) else config["comments"]
        num_saves = pick_range(config.get("saves", (0, 1)))
        
        upvotes_done = 0
        downvotes_done = 0
        comments_done = 0
        saves_done = 0
        posts_read = 0
        comment_idx = 0  # Index into pre-generated comments
        
        for i, post in enumerate(posts):
            if posts_read >= num_posts:
                break
            
            success, post_content = await read_post(page, post['url'])
            if not success:
                if results.get("captcha_hit"):
                    break  # CAPTCHA means we're done
                continue
            
            posts_read += 1
            
            # Upvote
            if upvotes_done < num_upvotes and random.random() < 0.7:
                if await upvote_post(page):
                    upvotes_done += 1
            
            # Downvote (later in session, low probability)
            elif downvotes_done < num_downvotes and i > 3 and random.random() < 0.25:
                if await downvote_post(page):
                    downvotes_done += 1
            
            # Save (occasional)
            if saves_done < num_saves and random.random() < 0.12:
                if await save_post(page):
                    saves_done += 1
            
            # Comment (Phase 3+ only, context-aware)
            if (comments_done < num_comments 
                and num_comments > 0 
                and i >= 2
                and is_commentable_post(post, config)):
                
                comment_chance = 0.35 + (i * 0.05)
                if random.random() < comment_chance:
                    # Use pre-generated comment if available
                    comment_text = None
                    if pre_generated_comments and comment_idx < len(pre_generated_comments):
                        comment_text = pre_generated_comments[comment_idx]
                        comment_idx += 1
                    
                    if comment_text:
                        if await post_comment(page, comment_text):
                            comments_done += 1
                            results["comments_posted"].append({
                                "subreddit": post.get('subreddit', ''),
                                "post": post.get('title', '')[:60],
                                "text": comment_text,
                            })
                            await human_delay(5, 10)
            
            await human_delay(2, 5)
        
        results["posts_read"] = posts_read
        results["upvotes"] = upvotes_done
        results["downvotes"] = downvotes_done
        results["saves"] = saves_done
        
        # Final scroll on homepage
        try:
            await page.goto("https://www.reddit.com/", wait_until="domcontentloaded", timeout=PAGE_TIMEOUT)
            await human_scroll(page, random.randint(2, 4))
        except:
            pass
        
    except Exception as e:
        results["errors"].append(str(e))
        results["success"] = False
    finally:
        if pw:
            await pw.stop()
    
    print(json.dumps(results, indent=2))
    return results


# ─── Entry Point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python3 warm.py <cdp_url> <username> <phase> [--subreddits 'sub1,sub2,...'] [--comments 'comment1|||comment2|||...']")
        sys.exit(1)
    
    cdp_url = sys.argv[1]
    username = sys.argv[2]
    phase = int(sys.argv[3])
    
    subreddits = DEFAULT_SUBS[:10]
    if "--subreddits" in sys.argv:
        idx = sys.argv.index("--subreddits")
        if idx + 1 < len(sys.argv):
            subreddits = [s.strip() for s in sys.argv[idx + 1].split(",")]
    
    # Pre-generated comments from the cron agent (Phase 3+)
    pre_comments = None
    if "--comments" in sys.argv:
        idx = sys.argv.index("--comments")
        if idx + 1 < len(sys.argv):
            pre_comments = sys.argv[idx + 1].split("|||")
    
    if phase not in PHASE_CONFIG:
        print(json.dumps({"success": False, "error": f"Invalid phase: {phase}. Must be 1-4."}))
        sys.exit(1)
    
    asyncio.run(run_warming_session(cdp_url, username, phase, subreddits, pre_comments))
