#!/usr/bin/env python3
"""Backfill app ideation into Notion database from a JSON file."""
import json, sys, urllib.request, time

NOTION_SECRET = "REDACTED_NOTION"
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
    with open(sys.argv[1]) as f:
        ideations = json.load(f)
    
    for item in ideations:
        page_id = item["page_id"]
        idea = item.get("ideation", {})
        if not idea:
            continue
        
        properties = {
            "Wabi Fit (1-5)": {"number": idea.get("wabi_fit")},
            "App Idea": rt(idea.get("app_idea", "")),
            "What It Does": rt(idea.get("what_it_does", "")),
            "How It Solves the Pain": rt(idea.get("how_it_solves", "")),
            "Feature Set": rt(idea.get("feature_set", "")),
            "Analysis": rt(idea.get("analysis", "")),
        }
        
        try:
            notion_request("PATCH", f"/pages/{page_id}", {"properties": properties})
            print(f"✓ {item.get('title', '?')[:60]}")
        except Exception as e:
            print(f"✗ {item.get('title', '?')[:60]} — {e}")
            time.sleep(2)
        
        time.sleep(0.3)

if __name__ == '__main__':
    main()
