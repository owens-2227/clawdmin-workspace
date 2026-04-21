#!/usr/bin/env python3
"""
Batch warmup v2 - sequential checks, parallel warmup.
Opens one profile at a time for login/shadowban check, then opens the whole batch for warm-up.
"""
import json, subprocess, requests, time, sys, os, threading

BASE = "http://127.0.0.1:50325/api/v1"
AUTH = {"Authorization": "Bearer 0d599e9255deef1bcc503d735da537160085c443c76f1c30"}
WARMUP_MINUTES = 30
SCRIPTS_DIR = '/Users/owen/.openclaw/workspace/BRAIN/scripts'

resp = requests.get(f"{BASE}/user/list?page=1&page_size=100", headers=AUTH)
profiles = sorted([p for p in resp.json()["data"]["list"] if p["name"].startswith("reddit-")], key=lambda p: p["name"])
print(f"Found {len(profiles)} profiles")

batches = [profiles[0:5], profiles[5:10], profiles[10:16], profiles[16:22]]
batch_start = int(sys.argv[1]) if len(sys.argv) > 1 else 1

CHECK_SCRIPT_TEMPLATE = """
const {{ chromium }} = require('playwright');
(async () => {{
    const browser = await chromium.connectOverCDP('{cdp}');
    const ctx = browser.contexts()[0];
    const page = ctx.pages()[0] || await ctx.newPage();
    const r = {{ profile: '{name}', username: '{user}', logged_in: false, shadowbanned: null, error: null }};
    try {{
        await page.goto('https://www.reddit.com/', {{ waitUntil: 'domcontentloaded', timeout: 60000 }});
        await page.waitForTimeout(5000);
        const loginBtn = await page.locator('a[href*="login"], button:has-text("Log In")').count();
        const userEl = await page.locator('a[href*="/user/"]').count();
        if (loginBtn > 0 && userEl === 0) {{ r.error = 'Not logged in'; console.log(JSON.stringify(r)); return; }}
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

WARMUP_SCRIPT_TEMPLATE = """
const {{ chromium }} = require('playwright');
(async () => {{
    const browser = await chromium.connectOverCDP('{cdp}');
    const ctx = browser.contexts()[0];
    const page = ctx.pages()[0] || await ctx.newPage();
    const subs = ['r/AskReddit','r/todayilearned','r/pics','r/funny','r/worldnews','r/science','r/gaming','r/movies','r/music','r/books','r/food','r/travel','r/technology','r/sports','r/nature'];
    const end = Date.now() + {mins}*60*1000;
    let visited = 0;
    while (Date.now() < end) {{
        try {{
            const sub = subs[Math.floor(Math.random()*subs.length)];
            await page.goto('https://www.reddit.com/'+sub+'/', {{ waitUntil: 'domcontentloaded', timeout: 60000 }});
            await page.waitForTimeout(3000+Math.random()*3000);
            visited++;
            for (let i=0; i<2+Math.floor(Math.random()*4); i++) {{
                await page.mouse.wheel(0, 300+Math.random()*400);
                await page.waitForTimeout(1500+Math.random()*2000);
            }}
            if (Math.random()>0.4) {{
                const posts = await page.locator('a[slot="full-post-link"]').all();
                if (posts.length>0) {{
                    await posts[Math.floor(Math.random()*Math.min(posts.length,5))].click();
                    await page.waitForTimeout(4000+Math.random()*4000);
                    visited++;
                    for (let i=0; i<2+Math.floor(Math.random()*3); i++) {{
                        await page.mouse.wheel(0, 250+Math.random()*300);
                        await page.waitForTimeout(1500+Math.random()*2000);
                    }}
                    await page.goBack();
                    await page.waitForTimeout(2000+Math.random()*2000);
                }}
            }}
            await page.waitForTimeout(5000+Math.random()*10000);
        }} catch(e) {{ await page.waitForTimeout(5000); }}
    }}
    console.log(JSON.stringify({{ done: true, pagesVisited: visited }}));
    process.exit(0);
}})();
"""

def open_profile(uid):
    r = requests.get(f"{BASE}/browser/start?user_id={uid}", headers=AUTH)
    d = r.json()
    if d.get("code") == 0:
        return d["data"]["ws"]["puppeteer"]
    return None

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
        return {"error": "timeout"}
    except Exception as e:
        return {"error": str(e)}

all_results = []

for batch_num, batch in enumerate(batches, 1):
    if batch_num < batch_start:
        continue
    
    print(f"\n{'='*80}")
    print(f"BATCH {batch_num}/4 — {len(batch)} profiles")
    print(f"{'='*80}")
    
    # Phase 1: Check each profile ONE AT A TIME
    print(f"\n  --- Phase 1: Login & Shadowban Check (sequential) ---")
    batch_results = []
    
    for p in batch:
        name, uid, uname = p["name"], p["user_id"], p.get("username","")
        print(f"  {name} ({uname}): opening...", end=" ", flush=True)
        cdp = open_profile(uid)
        if not cdp:
            print("❌ failed to open")
            batch_results.append({"profile": name, "username": uname, "error": "open failed"})
            continue
        
        time.sleep(3)  # Let browser settle
        print("checking...", end=" ", flush=True)
        
        script = CHECK_SCRIPT_TEMPLATE.format(cdp=cdp, name=name, user=uname)
        result = run_node(script, timeout_s=120)
        batch_results.append(result if isinstance(result, dict) else {"profile": name, "error": str(result)})
        
        if isinstance(result, dict):
            if result.get("error"):
                print(f"⚠️  {result['error'][:50]}")
            elif result.get("shadowbanned"):
                print(f"🚫 SHADOWBANNED")
            elif result.get("logged_in"):
                print(f"✅ logged in, clean")
            else:
                print(f"❌ not logged in")
        
        # Close after check
        close_profile(uid)
        time.sleep(2)
    
    # Phase 1 summary
    print(f"\n  --- Batch {batch_num} Check Results ---")
    good = []
    for i, r in enumerate(batch_results):
        pname = r.get("profile", batch[i]["name"])
        if r.get("logged_in") and not r.get("shadowbanned"):
            good.append(i)
            print(f"    ✅ {pname}")
        elif r.get("shadowbanned"):
            print(f"    🚫 {pname} — SHADOWBANNED")
        else:
            print(f"    ⚠️  {pname} — {r.get('error', 'not logged in')}")
    
    # Phase 2: Open all good profiles and warm up
    if good:
        print(f"\n  --- Phase 2: {WARMUP_MINUTES}min warm-up ({len(good)} profiles) ---")
        
        cdp_map = {}
        for i in good:
            p = batch[i]
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
        
        # Run warmup in parallel threads
        warmup_results = {}
        def do_warmup(name, cdp):
            script = WARMUP_SCRIPT_TEMPLATE.format(cdp=cdp, mins=WARMUP_MINUTES)
            warmup_results[name] = run_node(script, timeout_s=(WARMUP_MINUTES+5)*60)
        
        threads = []
        for name, (uid, cdp) in cdp_map.items():
            t = threading.Thread(target=do_warmup, args=(name, cdp))
            t.start()
            threads.append(t)
            time.sleep(2)
        
        print(f"    All {len(threads)} browsers warming... ({WARMUP_MINUTES} min)")
        for t in threads:
            t.join()
        
        print(f"    ✅ Warm-up complete!")
        for name, wr in warmup_results.items():
            pages = wr.get("pagesVisited", "?") if isinstance(wr, dict) else "?"
            print(f"      {name}: {pages} pages")
        
        # Close all
        print(f"\n  --- Closing batch {batch_num} ---")
        for name, (uid, cdp) in cdp_map.items():
            close_profile(uid)
            print(f"    Closed {name}")
            time.sleep(1)
    
    all_results.extend(batch_results)
    
    if batch_num < 4:
        print(f"\n  ⏳ Moving to batch {batch_num+1}...")
        time.sleep(5)

# Final summary
print(f"\n{'='*80}")
print(f"FINAL SUMMARY")
print(f"{'='*80}")
ok = sum(1 for r in all_results if isinstance(r, dict) and r.get("logged_in") and not r.get("shadowbanned"))
banned = sum(1 for r in all_results if isinstance(r, dict) and r.get("shadowbanned"))
errs = len(all_results) - ok - banned
print(f"  ✅ Clean & warmed: {ok}")
print(f"  🚫 Shadowbanned: {banned}")
print(f"  ⚠️  Errors/not logged in: {errs}")

output = "/Users/owen/.openclaw/workspace/BRAIN/summaries/warmup-2026-04-15.json"
os.makedirs(os.path.dirname(output), exist_ok=True)
with open(output, 'w') as f:
    json.dump(all_results, f, indent=2)
print(f"\nSaved to {output}")
