#!/usr/bin/env python3
"""Check shadowban status for warming accounts via a DIFFERENT AdsPower profile.
Uses one established account's browser to check all warming accounts via /about.json.
"""

import asyncio
import json
import sys
import urllib.request

API = "http://127.0.0.1:50325/api/v1"
AUTH_TOKEN = "0d599e9255deef1bcc503d735da537160085c443c76f1c30"

# Use Jess's profile as the checker (established account, different IP)
CHECKER_PROFILE = ("jess-m", "k1abonj2")

ACCOUNTS_TO_CHECK = [
    "qwsrbaeoyp",
    "ndbmzlayar",
    "lhdqpdftdt",
    "vglmtlyrdm",
    "cuvuvcljco",
]


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


async def check_all():
    from playwright.async_api import async_playwright

    checker_name, checker_id = CHECKER_PROFILE
    print(f"Opening checker profile: {checker_name} ({checker_id})...", flush=True)

    cdp_url = ads_open(checker_id)
    if not cdp_url:
        print("❌ Failed to open checker profile")
        return

    await asyncio.sleep(5)

    pw = await async_playwright().start()
    results = []

    try:
        browser = await pw.chromium.connect_over_cdp(cdp_url)
        ctx = browser.contexts[0]
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()

        for username in ACCOUNTS_TO_CHECK:
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
                            result["created"] = data.get("data", {}).get("created_utc", 0)
                    except json.JSONDecodeError:
                        result["status"] = "unknown_parse_error"
                        result["detail"] = body_text[:200]
                elif http_status == 404:
                    result["status"] = "shadowbanned"
                elif http_status == 403:
                    result["status"] = "blocked_403"
                    result["detail"] = body_text[:200]
                else:
                    result["status"] = f"unknown_http_{http_status}"
                    result["detail"] = body_text[:200]

            except Exception as e:
                result["status"] = f"error: {str(e)[:100]}"

            results.append(result)
            icon = {"clean": "✅", "shadowbanned": "❌", "suspended": "❌"}.get(result["status"], "⚠️")
            karma_str = f" (karma: {result.get('karma', '?')})" if result["status"] == "clean" else ""
            print(f"  {icon} {result['status']}{karma_str}", flush=True)

            await asyncio.sleep(2)

    finally:
        await pw.stop()
        ads_close(checker_id)

    print("\n" + json.dumps(results, indent=2))


if __name__ == "__main__":
    asyncio.run(check_all())
