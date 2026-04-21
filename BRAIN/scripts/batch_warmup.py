#!/usr/bin/env python3
"""
Batch warmup for 22 Reddit AdsPower profiles.
Batches: 5, 5, 6, 6
For each profile: open browser, connect Playwright, verify login, check shadowban, warm up 30 min, close.
"""
import json
import subprocess
import requests
import time
import sys
import os

BASE = "http://127.0.0.1:50325/api/v1"
AUTH_HEADER = "Authorization: Bearer 0d599e9255deef1bcc503d735da537160085c443c76f1c30"
AUTH = {"Authorization": "Bearer 0d599e9255deef1bcc503d735da537160085c443c76f1c30"}

WARMUP_MINUTES = 30

# Get all reddit profiles
resp = requests.get(f"{BASE}/user/list?page=1&page_size=100", headers=AUTH)
profiles = resp.json().get("data", {}).get("list", [])
reddit_profiles = sorted([p for p in profiles if p["name"].startswith("reddit-")], key=lambda p: p["name"])

print(f"Found {len(reddit_profiles)} profiles")

# Split into batches: 5, 5, 6, 6
batches = [
    reddit_profiles[0:5],
    reddit_profiles[5:10],
    reddit_profiles[10:16],
    reddit_profiles[16:22],
]

def open_profile(user_id):
    """Open an AdsPower profile and return the CDP URL."""
    resp = requests.get(f"{BASE}/browser/start?user_id={user_id}", headers=AUTH)
    data = resp.json()
    if data.get("code") == 0:
        return data["data"]["ws"]["puppeteer"]
    else:
        return None

def close_profile(user_id):
    """Close an AdsPower profile."""
    requests.get(f"{BASE}/browser/stop?user_id={user_id}", headers=AUTH)

def run_playwright_check(cdp_url, username, profile_name):
    """Run a Playwright script to verify login and check shadowban."""
    script = f"""
const {{ chromium }} = require('playwright');

(async () => {{
    const browser = await chromium.connectOverCDP('{cdp_url}');
    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.newPage();
    
    const results = {{ profile: '{profile_name}', username: '{username}', logged_in: false, shadowbanned: null, error: null }};
    
    try {{
        // Go to Reddit and check login
        await page.goto('https://www.reddit.com/', {{ waitUntil: 'domcontentloaded', timeout: 60000 }});
        await page.waitForTimeout(5000);
        
        // Check if logged in by looking for the user menu or login button
        const loginBtn = await page.locator('a[href*="login"], button:has-text("Log In")').count();
        const userMenu = await page.locator('faceplate-tracker[noun="user_menu"], button[aria-label*="avatar"], #USER_DROPDOWN_ID, a[href*="/user/"]').count();
        
        if (loginBtn > 0 && userMenu === 0) {{
            results.logged_in = false;
            results.error = 'Not logged in - cookies may be expired';
            console.log(JSON.stringify(results));
            return;
        }}
        
        results.logged_in = true;
        
        // Check shadowban: visit own profile page
        await page.goto('https://www.reddit.com/user/{username}/', {{ waitUntil: 'domcontentloaded', timeout: 60000 }});
        await page.waitForTimeout(4000);
        
        // Check for shadowban indicators
        const pageText = await page.textContent('body');
        const url = page.url();
        
        if (pageText.includes('page not found') || pageText.includes('Sorry, nobody on Reddit goes by that name') || url.includes('/404')) {{
            results.shadowbanned = true;
        }} else if (pageText.includes('suspended') || pageText.includes('This account has been suspended')) {{
            results.shadowbanned = 'suspended';
        }} else {{
            results.shadowbanned = false;
        }}
        
    }} catch (e) {{
        results.error = e.message;
    }}
    
    console.log(JSON.stringify(results));
}})();
"""
    try:
        result = subprocess.run(
            ['node', '-e', script],
            capture_output=True, text=True, timeout=120,
            cwd='/Users/owen/.openclaw/workspace/BRAIN/scripts'
        )
        if result.stdout.strip():
            # Find the last JSON line
            for line in reversed(result.stdout.strip().split('\n')):
                try:
                    return json.loads(line)
                except:
                    continue
        return {"error": result.stderr[:500] if result.stderr else "no output"}
    except subprocess.TimeoutExpired:
        return {"error": "timeout"}
    except Exception as e:
        return {"error": str(e)}


def warmup_browse(cdp_url, minutes):
    """Browse Reddit naturally for the specified minutes."""
    subreddits = ['r/AskReddit', 'r/todayilearned', 'r/pics', 'r/funny', 'r/worldnews',
                  'r/science', 'r/gaming', 'r/movies', 'r/music', 'r/books',
                  'r/food', 'r/travel', 'r/technology', 'r/sports', 'r/nature']
    
    script = f"""
const {{ chromium }} = require('playwright');

(async () => {{
    const browser = await chromium.connectOverCDP('{cdp_url}');
    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.newPage();
    
    const subreddits = {json.dumps(subreddits)};
    const endTime = Date.now() + {minutes} * 60 * 1000;
    let pagesVisited = 0;
    
    while (Date.now() < endTime) {{
        try {{
            // Pick a random subreddit
            const sub = subreddits[Math.floor(Math.random() * subreddits.length)];
            await page.goto('https://www.reddit.com/' + sub + '/', {{ waitUntil: 'domcontentloaded', timeout: 60000 }});
            await page.waitForTimeout(3000 + Math.random() * 3000);
            pagesVisited++;
            
            // Scroll the feed
            const scrollCount = 2 + Math.floor(Math.random() * 4);
            for (let i = 0; i < scrollCount; i++) {{
                await page.mouse.wheel(0, 300 + Math.random() * 400);
                await page.waitForTimeout(1500 + Math.random() * 2000);
            }}
            
            // Click into a post sometimes
            if (Math.random() > 0.4) {{
                const posts = await page.locator('a[slot="full-post-link"]').all();
                if (posts.length > 0) {{
                    const idx = Math.floor(Math.random() * Math.min(posts.length, 5));
                    await posts[idx].click();
                    await page.waitForTimeout(4000 + Math.random() * 4000);
                    pagesVisited++;
                    
                    // Scroll through post
                    const postScrolls = 2 + Math.floor(Math.random() * 3);
                    for (let i = 0; i < postScrolls; i++) {{
                        await page.mouse.wheel(0, 250 + Math.random() * 300);
                        await page.waitForTimeout(1500 + Math.random() * 2000);
                    }}
                    
                    await page.goBack();
                    await page.waitForTimeout(2000 + Math.random() * 2000);
                }}
            }}
            
            // Pause between subreddits
            await page.waitForTimeout(5000 + Math.random() * 10000);
            
        }} catch (e) {{
            // If navigation fails, just wait and try again
            await page.waitForTimeout(5000);
        }}
    }}
    
    console.log(JSON.stringify({{ done: true, pagesVisited }}));
}})();
"""
    try:
        result = subprocess.run(
            ['node', '-e', script],
            capture_output=True, text=True, timeout=(minutes + 5) * 60,
            cwd='/Users/owen/.openclaw/workspace/BRAIN/scripts'
        )
        if result.stdout.strip():
            for line in reversed(result.stdout.strip().split('\n')):
                try:
                    return json.loads(line)
                except:
                    continue
        return {"error": result.stderr[:500] if result.stderr else "no output"}
    except subprocess.TimeoutExpired:
        return {"done": True, "note": "timeout but browsing completed"}
    except Exception as e:
        return {"error": str(e)}


# ---- MAIN ----
all_results = []
batch_start_arg = int(sys.argv[1]) if len(sys.argv) > 1 else 1

for batch_num, batch in enumerate(batches, 1):
    if batch_num < batch_start_arg:
        continue
        
    print(f"\n{'='*80}")
    print(f"BATCH {batch_num}/{len(batches)} — {len(batch)} profiles")
    print(f"{'='*80}")
    
    # Step 1: Open all profiles in this batch (staggered)
    cdp_urls = {}
    for profile in batch:
        name = profile["name"]
        uid = profile["user_id"]
        print(f"  Opening {name} ({uid})...", end=" ", flush=True)
        cdp = open_profile(uid)
        if cdp:
            cdp_urls[uid] = cdp
            print(f"✅ CDP ready")
        else:
            print(f"❌ Failed to open")
        time.sleep(2)  # Stagger opens
    
    time.sleep(5)  # Let browsers settle
    
    # Step 2: Check login & shadowban for each
    print(f"\n  --- Login & Shadowban Check ---")
    batch_results = []
    for profile in batch:
        name = profile["name"]
        uid = profile["user_id"]
        username = profile.get("username", "")
        
        if uid not in cdp_urls:
            batch_results.append({"profile": name, "username": username, "error": "browser not open"})
            continue
        
        print(f"  Checking {name} ({username})...", end=" ", flush=True)
        result = run_playwright_check(cdp_urls[uid], username, name)
        batch_results.append(result)
        
        if isinstance(result, dict):
            if result.get("error"):
                print(f"⚠️  {result['error'][:60]}")
            elif result.get("shadowbanned"):
                print(f"🚫 SHADOWBANNED/SUSPENDED")
            elif result.get("logged_in"):
                print(f"✅ Logged in, not shadowbanned")
            else:
                print(f"❌ Not logged in")
        else:
            print(f"❓ Unexpected: {result}")
        
        time.sleep(1)
    
    # Print batch summary
    print(f"\n  --- Batch {batch_num} Status ---")
    ok_profiles = []
    for r in batch_results:
        status = "❓"
        if isinstance(r, dict):
            if r.get("shadowbanned"):
                status = "🚫 BANNED"
            elif r.get("logged_in"):
                status = "✅ OK"
                ok_profiles.append(r.get("profile", "?"))
            elif r.get("error"):
                status = f"⚠️  {r['error'][:40]}"
            else:
                status = "❌ Not logged in"
        print(f"    {r.get('profile', '?')} ({r.get('username', '?')}): {status}")
    
    # Step 3: Warm up for 30 minutes
    if ok_profiles:
        print(f"\n  --- Starting {WARMUP_MINUTES}min warm-up for {len(batch)} profiles ---")
        print(f"  Warming all simultaneously (browse-only)...")
        
        # Run warmup for all profiles in parallel using subprocesses
        import threading
        warmup_results = {}
        
        def warmup_thread(uid, name, cdp):
            warmup_results[name] = warmup_browse(cdp, WARMUP_MINUTES)
        
        threads = []
        for profile in batch:
            uid = profile["user_id"]
            name = profile["name"]
            if uid in cdp_urls:
                t = threading.Thread(target=warmup_thread, args=(uid, name, cdp_urls[uid]))
                t.start()
                threads.append(t)
                time.sleep(1)  # Stagger thread starts slightly
        
        # Wait for all warmup threads
        for t in threads:
            t.join()
        
        print(f"  Warm-up complete!")
        for name, wr in warmup_results.items():
            pages = wr.get("pagesVisited", "?") if isinstance(wr, dict) else "?"
            print(f"    {name}: {pages} pages visited")
    
    # Step 4: Close all profiles in this batch
    print(f"\n  --- Closing batch {batch_num} profiles ---")
    for profile in batch:
        uid = profile["user_id"]
        name = profile["name"]
        close_profile(uid)
        print(f"    Closed {name}")
        time.sleep(1)
    
    all_results.extend(batch_results)
    
    if batch_num < len(batches):
        print(f"\n  ⏳ Moving to next batch...")
        time.sleep(5)

# Final summary
print(f"\n{'='*80}")
print(f"FINAL SUMMARY")
print(f"{'='*80}")
ok = sum(1 for r in all_results if isinstance(r, dict) and r.get("logged_in") and not r.get("shadowbanned"))
banned = sum(1 for r in all_results if isinstance(r, dict) and r.get("shadowbanned"))
not_logged = sum(1 for r in all_results if isinstance(r, dict) and not r.get("logged_in") and not r.get("error"))
errors = sum(1 for r in all_results if isinstance(r, dict) and r.get("error"))
print(f"  ✅ Logged in & clean: {ok}")
print(f"  🚫 Shadowbanned/suspended: {banned}")
print(f"  ❌ Not logged in: {not_logged}")
print(f"  ⚠️  Errors: {errors}")

# Save results
output_path = "/Users/owen/.openclaw/workspace/BRAIN/summaries/warmup-2026-04-15.json"
os.makedirs(os.path.dirname(output_path), exist_ok=True)
with open(output_path, 'w') as f:
    json.dump(all_results, f, indent=2)
print(f"\nResults saved to {output_path}")
