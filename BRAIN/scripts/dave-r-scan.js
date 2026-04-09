const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

const CDP_URL = 'ws://127.0.0.1:50241/devtools/browser/194fbae4-3f08-4ba0-a4cb-de081c6a1362';
const AGENT_ID = 'dave-r';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const SUBREDDITS = ['HomeImprovement', 'DIY', 'woodworking', 'smoking'];

const CATEGORY_MAP = {
  HomeImprovement: 'Home & DIY',
  DIY: 'Home & DIY',
  woodworking: 'Home & DIY',
  smoking: 'BBQ & Grilling',
};

function apiCall(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => raw += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch(e) { resolve({ raw }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function getPostsViaJSON(sub) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.reddit.com',
      path: `/r/${sub}/hot.json?limit=25&raw_json=1`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          const posts = parsed.data.children.map(c => c.data).filter(p => !p.stickied && p.score >= 5);
          resolve(posts);
        } catch(e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  const category = CATEGORY_MAP[sub];
  let posts = [];
  let postsScanned = 0;
  let painPointsFound = 0;

  // Try browser-based approach first
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

    // Check for CAPTCHA or login wall
    const url = page.url();
    console.log(`Current URL: ${url}`);

    const content = await page.content();
    if (content.includes('CAPTCHA') || content.includes('captcha')) {
      console.log('CAPTCHA detected, falling back to JSON API');
      throw new Error('CAPTCHA');
    }
  } catch (err) {
    console.log(`Browser approach failed (${err.message}), using JSON API fallback`);
  }

  // Use JSON API to get posts
  try {
    console.log(`Fetching posts via Reddit JSON API for r/${sub}...`);
    posts = await getPostsViaJSON(sub);
    console.log(`Got ${posts.length} posts from JSON API`);
  } catch (err) {
    console.log(`JSON API also failed: ${err.message}`);
    await logScan(sub, 0, 0, 'error');
    return { postsScanned: 0, painPointsFound: 0 };
  }

  postsScanned = posts.length;

  // Analyze posts for pain points
  const painPoints = [];

  for (const post of posts) {
    const title = post.title || '';
    const body = post.selftext || '';
    const score = post.score || 0;
    const comments = post.num_comments || 0;
    const postId = post.id;
    const permalink = `https://reddit.com${post.permalink}`;

    // Pain point detection heuristics
    const painSignals = [
      /\b(frustrated|frustrating|annoyed|annoying|hate|hated|hate when|drives me crazy|so hard|struggle|struggling|can't figure|can't find|no way to|impossible)\b/i,
      /\b(is there an? (app|tool|software|way|method|trick|hack|plugin|solution)|does anyone know|anyone know of|what do you use for|how do you (manage|track|organize|handle))\b/i,
      /\b(manual(ly)?|by hand|spreadsheet|excel|pen and paper|notebook|no good way|still (doing|using))\b/i,
      /\b(too expensive|overpriced|subscription|can't afford|free alternative|cheaper option)\b/i,
      /\b(organize|track|plan|schedule|manage|keep track|record|log)\b/i,
      /\b(problem|issue|challenge|pain|difficult|hard|confusing|complicated)\b/i,
    ];

    let signalCount = 0;
    const combined = `${title} ${body}`;
    for (const signal of painSignals) {
      if (signal.test(combined)) signalCount++;
    }

    // Skip pure image posts, low engagement, or low signal
    if (signalCount < 2) continue;
    if (!post.is_self && body.length < 50) continue;

    // Generate pain point
    const pp = {
      post,
      title: title.substring(0, 80),
      description: generateDescription(title, body, sub),
      category,
      subreddit: `r/${sub}`,
      postId,
      permalink,
      score,
      comments,
      body: body.substring(0, 2000),
    };

    painPoints.push(pp);
    if (painPoints.length >= 5) break; // Cap per subreddit
  }

  console.log(`Found ${painPoints.length} pain points in r/${sub}`);

  // Submit pain points
  for (const pp of painPoints) {
    try {
      console.log(`  Submitting: "${pp.title}"`);
      const created = await apiCall('POST', '/api/pain-points', {
        title: pp.title,
        description: pp.description,
        category: pp.category,
        subreddit: pp.subreddit,
        discoveredBy: AGENT_ID,
      });

      console.log(`  Created pain point:`, JSON.stringify(created).substring(0, 200));

      const ppId = created.id || (created.data && created.data.id);
      if (ppId) {
        await apiCall('POST', '/api/pain-points/posts', {
          painPointId: ppId,
          redditPostId: pp.postId,
          redditUrl: pp.permalink,
          postTitle: pp.post.title,
          postBody: pp.body,
          upvotes: pp.score,
          commentCount: pp.comments,
          subreddit: pp.subreddit,
          discoveredBy: AGENT_ID,
        });
        console.log(`  Linked source post`);
      }

      painPointsFound++;
    } catch (err) {
      console.log(`  Error submitting pain point: ${err.message}`);
    }

    await sleep(500);
  }

  // Log scan results
  await logScan(sub, postsScanned, painPointsFound, 'completed');

  return { postsScanned, painPointsFound, painPoints };
}

function generateDescription(title, body, sub) {
  // Build a concise 2-3 sentence description
  const snippets = [];
  if (body && body.length > 50) {
    // Grab first meaningful sentence
    const sentences = body.split(/[.!?]+/).filter(s => s.trim().length > 20);
    if (sentences.length > 0) snippets.push(sentences[0].trim());
    if (sentences.length > 1) snippets.push(sentences[1].trim());
  }

  let description = `From r/${sub}: "${title}".`;
  if (snippets.length > 0) {
    description += ` ${snippets[0]}.`;
  }
  if (snippets.length > 1 && description.length < 200) {
    description += ` ${snippets[1]}.`;
  }
  return description.substring(0, 500);
}

async function logScan(sub, postsScanned, painPointsFound, status) {
  try {
    const result = await apiCall('POST', '/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned,
      painPointsFound,
      status,
    });
    console.log(`  Scan log submitted for r/${sub}: ${status}`);
  } catch (err) {
    console.log(`  Error logging scan: ${err.message}`);
  }
}

async function main() {
  console.log('dave-r scanner starting...');
  console.log(`CDP URL: ${CDP_URL}`);
  console.log(`Subreddits: ${SUBREDDITS.join(', ')}`);

  let browser;
  let page;

  try {
    console.log('Connecting to AdsPower browser via CDP...');
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected!');

    const context = browser.contexts()[0];
    const pages = context.pages();
    console.log(`Found ${pages.length} open pages`);

    // Close extra tabs
    for (let i = 1; i < pages.length; i++) await pages[i].close();
    page = pages[0] || await context.newPage();

  } catch (err) {
    console.log(`CDP connection failed: ${err.message}`);
    console.log('Will proceed with JSON API only (no browser)');
    page = null;
  }

  const results = [];
  let totalPosts = 0;
  let totalPainPoints = 0;
  const allPainPoints = [];

  for (const sub of SUBREDDITS) {
    try {
      const result = await scanSubreddit(page, sub);
      results.push({ sub, ...result });
      totalPosts += result.postsScanned || 0;
      totalPainPoints += result.painPointsFound || 0;
      if (result.painPoints) allPainPoints.push(...result.painPoints);
    } catch (err) {
      console.log(`Error scanning r/${sub}: ${err.message}`);
      await logScan(sub, 0, 0, 'error');
    }

    await sleep(3000); // Natural pacing between subreddits
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${SUBREDDITS.length}`);
  console.log(`Total posts analyzed: ${totalPosts}`);
  console.log(`Total pain points found: ${totalPainPoints}`);

  if (allPainPoints.length > 0) {
    console.log('\nPain points discovered:');
    allPainPoints.forEach((pp, i) => console.log(`  ${i+1}. [${pp.subreddit}] ${pp.title}`));
  }

  // Output JSON summary for parent agent
  const summary = {
    agentId: AGENT_ID,
    subredditsScanned: SUBREDDITS.length,
    totalPostsAnalyzed: totalPosts,
    totalPainPointsFound: totalPainPoints,
    painPoints: allPainPoints.map(pp => ({ subreddit: pp.subreddit, title: pp.title })),
    results,
  };
  console.log('\nSUMMARY_JSON:', JSON.stringify(summary));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
