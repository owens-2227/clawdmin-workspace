#!/usr/bin/env python3
"""
Weekly Top 50 Pain Points → Notion Database (with App Ideation)
Pulls the top 50 pain points (by uncapped viralScore) from MongoDB,
generates app ideation for each via Claude, creates a Notion database
matching the original format.
"""

import json
import time
import urllib.request
from datetime import datetime, timezone
from pymongo import MongoClient

# === Config ===
MONGO_URI = 'mongodb+srv://paul_db_user:REDACTED_MONGO_PASS@cluster0.tdvafh8.mongodb.net/?appName=Cluster0'
NOTION_SECRET = "REDACTED_NOTION"
PARENT_PAGE_ID = "31b66005-ab52-800d-9c49-fbc517921ae3"
NOTION_VERSION = "2022-06-28"
NOTION_BASE = "https://api.notion.com/v1"

# Anthropic API for app ideation
ANTHROPIC_API_KEY = None  # Will try to read from openclaw config
ANTHROPIC_BASE = "https://api.anthropic.com/v1"

NOTION_HEADERS = {
    "Authorization": f"Bearer {NOTION_SECRET}",
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
}

def notion_request(method, endpoint, data=None):
    url = f"{NOTION_BASE}{endpoint}"
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=NOTION_HEADERS, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        print(f"NOTION ERROR {e.code}: {err[:300]}")
        raise

def get_anthropic_key():
    """Try to read Anthropic API key from openclaw config."""
    import os, yaml
    config_path = os.path.expanduser("~/.openclaw/config.yaml")
    try:
        with open(config_path) as f:
            config = yaml.safe_load(f)
        # Try common config paths
        providers = config.get('providers', {})
        anthropic = providers.get('anthropic', {})
        return anthropic.get('apiKey') or anthropic.get('api_key')
    except Exception:
        pass
    # Try env
    return os.environ.get('ANTHROPIC_API_KEY')

def generate_app_ideation(pain_point_title, description, subreddit, source_posts):
    """Use Claude to generate app ideation for a pain point."""
    api_key = get_anthropic_key()
    if not api_key:
        return None

    posts_context = ""
    for p in source_posts[:3]:
        posts_context += f"- \"{p.get('postTitle', '')}\" ({p.get('upvotes', 0)} upvotes, {p.get('commentCount', 0)} comments)\n"

    prompt = f"""Analyze this Reddit pain point and generate a Wabi app idea. Wabi is a no-code micro-app platform — apps are simple, focused tools (calculators, trackers, guides, quizzes, checklists).

Pain Point: {pain_point_title}
Description: {description}
Subreddit: {subreddit}
Source Posts:
{posts_context}

Respond in EXACTLY this JSON format (no markdown, no code blocks):
{{
  "app_idea": "App Name — one-line description (max 120 chars)",
  "what_it_does": "2-3 sentences describing what the app does for the user (max 300 chars)",
  "how_it_solves": "2-3 sentences on how this specifically addresses the pain point (max 300 chars)",
  "feature_set": "• Feature 1\\n• Feature 2\\n• Feature 3\\n• Feature 4\\n• Feature 5",
  "wabi_fit": 4,
  "analysis": "1-2 sentences on why this is or isn't a good Wabi fit (max 200 chars)"
}}

wabi_fit is 1-5: 5=perfect fit (simple tracker/guide/calculator), 1=poor fit (needs complex backend/real-time data).
Be specific and practical. The app should be buildable as a simple micro-app."""

    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }

    payload = {
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 600,
        "messages": [{"role": "user", "content": prompt}]
    }

    req = urllib.request.Request(
        f"{ANTHROPIC_BASE}/messages",
        data=json.dumps(payload).encode(),
        headers=headers,
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
        text = result['content'][0]['text'].strip()
        # Parse JSON from response
        return json.loads(text)
    except Exception as e:
        print(f"  ⚠ Ideation failed: {e}")
        return None


def main():
    now = datetime.now(timezone.utc)
    week_label = now.strftime("%B %d, %Y")

    # === Step 1: Pull top 50 from MongoDB ===
    print("Connecting to MongoDB...")
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=15000)
    db = client['reddit_scanner']

    top50 = list(db['pain_points'].find(
        {'painPointType': {'$in': ['actionable', None]}}
    ).sort('viralScore', -1).limit(50))

    print(f"Got {len(top50)} pain points")

    # Pre-load linked posts
    pp_ids = [pp['_id'] for pp in top50]
    all_posts = list(db['pain_point_posts'].find({'painPointId': {'$in': pp_ids}}))
    posts_by_pp = {}
    for post in all_posts:
        pid = post['painPointId']
        if pid not in posts_by_pp:
            posts_by_pp[pid] = []
        posts_by_pp[pid].append(post)

    client.close()

    # === Step 2: Generate app ideation for each ===
    print("Generating app ideation for 50 pain points...")
    ideations = {}
    for i, pp in enumerate(top50):
        pp_id = pp['_id']
        posts = posts_by_pp.get(pp_id, [])
        print(f"  [{i+1}/50] Ideating: {pp.get('title', '?')[:55]}...")

        idea = generate_app_ideation(
            pp.get('title', ''),
            pp.get('description', ''),
            pp.get('subreddit', ''),
            posts
        )
        ideations[pp_id] = idea

        # Rate limit: 1 req/sec to be safe
        if idea is not None:
            time.sleep(1)

    success_count = sum(1 for v in ideations.values() if v is not None)
    print(f"Generated {success_count}/50 ideations")

    # === Step 3: Create Notion database ===
    title = f"🎯 Top 50 Pain Points — Week of {week_label}"
    print(f"Creating Notion database: {title}")

    db_payload = {
        "parent": {"type": "page_id", "page_id": PARENT_PAGE_ID},
        "title": [{"type": "text", "text": {"content": title}}],
        "properties": {
            "Pain Point": {"title": {}},
            "Subreddit": {"rich_text": {}},
            "Viral Score": {"number": {"format": "number"}},
            "Wabi Fit (1-5)": {"number": {"format": "number"}},
            "App Idea": {"rich_text": {}},
            "What It Does": {"rich_text": {}},
            "How It Solves the Pain": {"rich_text": {}},
            "Feature Set": {"rich_text": {}},
            "Analysis": {"rich_text": {}},
            "Post": {"rich_text": {}},
        }
    }

    db_result = notion_request("POST", "/databases", db_payload)
    db_id = db_result["id"]
    print(f"Database created: {db_id}")

    # === Step 4: Add rows ===
    print(f"Adding {len(top50)} rows...")

    for i, pp in enumerate(top50):
        pp_id = pp['_id']
        posts = posts_by_pp.get(pp_id, [])
        idea = ideations.get(pp_id) or {}

        # Best source post URL
        best_post_url = ""
        if posts:
            best = max(posts, key=lambda p: p.get('upvotes', 0))
            best_post_url = best.get('redditUrl', '')

        def rt(text, max_len=2000):
            """Make a rich_text field, truncated to Notion's limit."""
            t = (text or '')[:max_len]
            return {"rich_text": [{"text": {"content": t}}]} if t else {"rich_text": []}

        properties = {
            "Pain Point": {"title": [{"text": {"content": (pp.get('title') or '')[:200]}}]},
            "Subreddit": rt(pp.get('subreddit', '')),
            "Viral Score": {"number": pp.get('viralScore', 0)},
            "Wabi Fit (1-5)": {"number": idea.get('wabi_fit') if idea else None},
            "App Idea": rt(idea.get('app_idea', '')),
            "What It Does": rt(idea.get('what_it_does', '')),
            "How It Solves the Pain": rt(idea.get('how_it_solves', '')),
            "Feature Set": rt(idea.get('feature_set', '')),
            "Analysis": rt(idea.get('analysis', '')),
            "Post": rt(best_post_url),
        }

        payload = {"parent": {"database_id": db_id}, "properties": properties}

        try:
            notion_request("POST", "/pages", payload)
            print(f"  [{i+1}/50] ✓ {pp.get('title', '?')[:55]}")
        except Exception as e:
            print(f"  [{i+1}/50] ✗ {pp.get('title', '?')[:55]} — {e}")
            time.sleep(2)
            try:
                notion_request("POST", "/pages", payload)
                print(f"  [{i+1}/50] ✓ RETRY OK")
            except Exception as e2:
                print(f"  [{i+1}/50] ✗ RETRY FAILED — {e2}")

        # Rate limit: pause every 3 rows
        if (i + 1) % 3 == 0:
            time.sleep(0.5)

    print(f"\n✅ Done! Database: {title}")
    print(f"   Notion ID: {db_id}")
    print(f"   View at: https://notion.so/{db_id.replace('-', '')}")


if __name__ == '__main__':
    main()
