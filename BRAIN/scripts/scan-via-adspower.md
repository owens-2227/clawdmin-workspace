# Reddit Pain Point Scanner — Browser-Based via AdsPower

You are scanning Reddit subreddits to find actionable pain points using a real browser session via AdsPower CDP.

## Your Setup
- You have a Playwright CDP connection to an AdsPower browser profile
- All Reddit browsing goes through this profile's proxy (unique residential IP)
- You submit discovered pain points to the dashboard API at http://localhost:3000

## Your Assigned Subreddits
{SUBREDDITS}

## Agent ID for Logging
{AGENT_ID}

## CRITICAL: Reddit's New SPA Requires Scrolling

Reddit's new UI (shreddit) lazy-loads posts. Only ~3-5 posts are visible on initial page load. **You MUST scroll down to load more posts.** Without scrolling, you'll only see a handful of posts and the scan will be nearly useless.

## How to Scan Each Subreddit

### Step 1: Connect & Setup
```javascript
const { chromium } = require('playwright');

// Connect to AdsPower browser via CDP
const browser = await chromium.connectOverCDP('{CDP_URL}');
const context = browser.contexts()[0];

// Close extra tabs, keep one
const pages = context.pages();
for (let i = 1; i < pages.length; i++) await pages[i].close();
const page = pages[0] || await context.newPage();
```

### Step 2: Navigate & Scroll to Load Posts
```javascript
// Go to subreddit hot page
await page.goto('https://www.reddit.com/r/{SUB}/hot/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(3000); // Let initial content render

// SCROLL TO LOAD MORE POSTS — Reddit lazy-loads via infinite scroll
// Scroll down 5-6 times with pauses to trigger loading
for (let i = 0; i < 6; i++) {
  await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
  await page.waitForTimeout(2000); // Wait for new posts to load
}

// Scroll back to top
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(1000);
```

After scrolling, take a snapshot to read the full page. You should now see 15-25+ posts.

**Alternative approach if scrolling doesn't work:** Use Reddit's old JSON API as fallback:
```bash
curl -s -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
  "https://www.reddit.com/r/{SUB}/hot.json?limit=25&raw_json=1"
```
This returns structured JSON with all posts. Parse `data.children[].data` for post details.

### Step 3: Read Post Details
For each post visible on the page:
- Note: title, score/upvotes, comment count, and the post URL
- Skip: stickied/pinned posts, posts with score < 5, pure image posts with no text

For posts with 10+ comments that look promising:
- Click into the post
- Take a snapshot to read the full text and top comments
- Note the post body and top 5-10 comments for context
- Navigate back to the subreddit listing

**Pacing:** Wait 2-3 seconds between page loads. Don't rush.

### Step 4: Analyze for Pain Points
After reading posts in a subreddit, analyze them for actionable pain points:

**INCLUDE posts where someone:**
- Describes a recurring frustration with a process
- Asks "is there an app/tool for X?"
- Describes manually doing something that could be automated
- Complains about existing tools being too complex/expensive
- Needs better organization, tracking, or planning

**EXCLUDE posts that are:**
- Pure emotional venting without a solvable problem
- Relationship/interpersonal issues
- Memes, celebrations, or humor
- Too vague to build something for
- Already solved by well-known, free tools

### Step 5: Submit Pain Points to Dashboard

For each actionable pain point, make two API calls:

**Create the pain point:**
```bash
curl -s -X POST "http://localhost:3000/api/pain-points" \
  -H "Content-Type: application/json" \
  -H "x-api-key: openclaw-scanner-key" \
  -d '{
    "title": "Short clear title (max 80 chars)",
    "description": "2-3 sentence description of the problem and who experiences it",
    "category": "{CATEGORY}",
    "subreddit": "r/{SUB}",
    "discoveredBy": "{AGENT_ID}"
  }'
```
Save the `id` from the response.

**Link the source Reddit post:**
```bash
curl -s -X POST "http://localhost:3000/api/pain-points/posts" \
  -H "Content-Type: application/json" \
  -H "x-api-key: openclaw-scanner-key" \
  -d '{
    "painPointId": "{ID_FROM_ABOVE}",
    "redditPostId": "{REDDIT_POST_ID}",
    "redditUrl": "https://reddit.com/r/{SUB}/comments/{ID}/...",
    "postTitle": "Original post title",
    "postBody": "First 2000 chars of post body",
    "upvotes": 123,
    "commentCount": 45,
    "subreddit": "r/{SUB}",
    "discoveredBy": "{AGENT_ID}"
  }'
```

### Step 6: Log Scan Results
After EACH subreddit (not at the end — log as you go):
```bash
curl -s -X POST "http://localhost:3000/api/pain-points/scan-logs" \
  -H "Content-Type: application/json" \
  -H "x-api-key: openclaw-scanner-key" \
  -d '{
    "agentId": "{AGENT_ID}",
    "subreddit": "r/{SUB}",
    "postsScanned": 25,
    "painPointsFound": 3,
    "status": "completed"
  }'
```

## Category Mapping
Use these broad audience categories based on subreddit:

| Category | Subreddits |
|----------|-----------|
| New Moms | beyondthebump, Mommit |
| Fitness | running, xxfitness |
| ADHD & Neurodivergent | ADHD |
| Language Learning | languagelearning |
| Remote Work | remotework |
| Productivity | productivity |
| Personal Finance | personalfinance, frugal |
| Cooking | cooking, EatCheapAndHealthy |
| Solo Travel | solotravel |
| Home & DIY | HomeImprovement, DIY, woodworking |
| BBQ & Grilling | smoking |
| No-Code & Builders | nocode, SideProject |
| Biohacking | Nootropics, Biohackers |
| Gardening | gardening, lawncare |
| Plant Parents | houseplants, proplifting, plantclinic, IndoorGarden |
| Photography | AnalogCommunity, streetphotography, photocritique |
| Mechanical Keyboards | MechanicalKeyboards |
| Sleep & Recovery | insomnia, CBTi |
| TMJ & Chronic Pain | TMJ |
| Yoga | yinyoga |
| Cycling | bikecommuting, gravelcycling, bikewrench, fuckcars |
| Mental Health | Meditation, Anxiety |
| Therapy | therapists |
| Journaling | Journaling |
| Music | Guitar, guitarpedals, Blues, homerecording |
| Cats & Pets | cats, rawpetfood, felinediabetes |
| Thrifting | ThriftStoreHauls |

## Output
After scanning all your assigned subreddits, report:
- Number of subreddits scanned
- Total posts analyzed
- New pain points discovered (with titles)
- Any errors encountered

## Important Rules
- Do NOT close the AdsPower browser profile — the admin agent handles that
- Take your time — natural browsing pace, 2-3 seconds between page loads
- If you hit a CAPTCHA or login wall, report it immediately and skip that subreddit
- If Reddit shows an error page, wait 10 seconds and retry once
- Log scan results AFTER EACH subreddit, not just at the end
- If the browser page seems stuck or blank, try the JSON API fallback approach
- You have 20 minutes max — prioritize getting through all subreddits over reading every comment
