const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

const CDP_URL = 'ws://127.0.0.1:59729/devtools/browser/a90fac6d-b383-4e79-b437-44c2ed12ce83';
const AGENT_ID = 'ty-m';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const SUBREDDITS = [
  { name: 'bikecommuting', category: 'Cycling' },
  { name: 'gravelcycling', category: 'Cycling' },
  { name: 'bikewrench', category: 'Cycling' },
  { name: 'fuckcars', category: 'Cycling' },
  { name: 'HomeImprovement', category: 'Home & DIY' },
  { name: 'DIY', category: 'Home & DIY' },
  { name: 'woodworking', category: 'Home & DIY' },
  { name: 'smoking', category: 'BBQ & Grilling' },
  { name: 'insomnia', category: 'Sleep & Recovery' },
  { name: 'CBTi', category: 'Sleep & Recovery' },
];

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(responseData)); }
        catch(e) { resolve({ raw: responseData }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function submitPainPoint(title, description, category, subreddit) {
  const result = await apiRequest('POST', '/api/pain-points', {
    title: title.slice(0, 80),
    description,
    category,
    subreddit: `r/${subreddit}`,
    discoveredBy: AGENT_ID,
  });
  return result.id || result.painPoint?.id || null;
}

async function submitSource(painPointId, post, subreddit) {
  if (!painPointId) return;
  await apiRequest('POST', '/api/pain-points/posts', {
    painPointId,
    redditPostId: post.id,
    redditUrl: `https://reddit.com${post.permalink || `/r/${subreddit}/comments/${post.id}/`}`,
    postTitle: post.title,
    postBody: (post.selftext || '').slice(0, 2000),
    upvotes: post.score || 0,
    commentCount: post.num_comments || 0,
    subreddit: `r/${subreddit}`,
    discoveredBy: AGENT_ID,
  });
}

async function logScan(subreddit, postsScanned, painPointsFound, status = 'completed') {
  await apiRequest('POST', '/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned,
    painPointsFound,
    status,
  });
}

async function fetchSubredditJSON(subreddit) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.reddit.com',
      path: `/r/${subreddit}/hot.json?limit=25&raw_json=1`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse failed: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

function isPainPoint(post) {
  if (!post.title) return false;
  if (post.score < 5) return false;
  if (post.stickied) return false;
  if (!post.is_self && !post.selftext) {
    // Link-only post, but title might still be a pain point
  }

  const title = post.title.toLowerCase();
  const body = (post.selftext || '').toLowerCase();
  const combined = title + ' ' + body;

  // Keywords indicating pain points
  const painKeywords = [
    'how do i', 'how to', 'is there a', 'is there an', 'app for', 'tool for',
    'frustrated', 'frustrating', 'annoying', 'problem', 'issue', 'struggle',
    'cant find', "can't find", 'help me', 'need help', 'help with',
    'manually', 'too expensive', 'too complex', 'too complicated',
    'wish there was', 'wish i could', 'anyone know', 'recommendation',
    'looking for', 'advice', 'best way to', 'trying to', 'failing',
    'impossible', 'difficult', 'hard to', 'having trouble',
    'what do you use', 'what app', 'what software', 'what tool',
    'nobody talks about', 'rant', 'vent', 'confused', 'overwhelmed',
    'tracking', 'organize', 'keep track', 'manage', 'plan',
    'automate', 'easier', 'simpler', 'better way',
  ];

  const hasPainKeyword = painKeywords.some(kw => combined.includes(kw));
  const hasMinComments = post.num_comments >= 5;

  return hasPainKeyword || (hasMinComments && post.score >= 20);
}

function extractPainPointFromPost(post, subreddit, category) {
  const title = post.title;
  const body = post.selftext || '';
  const combined = (title + ' ' + body).toLowerCase();

  // Determine a good pain point title
  let ppTitle = title.length <= 80 ? title : title.slice(0, 77) + '...';

  // Create a meaningful description
  let desc = '';
  if (body && body.length > 20) {
    desc = body.slice(0, 200).replace(/\n+/g, ' ').trim();
    if (desc.length < body.length) desc += '...';
  }

  const description = desc
    ? `In r/${subreddit}: ${title}. ${desc}`
    : `In r/${subreddit}: ${title}. ${post.num_comments} comments, ${post.score} upvotes.`;

  return {
    title: ppTitle,
    description: description.slice(0, 500),
  };
}

async function scanWithBrowser(page, subreddit, category) {
  console.log(`[${subreddit}] Navigating via browser...`);
  const painPoints = [];
  let postsScanned = 0;

  try {
    await page.goto(`https://www.reddit.com/r/${subreddit}/hot/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    // Scroll to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await page.waitForTimeout(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1000);

    // Extract post data from page
    const posts = await page.evaluate(() => {
      const results = [];
      // Try new Reddit shreddit format
      const postEls = document.querySelectorAll('shreddit-post, [data-testid="post-container"], article');
      postEls.forEach(el => {
        const titleEl = el.querySelector('h1, h2, h3, [slot="title"], a[data-click-id="body"]');
        const title = titleEl ? titleEl.textContent.trim() : '';
        if (!title) return;

        const scoreEl = el.querySelector('[score], faceplate-number, [data-testid="vote-count"]');
        const score = scoreEl ? parseInt(scoreEl.textContent.replace(/[^0-9]/g, '') || '0') : 0;

        const commentsEl = el.querySelector('a[data-click-id="comments"], [data-click-id="comments"]');
        const commentsText = commentsEl ? commentsEl.textContent : '0';
        const num_comments = parseInt(commentsText.replace(/[^0-9]/g, '') || '0');

        const linkEl = el.querySelector('a[data-click-id="body"], a[href*="/comments/"]');
        const permalink = linkEl ? linkEl.href : '';

        const idMatch = permalink.match(/\/comments\/([a-z0-9]+)\//);
        const id = idMatch ? idMatch[1] : Math.random().toString(36).slice(2);

        results.push({ title, score, num_comments, permalink, id, selftext: '', is_self: true });
      });
      return results;
    });

    postsScanned = posts.length;
    console.log(`[${subreddit}] Found ${postsScanned} posts via browser`);

    for (const post of posts) {
      if (isPainPoint(post)) {
        const pp = extractPainPointFromPost(post, subreddit, category);
        painPoints.push({ pp, post });
      }
    }

  } catch (err) {
    console.log(`[${subreddit}] Browser scan failed: ${err.message}, falling back to JSON API`);
    return null; // Signal to use JSON fallback
  }

  return { postsScanned, painPoints };
}

async function scanSubreddit(page, subreddit, category) {
  console.log(`\n=== Scanning r/${subreddit} (${category}) ===`);
  let postsScanned = 0;
  let painPointsFound = 0;

  // Try browser first, then JSON fallback
  let browserResult = await scanWithBrowser(page, subreddit, category);
  let posts = [];

  if (!browserResult || browserResult.postsScanned === 0) {
    console.log(`[${subreddit}] Using JSON API fallback...`);
    try {
      await new Promise(r => setTimeout(r, 2000));
      const json = await fetchSubredditJSON(subreddit);
      if (json && json.data && json.data.children) {
        posts = json.data.children.map(c => c.data).filter(p => p && p.title);
        postsScanned = posts.length;
        console.log(`[${subreddit}] JSON API: ${postsScanned} posts`);
      }
    } catch (err) {
      console.log(`[${subreddit}] JSON API also failed: ${err.message}`);
      await logScan(subreddit, 0, 0, 'error');
      return { postsScanned: 0, painPointsFound: 0 };
    }

    for (const post of posts) {
      if (isPainPoint(post)) {
        const pp = extractPainPointFromPost(post, subreddit, category);
        try {
          console.log(`  → Pain point: ${pp.title}`);
          const id = await submitPainPoint(pp.title, pp.description, category, subreddit);
          await submitSource(id, post, subreddit);
          painPointsFound++;
          await new Promise(r => setTimeout(r, 500));
        } catch (err) {
          console.log(`  ✗ Failed to submit: ${err.message}`);
        }
      }
    }
  } else {
    postsScanned = browserResult.postsScanned;
    for (const { pp, post } of browserResult.painPoints) {
      try {
        console.log(`  → Pain point: ${pp.title}`);
        const id = await submitPainPoint(pp.title, pp.description, category, subreddit);
        await submitSource(id, post, subreddit);
        painPointsFound++;
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        console.log(`  ✗ Failed to submit: ${err.message}`);
      }
    }
  }

  await logScan(subreddit, postsScanned, painPointsFound, 'completed');
  console.log(`[${subreddit}] Done: ${postsScanned} posts, ${painPointsFound} pain points`);

  return { postsScanned, painPointsFound };
}

async function main() {
  console.log(`Starting Reddit scan for agent: ${AGENT_ID}`);
  console.log(`Subreddits: ${SUBREDDITS.map(s => s.name).join(', ')}`);
  console.log(`CDP URL: ${CDP_URL}`);

  let browser;
  let page;

  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected to browser via CDP');

    const context = browser.contexts()[0];
    const pages = context.pages();
    for (let i = 1; i < pages.length; i++) {
      await pages[i].close();
    }
    page = pages[0] || await context.newPage();
    console.log('Browser page ready');
  } catch (err) {
    console.log(`Failed to connect to CDP: ${err.message}. Will use JSON API for all subreddits.`);
    page = null;
  }

  const results = {
    totalPostsScanned: 0,
    totalPainPointsFound: 0,
    subredditsScanned: 0,
    painPointTitles: [],
    errors: [],
  };

  for (const { name, category } of SUBREDDITS) {
    try {
      const r = await scanSubreddit(page, name, category);
      results.totalPostsScanned += r.postsScanned;
      results.totalPainPointsFound += r.painPointsFound;
      results.subredditsScanned++;
      await new Promise(r => setTimeout(r, 3000)); // Pace between subreddits
    } catch (err) {
      console.log(`Error scanning r/${name}: ${err.message}`);
      results.errors.push(`r/${name}: ${err.message}`);
    }
  }

  // Don't close the browser — admin agent handles that

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${results.subredditsScanned}/${SUBREDDITS.length}`);
  console.log(`Total posts analyzed: ${results.totalPostsScanned}`);
  console.log(`Pain points found: ${results.totalPainPointsFound}`);
  if (results.errors.length) {
    console.log(`Errors: ${results.errors.join(', ')}`);
  }

  return results;
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
