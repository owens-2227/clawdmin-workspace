const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:62343/devtools/browser/addb7a63-85ed-49a2-a318-0d405fb9819c';
const AGENT_ID = 'elise-c';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const SUBREDDITS = ['cats', 'rawpetfood', 'ThriftStoreHauls', 'felinediabetes', 'EatCheapAndHealthy', 'lawncare'];

const CATEGORY_MAP = {
  cats: 'Cats & Pets',
  rawpetfood: 'Cats & Pets',
  felinediabetes: 'Cats & Pets',
  ThriftStoreHauls: 'Thrifting',
  EatCheapAndHealthy: 'Cooking',
  lawncare: 'Gardening',
};

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

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
  try { return JSON.parse(text); } catch { return text; }
}

async function fetchSubredditJSON(sub) {
  const url = `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function extractPainPoints(posts, sub) {
  const painPoints = [];

  const keywords = [
    'how do i', 'is there an app', 'is there a tool', 'anyone know', 'struggling with',
    'frustrated', 'frustrating', 'annoying', 'hate when', 'wish there was',
    'manually', 'time consuming', 'no way to', 'cant find', "can't find",
    'help me', 'looking for', 'need help', 'need a way', 'track', 'organize',
    'manage', 'keep track', 'reminder', 'schedule', 'expensive', 'too complicated',
    'overwhelmed', 'confusing', 'hard to', 'difficult to', 'problem with',
    'issue with', 'why is it so hard', 'anyone else', 'dealing with',
  ];

  for (const post of posts) {
    const d = post.data;
    if (!d || d.stickied || (d.score || 0) < 5) continue;
    if (!d.title) continue;

    const titleLower = d.title.toLowerCase();
    const bodyLower = (d.selftext || '').toLowerCase();
    const combined = titleLower + ' ' + bodyLower;

    const matched = keywords.some(kw => combined.includes(kw));
    if (!matched) continue;

    // Skip pure memes/images with no text
    if (!d.selftext && !d.is_self && d.post_hint === 'image') continue;

    // Skip if title looks like pure celebration/humor
    const skipPhrases = ['look at my', 'my cat', 'meet my', 'found this', 'just got', 'here is', 'here\'s my', 'lol', 'haha', '😂', 'cute', 'adorable'];
    if (skipPhrases.some(p => titleLower.includes(p)) && !matched) continue;

    painPoints.push({
      title: d.title.substring(0, 80),
      body: (d.selftext || '').substring(0, 2000),
      postId: d.id,
      url: `https://reddit.com${d.permalink}`,
      upvotes: d.score || 0,
      commentCount: d.num_comments || 0,
      subreddit: sub,
    });
  }

  return painPoints;
}

function buildDescription(pp, sub) {
  const body = pp.body ? ` "${pp.body.substring(0, 200).replace(/\n/g, ' ')}"` : '';
  return `Pain point discovered in r/${sub}: ${pp.title}.${body} (${pp.upvotes} upvotes, ${pp.commentCount} comments)`.substring(0, 500);
}

async function scanSubreddit(sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  let posts = [];

  try {
    const json = await fetchSubredditJSON(sub);
    posts = json?.data?.children || [];
    console.log(`  Fetched ${posts.length} posts via JSON API`);
  } catch (err) {
    console.log(`  JSON API failed: ${err.message}`);
    return { postsScanned: 0, painPointsFound: 0, status: 'error' };
  }

  const painPoints = extractPainPoints(posts, sub);
  console.log(`  Found ${painPoints.length} pain points`);

  const category = CATEGORY_MAP[sub] || 'General';
  let submitted = 0;

  for (const pp of painPoints) {
    try {
      const result = await apiPost('/api/pain-points', {
        title: pp.title,
        description: buildDescription(pp, sub),
        category,
        subreddit: `r/${sub}`,
        discoveredBy: AGENT_ID,
      });
      console.log(`  Submitted pain point: "${pp.title}" -> id=${result?.id || result}`);

      if (result?.id) {
        await apiPost('/api/pain-points/posts', {
          painPointId: result.id,
          redditPostId: pp.postId,
          redditUrl: pp.url,
          postTitle: pp.title,
          postBody: pp.body,
          upvotes: pp.upvotes,
          commentCount: pp.commentCount,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID,
        });
      }
      submitted++;
      await sleep(500);
    } catch (err) {
      console.log(`  Error submitting: ${err.message}`);
    }
  }

  // Log scan result
  try {
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned: posts.length,
      painPointsFound: submitted,
      status: 'completed',
    });
    console.log(`  Logged scan for r/${sub}`);
  } catch (err) {
    console.log(`  Failed to log scan: ${err.message}`);
  }

  return { postsScanned: posts.length, painPointsFound: submitted, status: 'completed' };
}

async function main() {
  // Try CDP connection first to validate it's alive
  let browser;
  try {
    console.log('Connecting to AdsPower via CDP...');
    browser = await chromium.connectOverCDP(CDP_URL, { timeout: 15000 });
    console.log('CDP connected successfully');
    
    const context = browser.contexts()[0];
    const pages = context ? context.pages() : [];
    console.log(`Browser contexts: ${browser.contexts().length}, pages: ${pages.length}`);
  } catch (err) {
    console.log(`CDP connection failed: ${err.message} — proceeding with JSON API fallback`);
    browser = null;
  }

  const summary = {
    totalSubreddits: 0,
    totalPostsScanned: 0,
    totalPainPoints: 0,
    results: [],
  };

  for (const sub of SUBREDDITS) {
    const result = await scanSubreddit(sub);
    summary.totalSubreddits++;
    summary.totalPostsScanned += result.postsScanned;
    summary.totalPainPoints += result.painPointsFound;
    summary.results.push({ sub, ...result });
    await sleep(2000);
  }

  if (browser) {
    try { await browser.close(); } catch {}
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${summary.totalSubreddits}`);
  console.log(`Total posts analyzed: ${summary.totalPostsScanned}`);
  console.log(`Pain points submitted: ${summary.totalPainPoints}`);
  console.log('Results:', JSON.stringify(summary.results, null, 2));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
