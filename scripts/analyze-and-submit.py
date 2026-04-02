#!/usr/bin/env python3
"""Analyze raw Reddit posts for pain points and submit to dashboard.
Processes posts by agent/persona, uses Claude via OpenClaw's API to extract pain points."""

import json
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone

DASHBOARD_URL = "http://localhost:3000/api/pain-points"
API_KEY = "openclaw-scanner-key"

RAW_DATA_PATH = "/tmp/pain-scan-raw.json"
RESULTS_PATH = "/tmp/pain-analysis-results.json"

AGENT_TO_PERSONA = {
    "jess-m": "Jess M",
    "owen-b": "Owen B",
    "maya-chen": "Maya C",
    "dave-r": "Dave R",
    "marco-v": "Marco V",
    "nora-p": "Nora P",
    "raj-s": "Raj S",
    "claire-t": "Claire T",
    "ty-m": "Ty M",
    "priya-k": "Priya K",
    "marcus-j": "Marcus J",
    "elise-c": "Elise C",
}


def analyze_posts_with_llm(agent_id, posts):
    """Use Claude to extract pain points from a batch of posts."""
    if not posts:
        return []

    # Summarize posts compactly
    post_summaries = []
    for p in posts[:25]:  # Cap at 25 per chunk
        summary = f"[r/{p['subreddit']}] (score:{p['score']}, comments:{p['num_comments']}) {p['title']}"
        if p.get('selftext'):
            summary += f"\n  {p['selftext'][:300]}"
        post_summaries.append(summary)

    posts_text = "\n---\n".join(post_summaries)

    prompt = f"""Analyze these Reddit posts from subreddits monitored by persona "{agent_id}" and extract distinct PAIN POINTS that users are experiencing.

A pain point is a recurring problem, frustration, or unmet need that could potentially be addressed by a mini-app or tool.

POSTS:
{posts_text}

Return a JSON array of pain points. Each pain point should have:
- "title": Short descriptive title (max 100 chars)
- "description": 2-3 sentence description of the pain point, what users are struggling with, and how it could be addressed
- "category": General category (e.g. "Gardening", "Fitness", "Finance")
- "subreddit": The primary subreddit where this was found (format: "r/subredditname")
- "viralScore": Estimated viral potential 1-100 based on engagement signals

Only include genuine pain points (not just discussions or show-off posts). Return 3-8 pain points per batch.
Return ONLY the JSON array, no other text."""

    # Use subprocess to call the anthropic API via curl
    api_payload = json.dumps({
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 2000,
        "messages": [{"role": "user", "content": prompt}]
    })

    result = subprocess.run(
        ["curl", "-s", "https://api.anthropic.com/v1/messages",
         "-H", "Content-Type: application/json",
         "-H", "x-api-key: " + get_anthropic_key(),
         "-H", "anthropic-version: 2023-06-01",
         "-d", api_payload],
        capture_output=True, text=True, timeout=60,
    )

    if result.returncode != 0:
        print(f"  ❌ LLM call failed for {agent_id}: {result.stderr}", file=sys.stderr)
        return []

    try:
        response = json.loads(result.stdout)
        content = response["content"][0]["text"]
        # Strip markdown code fences if present
        if content.startswith("```"):
            content = content.split("\n", 1)[1]
            content = content.rsplit("```", 1)[0]
        pain_points = json.loads(content)
        return pain_points
    except Exception as e:
        print(f"  ❌ Failed to parse LLM response for {agent_id}: {e}", file=sys.stderr)
        print(f"  Response: {result.stdout[:500]}", file=sys.stderr)
        return []


def get_anthropic_key():
    """Get the Anthropic API key from environment or OpenClaw config."""
    import os
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if key:
        return key
    # Try reading from openclaw config
    try:
        result = subprocess.run(
            ["grep", "-r", "ANTHROPIC_API_KEY", os.path.expanduser("~/.openclaw/")],
            capture_output=True, text=True, timeout=5
        )
        for line in result.stdout.split("\n"):
            if "ANTHROPIC_API_KEY" in line and "=" in line:
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    except:
        pass
    print("ERROR: No ANTHROPIC_API_KEY found", file=sys.stderr)
    sys.exit(1)


def submit_pain_point(pp, agent_id):
    """Submit a pain point to the dashboard API."""
    payload = json.dumps({
        "title": pp["title"],
        "description": pp["description"],
        "category": pp["category"],
        "personas": [pp["category"]],
        "subreddit": pp["subreddit"],
        "discoveredBy": agent_id,
        "viralScore": pp.get("viralScore", 0),
    }).encode()

    req = urllib.request.Request(
        DASHBOARD_URL, data=payload,
        headers={"Content-Type": "application/json", "x-api-key": API_KEY},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read())
            return True
    except Exception as e:
        print(f"  ❌ Submit failed for '{pp.get('title', '?')}': {e}", file=sys.stderr)
        return False


def main():
    print("=" * 60)
    print(f"🧠 Pain Points Analysis — {datetime.now().strftime('%Y-%m-%d %H:%M PDT')}")
    print("=" * 60)

    with open(RAW_DATA_PATH) as f:
        raw_data = json.load(f)

    all_results = {}
    total_found = 0
    total_submitted = 0

    for agent_id, agent_data in raw_data["agents"].items():
        posts = agent_data.get("posts", [])
        if not posts:
            print(f"\n⏭️  {agent_id}: No posts, skipping")
            continue

        print(f"\n🔍 Analyzing {len(posts)} posts for {agent_id}...")

        # Process in chunks of 25
        agent_pain_points = []
        for i in range(0, len(posts), 25):
            chunk = posts[i:i + 25]
            pps = analyze_posts_with_llm(agent_id, chunk)
            agent_pain_points.extend(pps)
            if i + 25 < len(posts):
                time.sleep(1)  # Rate limit between chunks

        print(f"  Found {len(agent_pain_points)} pain points")
        total_found += len(agent_pain_points)

        # Submit to dashboard
        submitted = 0
        for pp in agent_pain_points:
            if submit_pain_point(pp, agent_id):
                submitted += 1
                print(f"  ✅ {pp['title'][:60]}")
            time.sleep(0.2)

        total_submitted += submitted
        all_results[agent_id] = {
            "posts_analyzed": len(posts),
            "pain_points_found": len(agent_pain_points),
            "submitted": submitted,
            "pain_points": agent_pain_points,
        }

        time.sleep(1)  # Rate limit between agents

    # Save results
    with open(RESULTS_PATH, "w") as f:
        json.dump(all_results, f, indent=2)

    print(f"\n{'=' * 60}")
    print(f"✅ Analysis complete!")
    print(f"  Posts analyzed: {raw_data['total_posts']}")
    print(f"  Pain points found: {total_found}")
    print(f"  Submitted to dashboard: {total_submitted}")
    print(f"  Results saved to: {RESULTS_PATH}")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
