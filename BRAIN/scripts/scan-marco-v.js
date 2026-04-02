const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:54115/devtools/browser/1328c577-927b-41ee-8029-e512a9c86215';
const AGENT_ID = 'marco-v';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const SUBREDDITS = [
  { name: 'nocode', category: 'No-Code & Builders' },
  { name: 'Nootropics', category: 'Biohacking' },
  { name: 'Biohackers', category: 'Biohacking' },
  { name: 'SideProject', category: 'No-Code & Builders' },
];

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function submitPainPoint(painPoint) {
  console.log(`  Submitting pain point: ${painPoint.title}`);
  const result = await apiPost('/api/pain-points', {
    title: painPoint.title,
    description: painPoint.description,
    category: painPoint.category,
    subreddit: painPoint.subreddit,
    discoveredBy: AGENT_ID,
  });
  console.log(`  Created pain point ID: ${result.id || JSON.stringify(result)}`);
  return result.id;
}

async function submitPost(painPointId, postData) {
  if (!painPointId) return;
  await apiPost('/api/pain-points/posts', {
    painPointId,
    redditPostId: postData.redditPostId,
    redditUrl: postData.redditUrl,
    postTitle: postData.postTitle,
    postBody: (postData.postBody || '').substring(0, 2000),
    upvotes: postData.upvotes || 0,
    commentCount: postData.commentCount || 0,
    subreddit: postData.subreddit,
    discoveredBy: AGENT_ID,
  });
}

async function logScan(subreddit, postsScanned, painPointsFound, status) {
  await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned,
    painPointsFound,
    status,
  });
  console.log(`  Logged scan for r/${subreddit}: ${postsScanned} posts, ${painPointsFound} pain points`);
}

async function fetchSubredditJSON(subreddit) {
  const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=25&raw_json=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  const data = await res.json();
  return data?.data?.children?.map(c => c.data) || [];
}

function isPainPoint(post) {
  const title = (post.title || '').toLowerCase();
  const body = (post.selftext || '').toLowerCase();
  const text = title + ' ' + body;

  // Skip memes, celebrations, pure images
  if (post.score < 5) return false;
  if (!post.title) return false;

  const painKeywords = [
    'frustrated', 'frustrating', 'annoying', 'struggle', 'struggling',
    'problem', 'issue', 'help', 'advice', 'how do i', 'how to',
    'is there', 'anyone else', 'hate', 'wish', 'need a tool', 'app for',
    'manual', 'tedious', 'time consuming', 'expensive', 'complex',
    'complicated', 'confusing', 'cant find', "can't find", 'looking for',
    'recommendation', 'suggest', 'automate', 'workflow', 'pain point',
    'workaround', 'alternative to', 'better way', 'side effect',
    'doesnt work', "doesn't work", 'not working', 'broken',
    'cognitive', 'brain fog', 'focus', 'memory', 'sleep',
    'stack', 'dosing', 'tolerance', 'withdrawal', 'interaction',
    'nocode', 'no-code', 'bubble', 'webflow', 'airtable', 'zapier',
    'build', 'launch', 'mvp', 'startup', 'saas', 'automation',
    'biohack', 'optimize', 'protocol', 'tracking', 'data',
  ];

  const hasPainSignal = painKeywords.some(kw => text.includes(kw));
  if (!hasPainSignal) return false;

  // Exclude pure emotional venting, memes
  const excludeKeywords = ['[meme]', 'just a reminder', 'ama', 'achievement', 'update: i did it'];
  if (excludeKeywords.some(kw => text.includes(kw))) return false;

  return true;
}

function buildPainPointFromPost(post, category) {
  const title = post.title.substring(0, 80);
  const body = post.selftext || '';
  const description = body.length > 10
    ? body.substring(0, 300).replace(/\n+/g, ' ').trim() + (body.length > 300 ? '...' : '')
    : `Reddit post: "${post.title}". ${post.score} upvotes, ${post.num_comments} comments.`;

  return {
    title,
    description: description.substring(0, 400),
    category,
    subreddit: `r/${post.subreddit}`,
    redditPostId: post.id,
    redditUrl: `https://reddit.com${post.permalink}`,
    postTitle: post.title,
    postBody: body,
    upvotes: post.score,
    commentCount: post.num_comments,
  };
}

async function scanSubreddit(page, sub) {
  const { name, category } = sub;
  console.log(`\n=== Scanning r/${name} ===`);

  let posts = [];
  let usedFallback = false;

  try {
    // Try browser-based scan first
    await page.goto(`https://www.reddit.com/r/${name}/hot/`, {
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

    const content = await page.content();
    // Check if page loaded OK
    if (content.length < 5000 || content.includes('CAPTCHA') || content.includes('Are you human')) {
      console.log(`  Browser page issue for r/${name}, using JSON fallback`);
      usedFallback = true;
    } else {
      console.log(`  Browser loaded r/${name} OK (${content.length} chars), using JSON for post data`);
      usedFallback = true; // Use JSON for structured data regardless
    }
  } catch (err) {
    console.log(`  Browser nav failed: ${err.message}, using JSON fallback`);
    usedFallback = true;
  }

  // Fetch JSON API for structured post data
  try {
    posts = await fetchSubredditJSON(name);
    console.log(`  Fetched ${posts.length} posts from JSON API`);
  } catch (err) {
    console.log(`  JSON API failed: ${err.message}`);
    await logScan(name, 0, 0, 'error');
    return [];
  }

  const painPosts = posts.filter(isPainPoint);
  console.log(`  Found ${painPosts.length} potential pain points from ${posts.length} posts`);

  const submitted = [];
  for (const post of painPosts.slice(0, 5)) { // max 5 per subreddit
    const pp = buildPainPointFromPost(post, category);
    try {
      const id = await submitPainPoint(pp);
      await submitPost(id, pp);
      submitted.push(pp.title);
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.log(`  Error submitting: ${err.message}`);
    }
  }

  await logScan(name, posts.length, submitted.length, 'completed');
  return submitted;
}

async function main() {
  console.log('Connecting to AdsPower CDP...');
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL, { timeout: 30000 });
    console.log('Connected!');
  } catch (err) {
    console.error('Failed to connect to CDP:', err.message);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const pages = context.pages();
  for (let i = 1; i < pages.length; i++) await pages[i].close();
  const page = pages[0] || await context.newPage();

  const results = {};
  for (const sub of SUBREDDITS) {
    try {
      results[sub.name] = await scanSubreddit(page, sub);
    } catch (err) {
      console.error(`Error scanning r/${sub.name}:`, err.message);
      await logScan(sub.name, 0, 0, 'error');
      results[sub.name] = [];
    }
    await new Promise(r => setTimeout(r, 3000)); // Pause between subreddits
  }

  // Don't close the browser — admin handles that
  await browser.close().catch(() => {});

  console.log('\n=== SCAN COMPLETE ===');
  for (const [sub, points] of Object.entries(results)) {
    console.log(`r/${sub}: ${points.length} pain points`);
    points.forEach(p => console.log(`  - ${p}`));
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
