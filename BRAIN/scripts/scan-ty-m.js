const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:61014/devtools/browser/1f45e2af-094f-4268-9b13-813f0df60828';
const AGENT_ID = 'ty-m';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const SUBREDDITS = ['bikecommuting', 'gravelcycling', 'bikewrench', 'fuckcars'];

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function fetchRedditJson(sub) {
  const url = `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function isPainPoint(post) {
  const text = (post.title + ' ' + (post.selftext || '')).toLowerCase();
  const painKeywords = [
    'is there an app', 'tool for', 'looking for', 'how do you track',
    'frustrated', 'frustrating', 'annoying', 'problem', 'issue', 'struggle',
    'wish there was', 'anyone else', 'help me', 'need help', 'cant figure',
    "can't figure", 'how to', 'best way to', 'anyone know', 'recommendations',
    'manual', 'tedious', 'complicated', 'expensive', 'alternative to',
    'replace', 'broken', 'failing', 'hard to', 'difficult', 'pain point',
    'too much', 'waste', 'inefficient', 'organize', 'track', 'manage'
  ];
  return painKeywords.some(kw => text.includes(kw));
}

function extractPainTitle(post) {
  let title = post.title.trim();
  if (title.length > 80) title = title.substring(0, 77) + '...';
  return title;
}

function extractDescription(post) {
  const body = post.selftext ? post.selftext.substring(0, 500) : '';
  let desc = `Post in r/${post.subreddit}: "${post.title}". `;
  if (body) desc += body.substring(0, 200) + (body.length > 200 ? '...' : '');
  desc = desc.trim();
  if (desc.length > 400) desc = desc.substring(0, 397) + '...';
  return desc;
}

async function scanSubredditViaBrowser(page, sub) {
  console.log(`\n[${sub}] Navigating to https://www.reddit.com/r/${sub}/hot/`);
  let posts = [];
  
  try {
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    // Scroll to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    // Try to get page content and extract posts
    const content = await page.content();
    console.log(`[${sub}] Page loaded, content length: ${content.length}`);
    
    // Check for CAPTCHA or login wall
    if (content.includes('captcha') || content.includes('CAPTCHA')) {
      throw new Error('CAPTCHA detected');
    }
    if (content.includes('Log In') && content.includes('Sign Up') && !content.includes('r/' + sub)) {
      throw new Error('Login wall detected');
    }

    // Use JSON API as primary source for structured data
    console.log(`[${sub}] Fetching JSON API for structured data...`);
    const json = await fetchRedditJson(sub);
    posts = json.data.children.map(c => c.data);
    console.log(`[${sub}] Got ${posts.length} posts from JSON API`);
    
  } catch (err) {
    console.log(`[${sub}] Browser error: ${err.message}, trying JSON fallback...`);
    try {
      const json = await fetchRedditJson(sub);
      posts = json.data.children.map(c => c.data);
      console.log(`[${sub}] JSON fallback got ${posts.length} posts`);
    } catch (err2) {
      console.log(`[${sub}] JSON fallback also failed: ${err2.message}`);
      return { postsScanned: 0, painPointsFound: 0, error: err2.message };
    }
  }

  // Filter posts
  const validPosts = posts.filter(p => !p.stickied && p.score >= 5);
  console.log(`[${sub}] ${validPosts.length} valid posts after filtering`);

  let painPointsFound = 0;

  for (const post of validPosts) {
    if (!isPainPoint(post)) continue;

    console.log(`[${sub}] Pain point found: "${post.title}" (score: ${post.score}, comments: ${post.num_comments})`);

    try {
      // Create pain point
      const ppRes = await apiPost('/api/pain-points', {
        title: extractPainTitle(post),
        description: extractDescription(post),
        category: 'Cycling',
        subreddit: `r/${sub}`,
        discoveredBy: AGENT_ID
      });

      const ppId = ppRes?.id || ppRes?.data?.id;
      if (!ppId) {
        console.log(`[${sub}] No ID returned for pain point, response: ${JSON.stringify(ppRes)}`);
        continue;
      }

      // Link source post
      await apiPost('/api/pain-points/posts', {
        painPointId: ppId,
        redditPostId: post.id,
        redditUrl: `https://reddit.com${post.permalink}`,
        postTitle: post.title,
        postBody: (post.selftext || '').substring(0, 2000),
        upvotes: post.score,
        commentCount: post.num_comments,
        subreddit: `r/${sub}`,
        discoveredBy: AGENT_ID
      });

      painPointsFound++;
      await sleep(500);
    } catch (err) {
      console.log(`[${sub}] Error submitting pain point: ${err.message}`);
    }
  }

  // Log scan results
  await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${sub}`,
    postsScanned: validPosts.length,
    painPointsFound,
    status: 'completed'
  });

  console.log(`[${sub}] Done. Scanned ${validPosts.length} posts, found ${painPointsFound} pain points.`);
  return { postsScanned: validPosts.length, painPointsFound };
}

async function main() {
  console.log('Connecting to AdsPower browser via CDP...');
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected!');
  } catch (err) {
    console.error('Failed to connect via CDP:', err.message);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const pages = context.pages();
  
  // Close extra tabs, keep one
  for (let i = 1; i < pages.length; i++) await pages[i].close();
  const page = pages[0] || await context.newPage();

  const results = [];
  let totalPosts = 0;
  let totalPainPoints = 0;

  for (const sub of SUBREDDITS) {
    try {
      const result = await scanSubredditViaBrowser(page, sub);
      results.push({ sub, ...result });
      totalPosts += result.postsScanned || 0;
      totalPainPoints += result.painPointsFound || 0;
    } catch (err) {
      console.log(`[${sub}] Unexpected error: ${err.message}`);
      results.push({ sub, postsScanned: 0, painPointsFound: 0, error: err.message });
      
      // Log failed scan
      await apiPost('/api/pain-points/scan-logs', {
        agentId: AGENT_ID,
        subreddit: `r/${sub}`,
        postsScanned: 0,
        painPointsFound: 0,
        status: 'error'
      }).catch(() => {});
    }
    
    // Pace between subreddits
    if (SUBREDDITS.indexOf(sub) < SUBREDDITS.length - 1) {
      console.log('Waiting 3s before next subreddit...');
      await sleep(3000);
    }
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${SUBREDDITS.length}`);
  console.log(`Total posts analyzed: ${totalPosts}`);
  console.log(`Total pain points found: ${totalPainPoints}`);
  console.log('Results:', JSON.stringify(results, null, 2));

  // Don't close browser — admin agent handles that
  await browser.close().catch(() => {}); // disconnect only
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
