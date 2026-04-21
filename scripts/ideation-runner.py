#!/usr/bin/env python3
"""
Generate ideation for all 50 pain points and update Notion.
Reads pain points + page mapping, generates ideation via Anthropic, updates Notion.
"""
import json, os, sys, time, urllib.request

NOTION_SECRET = "REDACTED_NOTION_TOKEN"
ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
NOTION_BASE = "https://api.notion.com/v1"
NOTION_HEADERS = {
    "Authorization": f"Bearer {NOTION_SECRET}",
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
}

BASE = os.path.expanduser("~/.openclaw/workspace/BRAIN/scrapes")

def notion_req(method, endpoint, data=None):
    url = f"{NOTION_BASE}{endpoint}"
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=NOTION_HEADERS, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        print(f"NOTION ERR {e.code}: {err[:200]}")
        raise

def rt(text, max_len=2000):
    t = (text or "")[:max_len]
    return {"rich_text": [{"text": {"content": t}}]} if t else {"rich_text": []}

def call_claude(prompt):
    payload = {
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 700,
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
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
    return json.loads(text)

def generate_ideation(title, description, subreddit, posts_context):
    prompt = f"""You are an app ideation expert for Wabi — a platform where anyone can build and share micro-apps (like calculators, trackers, planners, quizzes) without code.

Given this Reddit pain point, generate a practical micro-app idea that could be built on Wabi.

PAIN POINT: {title}
SUBREDDIT: {subreddit}
DESCRIPTION: {description[:800]}
TOP POSTS: {posts_context}

Respond in EXACTLY this JSON format (no markdown, no explanation):
{{
  "app_idea": "Short catchy app name — one-line description",
  "what_it_does": "2-3 sentences explaining what the app does",
  "how_it_solves": "2-3 sentences on how this addresses the specific pain point",
  "feature_set": "Comma-separated list of 4-6 key features",
  "wabi_fit": <1-5 integer>,
  "analysis": "1-2 sentences on market opportunity and viral potential"
}}

SCORING:
- wabi_fit 5 = perfect for Wabi (tracker, calculator, planner, quiz, checklist)
- wabi_fit 3 = partially doable (needs some workarounds)
- wabi_fit 1 = needs native app features Wabi can't do (GPS, camera, real-time sync)
- Be creative but practical — buildable in a day on a no-code platform
- Focus on the SPECIFIC pain expressed, not generic solutions"""

    return call_claude(prompt)


def main():
    # Load data
    with open(os.path.join(BASE, "weekly-top50-painpoints.json")) as f:
        painpoints = json.load(f)
    with open(os.path.join(BASE, "notion-page-mapping.json")) as f:
        page_mapping = json.load(f)

    # Build title -> page_id lookup
    title_to_page = {}
    for pm in page_mapping:
        title_to_page[pm["title"]] = pm["page_id"]

    # Load/init cache
    cache_path = os.path.join(BASE, "ideation-cache.json")
    cache = {}
    if os.path.exists(cache_path):
        with open(cache_path) as f:
            cache = json.load(f)

    success = 0
    failed = 0

    for i, pp in enumerate(painpoints):
        title = pp["title"][:200]
        page_id = title_to_page.get(title)
        if not page_id:
            print(f"[{i+1}/50] ⚠ No Notion page for: {title[:50]}")
            failed += 1
            continue

        # Skip if already cached
        if title in cache and cache[title].get("wabi_fit") is not None:
            print(f"[{i+1}/50] CACHED: {title[:50]}")
            # Still update Notion in case it wasn't written
            idea = cache[title]
        else:
            posts = pp.get("posts", [])
            posts_ctx = "; ".join([f"{p['title']} ({p['upvotes']} up)" for p in posts[:3]]) if posts else "N/A"

            print(f"[{i+1}/50] Generating: {title[:55]}...")
            try:
                idea = generate_ideation(title, pp.get("description", ""), pp.get("subreddit", ""), posts_ctx)
                cache[title] = idea
            except Exception as e:
                print(f"  ✗ Claude error: {e}")
                failed += 1
                time.sleep(3)
                continue

        # Update Notion
        try:
            properties = {
                "Wabi Fit (1-5)": {"number": idea.get("wabi_fit")},
                "App Idea": rt(idea.get("app_idea", "")),
                "What It Does": rt(idea.get("what_it_does", "")),
                "How It Solves the Pain": rt(idea.get("how_it_solves", "")),
                "Feature Set": rt(idea.get("feature_set", "")),
                "Analysis": rt(idea.get("analysis", "")),
            }
            notion_req("PATCH", f"/pages/{page_id}", {"properties": properties})
            print(f"  ✓ {idea.get('app_idea', '')[:60]} (fit: {idea.get('wabi_fit', '?')})")
            success += 1
        except Exception as e:
            print(f"  ✗ Notion error: {e}")
            failed += 1

        # Save cache every 5
        if (i + 1) % 5 == 0:
            with open(cache_path, "w") as f:
                json.dump(cache, f, indent=2)

        time.sleep(1.2)

    # Final save
    with open(cache_path, "w") as f:
        json.dump(cache, f, indent=2)

    print(f"\n{'='*60}")
    print(f"✅ DONE: {success} ideations generated, {failed} failed")
    print(f"Cache: {cache_path} ({len(cache)} entries)")
    print(f"Notion: https://notion.so/34866005ab5281cc9c14c1cd2e024994")


if __name__ == "__main__":
    main()
