#!/usr/bin/env python3
"""Reddit Pain Point Scanner — jess-m agent"""

import asyncio
import json
import re
import time
import urllib.request
import urllib.error
from urllib.parse import urljoin

CDP_URL = 'ws://127.0.0.1:56628/devtools/browser/92a28768-a101-459f-9b7d-71a1b35ef070'
AGENT_ID = 'jess-m'
API_BASE = 'http://localhost:3000'
API_KEY = 'openclaw-scanner-key'

SUBREDDITS = [
    ('gardening', 'Gardening'),
    ('beyondthebump', 'New Moms'),
    ('Mommit', 'New Moms'),
    ('running', 'Fitness'),
    ('xxfitness', 'Fitness'),
    ('ADHD', 'ADHD & Neurodivergent'),
    ('languagelearning', 'Language Learning'),
    ('remotework', 'Remote Work'),
    ('productivity', 'Productivity'),
    ('EatCheapAndHealthy', 'Cooking'),
    ('lawncare', 'Gardening'),
]

PAIN_PATTERNS = [
    re.compile(r'is there (an?|any) (app|tool|website|service|way|plugin|extension|software)', re.I),
    re.compile(r'does anyone (know|use|recommend) (an?|any) (app|tool|way|method)', re.I),
    re.compile(r'looking for (an?|any) (app|tool|way|recommendation)', re.I),
    re.compile(r'any (app|tool|software|service|website) (that|for|to)', re.I),
    re.compile(r'need (an?|a better|some) (app|tool|way|system|method)', re.I),
    re.compile(r'what (app|tool|do you use) (for|to)', re.I),
    re.compile(r'manually (tracking|doing|managing|entering|recording)', re.I),
    re.compile(r'so (tedious|time.consuming|frustrating|annoying)', re.I),
    re.compile(r'tired of (manually|having to|doing)', re.I),
    re.compile(r'wish (there was|someone would|i could)', re.I),
    re.compile(r'why (isn.t|is there no|don.t they)', re.I),
    re.compile(r'too (expensive|complex|complicated|overwhelming)', re.I),
    re.compile(r'(excel|spreadsheet) (is|feels|getting)', re.I),
    re.compile(r'hard to (track|keep track|remember|organize|manage|stay consistent)', re.I),
    re.compile(r'how do you (track|keep track|organize|manage|stay on top)', re.I),
    re.compile(r'best way to (track|organize|manage|keep)', re.I),
    re.compile(r'struggling (to|with) (track|keep|manage|organize|stay)', re.I),
    re.compile(r'can.t (find|seem to find|keep track|remember|stay)', re.I),
    re.compile(r'(automat|reminder|alert|notif)', re.I),
    re.compile(r'(overwhelm|burnout|exhausted|impossible to)', re.I),
]

SKIP_PATTERNS = re.compile(r'\b(show off|just got|finally did it|success|woo|yay|milestone|achievement|proud of|i made|look at my|beautiful|gorgeous|amazing|love my|so happy|here.s my)\b', re.I)


def api_post(path, body):
    url = f"{API_BASE}{path}"
    data = json.dumps(body).encode('utf-8')
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            'Content-Type': 'application/json',
            'x-api-key': API_KEY,
        },
        method='POST'
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body_text = e.read().decode('utf-8', errors='replace')
        raise Exception(f"API {path} returned {e.code}: {body_text}")


def analyze_post(title, body, comments):
    full_text = f"{title} {body} {' '.join(comments or [])}"
    if SKIP_PATTERNS.search(title) and not any(p.search(full_text) for p in PAIN_PATTERNS[:6]):
        return 0
    count = sum(1 for p in PAIN_PATTERNS if p.search(full_text))
    return count


async def scan_all():
    from playwright.async_api import async_playwright

    print(f"🚀 Starting Reddit scan — Agent: {AGENT_ID}")
    print(f"📡 Connecting to CDP: {CDP_URL}")

    total_posts = 0
    total_pain_points = 0
    errors = []

    async with async_playwright() as pw:
        browser = await pw.chromium.connect_over_cdp(CDP_URL)
        print("✅ Connected to browser")

        contexts = browser.contexts
        print(f"   Browser contexts: {len(contexts)}")
        context = contexts[0] if contexts else await browser.new_context()

        pages = context.pages
        print(f"   Pages open: {len(pages)}")

        # Close extra tabs
        for p in pages[1:]:
            await p.close()

        page = pages[0] if pages else await context.new_page()

        for (subreddit, category) in SUBREDDITS:
            print(f"\n📍 Scanning r/{subreddit} ({category})...")
            posts_scanned = 0
            pain_points_found = 0

            try:
                await page.goto(
                    f"https://www.reddit.com/r/{subreddit}/hot/",
                    wait_until='domcontentloaded',
                    timeout=30000
                )
                await asyncio.sleep(3)

                current_url = page.url
                title = await page.title()
                print(f"   Title: {title[:80]}")
                print(f"   URL: {current_url[:100]}")

                if 'login' in current_url.lower() or 'log in' in title.lower():
                    print(f"   ⚠️ Login wall — skipping")
                    api_post('/api/pain-points/scan-logs', {
                        'agentId': AGENT_ID, 'subreddit': f'r/{subreddit}',
                        'postsScanned': 0, 'painPointsFound': 0, 'status': 'login_wall'
                    })
                    continue

                # Extract posts — try shreddit format first
                post_elements = await page.query_selector_all('shreddit-post')
                posts = []

                if post_elements:
                    print(f"   Shreddit format: {len(post_elements)} posts")
                    for el in post_elements[:25]:
                        try:
                            post_title = await el.get_attribute('post-title') or ''
                            score_str = await el.get_attribute('score') or '0'
                            comment_str = await el.get_attribute('comment-count') or '0'
                            permalink = await el.get_attribute('permalink') or ''
                            post_id_match = re.search(r'/comments/([a-z0-9]+)/', permalink)
                            post_id = post_id_match.group(1) if post_id_match else ''

                            score = int(score_str) if score_str.isdigit() else 0
                            comment_count = int(comment_str) if comment_str.isdigit() else 0

                            if post_title and score >= 5:
                                posts.append({
                                    'id': post_id,
                                    'title': post_title,
                                    'score': score,
                                    'commentCount': comment_count,
                                    'url': f"https://reddit.com{permalink}",
                                    'permalink': permalink,
                                    'body': '',
                                    'comments': [],
                                })
                        except Exception as e:
                            pass
                else:
                    # Fallback: grab links to comment threads
                    links = await page.query_selector_all('a[href*="/comments/"]')
                    seen = set()
                    for link in links[:60]:
                        try:
                            href = await link.get_attribute('href') or ''
                            text = (await link.inner_text()).strip()
                            if not href or len(text) < 15:
                                continue
                            match = re.search(r'/comments/([a-z0-9]+)/', href)
                            if not match:
                                continue
                            post_id = match.group(1)
                            if post_id in seen:
                                continue
                            seen.add(post_id)
                            full_url = href if href.startswith('http') else f"https://reddit.com{href}"
                            posts.append({
                                'id': post_id,
                                'title': text[:200],
                                'score': 10,
                                'commentCount': 15,
                                'url': full_url,
                                'permalink': href,
                                'body': '',
                                'comments': [],
                            })
                            if len(posts) >= 25:
                                break
                        except Exception:
                            pass
                    print(f"   Fallback format: {len(posts)} posts")

                posts_scanned = len(posts)
                print(f"   Posts found: {posts_scanned}")

                # Read posts with 10+ comments (up to 10 posts)
                to_read = [p for p in posts if p['commentCount'] >= 10][:10]
                print(f"   Reading {len(to_read)} posts with 10+ comments...")

                for post in to_read:
                    print(f"     → \"{post['title'][:60]}...\" ({post['commentCount']} comments)")
                    try:
                        await page.goto(post['url'], wait_until='domcontentloaded', timeout=30000)
                        await asyncio.sleep(2)

                        # Get post body
                        body_text = ''
                        for sel in ['div[slot="text-body"]', '[data-testid="post-content"]', '.Post__body', '.md']:
                            el = await page.query_selector(sel)
                            if el:
                                body_text = await el.inner_text()
                                break
                        post['body'] = body_text[:2000]

                        # Get comments
                        comments = []
                        for sel in ['shreddit-comment', '[data-testid="comment"]', '.Comment']:
                            els = await page.query_selector_all(sel)
                            if els:
                                for c_el in els[:8]:
                                    try:
                                        ct = await c_el.inner_text()
                                        if len(ct) > 20:
                                            comments.append(ct[:500])
                                    except Exception:
                                        pass
                                break
                        post['comments'] = comments

                        await asyncio.sleep(2.5)

                        # Navigate back
                        await page.goto(
                            f"https://www.reddit.com/r/{subreddit}/hot/",
                            wait_until='domcontentloaded',
                            timeout=30000
                        )
                        await asyncio.sleep(2)

                    except Exception as e:
                        print(f"     ❌ Error reading post: {e}")

                # Analyze for pain points
                candidate_posts = []
                for post in posts:
                    match_count = analyze_post(post['title'], post.get('body', ''), post.get('comments', []))
                    if match_count >= 1 and post['commentCount'] >= 5:
                        candidate_posts.append((post, match_count))

                candidate_posts.sort(key=lambda x: x[1], reverse=True)
                print(f"   🎯 {len(candidate_posts)} candidate pain points")

                submitted = 0
                for post, match_count in candidate_posts[:8]:
                    title_str = post['title'][:80]
                    body_snippet = post.get('body', '')[:200]
                    description = f"In r/{subreddit}, users are asking: \"{title_str}\". "
                    if body_snippet:
                        description += f"Details: {body_snippet}"
                    else:
                        description += f"This post has {post['commentCount']} comments and {post['score']} upvotes, indicating community resonance."

                    try:
                        pp_resp = api_post('/api/pain-points', {
                            'title': title_str,
                            'description': description[:500],
                            'category': category,
                            'subreddit': f'r/{subreddit}',
                            'discoveredBy': AGENT_ID,
                        })
                        pp_id = pp_resp.get('id') or (pp_resp.get('data') or {}).get('id')
                        print(f"   ✅ Pain point: {pp_id} — {title_str[:50]}")

                        if pp_id:
                            api_post('/api/pain-points/posts', {
                                'painPointId': pp_id,
                                'redditPostId': post['id'],
                                'redditUrl': post['url'],
                                'postTitle': post['title'],
                                'postBody': post.get('body', '')[:2000],
                                'upvotes': post['score'],
                                'commentCount': post['commentCount'],
                                'subreddit': f'r/{subreddit}',
                                'discoveredBy': AGENT_ID,
                            })
                        submitted += 1
                        time.sleep(0.5)
                    except Exception as e:
                        print(f"   ❌ Submit error: {e}")

                pain_points_found = submitted

                # Log scan
                try:
                    api_post('/api/pain-points/scan-logs', {
                        'agentId': AGENT_ID,
                        'subreddit': f'r/{subreddit}',
                        'postsScanned': posts_scanned,
                        'painPointsFound': pain_points_found,
                        'status': 'completed',
                    })
                except Exception as e:
                    print(f"   ⚠️ Log error: {e}")

                print(f"   ✅ r/{subreddit}: {posts_scanned} posts, {pain_points_found} pain points submitted")
                total_posts += posts_scanned
                total_pain_points += pain_points_found

            except Exception as e:
                print(f"   ❌ Error: {e}")
                errors.append(f"r/{subreddit}: {e}")
                try:
                    api_post('/api/pain-points/scan-logs', {
                        'agentId': AGENT_ID,
                        'subreddit': f'r/{subreddit}',
                        'postsScanned': posts_scanned,
                        'painPointsFound': 0,
                        'status': 'error',
                    })
                except Exception:
                    pass

            # Pace between subreddits
            await asyncio.sleep(3)

    print("\n========== SCAN COMPLETE ==========")
    print(f"Subreddits scanned: {len(SUBREDDITS)}")
    print(f"Total posts analyzed: {total_posts}")
    print(f"Pain points discovered: {total_pain_points}")
    if errors:
        print(f"Errors ({len(errors)}):")
        for err in errors:
            print(f"  - {err}")
    print("===================================")
    return total_posts, total_pain_points, errors


if __name__ == '__main__':
    asyncio.run(scan_all())
