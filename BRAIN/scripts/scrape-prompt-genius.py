#!/usr/bin/env python3
"""
Scrape r/ChatGPTPromptGenius top weekly posts and evaluate for Wabi mini app viability.
Appends results to the Notion page under Openclaw Management.
Intended to run as a 1 AM PDT cron job.
"""

import json
import requests
import time
from datetime import datetime, timezone, timedelta

# --- Config ---
NOTION_SECRET = "REDACTED_NOTION"
NOTION_PAGE_ID = "34166005-ab52-8162-9828-e902e7398dbb"
SUBREDDIT = "ChatGPTPromptGenius"
HEADERS_NOTION = {
    "Authorization": f"Bearer {NOTION_SECRET}",
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json"
}

WABI_CAPABILITIES = """
Wabi mini apps CAN:
- Use AI content client (short text, long text, structured entities, image/video/3D search, streaming, MCP)
- Send/search Gmail emails
- Create/update Google Calendar events
- Query Apple Health (steps, heart rate, sleep, workouts)
- Use Composio for third-party OAuth integrations
- Persistent MongoDB-backed KV store + Zustand with persistence/streaming/multiplayer
- In-app chat (WabiChat), TTS via ElevenLabs, multiplayer/presence
- Time-based triggers, geofence triggers, init triggers
- Push notifications via LLM, content generation on schedule
- Rich UI components (buttons, typography, tabs, markdown, date pickers, etc.)

Wabi mini apps CANNOT:
- Make arbitrary HTTP requests to external services
- Access device filesystem
- Run background processes outside triggers
- Access camera, contacts, or native iOS APIs without SDK bridge
- Use npm packages not in the Core bundle (~285 fixed modules)
- Exceed ~10-15 module budget
- Do image-to-image generation or arbitrary media processing
"""

def fetch_top_posts(time_filter="week", limit=25):
    """Fetch top posts from Reddit JSON API."""
    all_posts = []
    url = f"https://www.reddit.com/r/{SUBREDDIT}/top/.json?t={time_filter}&limit={limit}"
    headers = {"User-Agent": "WabiIdeaScanner/1.0"}
    
    r = requests.get(url, headers=headers, timeout=15)
    if r.status_code != 200:
        print(f"Reddit API returned {r.status_code}")
        return all_posts
    
    data = r.json()
    for child in data.get("data", {}).get("children", []):
        post = child.get("data", {})
        all_posts.append({
            "title": post.get("title", ""),
            "selftext": post.get("selftext", "")[:2000],
            "score": post.get("score", 0),
            "url": f"https://reddit.com{post.get('permalink', '')}",
            "flair": post.get("link_flair_text", ""),
            "num_comments": post.get("num_comments", 0),
            "id": post.get("id", ""),
            "created_utc": post.get("created_utc", 0),
        })
    
    return all_posts

def evaluate_wabi_viability(post):
    """
    Quick heuristic evaluation of whether a post idea can become a Wabi mini app.
    Returns (viable: bool, reason: str, app_name: str, wabi_fit: str, rating: int)
    """
    title = post["title"].lower()
    text = post["selftext"].lower()
    combined = title + " " + text
    
    # Skip discussion/meta posts
    skip_keywords = ["published", "playbook", "free course", "documentation", "tutorial list"]
    if any(k in combined for k in skip_keywords) and post["flair"] == "Discussion":
        return False, "Discussion/resource list, not an app concept", "", "", 0
    
    # NOTE: Wabi apps DO have camera access and image gen model — don't filter these out
    
    # Skip if it needs external APIs
    if any(k in combined for k in ["api key", "api access", "web scraping", "scrape"]):
        return False, "Requires external API access or web scraping", "", "", 0
    
    return True, "Needs AI evaluation", "", "", 0

def get_week_label():
    pdt = timezone(timedelta(hours=-7))
    now = datetime.now(pdt)
    start = now - timedelta(days=now.weekday())
    end = start + timedelta(days=6)
    return f"Week of {start.strftime('%B %d')}–{end.strftime('%d, %Y')}"

def append_to_notion(blocks):
    """Append blocks to the Notion page."""
    url = f"https://api.notion.com/v1/blocks/{NOTION_PAGE_ID}/children"
    payload = {"children": blocks}
    r = requests.patch(url, headers=HEADERS_NOTION, json=payload)
    if r.status_code == 200:
        print(f"✅ Appended {len(blocks)} blocks to Notion")
    else:
        print(f"❌ Notion error {r.status_code}: {r.text[:500]}")

def main():
    print(f"🔍 Scraping r/{SUBREDDIT} top posts (weekly)...")
    posts = fetch_top_posts()
    print(f"Found {len(posts)} posts")
    
    if not posts:
        print("No posts found, exiting.")
        return
    
    # Build Notion blocks
    week_label = get_week_label()
    blocks = [
        {"object": "block", "type": "divider", "divider": {}},
        {
            "object": "block",
            "type": "heading_2",
            "heading_2": {"rich_text": [{"text": {"content": week_label}}]}
        },
        {
            "object": "block",
            "type": "paragraph",
            "paragraph": {
                "rich_text": [{"text": {"content": f"Scraped {len(posts)} posts on {datetime.now().strftime('%Y-%m-%d %H:%M PDT')}"}}]
            }
        }
    ]
    
    viable_count = 0
    rejected_posts = []
    
    for post in sorted(posts, key=lambda p: p["score"], reverse=True):
        viable, reason, _, _, _ = evaluate_wabi_viability(post)
        
        if not viable:
            rejected_posts.append((post, reason))
            continue
        
        viable_count += 1
        blocks.append({
            "object": "block",
            "type": "heading_3",
            "heading_3": {
                "rich_text": [{"text": {"content": f"💡 {post['title'][:80]}"}, "annotations": {"bold": True}}]
            }
        })
        blocks.append({
            "object": "block",
            "type": "paragraph",
            "paragraph": {
                "rich_text": [
                    {"text": {"content": f"Score: {post['score']} | Comments: {post['num_comments']} | Flair: {post['flair'] or 'none'} | "}},
                    {"text": {"content": "Link", "link": {"url": post["url"]}}}
                ]
            }
        })
        # Add first 300 chars of selftext as context
        preview = post["selftext"][:300].replace("\n", " ").strip()
        if preview:
            blocks.append({
                "object": "block",
                "type": "quote",
                "quote": {
                    "rich_text": [{"text": {"content": preview + ("..." if len(post["selftext"]) > 300 else "")}}]
                }
            })
    
    # Add rejected section
    if rejected_posts:
        blocks.append({"object": "block", "type": "divider", "divider": {}})
        blocks.append({
            "object": "block",
            "type": "heading_3",
            "heading_3": {"rich_text": [{"text": {"content": "❌ Not Viable"}, "annotations": {"bold": True}}]}
        })
        for post, reason in rejected_posts:
            blocks.append({
                "object": "block",
                "type": "bulleted_list_item",
                "bulleted_list_item": {
                    "rich_text": [
                        {"text": {"content": post["title"][:60]}, "annotations": {"italic": True}},
                        {"text": {"content": f" ({post['score']}↑) — {reason}"}}
                    ]
                }
            })
    
    print(f"✅ {viable_count} viable ideas, {len(rejected_posts)} rejected")
    
    # Notion API has a 100-block limit per request
    for i in range(0, len(blocks), 100):
        append_to_notion(blocks[i:i+100])
        if i + 100 < len(blocks):
            time.sleep(0.5)
    
    # Save local summary
    pdt = timezone(timedelta(hours=-7))
    date_str = datetime.now(pdt).strftime("%Y-%m-%d")
    summary_path = f"/Users/owen/.openclaw/workspace/BRAIN/scrapes/prompt-genius-{date_str}.json"
    import os
    os.makedirs(os.path.dirname(summary_path), exist_ok=True)
    with open(summary_path, "w") as f:
        json.dump({
            "date": date_str,
            "subreddit": SUBREDDIT,
            "total_posts": len(posts),
            "viable": viable_count,
            "rejected": len(rejected_posts),
            "posts": posts
        }, f, indent=2)
    print(f"📁 Saved local copy to {summary_path}")

if __name__ == "__main__":
    main()
