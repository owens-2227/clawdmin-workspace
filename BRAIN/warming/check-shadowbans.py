#!/usr/bin/env python3
"""Check shadowban status for warming accounts via a DIFFERENT AdsPower profile.
Uses one established account's browser to check all warming accounts via /about.json.

v2 — Rebuilt 2026-04-13:
- Updates state.json directly with results
- Honest status: non-200 = ⚠️ unknown, not ✅ clean
- Only checks accounts with status="warming" 
"""

import asyncio
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

API = "http://127.0.0.1:50325/api/v1"
AUTH_TOKEN = "0d599e9255deef1bcc503d735da537160085c443c76f1c30"
STATE_FILE = os.path.expanduser("~/.openclaw/workspace/BRAIN/warming/state.json")

# Use Jess's profile as the checker (established account, different IP)
CHECKER_PROFILE = ("jess-m", "k1abonj2")


def ads_open(user_id):
    url = f"{API}/browser/start?user_id={user_id}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {AUTH_TOKEN}"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())
    return data.get("data", {}).get("ws", {}).get("puppeteer", "")


def ads_close(user_id):
    try:
        url = f"{API}/browser/stop?user_id={user_id}"
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {AUTH_TOKEN}"})
        urllib.request.urlopen(req, timeout=10)
    except:
        pass


def load_state():
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except:
        return {"accounts": {}}


def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


async def check_all():
    from playwright.async_api import async_playwright

    state = load_state()
    
    # Only check accounts with status="warming"
    accounts_to_check = []
    for name, acct in state.get("accounts", {}).items():
        if acct.get("status") == "warming":
            accounts_to_check.append(name)
    
    if not accounts_to_check:
        print("No active warming accounts to check.")
        return []
    
    checker_name, checker_id = CHECKER_PROFILE
    print(f"Opening checker profile: {checker_name} ({checker_id})...", flush=True)

    cdp_url = ads_open(checker_id)
    if not cdp_url:
        print("❌ Failed to open checker profile")
        return []

    await asyncio.sleep(5)

    pw = await async_playwright().start()
    results = []

    try:
        browser = await pw.chromium.connect_over_cdp(cdp_url)
        ctx = browser.contexts[0]
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()

        for username in accounts_to_check:
            print(f"\nChecking u/{username}...", flush=True)
            result = {"username": username, "status": "unknown"}

            try:
                url = f"https://www.reddit.com/user/{username}/about.json"
                resp = await page.goto(url, wait_until="domcontentloaded", timeout=15000)
                await asyncio.sleep(2)

                http_status = resp.status if resp else None
                result["http_status"] = http_status

                body_text = await page.text_content("body") or ""

                if http_status == 200:
                    try:
                        data = json.loads(body_text)
                        if data.get("data", {}).get("is_suspended"):
                            result["status"] = "suspended"
                        else:
                            result["status"] = "clean"
                            result["karma"] = data.get("data", {}).get("total_karma", 0)
                    except json.JSONDecodeError:
                        result["status"] = "unknown"
                        result["detail"] = "Could not parse response"
                elif http_status == 404:
                    result["status"] = "shadowbanned"
                elif http_status == 403:
                    result["status"] = "unknown"  # NOT conclusive
                    result["detail"] = "403 — could be rate limiting, not necessarily banned"
                else:
                    result["status"] = "unknown"
                    result["detail"] = f"HTTP {http_status}"

            except Exception as e:
                result["status"] = "unknown"
                result["detail"] = f"Error: {str(e)[:100]}"

            results.append(result)
            
            # Status icon — honest reporting
            icons = {
                "clean": "✅",
                "shadowbanned": "❌",
                "suspended": "❌",
                "unknown": "⚠️",
            }
            icon = icons.get(result["status"], "⚠️")
            karma_str = f" (karma: {result.get('karma', '?')})" if result["status"] == "clean" else ""
            detail_str = f" — {result.get('detail', '')}" if result.get("detail") else ""
            print(f"  {icon} {result['status']}{karma_str}{detail_str}", flush=True)
            
            # Update state.json
            if username in state.get("accounts", {}):
                acct = state["accounts"][username]
                acct["last_shadowban_check"] = datetime.now(timezone.utc).isoformat()
                acct["last_shadowban_result"] = result["status"]
                
                if result["status"] in ("shadowbanned", "suspended"):
                    acct["status"] = result["status"]
                    print(f"  🚨 Account marked as {result['status']} in state.json", flush=True)
                # Note: "unknown" does NOT change status — we only mark definitive results

            await asyncio.sleep(2)

    finally:
        await pw.stop()
        ads_close(checker_id)
    
    # Save updated state
    save_state(state)
    print(f"\n💾 State saved to {STATE_FILE}")
    
    print("\n" + json.dumps(results, indent=2))
    return results


if __name__ == "__main__":
    asyncio.run(check_all())
