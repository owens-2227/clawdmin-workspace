const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

const CDP_URL = 'ws://127.0.0.1:53733/devtools/browser/851c4cd9-aed1-4ae6-b1b3-cb42cfeea96c';
const AGENT_ID = 'jess-m';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const SUBREDDITS = ['gardening', 'beyondthebump', 'Mommit', 'running', 'xxfitness'];

const CATEGORY_MAP = {
  gardening: 'Gardening',
  beyondthebump: 'New Moms',
  Mommit: 'New Moms',
  running: 'Fitness',
  xxfitness: 'Fitness',
};

function apiPost(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const opts = {
      hostname: 'localhost',
      port: 3000,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = http.request(opts, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchRedditJSON(sub) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'www.reddit.com',
      path: `/r/${sub}/hot.json?limit=25&raw_json=1`,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    };
    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchPostComments(sub, postId) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'www.reddit.com',
      path: `/r/${sub}/comments/${postId}.json?limit=10&raw_json=1`,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    };
    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function isPainPoint(post) {
  const title = (post.title || '').toLowerCase();
  const body = (post.selftext || '').toLowerCase();
  const text = title + ' ' + body;

  // Skip
  if (post.stickied) return false;
  if (post.score < 5) return false;
  if (!post.is_self && !post.selftext) {
    // image/link post with no body — skip unless title is very specific
    const hasGoodTitle = /\b(how|anyone|tool|app|track|manage|organiz|frustrat|automat|wish|need|help|problem|issue|struggle|diffic|annoy|pain|broke|fail)\b/.test(title);
    if (!hasGoodTitle) return false;
  }

  // Pain point indicators
  const painKeywords = [
    'how do i', 'how do you', 'how can i', 'anyone else struggle',
    'is there an app', 'is there a tool', 'is there a way',
    'wish there was', 'frustrated', 'frustrating', 'annoying',
    'can\'t figure out', 'struggling with', 'hard to', 'difficult to',
    'manually track', 'tracking', 'organize', 'keep track',
    'too expensive', 'too complicated', 'no good option',
    'tired of', 'sick of', 'hate when', 'drives me crazy',
    'automate', 'automation', 'spreadsheet', 'keeps dying',
    'killing my', 'overwhelming', 'overwhelmed',
    'help me', 'advice', 'recommendations', 'suggestions',
    'problem with', 'issue with', 'dealing with',
    'nobody tells you', 'why doesn\'t', 'should be easier',
    'pain point', 'workaround', 'workarounds'
  ];

  return painKeywords.some((kw) => text.includes(kw));
}

function extractPainPointDescription(post, comments) {
  const title = post.title;
  const body = (post.selftext || '').slice(0, 500);
  const topComments = (comments || [])
    .filter((c) => c.score > 2)
    .slice(0, 3)
    .map((c) => c.body?.slice(0, 200))
    .filter(Boolean)
    .join(' | ');

  let desc = `r/${post.subreddit}: "${title}".`;
  if (body) desc += ` Post: ${body.slice(0, 300)}`;
  if (topComments) desc += ` Top comments: ${topComments.slice(0, 300)}`;
  return desc.slice(0, 600);
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  const category = CATEGORY_MAP[sub] || 'General';
  const painPointsFound = [];
  let postsScanned = 0;

  let posts = [];

  // Try browser first, fall back to JSON API
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

    const url = page.url();
    console.log(`Page URL: ${url}`);

    // Check for captcha/login wall
    const content = await page.content();
    if (content.includes('captcha') || content.includes('login') && content.includes('continue')) {
      console.log('Possible captcha/login wall detected, falling back to JSON API');
      throw new Error('login wall');
    }
  } catch (e) {
    console.log(`Browser navigation issue: ${e.message}, using JSON API fallback`);
  }

  // Use JSON API for reliable data
  try {
    console.log(`Fetching JSON API for r/${sub}...`);
    await sleep(2000);
    const data = await fetchRedditJSON(sub);
    if (data && data.data && data.data.children) {
      posts = data.data.children.map((c) => c.data).filter((p) => p && !p.stickied);
      console.log(`Got ${posts.length} posts from JSON API`);
    }
  } catch (e) {
    console.log(`JSON API error: ${e.message}`);
  }

  postsScanned = posts.length;

  // Analyze posts for pain points
  for (const post of posts) {
    if (!isPainPoint(post)) continue;

    console.log(`  Pain point candidate: "${post.title}" (score: ${post.score}, comments: ${post.num_comments})`);

    // Fetch comments for promising posts
    let topComments = [];
    if (post.num_comments >= 5) {
      try {
        await sleep(1500);
        const commData = await fetchPostComments(sub, post.id);
        if (commData && commData[1] && commData[1].data && commData[1].data.children) {
          topComments = commData[1].data.children
            .map((c) => c.data)
            .filter((c) => c && c.body && c.score > 1)
            .slice(0, 5);
        }
      } catch (e) {
        console.log(`  Could not fetch comments: ${e.message}`);
      }
    }

    // Build pain point title (max 80 chars)
    let ppTitle = post.title.slice(0, 80);
    if (post.title.length > 80) ppTitle = post.title.slice(0, 77) + '...';

    const description = extractPainPointDescription(post, topComments);

    // Submit pain point
    try {
      const ppResp = await apiPost('/api/pain-points', {
        title: ppTitle,
        description,
        category,
        subreddit: `r/${sub}`,
        discoveredBy: AGENT_ID,
      });

      console.log(`  Submitted pain point: ${JSON.stringify(ppResp).slice(0, 200)}`);

      const ppId = ppResp.id || ppResp.painPoint?.id || ppResp._id;
      if (ppId) {
        // Link source post
        const postBody = (post.selftext || '').slice(0, 2000);
        await apiPost('/api/pain-points/posts', {
          painPointId: ppId,
          redditPostId: post.id,
          redditUrl: `https://reddit.com${post.permalink}`,
          postTitle: post.title,
          postBody,
          upvotes: post.score,
          commentCount: post.num_comments,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID,
        });
        console.log(`  Linked source post: ${post.id}`);
      }

      painPointsFound.push(ppTitle);
    } catch (e) {
      console.log(`  Error submitting pain point: ${e.message}`);
    }

    await sleep(500);
  }

  // Log scan results
  try {
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned,
      painPointsFound: painPointsFound.length,
      status: 'completed',
    });
    console.log(`  Scan log submitted for r/${sub}`);
  } catch (e) {
    console.log(`  Error submitting scan log: ${e.message}`);
  }

  return { sub, postsScanned, painPointsFound };
}

async function main() {
  console.log('Starting Jess-M Reddit pain point scan...');
  console.log(`CDP URL: ${CDP_URL}`);
  console.log(`Subreddits: ${SUBREDDITS.join(', ')}`);

  let browser;
  let page;

  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected to browser via CDP');

    const context = browser.contexts()[0];
    const pages = context.pages();
    console.log(`Found ${pages.length} open pages`);

    // Close extra tabs, keep one
    for (let i = 1; i < pages.length; i++) {
      await pages[i].close();
    }
    page = pages[0] || await context.newPage();
    console.log('Page ready');
  } catch (e) {
    console.error(`Failed to connect via CDP: ${e.message}`);
    console.log('Proceeding with JSON API only (no browser page)');
  }

  const results = [];
  let totalPosts = 0;
  let allPainPoints = [];

  for (const sub of SUBREDDITS) {
    try {
      const result = await scanSubreddit(page, sub);
      results.push(result);
      totalPosts += result.postsScanned;
      allPainPoints = allPainPoints.concat(result.painPointsFound);
    } catch (e) {
      console.error(`Error scanning r/${sub}: ${e.message}`);
      results.push({ sub, postsScanned: 0, painPointsFound: [], error: e.message });
      // Log error
      try {
        await apiPost('/api/pain-points/scan-logs', {
          agentId: AGENT_ID,
          subreddit: `r/${sub}`,
          postsScanned: 0,
          painPointsFound: 0,
          status: 'error',
        });
      } catch {}
    }
    // Pacing between subreddits
    await sleep(3000);
  }

  // Summary
  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${results.length}`);
  console.log(`Total posts analyzed: ${totalPosts}`);
  console.log(`Total pain points found: ${allPainPoints.length}`);
  console.log('Pain points:');
  allPainPoints.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));

  // Write results to file
  const summary = {
    agentId: AGENT_ID,
    timestamp: new Date().toISOString(),
    subredditsScanned: results.length,
    totalPostsAnalyzed: totalPosts,
    totalPainPointsFound: allPainPoints.length,
    painPoints: allPainPoints,
    details: results,
  };

  require('fs').writeFileSync(
    '/Users/owen/.openclaw/workspace/BRAIN/scripts/scan-jess-m-results.json',
    JSON.stringify(summary, null, 2)
  );
  console.log('Results written to scan-jess-m-results.json');

  // Don't close browser — admin handles that
  if (browser) {
    try { await browser.close(); } catch {}
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
