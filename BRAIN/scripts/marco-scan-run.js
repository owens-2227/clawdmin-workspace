const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

const CDP_URL = 'ws://127.0.0.1:53864/devtools/browser/a63a6451-dedf-4e14-bf5d-351c14642528';
const AGENT_ID = 'marco-v';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const SUBREDDITS = [
  'nocode', 'Nootropics', 'Biohackers', 'SideProject',
  'personalfinance', 'cooking', 'solotravel', 'frugal',
  'therapists', 'Journaling'
];

const CATEGORY_MAP = {
  'nocode': 'No-Code & Builders',
  'SideProject': 'No-Code & Builders',
  'Nootropics': 'Biohacking',
  'Biohackers': 'Biohacking',
  'personalfinance': 'Personal Finance',
  'frugal': 'Personal Finance',
  'cooking': 'Cooking',
  'solotravel': 'Solo Travel',
  'therapists': 'Therapy',
  'Journaling': 'Journaling',
};

function apiPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const opts = {
      hostname: 'localhost',
      port: 3000,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'x-api-key': API_KEY,
      }
    };
    const req = http.request(opts, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch(e) { resolve({ raw: body }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function fetchSubredditJSON(sub) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'www.reddit.com',
      path: `/r/${sub}/hot.json?limit=25&raw_json=1`,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    };
    const req = https.request(opts, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch(e) { resolve(null); }
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

  // Exclusions
  if (post.score < 5) return false;
  if (post.stickied) return false;
  if (!post.is_self && !post.selftext) {
    // pure image/link with no body - check title only
  }

  // Pain point signals
  const painSignals = [
    'how do i', 'is there a way', 'is there an app', 'is there a tool',
    'does anyone know', 'looking for', 'need help', 'struggling',
    'frustrated', 'annoying', 'wish there was', 'hate when',
    'manually', 'tedious', 'time consuming', 'hard to',
    'difficult to', 'problem with', 'issue with', 'can\'t find',
    'anyone else', 'is it just me', 'have to', 'keeps',
    'always have to', 'no way to', 'impossible to', 'help me',
    'advice', 'recommend', 'suggestion', 'alternative to',
    'too expensive', 'too complex', 'too complicated', 'doesn\'t work',
    'broken', 'fails', 'keeps failing', 'workaround', 'automate',
    'track', 'organize', 'manage', 'overwhelmed', 'behind on',
    'can\'t afford', 'can\'t figure out', 'confusing'
  ];

  return painSignals.some(signal => text.includes(signal));
}

function buildPainPointTitle(post) {
  // Use post title, truncated
  return post.title.substring(0, 80);
}

function buildPainPointDescription(post) {
  const body = post.selftext ? post.selftext.substring(0, 300) : '';
  const title = post.title;
  if (body && body.length > 20) {
    return `Post titled "${title}". ${body.replace(/\n/g, ' ').substring(0, 250)}...`;
  }
  return `Community discussion: "${title}" with ${post.num_comments} comments and ${post.score} upvotes. Users are discussing a common pain point in r/${post.subreddit}.`;
}

async function scanSubreddit(page, sub) {
  console.log(`\n--- Scanning r/${sub} ---`);
  const category = CATEGORY_MAP[sub] || 'General';
  let posts = [];
  let painPointsFound = 0;

  // Try browser first
  try {
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Scroll to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await page.waitForTimeout(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1000);

    // Check if we got posts via browser
    const content = await page.content();
    if (content.includes('reddit') && !content.includes('blocked') && !content.includes('captcha')) {
      console.log(`Browser load OK for r/${sub}`);
    }
  } catch (e) {
    console.log(`Browser navigation error for r/${sub}: ${e.message}`);
  }

  // Use JSON API as primary data source (more reliable)
  console.log(`Fetching JSON for r/${sub}...`);
  let jsonData = null;
  try {
    jsonData = await fetchSubredditJSON(sub);
  } catch (e) {
    console.log(`JSON fetch error: ${e.message}`);
  }

  if (jsonData && jsonData.data && jsonData.data.children) {
    posts = jsonData.data.children.map(c => c.data);
    console.log(`Got ${posts.length} posts from JSON`);
  } else {
    console.log(`No JSON data for r/${sub}, skipping`);
    await logScan(sub, 0, 0, 'error');
    return 0;
  }

  // Filter and analyze posts
  const actionablePosts = posts.filter(isPainPoint);
  console.log(`${actionablePosts.length} actionable pain points found in r/${sub}`);

  // Submit top pain points (max 5 per subreddit to avoid spam)
  const toSubmit = actionablePosts.slice(0, 5);
  
  for (const post of toSubmit) {
    try {
      const ppTitle = buildPainPointTitle(post);
      const ppDesc = buildPainPointDescription(post);

      // Create pain point
      const ppResult = await apiPost('/api/pain-points', {
        title: ppTitle,
        description: ppDesc,
        category,
        subreddit: `r/${sub}`,
        discoveredBy: AGENT_ID,
      });

      console.log(`Created pain point: ${ppTitle.substring(0, 50)}... => id: ${ppResult.id || ppResult.painPoint?.id || 'unknown'}`);

      const ppId = ppResult.id || ppResult.painPoint?.id || ppResult.data?.id;

      if (ppId) {
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
          discoveredBy: AGENT_ID,
        });
        console.log(`Linked source post: ${post.id}`);
      }

      painPointsFound++;
      await new Promise(r => setTimeout(r, 1000)); // Pace API calls
    } catch (e) {
      console.log(`Error submitting pain point: ${e.message}`);
    }
  }

  // Log scan result
  await logScan(sub, posts.length, painPointsFound, 'completed');
  return painPointsFound;
}

async function logScan(sub, postsScanned, painPointsFound, status) {
  try {
    const result = await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned,
      painPointsFound,
      status,
    });
    console.log(`Logged scan for r/${sub}: ${status}`);
  } catch (e) {
    console.log(`Failed to log scan for r/${sub}: ${e.message}`);
  }
}

async function main() {
  console.log(`Starting scan for ${AGENT_ID}`);
  console.log(`CDP URL: ${CDP_URL}`);
  console.log(`Subreddits: ${SUBREDDITS.join(', ')}`);

  let browser;
  let page;

  try {
    console.log('Connecting to AdsPower browser...');
    browser = await chromium.connectOverCDP(CDP_URL);
    const context = browser.contexts()[0];
    
    // Close extra tabs
    const pages = context.pages();
    for (let i = 1; i < pages.length; i++) await pages[i].close();
    page = pages[0] || await context.newPage();
    console.log('Connected! Pages:', pages.length);
  } catch (e) {
    console.log(`CDP connection failed: ${e.message}`);
    // Continue with just JSON API fallback (page will be null)
  }

  let totalPainPoints = 0;
  let totalPosts = 0;
  const results = [];

  for (const sub of SUBREDDITS) {
    try {
      const found = await scanSubreddit(page, sub);
      totalPainPoints += found;
      results.push({ sub, found });
      await new Promise(r => setTimeout(r, 3000)); // Pace between subreddits
    } catch (e) {
      console.log(`Error scanning r/${sub}: ${e.message}`);
      results.push({ sub, found: 0, error: e.message });
    }
  }

  console.log('\n========== SCAN COMPLETE ==========');
  console.log(`Agent: ${AGENT_ID}`);
  console.log(`Subreddits scanned: ${SUBREDDITS.length}`);
  console.log(`Total pain points submitted: ${totalPainPoints}`);
  console.log('Results per subreddit:');
  results.forEach(r => console.log(`  r/${r.sub}: ${r.found} pain points${r.error ? ' (ERROR: ' + r.error + ')' : ''}`));
  console.log('====================================');

  // Don't close browser — admin handles that
  process.exit(0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
