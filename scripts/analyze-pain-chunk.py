#!/usr/bin/env python3
"""Analyze a chunk of Reddit posts, extract pain points, and submit to dashboard.
Usage: python3 analyze-pain-chunk.py <chunk_file> <output_file>"""

import json
import sys
import urllib.request

DASHBOARD_URL = "http://localhost:3000/api/pain-points"
API_KEY = "openclaw-scanner-key"

def submit_pain_point(pp):
    payload = json.dumps(pp).encode()
    req = urllib.request.Request(
        DASHBOARD_URL, data=payload,
        headers={"Content-Type": "application/json", "x-api-key": API_KEY},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read())
            return result.get("upserted", False)
    except Exception as e:
        print(f"  ❌ Submit failed for '{pp.get('title', '?')}': {e}", file=sys.stderr)
        return None

def submit_all(pain_points_file, output_file):
    """Read pain points from JSON file and submit to dashboard."""
    with open(pain_points_file) as f:
        pain_points = json.load(f)
    
    new_count = 0
    upserted_count = 0
    failed_count = 0
    
    for pp in pain_points:
        result = submit_pain_point(pp)
        if result is None:
            failed_count += 1
        elif result:
            upserted_count += 1
        else:
            new_count += 1
    
    summary = {
        "total": len(pain_points),
        "new": new_count,
        "upserted": upserted_count,
        "failed": failed_count,
    }
    
    with open(output_file, 'w') as f:
        json.dump(summary, f, indent=2)
    
    print(json.dumps(summary))

if __name__ == "__main__":
    if len(sys.argv) == 3:
        submit_all(sys.argv[1], sys.argv[2])
    else:
        print("Usage: python3 analyze-pain-chunk.py <pain_points_file> <output_file>")
