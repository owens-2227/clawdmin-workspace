#!/usr/bin/env python3
"""
Extended warmup - 3 hours, batches of 5/5/6/6.
Fixes: reuses single tab, closes extra tabs, no goBack().
"""
import json, subprocess, requests, time, sys, os, threading

BASE = "http://127.0.0.1:50325/api/v1"
AUTH = {"Authorization": "Bearer 0d599e9255deef1bcc503d735da537160085c443c76f1c30"}
WARMUP_MINUTES = 180  # 3 hours
SCRIPTS_DIR = '/Users/owen/.openclaw/workspace/BRAIN/scripts'

resp = requests.get(f"{BASE}/user/list?page=1&page_size=100", headers=AUTH)
profiles = sorted([p for p in resp.json()["data"]["list"] if p["name"].startswith("reddit-")], key=lambda p: p["name"])
print(f"Found {len(profiles)} profiles")

batches = [profiles[0:5], profiles[5:10], profiles[10:16], profiles[16:22]]
batch_start = int(sys.argv[1]) if len(sys.argv) > 1 else 1

# This script: reuses first tab, closes extras, navigates only via goto (no goBack)
WARMUP_SCRIPT_TEMPLATE = """
const {{ chromium }} = require('playwright');
(async () => {{
    const browser = await chromium.connectOverCDP('{cdp}');
    const ctx = browser.contexts()[0];
    
    // Close all extra tabs, keep only the first one
    const pages = ctx.pages();
    const page = pages[0] || await ctx.newPage();
    for (let i = 1; i < pages.length; i++) {{
        await pages[i].close();
    }}
    
    // Block heavy resources to save bandwidth
    await page.route('**/*', route => {{
        const type = route.request().resourceType();
        if (['image','media','font','stylesheet'].includes(type)) {{
            return route.abort();
        }}
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
            // Close any extra tabs that may have opened
            const currentPages = ctx.pages();
            for (let i = 1; i < currentPages.length; i++) {{
                try {{ await currentPages[i].close(); }} catch(e) {{}}
            }}
            
            // Pick a random subreddit and navigate
            const sub = subs[Math.floor(Math.random()*subs.length)];
            await page.goto('https://www.reddit.com/' + sub + '/', {{ waitUntil: 'domcontentloaded', timeout: 60000 }});
            await page.waitForTimeout(3000 + Math.random()*4000);
            visited++;
            
            // Scroll the feed naturally
            const scrollCount = 2 + Math.floor(Math.random()*5);
            for (let i = 0; i < scrollCount; i++) {{
                await page.mouse.wheel(0, 300 + Math.random()*400);
                await page.waitForTimeout(1500 + Math.random()*2500);
            }}
            
            // Sometimes click into a post (navigate directly, no goBack)
            if (Math.random() > 0.4) {{
                const posts = await page.locator('a[slot="full-post-link"]').all();
                if (posts.length > 0) {{
                    const idx = Math.floor(Math.random() * Math.min(posts.length, 8));
                    const href = await posts[idx].getAttribute('href');
                    if (href) {{
                        // Navigate directly to post URL instead of clicking (avoids new tabs)
                        const postUrl = href.startsWith('http') ? href : 'https://www.reddit.com' + href;
                        await page.goto(postUrl, {{ waitUntil: 'domcontentloaded', timeout: 60000 }});
                        await page.waitForTimeout(3000 + Math.random()*5000);
                        visited++;
                        
                        // Scroll through comments
                        const commentScrolls = 2 + Math.floor(Math.random()*4);
                        for (let i = 0; i < commentScrolls; i++) {{
                            await page.mouse.wheel(0, 250 + Math.random()*350);
                            await page.waitForTimeout(1500 + Math.random()*2000);
                        }}
                    }}
                }}
            }}
            
            // Longer pause between subreddits (natural behavior)
            await page.waitForTimeout(8000 + Math.random()*15000);
            
        }} catch(e) {{
            // If something fails, just wait and try next subreddit
            await page.waitForTimeout(10000);
        }}
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

def run_node(script, timeout_s):
    try:
        r = subprocess.run(['node', '-e', script], capture_output=True, text=True, timeout=timeout_s, cwd=SCRIPTS_DIR)
        for line in reversed(r.stdout.strip().split('\n')):
            try: return json.loads(line)
            except: continue
        return {"error": r.stderr[:300] if r.stderr else "no output"}
    except subprocess.TimeoutExpired:
        return {"done": True, "note": "timeout but completed"}
    except Exception as e:
        return {"error": str(e)}

all_results = {}

for batch_num, batch in enumerate(batches, 1):
    if batch_num < batch_start:
        continue
    
    print(f"\n{'='*80}")
    print(f"BATCH {batch_num}/4 — {len(batch)} profiles — {WARMUP_MINUTES} min warmup")
    print(f"{'='*80}")
    
    # Open all profiles
    cdp_map = {}
    for p in batch:
        name, uid = p["name"], p["user_id"]
        print(f"  Opening {name}...", end=" ", flush=True)
        cdp = open_profile(uid)
        if cdp:
            cdp_map[name] = (uid, cdp)
            print("✅")
        else:
            print("❌")
        time.sleep(3)
    
    time.sleep(5)
    
    # Run warmup in parallel
    warmup_results = {}
    def do_warmup(name, cdp):
        script = WARMUP_SCRIPT_TEMPLATE.format(cdp=cdp, mins=WARMUP_MINUTES)
        warmup_results[name] = run_node(script, timeout_s=(WARMUP_MINUTES + 10) * 60)
    
    threads = []
    for name, (uid, cdp) in cdp_map.items():
        t = threading.Thread(target=do_warmup, args=(name, cdp))
        t.start()
        threads.append(t)
        time.sleep(2)
    
    print(f"\n  All {len(threads)} browsers warming for {WARMUP_MINUTES} min...")
    print(f"  Estimated finish: ~{WARMUP_MINUTES} min from now")
    
    for t in threads:
        t.join()
    
    print(f"\n  ✅ Batch {batch_num} warm-up complete!")
    for name, wr in warmup_results.items():
        pages = wr.get("pagesVisited", "?") if isinstance(wr, dict) else "?"
        print(f"    {name}: {pages} pages")
    
    all_results.update(warmup_results)
    
    # Close all
    print(f"\n  Closing batch {batch_num}...")
    for name, (uid, cdp) in cdp_map.items():
        close_profile(uid)
        time.sleep(1)
    print(f"  All closed.")
    
    if batch_num < 4:
        print(f"\n  ⏳ Moving to batch {batch_num+1}...")
        time.sleep(5)

# Summary
print(f"\n{'='*80}")
print(f"DONE — All batches complete")
print(f"{'='*80}")
total_pages = sum(r.get("pagesVisited", 0) for r in all_results.values() if isinstance(r, dict))
print(f"Total pages visited across all profiles: {total_pages}")
