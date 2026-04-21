#!/usr/bin/env python3
"""
Comment Preparation for Premium Accounts
Fetches commentable posts from an account's HISTORICAL subreddits.

Key differences from regular prepare-comments.py:
- Targets the specific subs the account has been active in
- Includes both top-level post opportunities AND reply-to-comment opportunities
- Fetches deeper comment context for reply targeting
- Tags each candidate with whether it's a good top-level or reply target

Usage:
    python3 prepare-comments-premium.py \\
        --subreddits "AmItheAsshole,StardewValley,anime" \\
        --count 8 \\
        --persona roostersubstantial75

Output: JSON array of commentable posts with context, to stdout.
"""

import json
import random
import subprocess
import sys
import time

USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

# Use SEPARATE proxy ports for API fetching — NOT the premium account IPs.
# Hitting Reddit's JSON API from the same IP that logs into the account looks like automation.
# These are generic pool ports not tied to any specific account.
PROXY_USER = "user-sp5ybd1vj0-sessionduration-60"
PROXY_PASS = "_rbm65iDq3EOuJ3sag"
PROXY_HOST = "city.decodo.com"
PROXY_PORTS = [21010, 21011, 21012, 21013, 21014, 21015]  # Unused/generic ports for fetch only

# More relaxed thresholds for premium accounts (they can engage with smaller threads)
MIN_SCORE = 5
MIN_COMMENTS = 3
MIN_BODY_LENGTH = 30


def fetch(url, proxy_port=None):
    """Fetch a URL, optionally through proxy."""
    cmd = ["curl", "-s", "--connect-timeout", "15", "-H", f"User-Agent: {USER_AGENT}", url]
    if proxy_port:
        proxy_url = f"http://{PROXY_USER}:{PROXY_PASS}@{PROXY_HOST}:{proxy_port}"
        cmd = ["curl", "-s", "-x", proxy_url, "--connect-timeout", "15", "-H", f"User-Agent: {USER_AGENT}", url]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
        if result.returncode != 0:
            return None
        return json.loads(result.stdout)
    except Exception as e:
        print(f"  ⚠️ Fetch failed: {e}", file=sys.stderr)
        return None


def fetch_subreddit_posts(sub, sort="hot", limit=25, proxy_port=None):
    """Fetch posts from a subreddit."""
    data = fetch(f"https://old.reddit.com/r/{sub}/{sort}.json?limit={limit}&raw_json=1", proxy_port)
    if not data:
        return []

    posts = []
    for child in data.get("data", {}).get("children", []):
        p = child.get("data", {})
        if p.get("stickied"):
            continue
        posts.append({
            "id": p.get("id", ""),
            "title": p.get("title", ""),
            "selftext": p.get("selftext", "") or "",
            "score": p.get("score", 0),
            "num_comments": p.get("num_comments", 0),
            "permalink": p.get("permalink", ""),
            "url": f"https://www.reddit.com{p.get('permalink', '')}",
            "subreddit": sub,
            "is_self": p.get("is_self", False),
            "link_flair_text": p.get("link_flair_text", ""),
            "created_utc": p.get("created_utc", 0),
        })
    return posts


def fetch_comments_with_context(post_permalink, proxy_port=None, limit=10):
    """Fetch comments for reply targeting. Returns comments with enough context
    for the LLM to write a relevant reply."""
    data = fetch(f"https://old.reddit.com{post_permalink}.json?limit={limit}&sort=top&raw_json=1", proxy_port)
    if not data or not isinstance(data, list) or len(data) < 2:
        return []

    comments = []
    for child in data[1].get("data", {}).get("children", []):
        c = child.get("data", {})
        body = c.get("body", "")
        if not body or child.get("kind") != "t1":
            continue
        
        # Get replies to this comment too (for thread context)
        replies = []
        reply_data = c.get("replies", "")
        if isinstance(reply_data, dict):
            for rc in reply_data.get("data", {}).get("children", []):
                rb = rc.get("data", {}).get("body", "")
                if rb and rc.get("kind") == "t1":
                    replies.append(rb[:200])

        comments.append({
            "body": body[:500],
            "score": c.get("score", 0),
            "author": c.get("author", ""),
            "replies": replies[:3],
            "reply_count": len(replies),
        })

    return comments[:limit]


def is_commentable(post):
    """Check if a post is suitable for premium account engagement."""
    if post.get("score", 0) < MIN_SCORE:
        return False
    if post.get("num_comments", 0) < MIN_COMMENTS:
        return False

    title_lower = post.get("title", "").lower()
    body_lower = post.get("selftext", "").lower()
    combined = title_lower + " " + body_lower

    # Skip meta/mod posts
    skip_keywords = ["megathread", "weekly thread", "daily discussion", "mod post", "announcement"]
    if any(kw in title_lower for kw in skip_keywords):
        return False

    # Skip grief/loss/crisis
    grief_signals = [
        "didn't make it", "passed away", "rainbow bridge", "rest in peace",
        "put to sleep", "put down", "euthan", "end of life", "saying goodbye",
        "lost my", "passed today", "passed yesterday", "gone now",
        "no longer with us", "in loving memory",
    ]
    if any(signal in combined for signal in grief_signals):
        return False

    # Skip locked/archived
    flair = (post.get("link_flair_text", "") or "").lower()
    if "locked" in flair or "closed" in flair:
        return False

    return True


def main():
    subreddits = []
    target_count = 8
    persona = ""

    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--subreddits" and i + 1 < len(args):
            subreddits = [s.strip() for s in args[i + 1].split(",") if s.strip()]
            i += 2
        elif args[i] == "--count" and i + 1 < len(args):
            target_count = int(args[i + 1])
            i += 2
        elif args[i] == "--persona" and i + 1 < len(args):
            persona = args[i + 1]
            i += 2
        else:
            i += 1

    if not subreddits:
        print(json.dumps({"error": "No subreddits provided. Use --subreddits 'sub1,sub2,...'"}))
        sys.exit(1)

    print(f"[premium] Scanning {len(subreddits)} historical subs for {persona or 'unknown'}...", file=sys.stderr)

    all_candidates = []
    proxy_idx = random.randint(0, len(PROXY_PORTS) - 1)

    for sub in subreddits:
        port = PROXY_PORTS[proxy_idx % len(PROXY_PORTS)]
        proxy_idx += 1

        for sort in ["rising", "hot"]:
            posts = fetch_subreddit_posts(sub, sort=sort, limit=15, proxy_port=port)
            for post in posts:
                if is_commentable(post):
                    post["_sort_source"] = sort
                    all_candidates.append(post)
            time.sleep(0.5)
        time.sleep(1)

    print(f"[premium] Found {len(all_candidates)} commentable candidates", file=sys.stderr)

    # Deduplicate
    seen_ids = set()
    deduped = []
    for post in all_candidates:
        if post["id"] not in seen_ids:
            seen_ids.add(post["id"])
            deduped.append(post)
    all_candidates = deduped

    # Sort: rising first, then by engagement
    def sort_key(p):
        rising_bonus = 1000 if p.get("_sort_source") == "rising" else 0
        return rising_bonus + p["score"] + p["num_comments"] * 2

    all_candidates.sort(key=sort_key, reverse=True)

    # Select with per-sub limits (max 3 per sub for premium — they go deeper)
    selected = []
    sub_counts = {}
    for post in all_candidates:
        sub = post["subreddit"]
        if sub_counts.get(sub, 0) >= 3:
            continue

        port = PROXY_PORTS[proxy_idx % len(PROXY_PORTS)]
        proxy_idx += 1
        comments = fetch_comments_with_context(post["permalink"], proxy_port=port)
        time.sleep(0.5)

        # Determine if this is better for top-level or reply
        # Posts with lots of debatable comments = good for reply
        # Posts asking questions or sharing stories = good for top-level
        has_reply_targets = any(c["score"] > 3 and len(c["body"]) > 50 for c in comments)

        # Pick the best reply target: mid-score comment with substance
        # (not the top comment — too visible; not buried — no engagement)
        best_reply_target = None
        reply_candidates = [c for c in comments if c["score"] > 2 and len(c["body"]) > 50]
        if len(reply_candidates) > 1:
            # Skip the highest-score comment (too visible), pick from the rest
            reply_candidates.sort(key=lambda c: c["score"], reverse=True)
            best_reply_target = reply_candidates[1] if len(reply_candidates) > 1 else reply_candidates[0]
        elif reply_candidates:
            best_reply_target = reply_candidates[0]

        selected.append({
            "post_url": post["url"],
            "post_id": post["id"],
            "subreddit": post["subreddit"],
            "title": post["title"],
            "body": post["selftext"][:1000],
            "score": post["score"],
            "num_comments": post["num_comments"],
            "flair": post.get("link_flair_text", ""),
            "top_comments": [
                {
                    "body": c["body"],
                    "score": c["score"],
                    "author": c["author"],
                    "replies": c["replies"],
                }
                for c in comments
            ],
            "suggested_reply_target": {
                "author": best_reply_target["author"],
                "body": best_reply_target["body"],
                "score": best_reply_target["score"],
            } if best_reply_target else None,
            "suggested_type": "reply" if has_reply_targets else "top_level",
            "persona": persona,
        })

        sub_counts[sub] = sub_counts.get(sub, 0) + 1

        if len(selected) >= target_count:
            break

    print(f"[premium] Selected {len(selected)} posts for commenting", file=sys.stderr)
    print(json.dumps(selected, indent=2))


if __name__ == "__main__":
    main()
