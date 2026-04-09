#!/usr/bin/env python3
"""
Fix all 26 Flint app pages with correct template (kitty-diabetes-final),
real screenshots, icons, and descriptions from Wabi + Notion.
"""

import urllib.request
import urllib.parse
import json
import re
import time
import sys
import subprocess

# Force unbuffered output
sys.stdout.reconfigure(line_buffering=True) if hasattr(sys.stdout, 'reconfigure') else None

FLINT_API_KEY = "ak_E7WFVNH5C0VZGFETBE9S5DSM9JR49D36"
SITE_ID = "12628d27-7872-468a-aa54-c4780cf3284b"
NOTION_COLLECTION_ID = "a72b7162-7439-838a-807f-87e15fac8204"
NOTION_VIEW_ID = "388b7162-7439-83cf-8dde-88f29e1044a8"

# All 26 apps: (slug, notion_old_name, wabi_url)
APPS = [
    ("adhd-task-reminders", "ADHDoing", "https://wabi.ai/@junaid/adhdoing-1009319?_v=13"),
    ("ai-bedtime-stories", "AI Bedtime Stories", "https://wabi.ai/@zach_derhake/ai-bedtime-stories-1041051?_v=1"),
    ("blank", "Blank", "https://wabi.ai/@danielle/blank-2-0-1028228?_v=7"),
    ("bonsai", "Bonsai", "https://wabi.ai/@junaid/bonsai-1042598?_v=27"),
    ("child-growth-tracker", "Child Growth Tracker", "https://wabi.ai/@paul_kats/child-growth-tracker-1045758?_v=12"),
    ("color-match-challenge", "Color Match Challenge", "https://wabi.ai/@blas/color-match-challenge-1029774?_v=2"),
    ("priority-of-the-day", "Eat the Frog", "https://wabi.ai/@blas/eat-the-frog-1005220?_v=16"),
    ("event-finder", "Event Finder", "https://wabi.ai/@junaid/event-finder-1028775?_v=39"),
    ("f1-reaction-tester", "F1 Reaction Tester", "https://wabi.ai/@tobi/f1-reaction-tester-1009591?_v=1"),
    ("connect-with-friends-irl", "IRL We", "https://wabi.ai/@junaid/irl-we-1010434?_v=8"),
    ("minimalist-crokinole", "Minimalist Crokinole", "https://wabi.ai/@hintze/minimalist-crokinole-1037881?_v=15"),
    ("my-personal-library", "My Personal Library", "https://wabi.ai/@awd/my-personal-library-1046832?_v=56"),
    ("omg", "OMG", "https://wabi.ai/@awd/omg-1042772?_v=5"),
    ("discover-your-personality", "PersonaScope", "https://wabi.ai/@janina/personascope-discover-yourself-1004622?_v=9"),
    ("photo-habit-tracker", "Photo Habit Tracker", "https://wabi.ai/@joonas/photo-habit-tracker-1024115?_v=4"),
    ("pictionary", "Pictionary", "https://wabi.ai/@blas/pictionary-1038939?_v=8"),
    ("project-planner", "Projek", "https://wabi.ai/@junaid/projek-1041647?_v=12"),
    ("rubiks-world", "Rubik's World", "https://wabi.ai/@awd/rubiks-world-1045742?_v=14"),
    ("side-quests", "Side Quests", "https://wabi.ai/@mulletmax/side-quests-1033859?_v=2"),
    ("global-tap-counter", "Tap Together", "https://wabi.ai/@blas/global-tap-counter-1030312?_v=6"),
    ("timerish", "Timerish", "https://wabi.ai/@junaid/timerish-1013489?_v=13"),
    ("trivia-battle", "Trivia Battle", "https://wabi.ai/@junaid/trivia-battle-1032190?_v=15"),
    ("wabi-boy", "Wabi Boy", "https://wabi.ai/@junaid/wabi-boy-1007494?_v=16"),
    ("weekly-pill-organizer", "Weekly Pill Organizer", "https://wabi.ai/@awd/weekly-pill-organizer-1039217?_v=33"),
    ("wordle-war", "Wordle War", "https://wabi.ai/@junaid/wordle-war-1032173?_v=24"),
    ("coloring-page-creator", "coloring page creator", "https://wabi.ai/@blas/coloring-page-creator-1023217?_v=4"),
]

def fetch_url(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"})
    return urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", errors="ignore")

def get_wabi_info(wabi_url):
    """Get title, description, icon from Wabi share page."""
    html = fetch_url(wabi_url)
    title_m = re.search(r'og:title.*?content="([^"]+)"', html)
    desc_m = re.search(r'og:description.*?content="([^"]+)"', html)
    icon_m = re.search(r'cover_image_url":"([^"]+)"', html)
    
    title = title_m.group(1) if title_m else ""
    desc = desc_m.group(1).replace("&#x27;", "'").replace("&amp;", "&") if desc_m else ""
    icon = icon_m.group(1).replace("\\/", "/") if icon_m else ""
    
    return {"title": title, "description": desc, "icon_url": icon}

def get_notion_data():
    """Get all apps from Notion with their screenshot attachment refs and page IDs."""
    import subprocess
    payload = json.dumps({
        "collection": {"id": NOTION_COLLECTION_ID},
        "collectionView": {"id": NOTION_VIEW_ID},
        "loader": {"type": "reducer", "reducers": {"collection_group_results": {"type": "results", "limit": 200}},
                   "searchQuery": "", "userTimeZone": "America/Los_Angeles", "loadContentCover": True}
    })
    result = subprocess.run([
        "curl", "-s", "https://silver-face-9c4.notion.site/api/v3/queryCollection",
        "-H", "Content-Type: application/json",
        "-H", "User-Agent: Mozilla/5.0",
        "-d", payload
    ], capture_output=True, text=True, timeout=30)
    data = json.loads(result.stdout)
    blocks = data.get("recordMap", {}).get("block", {})
    
    results = {}
    for bid, b in blocks.items():
        val = b.get("value", {})
        if isinstance(val, dict) and "value" in val:
            val = val["value"]
        if val.get("type") != "page":
            continue
        props = val.get("properties", {})
        title = "".join([p[0] for p in props.get("title", []) if isinstance(p, list)])
        ss = props.get("VbDU", [])
        creator = "".join([p[0] for p in props.get("iJ<B", []) if isinstance(p, list)])
        category = "".join([p[0] for p in props.get("FRg=", []) if isinstance(p, list)])
        
        # Extract attachment reference
        attachment_ref = None
        if ss and len(ss) > 0 and len(ss[0]) > 1:
            try:
                attachment_ref = ss[0][1][0][1]  # e.g. "attachment:UUID:filename.png"
            except (IndexError, TypeError):
                pass
        
        results[title.lower()] = {
            "page_id": bid,
            "title": title,
            "attachment_ref": attachment_ref,
            "creator": creator,
            "category": category,
        }
    
    return results

def download_notion_screenshot(page_id, attachment_ref):
    """Download screenshot from Notion's image proxy."""
    import subprocess, tempfile
    encoded = urllib.parse.quote(attachment_ref)
    url = f"https://silver-face-9c4.notion.site/image/{encoded}?id={page_id}&table=block"
    tmp = tempfile.mktemp(suffix=".png")
    subprocess.run(["curl", "-sL", "-H", "User-Agent: Mozilla/5.0", url, "-o", tmp], timeout=30)
    with open(tmp, "rb") as f:
        return f.read()

def upload_to_imgur(img_bytes, filename="screenshot.png"):
    """Upload image to Imgur, return URL."""
    boundary = "BOUNDARY" + str(int(time.time()))
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"reqtype\"\r\n\r\nfileupload\r\n"
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{filename}\"\r\n"
        f"Content-Type: image/png\r\n\r\n"
    ).encode() + img_bytes + f"\r\n--{boundary}--\r\n".encode()
    
    req = urllib.request.Request("https://api.imgur.com/3/image", method="POST",
        headers={"Authorization": "Client-ID 546c25a59c58ad7",
                 "Content-Type": f"multipart/form-data; boundary={boundary}"}, data=body)
    resp = json.loads(urllib.request.urlopen(req, timeout=60).read())
    return resp.get("data", {}).get("link", "")

def create_flint_task(slug, app_name, description, icon_url, screenshot_url, creator, category, wabi_url):
    """Send Flint prompt to recreate page with correct template and content."""
    qr_url = f"https://api.qrserver.com/v1/create-qr-code/?size=300x300&data={urllib.parse.quote(wabi_url)}"
    
    prompt = f"""Delete the existing page at /apps/{slug} and recreate it using /apps/kitty-diabetes-final as the design template. Match the layout and component structure of kitty-diabetes-final exactly.

App name: {app_name}
Category: {category}
App description: {description}
Icon URL: {icon_url}
Screenshot URL: {screenshot_url}
Screenshot alt: {app_name} app screenshot showing the main interface
Creator: {creator}

Write a compelling landing page for this app based on its description. Follow these rules:
- H1 should be problem-first (what pain does this solve?), not product-first. Do not include "on Wabi" in the H1.
- Include a relevant real statistic in the hero section related to the problem this app solves.
- Write 5-6 features based on what the app likely does given its description.
- Write an alternatives section with 3 alternatives (a digital tool, a paid app, and an analog method).
- Write 5 FAQ entries, including 3 "What if I want [remix variation]?" entries.
- Write a community section mentioning relevant subreddits.
- Trust signals: Free · No ads · Free Wabi account · Built on Wabi
- All CTA buttons and links must point to: {wabi_url}
- QR code URL: {qr_url}
- Use the screenshot image ({screenshot_url}) as the main app preview image.
- Use the icon URL ({icon_url}) as the small app icon.
- Do NOT use images from any other app page (especially not breathwork).

SEO:
- Title tag should be problem-first, ~60 chars, include the app concept
- Meta description ~155 chars with the primary keyword"""

    payload = json.dumps({
        "siteId": SITE_ID,
        "command": "prompt",
        "publish": True,
        "prompt": prompt
    }).encode()
    
    req = urllib.request.Request("https://app.tryflint.com/api/v1/agent/tasks",
        method="POST",
        headers={"Authorization": f"Bearer {FLINT_API_KEY}", "Content-Type": "application/json"},
        data=payload)
    result = json.loads(urllib.request.urlopen(req, timeout=30).read())
    return result.get("taskId", "")

def poll_task(task_id, max_minutes=20):
    """Poll Flint task until completed or failed."""
    for i in range(max_minutes * 4):  # check every 15s
        time.sleep(15)
        encoded_id = urllib.parse.quote(task_id, safe="")
        req = urllib.request.Request(
            f"https://app.tryflint.com/api/v1/agent/tasks/{encoded_id}",
            headers={"Authorization": f"Bearer {FLINT_API_KEY}"})
        result = json.loads(urllib.request.urlopen(req, timeout=15).read())
        status = result.get("status", "unknown")
        if status in ("completed", "succeeded"):
            return "completed", result
        elif status == "failed":
            return "failed", result
    return "timeout", {}

def main():
    # Skip index if provided (to resume)
    start_idx = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    
    print("Fetching Notion data...")
    notion_data = get_notion_data()
    print(f"Found {len(notion_data)} apps in Notion\n")
    
    results = []
    
    for idx, (slug, notion_name, wabi_url) in enumerate(APPS):
        if idx < start_idx:
            continue
            
        print(f"\n{'='*60}")
        print(f"[{idx+1}/26] {slug}")
        print(f"{'='*60}")
        
        # 1. Get Wabi info
        try:
            wabi_info = get_wabi_info(wabi_url)
            app_name = wabi_info["title"] or notion_name
            description = wabi_info["description"] or "A mini-app on Wabi."
            icon_url = wabi_info["icon_url"] or ""
            print(f"  Title: {app_name}")
            print(f"  Desc: {description}")
            print(f"  Icon: {'YES' if icon_url else 'MISSING'}")
        except Exception as e:
            print(f"  ERROR getting Wabi info: {e}")
            app_name = notion_name
            description = "A mini-app on Wabi."
            icon_url = ""
        
        # 2. Get Notion screenshot
        notion_key = notion_name.lower()
        notion_entry = notion_data.get(notion_key, {})
        if not notion_entry:
            # Try fuzzy match
            for k, v in notion_data.items():
                if notion_name.lower() in k or k in notion_name.lower():
                    notion_entry = v
                    break
        
        screenshot_url = ""
        if notion_entry and notion_entry.get("attachment_ref"):
            try:
                print(f"  Downloading screenshot from Notion...")
                img_bytes = download_notion_screenshot(notion_entry["page_id"], notion_entry["attachment_ref"])
                print(f"  Screenshot: {len(img_bytes)} bytes, uploading to Imgur...")
                screenshot_url = upload_to_imgur(img_bytes, f"{slug}.png")
                print(f"  Imgur URL: {screenshot_url}")
            except Exception as e:
                print(f"  ERROR with screenshot: {e}")
        else:
            print(f"  WARNING: No screenshot in Notion for '{notion_name}'")
        
        creator = notion_entry.get("creator", "Wabi") if notion_entry else "Wabi"
        category = notion_entry.get("category", "Lifestyle") if notion_entry else "Lifestyle"
        
        # 3. Create Flint task
        try:
            print(f"  Creating Flint task...")
            task_id = create_flint_task(slug, app_name, description, icon_url, screenshot_url, creator, category, wabi_url)
            print(f"  Task ID: {task_id}")
        except Exception as e:
            print(f"  ERROR creating task: {e}")
            results.append({"slug": slug, "status": "error", "error": str(e)})
            continue
        
        # 4. Poll until done
        print(f"  Polling (this takes 5-10 min)...")
        status, result = poll_task(task_id)
        
        if status == "completed":
            output = result.get("output", {})
            pages = output.get("pagesModified", []) + output.get("pagesCreated", [])
            pub_url = pages[0].get("publishedUrl", "N/A") if pages else "N/A"
            print(f"  ✅ DONE → {pub_url}")
            results.append({"slug": slug, "status": "completed", "url": pub_url})
        elif status == "failed":
            err = result.get("errorMessage", "unknown")
            print(f"  ❌ FAILED: {err}")
            results.append({"slug": slug, "status": "failed", "error": err})
            # If concurrent write error, wait and retry
            if "write operation" in str(err).lower():
                print(f"  Waiting 120s for write lock to clear...")
                time.sleep(120)
        else:
            print(f"  ⏰ TIMEOUT")
            results.append({"slug": slug, "status": "timeout"})
        
        # Brief pause between tasks
        time.sleep(5)
    
    # Summary
    print(f"\n\n{'='*60}")
    print("SUMMARY")
    print(f"{'='*60}")
    completed = [r for r in results if r["status"] == "completed"]
    failed = [r for r in results if r["status"] != "completed"]
    print(f"Completed: {len(completed)}/26")
    print(f"Failed: {len(failed)}")
    for r in failed:
        print(f"  ❌ {r['slug']}: {r.get('error', r['status'])}")
    for r in completed:
        print(f"  ✅ {r['slug']} → {r.get('url', '')}")

if __name__ == "__main__":
    main()
