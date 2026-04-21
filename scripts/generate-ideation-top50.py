#!/usr/bin/env python3
"""
Generate app ideation for top 50 pain points and update Notion.
1. Fetch all pages from the Notion database
2. For each, call Claude to generate ideation
3. Update the Notion row with the ideation
"""
import json, os, sys, time, urllib.request

# === Config ===
env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env')
NOTION_SECRET = ""
ANTHROPIC_KEY = ""
if os.path.exists(env_path):
    for line in open(env_path):
        line = line.strip()
        if line.startswith('NOTION_SECRET='):
            NOTION_SECRET = line.split('=', 1)[1]
        if line.startswith('ANTHROPIC_API_KEY='):
            ANTHROPIC_KEY = line.split('=', 1)[1]

# Fallback
if not NOTION_SECRET:
    NOTION_SECRET = os.environ.get('NOTION_SECRET', '')
if not ANTHROPIC_KEY:
    ANTHROPIC_KEY = os.environ.get('ANTHROPIC_API_KEY', '')

NOTION_DB_ID = sys.argv[1] if len(sys.argv) > 1 else "34866005-ab52-81cc-9c14-c1cd2e024994"
NOTION_BASE = "https://api.notion.com/v1"
NOTION_HEADERS = {
    "Authorization": f"Bearer {NOTION_SECRET}",
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
}

# Load pain points JSON for richer context
PP_PATH = os.path.expanduser("~/.openclaw/workspace/BRAIN/scrapes/weekly-top50-painpoints.json")
pp_by_title = {}
if os.path.exists(PP_PATH):
    with open(PP_PATH) as f:
        for pp in json.load(f):
            pp_by_title[pp['title'][:200]] = pp

def notion_request(method, endpoint, data=None):
    url = f"{NOTION_BASE}{endpoint}"
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=NOTION_HEADERS, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        print(f"NOTION ERROR {e.code}: {err[:300]}")
        raise

def rt(text, max_len=2000):
    t = (text or '')[:max_len]
    return {"rich_text": [{"text": {"content": t}}]} if t else {"rich_text": []}

def get_all_pages(db_id):
    """Fetch all pages from a Notion database."""
    pages = []
    has_more = True
    start_cursor = None
    while has_more:
        payload = {"page_size": 100}
        if start_cursor:
            payload["start_cursor"] = start_cursor
        result = notion_request("POST", f"/databases/{db_id}/query", payload)
        pages.extend(result.get("results", []))
        has_more = result.get("has_more", False)
        start_cursor = result.get("next_cursor")
    return pages

def extract_title(page):
    """Extract the Pain Point title from a Notion page."""
    title_prop = page.get("properties", {}).get("Pain Point", {}).get("title", [])
    if title_prop:
        return title_prop[0].get("text", {}).get("content", "")
    return ""

def extract_rich_text(page, prop_name):
    rt_prop = page.get("properties", {}).get(prop_name, {}).get("rich_text", [])
    if rt_prop:
        return rt_prop[0].get("text", {}).get("content", "")
    return ""

def generate_ideation(title, description, subreddit, posts_context):
    """Call Claude to generate app ideation for a pain point."""
    prompt = f"""You are an app ideation expert for Wabi — a platform where anyone can build and share micro-apps (like calculators, trackers, planners, quizzes) without code.

Given this Reddit pain point, generate a practical micro-app idea that could be built on Wabi.

PAIN POINT: {title}
SUBREDDIT: {subreddit}
DESCRIPTION: {description}
TOP POSTS: {posts_context}

Respond in EXACTLY this JSON format (no markdown, no explanation):
{{
  "app_idea": "Short catchy app name — one-line description",
  "what_it_does": "2-3 sentences explaining what the app does",
  "how_it_solves": "2-3 sentences on how this addresses the specific pain point",
  "feature_set": "Comma-separated list of 4-6 key features",
  "wabi_fit": <1-5 integer — how well this fits Wabi's no-code micro-app format>,
  "analysis": "1-2 sentences on market opportunity and viral potential"
}}

IMPORTANT:
- wabi_fit 5 = perfect for Wabi (tracker, calculator, planner, quiz)
- wabi_fit 1 = needs native app features Wabi can't do (GPS, camera, real-time sync)
- Be creative but practical — these should be buildable in a day
- Focus on the SPECIFIC pain expressed, not generic solutions"""

    payload = {
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 600,
        "messages": [{"role": "user", "content": prompt}]
    }

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps(payload).encode(),
        headers={
            "x-api-key": ANTHROPIC_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        method="POST"
    )

    with urllib.request.urlopen(req, timeout=60) as resp:
        result = json.loads(resp.read())
    
    text = result["content"][0]["text"].strip()
    # Clean up any markdown wrapping
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
    
    return json.loads(text)


def main():
    print(f"Fetching pages from Notion DB: {NOTION_DB_ID}")
    pages = get_all_pages(NOTION_DB_ID)
    print(f"Found {len(pages)} pages")

    # Check which already have ideation
    to_process = []
    for page in pages:
        title = extract_title(page)
        app_idea = extract_rich_text(page, "App Idea")
        if not app_idea or app_idea.startswith("[Pending"):
            to_process.append(page)
        else:
            print(f"  SKIP (already has ideation): {title[:50]}")
    
    print(f"\n{len(to_process)} pages need ideation\n")

    # Cache results as we go
    cache_path = os.path.expanduser("~/.openclaw/workspace/BRAIN/scrapes/ideation-cache.json")
    cache = {}
    if os.path.exists(cache_path):
        with open(cache_path) as f:
            cache = json.load(f)

    results = []
    for i, page in enumerate(to_process):
        title = extract_title(page)
        page_id = page["id"]
        subreddit = extract_rich_text(page, "Subreddit")
        
        # Get richer context from pain points JSON
        pp_data = pp_by_title.get(title, {})
        description = pp_data.get("description", "")
        posts = pp_data.get("posts", [])
        posts_context = "; ".join([f"{p['title']} ({p['upvotes']} upvotes)" for p in posts[:3]]) if posts else "N/A"

        print(f"[{i+1}/{len(to_process)}] Generating ideation for: {title[:55]}...")
        
        try:
            idea = generate_ideation(title, description, subreddit, posts_context)
            
            # Update Notion
            properties = {
                "Wabi Fit (1-5)": {"number": idea.get("wabi_fit")},
                "App Idea": rt(idea.get("app_idea", "")),
                "What It Does": rt(idea.get("what_it_does", "")),
                "How It Solves the Pain": rt(idea.get("how_it_solves", "")),
                "Feature Set": rt(idea.get("feature_set", "")),
                "Analysis": rt(idea.get("analysis", "")),
            }
            notion_request("PATCH", f"/pages/{page_id}", {"properties": properties})
            
            print(f"  ✓ {idea.get('app_idea', '')[:60]} (Wabi fit: {idea.get('wabi_fit', '?')})")
            
            # Cache it
            cache[title] = idea
            results.append({"page_id": page_id, "title": title, "ideation": idea})
            
        except Exception as e:
            print(f"  ✗ ERROR: {e}")
            results.append({"page_id": page_id, "title": title, "error": str(e)})
        
        # Rate limit: ~1.5s between calls
        time.sleep(1.5)
        
        # Save cache every 10 items
        if (i + 1) % 10 == 0:
            with open(cache_path, "w") as f:
                json.dump(cache, f, indent=2)
            print(f"  [Cache saved: {len(cache)} ideations]")

    # Final cache save
    with open(cache_path, "w") as f:
        json.dump(cache, f, indent=2)

    success = sum(1 for r in results if "ideation" in r)
    failed = sum(1 for r in results if "error" in r)
    print(f"\n✅ Done! {success} ideations generated, {failed} failed")
    print(f"Cache saved to {cache_path}")
    print(f"Notion DB: https://notion.so/{NOTION_DB_ID.replace('-', '')}")


if __name__ == '__main__':
    main()
