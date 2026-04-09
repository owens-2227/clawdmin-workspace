#!/usr/bin/env python3
"""
Account Warming Script — Playwright CDP
Performs phase-appropriate Reddit activity through an AdsPower browser profile.

Usage:
    python3 warm.py <cdp_url> <username> <phase> [--subreddits "sub1,sub2,..."]

Phase 1: Browse + upvote only
Phase 2: Browse + upvote + ultra-short comments (1-2)
Phase 3: Browse + upvote + medium comments (3-5)
Phase 4: Browse + upvote + varied comments (5-8)
"""

import asyncio
import json
import os
import random
import sys
import time
from datetime import datetime

# Ensure playwright is importable
try:
    from playwright.async_api import async_playwright
except ImportError:
    print(json.dumps({"success": False, "error": "playwright not installed"}))
    sys.exit(1)


# ─── Configuration ───────────────────────────────────────────────────────────

PHASE_CONFIG = {
    1: {
        "browse_minutes": (5, 10),
        "upvotes": (5, 8),
        "downvotes": (0, 0),
        "comments": 0,
        "posts_to_read": (4, 7),
        "join_subs": True,
    },
    2: {
        "browse_minutes": (5, 10),
        "upvotes": (8, 12),
        "downvotes": (1, 2),
        "comments": (1, 2),
        "posts_to_read": (5, 8),
        "join_subs": False,
        "comment_style": "ultra_short",
    },
    3: {
        "browse_minutes": (8, 12),
        "upvotes": (10, 15),
        "downvotes": (2, 3),
        "comments": (3, 5),
        "posts_to_read": (6, 10),
        "join_subs": False,
        "comment_style": "medium",
    },
    4: {
        "browse_minutes": (10, 15),
        "upvotes": (10, 15),
        "downvotes": (2, 4),
        "comments": (5, 8),
        "posts_to_read": (8, 12),
        "join_subs": False,
        "comment_style": "mixed",
    },
}

ULTRA_SHORT_COMMENTS = [
    "this is great",
    "needed this today",
    "saving this",
    "same here",
    "exactly this",
    "seriously underrated",
    "been looking for this",
    "thanks for sharing",
    "wow didn't know that",
    "this changed my perspective",
    "so true",
    "came here to say this",
    "well said",
    "this right here",
    "bookmarked",
    "solid advice",
    "appreciate the breakdown",
    "this is the way",
    "wish i knew this sooner",
    "finally someone said it",
]

MEDIUM_COMMENT_TEMPLATES = [
    "I've been wondering about this too. {observation}",
    "Interesting take. {observation}",
    "{observation} Curious what others think.",
    "Had the same experience. {observation}",
    "That's a good point. {observation}",
    "{observation} Thanks for posting this.",
    "This resonates. {observation}",
]

OBSERVATIONS = [
    "I tried something similar and it worked out well.",
    "Never thought about it that way before.",
    "The comments here are surprisingly helpful.",
    "This subreddit always delivers.",
    "I keep coming back to posts like this.",
    "Really depends on the situation but good starting point.",
    "Would love to see a follow-up on this.",
    "The key thing people miss is consistency.",
    "Simple but effective approach.",
    "This kind of content is why I come here.",
    "Way better than what I've seen elsewhere.",
    "People really underestimate how much this matters.",
]

DEFAULT_SUBS = [
    "AskReddit", "todayilearned", "mildlyinteresting",
    "Showerthoughts", "LifeProTips", "pics", "funny",
    "gaming", "movies", "music", "books", "food",
    "EarthPorn", "aww", "science", "technology",
    "Futurology", "space", "dataisbeautiful", "DIY",
    "GetMotivated", "UpliftingNews", "wholesomememes",
    "coolguides", "interestingasfuck", "NoStupidQuestions",
]


# ─── Helpers ─────────────────────────────────────────────────────────────────

def pick_range(r):
    if isinstance(r, tuple):
        return random.randint(r[0], r[1])
    return r


def generate_comment(style):
    """Generate a comment based on style."""
    if style == "ultra_short":
        return random.choice(ULTRA_SHORT_COMMENTS)
    elif style == "medium":
        tmpl = random.choice(MEDIUM_COMMENT_TEMPLATES)
        obs = random.choice(OBSERVATIONS)
        return tmpl.format(observation=obs)
    elif style == "mixed":
        # 40% ultra short, 40% medium, 20% longer
        roll = random.random()
        if roll < 0.4:
            return random.choice(ULTRA_SHORT_COMMENTS)
        elif roll < 0.8:
            tmpl = random.choice(MEDIUM_COMMENT_TEMPLATES)
            obs = random.choice(OBSERVATIONS)
            return tmpl.format(observation=obs)
        else:
            # Longer comment: 2-3 sentences
            obs1 = random.choice(OBSERVATIONS)
            obs2 = random.choice(OBSERVATIONS)
            while obs2 == obs1:
                obs2 = random.choice(OBSERVATIONS)
            return f"{obs1} {obs2}"
    return ""


async def human_delay(min_s=1.0, max_s=3.0):
    """Random delay to mimic human behavior."""
    await asyncio.sleep(random.uniform(min_s, max_s))


async def human_scroll(page, scrolls=3):
    """Scroll like a human reading."""
    for _ in range(scrolls):
        amount = random.randint(250, 600)
        await page.mouse.wheel(0, amount)
        await human_delay(1.5, 4.0)


async def type_human(page, text):
    """Type with human-like delays."""
    for i, char in enumerate(text):
        await page.keyboard.type(char, delay=0)
        # Base delay
        delay = random.uniform(0.05, 0.12)
        # Extra pause after punctuation
        if char in '.!?,;:':
            delay += random.uniform(0.15, 0.4)
        # Slight pause between words
        elif char == ' ':
            delay += random.uniform(0.03, 0.12)
        # Random micro-pause (6% chance)
        elif random.random() < 0.06:
            delay += random.uniform(0.1, 0.3)
        await asyncio.sleep(delay)


# ─── Core Actions ────────────────────────────────────────────────────────────

async def join_subreddits(page, subreddits):
    """Join subreddits by visiting and clicking Join."""
    joined = []
    for sub in subreddits[:8]:  # Max 8 per session
        try:
            await page.goto(f"https://www.reddit.com/r/{sub}/", 
                          wait_until="domcontentloaded", timeout=20000)
            await human_delay(2, 4)
            
            # Look for Join button
            join_btn = page.get_by_role("button", name="Join")
            if await join_btn.count() > 0:
                await join_btn.first.click()
                joined.append(sub)
                await human_delay(1, 2)
            
            await human_scroll(page, random.randint(2, 4))
        except Exception as e:
            pass  # Skip failed subs
    
    return joined


async def browse_and_collect_posts(page, subreddits, num_posts):
    """Browse subreddit feeds and collect post URLs for interaction."""
    posts = []
    subs_to_browse = random.sample(subreddits, min(len(subreddits), 4))
    
    for sub in subs_to_browse:
        try:
            # Alternate between hot and rising
            sort = random.choice(["hot", "rising", "new"])
            url = f"https://www.reddit.com/r/{sub}/{sort}/"
            await page.goto(url, wait_until="domcontentloaded", timeout=20000)
            await human_delay(2, 4)
            
            # Scroll feed
            await human_scroll(page, random.randint(3, 6))
            
            # Collect post links
            post_links = await page.evaluate("""() => {
                const links = document.querySelectorAll('a[slot="full-post-link"]');
                return Array.from(links).slice(0, 15).map(a => ({
                    url: a.href,
                    title: a.textContent.trim().substring(0, 100)
                }));
            }""")
            
            for pl in post_links:
                if pl['url'] and '/comments/' in pl['url']:
                    posts.append({**pl, 'subreddit': sub})
            
        except Exception:
            pass
    
    # Shuffle and limit
    random.shuffle(posts)
    return posts[:num_posts]


async def read_post(page, post_url):
    """Navigate to a post and read it (scroll through comments)."""
    try:
        await page.goto(post_url, wait_until="domcontentloaded", timeout=20000)
        await human_delay(3, 6)  # Read the post
        
        # Scroll through comments
        scroll_count = random.randint(2, 5)
        await human_scroll(page, scroll_count)
        
        return True
    except Exception:
        return False


async def upvote_post(page):
    """Upvote the currently viewed post."""
    try:
        upvote_btn = page.get_by_role("button", name="Upvote").first
        if await upvote_btn.count() > 0:
            # Check if already voted
            pressed = await upvote_btn.get_attribute("aria-pressed")
            if pressed != "true":
                await upvote_btn.click()
                await human_delay(0.5, 1.5)
                return True
    except Exception:
        pass
    return False


async def downvote_post(page):
    """Downvote the currently viewed post."""
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
    """Save the currently viewed post (occasional action)."""
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
    """Post a comment on the current post using the proven comment method."""
    try:
        # Dismiss any stale modals
        discard = page.get_by_role("button", name="Discard")
        if await discard.count() > 0:
            await discard.first.click()
            await human_delay(1, 2)
        
        # Click comment composer to expand
        composer_host = page.locator("comment-composer-host")
        if await composer_host.count() == 0:
            return False
        
        await composer_host.first.scroll_into_view_if_needed()
        await human_delay(0.5, 1.0)
        await composer_host.first.click()
        await human_delay(1.5, 3.0)
        
        # Find the contenteditable div
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
        
        # Type with human-like delays
        await type_human(page, text)
        await human_delay(1.0, 2.0)
        
        # Find and click submit button
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
    except Exception as e:
        return False


# ─── Main Session ────────────────────────────────────────────────────────────

async def run_warming_session(cdp_url, username, phase, subreddits):
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
        "success": True,
    }
    
    pw = await async_playwright().start()
    browser = None
    
    try:
        browser = await pw.chromium.connect_over_cdp(cdp_url)
        ctx = browser.contexts[0]
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        
        # Phase 1: Join subreddits
        if config["join_subs"]:
            joined = await join_subreddits(page, subreddits)
            results["subreddits_joined"] = joined
        
        # Collect posts to interact with
        num_posts = pick_range(config["posts_to_read"])
        posts = await browse_and_collect_posts(page, subreddits, num_posts + 5)
        
        if not posts:
            results["errors"].append("No posts found to interact with")
            results["success"] = False
            print(json.dumps(results, indent=2))
            return results
        
        # Determine actions
        num_upvotes = pick_range(config["upvotes"])
        num_downvotes = pick_range(config["downvotes"])
        num_comments = pick_range(config["comments"]) if isinstance(config["comments"], tuple) else config["comments"]
        comment_style = config.get("comment_style", "")
        
        # Read posts and perform actions
        upvotes_done = 0
        downvotes_done = 0
        comments_done = 0
        posts_read = 0
        
        for i, post in enumerate(posts):
            if posts_read >= num_posts:
                break
            
            success = await read_post(page, post['url'])
            if not success:
                continue
            
            posts_read += 1
            
            # Upvote?
            if upvotes_done < num_upvotes and random.random() < 0.7:
                if await upvote_post(page):
                    upvotes_done += 1
            
            # Downvote? (only some posts, later in session)
            elif downvotes_done < num_downvotes and i > 3 and random.random() < 0.3:
                if await downvote_post(page):
                    downvotes_done += 1
            
            # Save? (occasional — 15% chance)
            if random.random() < 0.15:
                if await save_post(page):
                    results["saves"] += 1
            
            # Comment?
            if comments_done < num_comments and comment_style and i >= 2:
                # Don't comment on the very first posts (looks bot-like)
                # Higher chance as session progresses
                comment_chance = 0.4 + (i * 0.05)
                if random.random() < comment_chance:
                    text = generate_comment(comment_style)
                    if await post_comment(page, text):
                        comments_done += 1
                        results["comments_posted"].append({
                            "subreddit": post['subreddit'],
                            "post": post['title'][:60],
                            "text": text,
                        })
                        await human_delay(5, 10)  # Cool down after commenting
            
            # Random pause between posts
            await human_delay(2, 5)
        
        # Fill remaining upvotes if needed
        while upvotes_done < num_upvotes and posts_read < len(posts):
            post = posts[posts_read]
            if await read_post(page, post['url']):
                if await upvote_post(page):
                    upvotes_done += 1
                posts_read += 1
            await human_delay(1, 3)
        
        results["posts_read"] = posts_read
        results["upvotes"] = upvotes_done
        results["downvotes"] = downvotes_done
        
        # Final scroll on homepage
        await page.goto("https://www.reddit.com/", wait_until="domcontentloaded", timeout=15000)
        await human_scroll(page, random.randint(2, 4))
        
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
        print("Usage: python3 warm.py <cdp_url> <username> <phase> [--subreddits 'sub1,sub2,...']")
        sys.exit(1)
    
    cdp_url = sys.argv[1]
    username = sys.argv[2]
    phase = int(sys.argv[3])
    
    # Parse optional subreddits
    subreddits = DEFAULT_SUBS[:10]
    if "--subreddits" in sys.argv:
        idx = sys.argv.index("--subreddits")
        if idx + 1 < len(sys.argv):
            subreddits = [s.strip() for s in sys.argv[idx + 1].split(",")]
    
    if phase not in PHASE_CONFIG:
        print(json.dumps({"success": False, "error": f"Invalid phase: {phase}. Must be 1-4."}))
        sys.exit(1)
    
    asyncio.run(run_warming_session(cdp_url, username, phase, subreddits))
