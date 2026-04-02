#!/usr/bin/env python3
"""Daily pain points scanner — fetches hot posts from all persona subreddits via Reddit JSON API,
identifies pain points, and submits them to the dashboard."""

import json
import time
import urllib.request
import urllib.error
import subprocess
import sys
from datetime import datetime, timezone

DASHBOARD_URL = "http://localhost:3000/api/pain-points"
API_KEY = "openclaw-scanner-key"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

# AdsPower proxy config — rotate across ports to spread load
PROXY_USER = "sp1seut7gn"
PROXY_PASS = "3=wJje7xe98vAiXzVh"
PROXY_HOST = "isp.decodo.com"
PROXY_PORTS = list(range(10001, 10013))  # Ports 10001-10012 (Account A profiles)

AGENTS = {
    "jess-m": ["gardening", "beyondthebump", "Mommit", "running", "xxfitness"],
    "owen-b": ["ADHD", "languagelearning", "remotework", "productivity"],
    "maya-chen": ["personalfinance", "cooking", "solotravel", "frugal"],
    "dave-r": ["HomeImprovement", "DIY", "woodworking", "smoking"],
    "marco-v": ["nocode", "Nootropics", "Biohackers", "SideProject"],
    "nora-p": ["houseplants", "proplifting", "plantclinic", "IndoorGarden"],
    "raj-s": ["AnalogCommunity", "streetphotography", "MechanicalKeyboards", "photocritique"],
    "claire-t": ["insomnia", "CBTi", "TMJ", "yinyoga"],
    "ty-m": ["bikecommuting", "gravelcycling", "bikewrench", "fuckcars"],
    "priya-k": ["Meditation", "Anxiety", "therapists", "Journaling"],
    "marcus-j": ["Guitar", "guitarpedals", "Blues", "homerecording"],
    "elise-c": ["cats", "rawpetfood", "ThriftStoreHauls", "felinediabetes"],
}

_proxy_index = 0

def fetch_subreddit(sub, limit=25):
    """Fetch hot posts from a subreddit via public JSON API through AdsPower proxy."""
    global _proxy_index
    port = PROXY_PORTS[_proxy_index % len(PROXY_PORTS)]
    _proxy_index += 1
    proxy_url = f"http://{PROXY_USER}:{PROXY_PASS}@{PROXY_HOST}:{port}"
    url = f"https://old.reddit.com/r/{sub}/hot.json?limit={limit}&raw_json=1"
    try:
        result = subprocess.run(
            ["curl", "-s", "-x", proxy_url, "--connect-timeout", "15", "-H", f"User-Agent: {USER_AGENT}", url],
            capture_output=True, text=True, timeout=20,
        )
        if result.returncode != 0:
            raise Exception(f"curl exit {result.returncode}")
        data = json.loads(result.stdout)
        posts = []
        for child in data.get("data", {}).get("children", []):
            p = child.get("data", {})
            if p.get("stickied"):
                continue
            posts.append({
                "title": p.get("title", ""),
                "selftext": (p.get("selftext", "") or "")[:1500],
                "score": p.get("score", 0),
                "num_comments": p.get("num_comments", 0),
                "permalink": p.get("permalink", ""),
                "created_utc": p.get("created_utc", 0),
                "subreddit": sub,
            })
        return posts
    except Exception as e:
        print(f"  ⚠️  Failed to fetch r/{sub}: {e}", file=sys.stderr)
        return []

def submit_pain_point(pp):
    """Submit a pain point to the dashboard API."""
    payload = json.dumps(pp).encode()
    req = urllib.request.Request(
        DASHBOARD_URL,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "x-api-key": API_KEY,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read())
            return result.get("upserted", False)
    except Exception as e:
        print(f"  ❌ Submit failed: {e}", file=sys.stderr)
        return None

def main():
    all_posts = {}
    stats = {}
    
    print("=" * 60)
    print(f"🔍 Pain Points Scan — {datetime.now().strftime('%Y-%m-%d %H:%M PDT')}")
    print("=" * 60)
    
    # Phase 1: Fetch all subreddit data
    total_fetched = 0
    failed_subs = []
    for agent, subs in AGENTS.items():
        agent_posts = []
        for sub in subs:
            print(f"  📡 Fetching r/{sub} for {agent}...")
            posts = fetch_subreddit(sub)
            if posts:
                agent_posts.extend(posts)
                total_fetched += len(posts)
            else:
                failed_subs.append(f"r/{sub}")
            time.sleep(1.5)  # Rate limiting
        all_posts[agent] = agent_posts
    
    print(f"\n📊 Fetched {total_fetched} posts across {sum(len(s) for s in AGENTS.values())} subreddits")
    if failed_subs:
        print(f"⚠️  Failed: {', '.join(failed_subs)}")
    
    # Phase 2: Output posts as JSON for AI analysis
    output = {
        "fetch_time": datetime.now(timezone.utc).isoformat(),
        "total_posts": total_fetched,
        "failed_subreddits": failed_subs,
        "agents": {}
    }
    
    for agent, posts in all_posts.items():
        # Only include posts with meaningful engagement or content
        filtered = [p for p in posts if p["score"] > 1 or p["num_comments"] > 2]
        output["agents"][agent] = {
            "subreddits": AGENTS[agent],
            "post_count": len(filtered),
            "posts": filtered
        }
    
    # Write to file for analysis
    outpath = "/tmp/pain-scan-raw.json"
    with open(outpath, "w") as f:
        json.dump(output, f, indent=2)
    print(f"\n💾 Raw data saved to {outpath}")
    print(f"📝 {total_fetched} total posts, ready for analysis")

if __name__ == "__main__":
    main()
