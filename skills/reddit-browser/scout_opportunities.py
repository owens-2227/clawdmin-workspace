#!/usr/bin/env python3
"""
Reddit Thread Opportunity Scout

Browses subreddits via Playwright CDP through AdsPower profiles and finds
comment reply opportunities — places where a persona can add value by
replying to another user's comment (not top-level).

Targets rising/hot threads with moderate comment counts (10-200) and finds
comments that are unanswered questions, requests for advice, or discussions
where the persona can contribute.

Usage:
    python3 scout_opportunities.py <cdp_url> --subreddits "sub1,sub2,sub3" --count 10 --persona "<description>"

Returns JSON array of opportunities:
[
  {
    "post_url": "https://www.reddit.com/r/.../comments/...",
    "post_title": "...",
    "subreddit": "r/gardening",
    "target_author": "username",
    "target_text": "first 200 chars of the comment...",
    "target_thing_id": "t1_xxx",
    "thread_depth": 2,
    "comment_count": 45,
    "suggested_angle": "experience-sharing | question-answering | supportive | comparison",
    "reason": "Why this is a good opportunity"
  },
  ...
]
"""

import asyncio
import sys
import json
import os
import time
import random
import argparse


SCREENSHOT_DIR = "/tmp/reddit_scout"
os.makedirs(SCREENSHOT_DIR, exist_ok=True)


def ss(name):
    return os.path.join(SCREENSHOT_DIR, f"{name}_{int(time.time())}.png")


async def get_post_list(page, subreddit, sort="hot"):
    """Navigate to a subreddit and extract post list with metadata."""
    url = f"https://www.reddit.com/r/{subreddit}/{sort}/"
    await page.goto(url, wait_until="domcontentloaded", timeout=20000)
    await asyncio.sleep(5)

    # Scroll down to load more posts
    for _ in range(3):
        await page.evaluate("window.scrollBy(0, 800)")
        await asyncio.sleep(1.5)

    posts = await page.evaluate("""() => {
        const results = [];
        // shreddit-post elements contain post data
        const postEls = document.querySelectorAll('shreddit-post, article');
        for (const p of postEls) {
            const permalink = p.getAttribute('permalink') ||
                              p.getAttribute('content-href') || '';
            const title = p.getAttribute('post-title') || '';
            const commentCount = parseInt(p.getAttribute('comment-count') || '0');
            const score = parseInt(p.getAttribute('score') || '0');
            const createdTs = p.getAttribute('created-timestamp') || '';

            if (permalink && title) {
                results.push({
                    url: permalink.startsWith('http') ? permalink : 'https://www.reddit.com' + permalink,
                    title: title,
                    comment_count: commentCount,
                    score: score,
                    created: createdTs,
                });
            }
        }
        return results;
    }""")

    return posts


async def get_thread_comments(page, post_url):
    """Navigate to a post and extract all visible comments with their structure."""
    await page.goto(post_url, wait_until="domcontentloaded", timeout=20000)
    await asyncio.sleep(5)

    # Scroll to load comments
    for _ in range(4):
        await page.evaluate("window.scrollBy(0, 1000)")
        await asyncio.sleep(1.5)

    # Expand some "more replies" if available
    for _ in range(2):
        clicked = await page.evaluate("""() => {
            const btns = document.querySelectorAll('button, faceplate-partial');
            for (const b of btns) {
                const text = (b.textContent || '').trim().toLowerCase();
                if ((text.includes('more repl') || text.includes('view more'))
                    && !text.includes('award')) {
                    const r = b.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) {
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

    # Extract comments
    comments = await page.evaluate("""() => {
        const results = [];
        document.querySelectorAll('shreddit-comment').forEach(c => {
            const author = c.getAttribute('author') || '';
            const thingId = c.getAttribute('thingid') || '';
            const parentId = c.getAttribute('parentid') || '';
            const depth = parseInt(c.getAttribute('depth') || '0');
            const score = c.getAttribute('score') || '0';

            const ps = c.querySelectorAll('p');
            let text = '';
            ps.forEach(p => text += p.textContent + ' ');
            text = text.trim();

            // Check if this comment has child replies
            // (look for shreddit-comment elements inside this one)
            const childComments = c.querySelectorAll(':scope > shreddit-comment');
            const replyCount = childComments.length;

            results.push({
                author,
                thingId,
                parentId,
                depth,
                score: parseInt(score) || 0,
                text: text.substring(0, 500),
                fullLength: text.length,
                replyCount,
            });
        });
        return results;
    }""")

    # Get post title
    post_title = await page.evaluate("""() => {
        const post = document.querySelector('shreddit-post');
        return post ? (post.getAttribute('post-title') || '') : '';
    }""")

    return {"title": post_title, "comments": comments, "url": page.url}


def score_opportunity(comment, all_comments, post):
    """Score how good a reply opportunity this comment is.

    Higher score = better opportunity.
    """
    score = 0

    text = comment["text"].lower()
    length = comment["fullLength"]

    # Questions are gold — high intent
    if "?" in comment["text"]:
        score += 30
    if any(q in text for q in ["anyone", "has anyone", "what do you", "recommend", "suggest",
                                 "how do you", "how did you", "what's your", "whats your",
                                 "any tips", "any advice", "help me", "struggling with"]):
        score += 20

    # Unanswered or lightly-answered comments are better targets
    if comment["replyCount"] == 0:
        score += 25  # Unanswered — we can be the helpful one
    elif comment["replyCount"] <= 2:
        score += 10  # Lightly answered — room for another perspective

    # Moderate depth is ideal (depth 1-2 = replying in a thread, not top-level)
    if comment["depth"] in [0, 1]:
        score += 15  # Replying to a top-level or depth-1 comment
    elif comment["depth"] == 2:
        score += 10

    # Comment substance matters — too short = low value, medium = sweet spot
    if 50 < length < 300:
        score += 10  # Medium-length comments are usually the most substantive
    elif length >= 300:
        score += 5   # Long comments — still good but our reply might get lost

    # Positive score comments are better targets
    if comment["score"] > 5:
        score += 10
    elif comment["score"] > 1:
        score += 5

    # Penalize very deep threads (depth 4+)
    if comment["depth"] > 3:
        score -= 20

    # Penalize heavily-replied comments (our reply won't be seen)
    if comment["replyCount"] > 5:
        score -= 15

    # Penalize very short comments (not much to reply to)
    if length < 20:
        score -= 20

    # Penalize AutoMod and bot comments
    if comment["author"].lower() in ["automoderator", "[deleted]", ""]:
        score -= 100

    return score


def classify_angle(comment):
    """Suggest the best reply angle for this comment."""
    text = comment["text"].lower()

    if "?" in comment["text"]:
        if any(w in text for w in ["recommend", "suggest", "best", "favorite", "which"]):
            return "question-answering"
        if any(w in text for w in ["vs", "versus", "compared to", "or should i", "difference between"]):
            return "comparison"
        return "question-answering"

    if any(w in text for w in ["i tried", "i use", "i switched", "i've been", "ive been", "my experience"]):
        return "supportive"  # Agree and add detail

    return "experience-sharing"  # Share your own related experience


async def scout(cdp_url, subreddits, count=10, persona_desc=""):
    """Main scout function — browse subs and find reply opportunities."""
    from playwright.async_api import async_playwright

    pw = await async_playwright().start()
    browser = await pw.chromium.connect_over_cdp(cdp_url)
    ctx = browser.contexts[0]

    pages = ctx.pages
    if len(pages) > 1:
        for p in pages[1:]:
            await p.close()
    page = pages[0]

    all_opportunities = []
    posts_visited = set()

    try:
        for sub in subreddits:
            print(f"\n=== Scouting r/{sub} ===", file=sys.stderr)

            # Get post list — try both hot and rising
            posts = []
            for sort in ["hot", "rising"]:
                post_list = await get_post_list(page, sub, sort)
                posts.extend(post_list)
                # Small delay between page loads
                await asyncio.sleep(random.uniform(2, 4))

            # Deduplicate
            seen_urls = set()
            unique_posts = []
            for p in posts:
                if p["url"] not in seen_urls:
                    seen_urls.add(p["url"])
                    unique_posts.append(p)
            posts = unique_posts

            # Filter: 10-200 comments (sweet spot), not ancient
            good_posts = [p for p in posts
                          if 10 <= p["comment_count"] <= 200
                          and p["url"] not in posts_visited]

            # Also include some posts with fewer comments (rising)
            rising_posts = [p for p in posts
                            if 3 <= p["comment_count"] < 10
                            and p["url"] not in posts_visited]

            # Sort by comment count (moderate preferred) and score
            good_posts.sort(key=lambda p: p["score"], reverse=True)
            candidates = good_posts[:5] + rising_posts[:2]  # Mix of established + rising

            print(f"  Found {len(posts)} posts, {len(good_posts)} with good comment counts, checking {len(candidates)}", file=sys.stderr)

            for post in candidates:
                if len(all_opportunities) >= count * 2:  # Collect 2x, then pick best
                    break

                if post["url"] in posts_visited:
                    continue
                posts_visited.add(post["url"])

                print(f"  Checking: {post['title'][:60]}... ({post['comment_count']} comments)", file=sys.stderr)

                try:
                    thread_data = await get_thread_comments(page, post["url"])
                except Exception as e:
                    print(f"  Error loading thread: {e}", file=sys.stderr)
                    continue

                comments = thread_data["comments"]
                if not comments:
                    continue

                # Score each comment as a reply target
                scored = []
                for c in comments:
                    s = score_opportunity(c, comments, post)
                    if s > 0:
                        scored.append((s, c))

                scored.sort(key=lambda x: x[0], reverse=True)

                # Take top 1-2 from this thread (don't cluster too many in one post)
                for score_val, comment in scored[:2]:
                    angle = classify_angle(comment)
                    reason = []
                    if "?" in comment["text"]:
                        reason.append("asks a question")
                    if comment["replyCount"] == 0:
                        reason.append("unanswered")
                    elif comment["replyCount"] <= 2:
                        reason.append("lightly answered")
                    if comment["score"] > 5:
                        reason.append(f"well-received ({comment['score']} pts)")
                    if comment["depth"] <= 1:
                        reason.append(f"depth {comment['depth']} — visible")

                    all_opportunities.append({
                        "post_url": post["url"],
                        "post_title": post["title"],
                        "subreddit": f"r/{sub}",
                        "comment_count": post["comment_count"],
                        "target_author": comment["author"],
                        "target_text": comment["text"][:200],
                        "target_thing_id": comment["thingId"],
                        "target_depth": comment["depth"],
                        "target_score": comment["score"],
                        "target_reply_count": comment["replyCount"],
                        "opportunity_score": score_val,
                        "suggested_angle": angle,
                        "reason": "; ".join(reason) if reason else "good reply target",
                    })

                # Natural browsing delay between posts
                await asyncio.sleep(random.uniform(3, 7))

        # Sort all opportunities by score and pick top N
        all_opportunities.sort(key=lambda x: x["opportunity_score"], reverse=True)

        # Ensure we pick from different posts (1 per post max for the final list)
        final = []
        used_posts = set()
        for opp in all_opportunities:
            if opp["post_url"] not in used_posts:
                final.append(opp)
                used_posts.add(opp["post_url"])
            if len(final) >= count:
                break

        # If we don't have enough unique posts, allow 2nd picks from same posts
        if len(final) < count:
            for opp in all_opportunities:
                if opp not in final:
                    final.append(opp)
                if len(final) >= count:
                    break

        # Take screenshot of last page for reference
        scout_ss = ss("scout_final")
        await page.screenshot(path=scout_ss)

        return {
            "success": True,
            "opportunities": final,
            "total_posts_checked": len(posts_visited),
            "total_candidates_found": len(all_opportunities),
            "screenshot": scout_ss,
        }

    except Exception as e:
        err_ss = ss("scout_error")
        try:
            await page.screenshot(path=err_ss)
        except:
            pass
        return {"success": False, "error": str(e), "screenshot": err_ss}

    finally:
        await pw.stop()


async def main():
    parser = argparse.ArgumentParser(description="Scout Reddit threads for reply opportunities")
    parser.add_argument("cdp_url", help="CDP WebSocket URL from AdsPower")
    parser.add_argument("--subreddits", required=True, help="Comma-separated list of subreddits (without r/)")
    parser.add_argument("--count", type=int, default=10, help="Number of opportunities to find (default: 10)")
    parser.add_argument("--persona", default="", help="Persona description for context-aware scoring")

    args = parser.parse_args()
    subs = [s.strip().replace("r/", "") for s in args.subreddits.split(",")]

    result = await scout(args.cdp_url, subs, count=args.count, persona_desc=args.persona)
    print(json.dumps(result, indent=2))
    sys.exit(0 if result.get("success") else 1)


if __name__ == "__main__":
    asyncio.run(main())
