#!/usr/bin/env python3
"""
Comment Preparation Script for Account Warming Phase 3+
Fetches high-engagement text posts from an account's subreddits,
outputs them as JSON for the cron agent to generate comments for.

This script does NOT generate comments — it gathers the post context
so the cron agent (which has LLM access) can produce targeted, relevant comments.

Usage:
    python3 prepare-comments.py --subreddits "AskReddit,cats,todayilearned" --count 6

Output: JSON array of commentable posts with context, to stdout.
"""

import json
import random
import subprocess
import sys
import time

USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

# Proxy config — rotate to avoid rate limits on JSON API
PROXY_USER = "sp1seut7gn"
PROXY_PASS = "3=wJje7xe98vAiXzVh"
PROXY_HOST = "isp.decodo.com"
PROXY_PORTS = list(range(10001, 10013))

# Minimum thresholds for a post worth commenting on
MIN_SCORE = 10
MIN_COMMENTS = 5
MIN_BODY_LENGTH = 50  # Characters — skip posts with no real text


def fetch_subreddit_posts(sub, sort="hot", limit=25, proxy_port=None):
    """Fetch posts from a subreddit via Reddit's public JSON API."""
    url = f"https://old.reddit.com/r/{sub}/{sort}.json?limit={limit}&raw_json=1"
    
    cmd = ["curl", "-s", "--connect-timeout", "10", "-H", f"User-Agent: {USER_AGENT}", url]
    
    if proxy_port:
        proxy_url = f"http://{PROXY_USER}:{PROXY_PASS}@{PROXY_HOST}:{proxy_port}"
        cmd = ["curl", "-s", "-x", proxy_url, "--connect-timeout", "15", "-H", f"User-Agent: {USER_AGENT}", url]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
        if result.returncode != 0:
            return []
        
        data = json.loads(result.stdout)
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
            })
        return posts
    except Exception as e:
        print(f"  ⚠️ Failed to fetch r/{sub}: {e}", file=sys.stderr)
        return []


def fetch_top_comments(post_permalink, proxy_port=None, limit=5):
    """Fetch the top comments for a specific post."""
    url = f"https://old.reddit.com{post_permalink}.json?limit={limit}&sort=top&raw_json=1"
    
    cmd = ["curl", "-s", "--connect-timeout", "10", "-H", f"User-Agent: {USER_AGENT}", url]
    
    if proxy_port:
        proxy_url = f"http://{PROXY_USER}:{PROXY_PASS}@{PROXY_HOST}:{proxy_port}"
        cmd = ["curl", "-s", "-x", proxy_url, "--connect-timeout", "15", "-H", f"User-Agent: {USER_AGENT}", url]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
        if result.returncode != 0:
            return []
        
        data = json.loads(result.stdout)
        comments = []
        
        # Reddit returns [post_listing, comment_listing]
        if isinstance(data, list) and len(data) > 1:
            for child in data[1].get("data", {}).get("children", []):
                c = child.get("data", {})
                body = c.get("body", "")
                if body and child.get("kind") == "t1":
                    comments.append({
                        "body": body[:300],
                        "score": c.get("score", 0),
                        "author": c.get("author", ""),
                    })
        
        return comments[:limit]
    except Exception:
        return []


def is_commentable(post):
    """Does this post meet our commenting criteria?"""
    # Must be a text post with actual content
    if not post.get("is_self", False):
        return False
    if len(post.get("selftext", "")) < MIN_BODY_LENGTH:
        return False
    if post.get("score", 0) < MIN_SCORE:
        return False
    if post.get("num_comments", 0) < MIN_COMMENTS:
        return False
    
    # Skip meta/mod posts
    title_lower = post.get("title", "").lower()
    body_lower = post.get("selftext", "").lower()
    combined = title_lower + " " + body_lower
    
    skip_keywords = ["megathread", "weekly thread", "daily discussion", "mod post", "rule", "announcement"]
    if any(kw in title_lower for kw in skip_keywords):
        return False
    
    # Skip grief/loss/end-of-life posts (warming accounts should never comment on these)
    grief_signals = [
        "didn't make it", "didn't make it", "passed away", "crossing the rainbow",
        "rainbow bridge", "rest in peace", "rip ", "put to sleep", "put down",
        "euthan", "end of life", "saying goodbye", "lost my", "passed today",
        "passed yesterday", "passed last", "gone now", "no longer with us",
        "in loving memory", "miss you", "miss her", "miss him",
    ]
    if any(signal in combined for signal in grief_signals):
        return False
    
    # Skip posts tagged as sensitive/seeking support with bad news indicators
    flair = (post.get("link_flair_text", "") or "").lower()
    if "sensitive" in flair or "support" in flair or "grief" in flair or "loss" in flair:
        if any(w in combined for w in ["died", "dead", "dying", "terminal", "hospice", "last days"]):
            return False
    
    return True


def main():
    # Parse args
    subreddits = []
    target_count = 6
    
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--subreddits" and i + 1 < len(args):
            subreddits = [s.strip() for s in args[i + 1].split(",") if s.strip()]
            i += 2
        elif args[i] == "--count" and i + 1 < len(args):
            target_count = int(args[i + 1])
            i += 2
        else:
            i += 1
    
    if not subreddits:
        print(json.dumps({"error": "No subreddits provided. Use --subreddits 'sub1,sub2,...'"}))
        sys.exit(1)
    
    print(f"Scanning {len(subreddits)} subreddits for commentable posts...", file=sys.stderr)
    
    all_candidates = []
    proxy_idx = random.randint(0, len(PROXY_PORTS) - 1)
    
    for sub in subreddits:
        port = PROXY_PORTS[proxy_idx % len(PROXY_PORTS)]
        proxy_idx += 1
        
        # Fetch both Rising and Hot — Rising posts have exponentially more algorithmic value
        # (early comments on rising posts compound: 1→10 = same weight as 100→1000)
        for sort in ["rising", "hot"]:
            posts = fetch_subreddit_posts(sub, sort=sort, limit=15, proxy_port=port)
            for post in posts:
                if is_commentable(post):
                    # Tag with sort source so we can prioritize rising
                    post["_sort_source"] = sort
                    all_candidates.append(post)
            time.sleep(0.5)
        
        time.sleep(1)  # Rate limit between subs
    
    print(f"Found {len(all_candidates)} commentable posts across {len(subreddits)} subs", file=sys.stderr)
    
    # Deduplicate (same post may appear in both rising and hot)
    seen_ids = set()
    deduped = []
    for post in all_candidates:
        if post["id"] not in seen_ids:
            seen_ids.add(post["id"])
            deduped.append(post)
    all_candidates = deduped
    
    # Sort: prioritize Rising posts (early comments = exponential value),
    # then by engagement within each tier
    def sort_key(p):
        rising_bonus = 1000 if p.get("_sort_source") == "rising" else 0
        return rising_bonus + p["score"] + p["num_comments"] * 2
    
    all_candidates.sort(key=sort_key, reverse=True)
    
    # Pick target_count, but spread across subreddits (max 2 per sub)
    selected = []
    sub_counts = {}
    for post in all_candidates:
        sub = post["subreddit"]
        if sub_counts.get(sub, 0) >= 2:
            continue
        
        # Fetch top comments for context
        port = PROXY_PORTS[proxy_idx % len(PROXY_PORTS)]
        proxy_idx += 1
        top_comments = fetch_top_comments(post["permalink"], proxy_port=port)
        time.sleep(0.5)
        
        selected.append({
            "post_url": post["url"],
            "post_id": post["id"],
            "subreddit": post["subreddit"],
            "title": post["title"],
            "body": post["selftext"][:800],
            "score": post["score"],
            "num_comments": post["num_comments"],
            "flair": post.get("link_flair_text", ""),
            "top_comments": [c["body"] for c in top_comments],
        })
        
        sub_counts[sub] = sub_counts.get(sub, 0) + 1
        
        if len(selected) >= target_count:
            break
    
    print(f"Selected {len(selected)} posts for commenting", file=sys.stderr)
    
    # Output to stdout as JSON (cron agent reads this)
    print(json.dumps(selected, indent=2))


if __name__ == "__main__":
    main()
