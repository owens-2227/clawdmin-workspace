#!/usr/bin/env python3
"""Check and import cookies for all 22 AdsPower Reddit profiles."""
import json
import requests
import sys

BASE = "http://127.0.0.1:50325/api/v1"
AUTH = {"Authorization": "Bearer 0d599e9255deef1bcc503d735da537160085c443c76f1c30"}

# Load the cookie source file
with open("/Users/owen/.openclaw/workspace/BRAIN/credentials/reddit-accounts-fresh-2026-04-15.json") as f:
    accounts = json.load(f)

# Build lookup: reddit_username -> cookies
cookie_map = {}
for acc in accounts:
    cookie_map[acc["reddit_username"]] = acc.get("cookies", "")

# Get all AdsPower profiles
resp = requests.get(f"{BASE}/user/list?page=1&page_size=100", headers=AUTH)
profiles = resp.json().get("data", {}).get("list", [])

# Filter to reddit-XX profiles only
reddit_profiles = [p for p in profiles if p["name"].startswith("reddit-")]
reddit_profiles.sort(key=lambda p: p["name"])

print(f"Found {len(reddit_profiles)} Reddit profiles in AdsPower")
print(f"Found {len(accounts)} accounts in cookie source file")
print("=" * 80)

missing = []
has_cookies = []
no_match = []

for profile in reddit_profiles:
    name = profile["name"]
    user_id = profile["user_id"]
    username = profile.get("username", "")
    
    # Check if this profile has cookies by opening it briefly and checking
    # Actually, let's use the API to check - the user/list already shows username
    # The cookie_import endpoint is what we need
    
    # First check if username matches a cookie source
    if username in cookie_map:
        source_cookies = cookie_map[username]
        if source_cookies:
            # Try to check if cookies are already in the profile
            # AdsPower API: GET /api/v1/user/cookies?user_id=xxx
            # or we check via the update endpoint
            
            # Let's try importing via the update API with cookie_import
            print(f"  {name} ({user_id}): username={username} - HAS cookie source")
            has_cookies.append((name, user_id, username, source_cookies))
        else:
            print(f"  {name} ({user_id}): username={username} - cookie source EMPTY")
            missing.append((name, user_id, username))
    else:
        print(f"  {name} ({user_id}): username={username} - NO MATCH in cookie file")
        no_match.append((name, user_id, username))

print("\n" + "=" * 80)
print(f"\nSummary:")
print(f"  With cookie source: {len(has_cookies)}")
print(f"  Empty cookie source: {len(missing)}")
print(f"  No match in file: {len(no_match)}")

if no_match:
    print(f"\n  Unmatched profiles:")
    for name, uid, uname in no_match:
        print(f"    {name}: {uname}")

# Now try to import cookies for profiles that have a source
# AdsPower cookie import: POST /api/v1/user/update with cookie_import field
print("\n" + "=" * 80)
print("\nAttempting cookie import for all matched profiles...")

for name, user_id, username, cookies_str in has_cookies:
    try:
        # Parse the cookies string to verify it's valid JSON
        cookies_data = json.loads(cookies_str)
        
        # AdsPower expects cookies in a specific format for import
        # Try the user/update endpoint with cookie_import_list
        payload = {
            "user_id": user_id,
            "cookie": cookies_str  # Try "cookie" field first
        }
        
        resp = requests.post(f"{BASE}/user/update", json=payload, headers=AUTH)
        result = resp.json()
        
        if result.get("code") == 0:
            print(f"  ✅ {name} ({username}): cookies imported ({len(cookies_data)} cookies)")
        else:
            print(f"  ❌ {name} ({username}): {result.get('msg', 'unknown error')}")
            
            # Try alternative field name
            payload2 = {
                "user_id": user_id,
                "cookie_import_list": cookies_str
            }
            resp2 = requests.post(f"{BASE}/user/update", json=payload2, headers=AUTH)
            result2 = resp2.json()
            if result2.get("code") == 0:
                print(f"     ✅ Retry with cookie_import_list succeeded")
            else:
                print(f"     ❌ Retry also failed: {result2.get('msg')}")
                
    except json.JSONDecodeError:
        print(f"  ⚠️  {name} ({username}): invalid JSON in cookie source")
    except Exception as e:
        print(f"  ❌ {name} ({username}): {e}")

print("\nDone.")
