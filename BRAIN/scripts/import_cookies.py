#!/usr/bin/env python3
"""Import cookies for all 22 AdsPower Reddit profiles with rate limiting."""
import json
import requests
import time
import sys

BASE = "http://127.0.0.1:50325/api/v1"
AUTH = {"Authorization": "Bearer 0d599e9255deef1bcc503d735da537160085c443c76f1c30"}

with open("/Users/owen/.openclaw/workspace/BRAIN/credentials/reddit-accounts-fresh-2026-04-15.json") as f:
    accounts = json.load(f)

cookie_map = {acc["reddit_username"]: acc.get("cookies", "") for acc in accounts}

resp = requests.get(f"{BASE}/user/list?page=1&page_size=100", headers=AUTH)
profiles = resp.json().get("data", {}).get("list", [])
reddit_profiles = sorted([p for p in profiles if p["name"].startswith("reddit-")], key=lambda p: p["name"])

success = 0
failed = 0

for i, profile in enumerate(reddit_profiles):
    name = profile["name"]
    user_id = profile["user_id"]
    username = profile.get("username", "")
    
    if username not in cookie_map or not cookie_map[username]:
        print(f"  ⚠️  {name} ({username}): no cookie source, skipping")
        continue
    
    cookies_str = cookie_map[username]
    try:
        cookies_data = json.loads(cookies_str)
        payload = {"user_id": user_id, "cookie": cookies_str}
        
        resp = requests.post(f"{BASE}/user/update", json=payload, headers=AUTH)
        result = resp.json()
        
        if result.get("code") == 0:
            print(f"  ✅ {name} ({username}): {len(cookies_data)} cookies imported")
            success += 1
        else:
            print(f"  ❌ {name} ({username}): {result.get('msg')}")
            failed += 1
    except Exception as e:
        print(f"  ❌ {name} ({username}): {e}")
        failed += 1
    
    # Rate limit: 1 request per second
    time.sleep(1.5)

print(f"\n✅ Success: {success} | ❌ Failed: {failed} | Total: {len(reddit_profiles)}")
