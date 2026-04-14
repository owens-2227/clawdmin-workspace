#!/usr/bin/env python3
"""
Rebuild the weekly Notion database with this week's top 50 pain points
using opportunityScore from pain_point_snapshots (not the stale viralScore).
"""
import json, sys, time, urllib.request
from pymongo import MongoClient

import os
MONGO_URI = os.environ.get('MONGO_URI', '')
if not MONGO_URI:
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env')
    if os.path.exists(env_path):
        for line in open(env_path):
            if line.startswith('MONGO_URI='):
                MONGO_URI = line.strip().split('=', 1)[1]
NOTION_SECRET = "REDACTED_NOTION"
DB_ID = "33e66005-ab52-81c7-aaef-f6f8538429e2"  # Already created April 10 database
NOTION_BASE = "https://api.notion.com/v1"
HEADERS = {
    "Authorization": f"Bearer {NOTION_SECRET}",
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
}

def notion_request(method, endpoint, data=None):
    url = f"{NOTION_BASE}{endpoint}"
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=HEADERS, method=method)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())

def rt(text, max_len=2000):
    t = (text or '')[:max_len]
    return {"rich_text": [{"text": {"content": t}}]} if t else {"rich_text": []}

def main():
    # Load ideation data
    with open(sys.argv[1]) as f:
        ideations = {item["pp_id"]: item["ideation"] for item in json.load(f)}

    # Step 1: Delete all existing pages in the database
    print("Deleting old pages...")
    has_more = True
    start_cursor = None
    deleted = 0
    while has_more:
        body = {"page_size": 100}
        if start_cursor:
            body["start_cursor"] = start_cursor
        result = notion_request("POST", f"/databases/{DB_ID}/query", body)
        for page in result["results"]:
            notion_request("PATCH", f"/pages/{page['id']}", {"archived": True})
            deleted += 1
        has_more = result.get("has_more", False)
        start_cursor = result.get("next_cursor")
        time.sleep(0.3)
    print(f"Deleted {deleted} old pages")

    # Step 2: Get fresh top 50 from MongoDB snapshots
    print("Pulling fresh data from MongoDB...")
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=15000)
    db = client['reddit_scanner']

    pipeline = [
        {"$match": {"snapshotDate": {"$gte": "2026-04-04"}}},
        {"$sort": {"snapshotDate": -1}},
        {"$group": {
            "_id": "$painPointId",
            "opportunityScore": {"$first": "$opportunityScore"},
            "postCount": {"$first": "$postCount"},
            "totalEngagement": {"$first": "$totalEngagement"},
        }},
        {"$sort": {"opportunityScore": -1}},
        {"$limit": 50}
    ]
    top50 = list(db['pain_point_snapshots'].aggregate(pipeline))

    # Step 3: Add new pages
    print(f"Adding {len(top50)} rows...")
    for i, opp in enumerate(top50):
        pp = db['pain_points'].find_one({"_id": opp["_id"]})
        if not pp:
            continue

        best_post = db['pain_point_posts'].find_one(
            {"painPointId": opp["_id"]},
            sort=[("upvotes", -1)]
        )
        post_url = best_post.get('redditUrl', '') if best_post else ''
        idea = ideations.get(opp["_id"], {})

        properties = {
            "Pain Point": {"title": [{"text": {"content": (pp.get('title') or '')[:200]}}]},
            "Subreddit": rt(pp.get('subreddit', '')),
            "Viral Score": {"number": opp['opportunityScore']},
            "Wabi Fit (1-5)": {"number": idea.get('wabi_fit') if idea else None},
            "App Idea": rt(idea.get('app_idea', '')),
            "What It Does": rt(idea.get('what_it_does', '')),
            "How It Solves the Pain": rt(idea.get('how_it_solves', '')),
            "Feature Set": rt(idea.get('feature_set', '')),
            "Analysis": rt(idea.get('analysis', '')),
            "Post": rt(post_url),
        }

        try:
            notion_request("POST", "/pages", {"parent": {"database_id": DB_ID}, "properties": properties})
            print(f"  [{i+1}/50] ✓ {pp.get('title', '?')[:55]}")
        except Exception as e:
            print(f"  [{i+1}/50] ✗ {e}")
            time.sleep(2)

        if (i + 1) % 3 == 0:
            time.sleep(0.5)

    client.close()
    print("\n✅ Done!")

if __name__ == '__main__':
    main()
