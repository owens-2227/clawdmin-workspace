#!/usr/bin/env python3
"""
Warmup v3 - shadowban check + 3hr warmup, bandwidth-optimized.
Batches of 5/5/6/6. Blocks images/media/fonts via Playwright route.
"""
import json, subprocess, requests, time, sys, os, threading

BASE = "http://127.0.0.1:50325/api/v1"
AUTH = {"Authorization": "Bearer 0d599e9255deef1bcc503d735da537160085c443c76f1c30"}
WARMUP_MINUTES = 60
SCRIPTS_DIR = '/Users/owen/.openclaw/workspace/BRAIN/scripts'

resp = requests.get(f"{BASE}/user/list?page=1&page_size=100", headers=AUTH)
profiles = sorted([p for p in resp.json()["data"]["list"] if p["name"].startswith("reddit-")], key=lambda p: p["name"])
print(f"Found {len(profiles)} profiles")

batches = [profiles[0:5], profiles[5:10], profiles[10:16], profiles[16:22]]
batch_start = int(sys.argv[1]) if len(sys.argv) > 1 else 1

CHECK_SCRIPT = """
const {{ chromium }} = require('playwright');
(async () => {{
    const browser = await chromium.connectOverCDP('{cdp}');
    const ctx = browser.contexts()[0];
    const page = ctx.pages()[0] || await ctx.newPage();
    // Close extra tabs
    for (const p of ctx.pages().slice(1)) {{ try {{ await p.close(); }} catch(e) {{}} }}
    const r = {{ profile: '{name}', username: '{user}', logged_in: false, shadowbanned: null, error: null }};
    try {{
        await page.goto('https://www.reddit.com/', {{ waitUntil: 'domcontentloaded', timeout: 60000 }});
        await page.waitForTimeout(5000);
        const loginBtn = await page.locator('a[href*="login"], button:has-text("Log In")').count();
        const userEl = await page.locator('a[href*="/user/"]').count();
        if (loginBtn > 0 && userEl === 0) {{ r.error = 'Not logged in'; console.log(JSON.stringify(r)); process.exit(0); }}
        r.logged_in = true;
        await page.goto('https://www.reddit.com/user/{user}/', {{ waitUntil: 'domcontentloaded', timeout: 60000 }});
        await page.waitForTimeout(4000);
        const t = await page.textContent('body');
        if (t.includes('page not found') || t.includes('nobody on Reddit goes by that name')) r.shadowbanned = true;
        else if (t.includes('suspended')) r.shadowbanned = 'suspended';
        else r.shadowbanned = false;
    }} catch(e) {{ r.error = e.message; }}
    console.log(JSON.stringify(r));
    process.exit(0);
}})();
"""

WARMUP_SCRIPT = """
const {{ chromium }} = require('playwright');
(async () => {{
    const browser = await chromium.connectOverCDP('{cdp}');
    const ctx = browser.contexts()[0];
    const pages = ctx.pages();
    const page = pages[0] || await ctx.newPage();
    for (let i = 1; i < pages.length; i++) {{ try {{ await pages[i].close(); }} catch(e) {{}} }}
    
    // Block heavy resources to save bandwidth
    await page.route('**/*', route => {{
        const type = route.request().resourceType();
        if (['image','media','font','stylesheet'].includes(type)) return route.abort();
        return route.continue();
    }});
    
    const subs = ['r/AskReddit','r/todayilearned','r/pics','r/funny','r/worldnews',
                  'r/science','r/gaming','r/movies','r/music','r/books',
                  'r/food','r/travel','r/technology','r/sports','r/nature',
                  'r/aww','r/mildlyinteresting','r/Showerthoughts','r/LifeProTips','r/explainlikeimfive',
                  'r/interestingasfuck','r/dataisbeautiful','r/space','r/history','r/philosophy'];
    const end = Date.now() + {mins}*60*1000;
    let visited = 0;
    
    while (Date.now() < end) {{
        try {{
            // Close any extra tabs
            for (const p of ctx.pages().slice(1)) {{ try {{ await p.close(); }} catch(e) {{}} }}
            
            const sub = subs[Math.floor(Math.random()*subs.length)];
            await page.goto('https://www.reddit.com/' + sub + '/', {{ waitUntil: 'domcontentloaded', timeout: 60000 }});
            await page.waitForTimeout(3000 + Math.random()*4000);
            visited++;
            
            const scrollCount = 2 + Math.floor(Math.random()*5);
            for (let i = 0; i < scrollCount; i++) {{
                await page.mouse.wheel(0, 300 + Math.random()*400);
                await page.waitForTimeout(1500 + Math.random()*2500);
            }}
            
            if (Math.random() > 0.4) {{
                const posts = await page.locator('a[slot="full-post-link"]').all();
                if (posts.length > 0) {{
                    const idx = Math.floor(Math.random() * Math.min(posts.length, 8));
                    const href = await posts[idx].getAttribute('href');
                    if (href) {{
                        const postUrl = href.startsWith('http') ? href : 'https://www.reddit.com' + href;
                        await page.goto(postUrl, {{ waitUntil: 'domcontentloaded', timeout: 60000 }});
                        await page.waitForTimeout(3000 + Math.random()*5000);
                        visited++;
                        const commentScrolls = 2 + Math.floor(Math.random()*4);
                        for (let i = 0; i < commentScrolls; i++) {{
                            await page.mouse.wheel(0, 250 + Math.random()*350);
                            await page.waitForTimeout(1500 + Math.random()*2000);
                        }}
                    }}
                }}
            }}
            
            await page.waitForTimeout(8000 + Math.random()*15000);
        }} catch(e) {{
            await page.waitForTimeout(10000);
        }}
    }}
    
    console.log(JSON.stringify({{ done: true, pagesVisited: visited }}));
    process.exit(0);
}})();
"""

def open_profile(uid):
    r = requests.get(f"{BASE}/browser/start?user_id={uid}&launch_args=%5B%22--blink-settings%3DimagesEnabled%3Dfalse%22%5D", headers=AUTH)
    d = r.json()
    return d["data"]["ws"]["puppeteer"] if d.get("code") == 0 else None

def close_profile(uid):
    requests.get(f"{BASE}/browser/stop?user_id={uid}", headers=AUTH)

def run_node(script, timeout_s=120):
    try:
        r = subprocess.run(['node', '-e', script], capture_output=True, text=True, timeout=timeout_s, cwd=SCRIPTS_DIR)
        for line in reversed(r.stdout.strip().split('\n')):
            try: return json.loads(line)
            except: continue
        return {"error": r.stderr[:300] if r.stderr else "no output"}
    except subprocess.TimeoutExpired:
        return {"done": True, "note": "timeout"}
    except Exception as e:
        return {"error": str(e)}

all_check_results = []
all_warmup_results = {}

for batch_num, batch in enumerate(batches, 1):
    if batch_num < batch_start:
        continue
    
    print(f"\n{'='*80}")
    print(f"BATCH {batch_num}/4 — {len(batch)} profiles")
    print(f"{'='*80}")
    
    # Phase 1: Sequential shadowban check
    print(f"\n  --- Shadowban Check ---")
    batch_checks = []
    good_profiles = []
    
    for p in batch:
        name, uid, uname = p["name"], p["user_id"], p.get("username","")
        print(f"  {name} ({uname}): ", end="", flush=True)
        cdp = open_profile(uid)
        if not cdp:
            print("❌ open failed")
            batch_checks.append({"profile": name, "username": uname, "error": "open failed"})
            continue
        
        time.sleep(3)
        script = CHECK_SCRIPT.format(cdp=cdp, name=name, user=uname)
        result = run_node(script, timeout_s=120)
        batch_checks.append(result if isinstance(result, dict) else {"profile": name, "error": str(result)})
        
        if isinstance(result, dict):
            if result.get("shadowbanned"):
                print(f"🚫 SHADOWBANNED")
            elif result.get("logged_in"):
                print(f"✅ clean")
                good_profiles.append(p)
            elif result.get("error"):
                print(f"⚠️  {result['error'][:50]}")
            else:
                print(f"❌ not logged in")
        
        close_profile(uid)
        time.sleep(2)
    
    all_check_results.extend(batch_checks)
    
    # Phase 2: Warmup good profiles
    if good_profiles:
        print(f"\n  --- {WARMUP_MINUTES}min Warmup ({len(good_profiles)} profiles, bandwidth-optimized) ---")
        
        cdp_map = {}
        for p in good_profiles:
            name, uid = p["name"], p["user_id"]
            print(f"    Opening {name}...", end=" ", flush=True)
            cdp = open_profile(uid)
            if cdp:
                cdp_map[name] = (uid, cdp)
                print("✅")
            else:
                print("❌")
            time.sleep(3)
        
        time.sleep(5)
        
        def do_warmup(name, cdp):
            script = WARMUP_SCRIPT.format(cdp=cdp, mins=WARMUP_MINUTES)
            all_warmup_results[name] = run_node(script, timeout_s=(WARMUP_MINUTES + 10) * 60)
        
        threads = []
        for name, (uid, cdp) in cdp_map.items():
            t = threading.Thread(target=do_warmup, args=(name, cdp))
            t.start()
            threads.append(t)
            time.sleep(2)
        
        print(f"\n    All {len(threads)} browsers warming for {WARMUP_MINUTES} min (images/media blocked)...")
        for t in threads:
            t.join()
        
        print(f"\n    ✅ Batch {batch_num} warmup complete!")
        for name, wr in {k: v for k, v in all_warmup_results.items() if k.startswith(f"reddit-{str(batch[0]['name'][-2:])}")}.items():
            pages = wr.get("pagesVisited", "?") if isinstance(wr, dict) else "?"
            print(f"      {name}: {pages} pages")
        # Print all from this batch
        for p in good_profiles:
            name = p["name"]
            if name in all_warmup_results:
                wr = all_warmup_results[name]
                pages = wr.get("pagesVisited", "?") if isinstance(wr, dict) else "?"
                print(f"      {name}: {pages} pages")
        
        print(f"\n    Closing batch {batch_num}...")
        for name, (uid, cdp) in cdp_map.items():
            close_profile(uid)
            time.sleep(1)
        print(f"    All closed.")
    
    if batch_num < 4:
        print(f"\n  ⏳ Moving to batch {batch_num+1}...")
        time.sleep(5)

# Final summary
print(f"\n{'='*80}")
print(f"FINAL SUMMARY")
print(f"{'='*80}")
ok = sum(1 for r in all_check_results if isinstance(r, dict) and r.get("logged_in") and not r.get("shadowbanned"))
banned = sum(1 for r in all_check_results if isinstance(r, dict) and r.get("shadowbanned"))
errs = len(all_check_results) - ok - banned
print(f"  ✅ Clean: {ok}")
print(f"  🚫 Shadowbanned: {banned}")
print(f"  ⚠️  Errors: {errs}")

if banned > 0:
    print(f"\n  Shadowbanned accounts:")
    for r in all_check_results:
        if isinstance(r, dict) and r.get("shadowbanned"):
            print(f"    🚫 {r.get('profile')} ({r.get('username')})")

total_pages = sum(r.get("pagesVisited", 0) for r in all_warmup_results.values() if isinstance(r, dict))
print(f"\n  Total pages visited: {total_pages}")

output = "/Users/owen/.openclaw/workspace/BRAIN/summaries/warmup-v3-2026-04-16.json"
os.makedirs(os.path.dirname(output), exist_ok=True)
with open(output, 'w') as f:
    json.dump({"checks": all_check_results, "warmup": {k: v for k, v in all_warmup_results.items()}}, f, indent=2)
print(f"  Saved to {output}")
