#!/usr/bin/env python3
"""
Weekly Top 50 Pain Points → Notion Database
Pulls the top 50 pain points (by uncapped viralScore) from MongoDB,
creates a fresh Notion database with the same columns as the original analysis.
"""

import json
import time
import uuid
import urllib.request
from datetime import datetime, timezone
from pymongo import MongoClient

# === Config ===
MONGO_URI = 'mongodb+srv://paul_db_user:REDACTED_MONGO_PASS@cluster0.tdvafh8.mongodb.net/?appName=Cluster0'
NOTION_SECRET = "REDACTED_NOTION"
PARENT_PAGE_ID = "31b66005-ab52-800d-9c49-fbc517921ae3"
NOTION_VERSION = "2022-06-28"
BASE = "https://api.notion.com/v1"

HEADERS = {
    "Authorization": f"Bearer {NOTION_SECRET}",
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
}

def notion_request(method, endpoint, data=None):
    url = f"{BASE}{endpoint}"
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=HEADERS, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        print(f"ERROR {e.code}: {err}")
        raise

def main():
    now = datetime.now(timezone.utc)
    week_label = now.strftime("%B %d, %Y")
    
    # === Step 1: Pull top 50 from MongoDB ===
    print("Connecting to MongoDB...")
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=15000)
    db = client['reddit_scanner']
    
    # Get top 50 by viralScore (uncapped), only actionable
    top50 = list(db['pain_points'].find(
        {'painPointType': {'$in': ['actionable', None]}}
    ).sort('viralScore', -1).limit(50))
    
    print(f"Got {len(top50)} pain points")
    
    # Pre-load linked posts for engagement context
    pp_ids = [pp['_id'] for pp in top50]
    all_posts = list(db['pain_point_posts'].find({'painPointId': {'$in': pp_ids}}))
    posts_by_pp = {}
    for post in all_posts:
        pid = post['painPointId']
        if pid not in posts_by_pp:
            posts_by_pp[pid] = []
        posts_by_pp[pid].append(post)
    
    client.close()
    
    # === Step 2: Create Notion database ===
    title = f"🎯 Top 50 Pain Points — Week of {week_label}"
    print(f"Creating Notion database: {title}")
    
    db_payload = {
        "parent": {"type": "page_id", "page_id": PARENT_PAGE_ID},
        "title": [{"type": "text", "text": {"content": title}}],
        "properties": {
            "Pain Point": {"title": {}},
            "Subreddit": {"rich_text": {}},
            "Viral Score": {"number": {}},
            "Upvotes": {"number": {}},
            "Comments": {"number": {}},
            "Occurrences": {"number": {}},
            "Type": {"rich_text": {}},
            "Description": {"rich_text": {}},
            "Top Source Post": {"url": {}},
        }
    }
    
    db_result = notion_request("POST", "/databases", db_payload)
    db_id = db_result["id"]
    print(f"Database created: {db_id}")
    
    # === Step 3: Add rows ===
    print(f"Adding {len(top50)} rows...")
    
    for i, pp in enumerate(top50):
        pp_id = pp['_id']
        posts = posts_by_pp.get(pp_id, [])
        
        # Aggregate engagement
        total_upvotes = sum(p.get('upvotes', 0) for p in posts)
        total_comments = sum(p.get('commentCount', 0) for p in posts)
        
        # Best source post URL (highest upvotes)
        best_post_url = None
        if posts:
            best = max(posts, key=lambda p: p.get('upvotes', 0))
            best_post_url = best.get('redditUrl')
        
        # Truncate description to 2000 chars (Notion limit)
        desc = (pp.get('description') or '')[:2000]
        
        properties = {
            "Pain Point": {
                "title": [{"text": {"content": (pp.get('title') or '')[:200]}}]
            },
            "Subreddit": {
                "rich_text": [{"text": {"content": pp.get('subreddit', '')}}]
            },
            "Viral Score": {
                "number": pp.get('viralScore', 0)
            },
            "Upvotes": {
                "number": total_upvotes
            },
            "Comments": {
                "number": total_comments
            },
            "Occurrences": {
                "number": pp.get('occurrenceCount', 1)
            },
            "Type": {
                "rich_text": [{"text": {"content": pp.get('painPointType', 'unknown')}}]
            },
            "Description": {
                "rich_text": [{"text": {"content": desc}}]
            },
        }
        
        # URL field can't be empty string
        if best_post_url:
            properties["Top Source Post"] = {"url": best_post_url}
        
        payload = {
            "parent": {"database_id": db_id},
            "properties": properties
        }
        
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
