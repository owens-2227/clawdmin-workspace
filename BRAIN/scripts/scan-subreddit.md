# Subreddit Pain Point Scanner — Agent Task Instructions

You are scanning Reddit subreddits to find actionable pain points — real problems people experience that could be solved by an app or tool.

## Your Task

1. **Fetch hot posts** from each of your assigned subreddits using Reddit's public JSON API
2. **Read the top comments** on promising posts (high engagement ones)
3. **Analyze** each post for actionable pain points — not rants, memes, or celebrations
4. **Submit** discovered pain points to the dashboard API
5. **Log** the scan results

## How to Scan

### Step 1: Fetch Hot Posts
For each subreddit, fetch via:
```
curl -s -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
  "https://www.reddit.com/r/{SUBREDDIT}/hot.json?limit=25&raw_json=1"
```

Parse the JSON response. Each post is in `data.children[].data`. Key fields:
- `id` — Reddit post ID
- `title` — Post title
- `selftext` — Post body text
- `score` — Upvotes
- `num_comments` — Number of comments
- `permalink` — URL path (prepend https://reddit.com)
- `stickied` — Skip if true (pinned posts)
- `subreddit` — Subreddit name

**Skip:** stickied posts, posts with score < 5, posts that are clearly memes/images only (no selftext and not a self post)

### Step 2: Read Top Comments (for high-engagement posts)
For posts with 10+ comments, fetch top comments:
```
curl -s -H "User-Agent: Mozilla/5.0..." \
  "https://www.reddit.com{permalink}.json?limit=10&sort=top&raw_json=1"
```
Comments are in the second array element: `[1].data.children[].data.body`

### Step 3: Analyze for Pain Points
For each post, determine:
- Is there a **specific, actionable problem** that could be solved by software/an app?
- What **category** does it fall into? (see category mapping below)
- How **confident** are you? (0.0-1.0)

**CATEGORY MAPPING — Use broad audience groups, NOT specific problem topics:**

| Category | Subreddits |
|----------|-----------|
| New Moms | r/beyondthebump, r/Mommit, r/babybumps |
| Fitness | r/running, r/xxfitness |
| ADHD & Neurodivergent | r/ADHD |
| Language Learning | r/languagelearning |
| Remote Work | r/remotework |
| Productivity | r/productivity |
| Personal Finance | r/personalfinance, r/frugal |
| Cooking | r/cooking |
| Solo Travel | r/solotravel |
| Home & DIY | r/HomeImprovement, r/DIY, r/woodworking |
| BBQ & Grilling | r/smoking |
| No-Code & Builders | r/nocode, r/SideProject |
| Biohacking | r/Nootropics, r/Biohackers |
| Gardening | r/gardening |

The category = WHO cares. The pain point title/description = WHAT the problem is.
For subreddits not listed, use the closest matching category.

**INCLUDE** posts where someone:
- Describes a recurring frustration with a process
- Asks "is there an app/tool for X?"
- Describes manually doing something that could be automated
- Complains about existing tools being too complex/expensive
- Needs better organization, tracking, or planning

**EXCLUDE** posts that are:
- Pure emotional venting without a solvable problem
- Relationship/interpersonal issues
- Memes, celebrations, or humor
- Too vague to build something for
- Already solved by well-known, free tools

### Step 4: Submit to Dashboard API
For each actionable pain point found, make two API calls:

**Create/upsert the pain point:**
```
curl -s -X POST "http://localhost:3000/api/pain-points" \
  -H "Content-Type: application/json" \
  -H "x-api-key: openclaw-scanner-key" \
  -d '{
    "title": "Short clear title (max 80 chars)",
    "description": "2-3 sentence description of the problem",
    "category": "specific category",
    "subreddit": "r/subredditname",
    "discoveredBy": "YOUR_AGENT_ID"
  }'
```
This returns `{ "id": "pain-point-id" }`. If a similar pain point exists, it increments the count.

**Link the Reddit post:**
```
curl -s -X POST "http://localhost:3000/api/pain-points/posts" \
  -H "Content-Type: application/json" \
  -H "x-api-key: openclaw-scanner-key" \
  -d '{
    "painPointId": "pain-point-id-from-above",
    "redditPostId": "reddit-post-id",
    "redditUrl": "https://reddit.com/r/.../comments/...",
    "postTitle": "Original post title",
    "postBody": "First 2000 chars of post body",
    "upvotes": 123,
    "commentCount": 45,
    "subreddit": "r/subredditname",
    "discoveredBy": "YOUR_AGENT_ID"
  }'
```

### Step 5: Log the Scan
After scanning each subreddit:
```
curl -s -X POST "http://localhost:3000/api/pain-points/scan-logs" \
  -H "Content-Type: application/json" \
  -H "x-api-key: openclaw-scanner-key" \
  -d '{
    "agentId": "YOUR_AGENT_ID",
    "subreddit": "r/subredditname",
    "postsScanned": 25,
    "painPointsFound": 3,
    "status": "completed"
  }'
```

## Output
After scanning all subreddits, report back with:
- Number of subreddits scanned
- Total posts analyzed
- Pain points discovered (new vs existing)
- Any errors encountered
