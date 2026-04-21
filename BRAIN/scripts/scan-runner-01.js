const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:53207/devtools/browser/d0b8478f-1a84-48be-957b-6916adb2686c';
const AGENT_ID = 'scanner-01';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const SUBREDDITS = [
  { name: 'gardening', category: 'Gardening' },
  { name: 'beyondthebump', category: 'New Moms' },
  { name: 'Mommit', category: 'New Moms' },
  { name: 'running', category: 'Fitness' },
  { name: 'xxfitness', category: 'Fitness' },
  { name: 'ADHD', category: 'ADHD & Neurodivergent' },
  { name: 'languagelearning', category: 'Language Learning' },
  { name: 'remotework', category: 'Remote Work' },
  { name: 'productivity', category: 'Productivity' },
  { name: 'Meditation', category: 'Mental Health' },
  { name: 'Anxiety', category: 'Mental Health' },
];

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
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function fetchRedditJson(sub) {
  const url = `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function isPainPoint(post) {
  const text = (post.title + ' ' + (post.selftext || '')).toLowerCase();
  // Exclude
  if (post.stickied) return false;
  if (post.score < 5) return false;
  if (!post.is_self && !post.selftext) return false; // pure link/image post

  // Include signals
  const includePatterns = [
    /is there (an? |any )?(app|tool|way|software|plugin|extension)/i,
    /how do (you|i) (track|manage|organize|automate|deal with|handle)/i,
    /frustrat/i,
    /struggl/i,
    /wish (there was|i could|it would)/i,
    /annoying(ly)?/i,
    /pain point/i,
    /manually (doing|tracking|logging|entering)/i,
    /too (expensive|complex|complicated)/i,
    /nothing works/i,
    /can't find/i,
    /looking for (an? |a )?(app|tool|solution|way)/i,
    /does anyone else/i,
    /overwhelm/i,
    /hard to (keep track|stay|manage|remember)/i,
    /keeps forgetting/i,
    /no good (app|tool|way)/i,
    /what do you use (for|to)/i,
    /recommend(ation)? (for|a)/i,
    /help (me|with)/i,
  ];

  const titleLower = post.title.toLowerCase();
  const bodyLower = (post.selftext || '').toLowerCase();

  for (const pattern of includePatterns) {
    if (pattern.test(titleLower) || pattern.test(bodyLower)) return true;
  }
  return false;
}

function extractPainPointTitle(post) {
  // Trim to 80 chars
  return post.title.substring(0, 80);
}

function extractDescription(post) {
  const body = post.selftext || '';
  const snippet = body.substring(0, 300).replace(/\n+/g, ' ').trim();
  if (snippet) {
    return `${post.title}. ${snippet}`;
  }
  return `Community discussion: ${post.title}. Posted in r/${post.subreddit} with ${post.ups} upvotes and ${post.num_comments} comments.`;
}

async function scanSubreddit(sub, category, page) {
  console.log(`\n--- Scanning r/${sub} ---`);
  let posts = [];
  let usedFallback = false;

  // Try browser first
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

    // Try to get page content and check if Reddit loaded
    const content = await page.content();
    if (content.includes('captcha') || content.includes('CAPTCHA') || content.length < 5000) {
      console.log(`Browser approach seems blocked for r/${sub}, falling back to JSON API`);
      usedFallback = true;
    }
  } catch (e) {
    console.log(`Browser error for r/${sub}: ${e.message}, falling back to JSON API`);
    usedFallback = true;
  }

  // JSON API fallback (or primary if browser failed)
  if (usedFallback) {
    try {
      const data = await fetchRedditJson(sub);
      posts = data.data.children.map(c => c.data);
      console.log(`JSON API: got ${posts.length} posts for r/${sub}`);
    } catch (e) {
      console.log(`JSON API also failed for r/${sub}: ${e.message}`);
      await logScan(sub, 0, 0, 'error');
      return 0;
    }
  } else {
    // Use JSON API to get structured data even if browser worked (more reliable)
    try {
      const data = await fetchRedditJson(sub);
      posts = data.data.children.map(c => c.data);
      console.log(`Got ${posts.length} posts for r/${sub} via JSON API`);
    } catch (e) {
      console.log(`JSON fetch failed, proceeding with browser data only`);
    }
  }

  if (!posts.length) {
    await logScan(sub, 0, 0, 'error');
    return 0;
  }

  // Filter pain points
  const painPointPosts = posts.filter(isPainPoint);
  console.log(`Found ${painPointPosts.length} pain point posts out of ${posts.length} total`);

  let submitted = 0;
  for (const post of painPointPosts.slice(0, 5)) { // cap at 5 per subreddit
    try {
      const ppRes = await apiPost('/api/pain-points', {
        title: extractPainPointTitle(post),
        description: extractDescription(post).substring(0, 500),
        category: category,
        subreddit: `r/${sub}`,
        discoveredBy: AGENT_ID,
      });

      const ppId = ppRes && (ppRes.id || (ppRes.painPoint && ppRes.painPoint.id));
      if (ppId) {
        const postUrl = `https://reddit.com/r/${sub}/comments/${post.id}/`;
        await apiPost('/api/pain-points/posts', {
          painPointId: ppId,
          redditPostId: post.id,
          redditUrl: postUrl,
          postTitle: post.title,
          postBody: (post.selftext || '').substring(0, 2000),
          upvotes: post.ups || post.score || 0,
          commentCount: post.num_comments || 0,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID,
        });
        console.log(`  ✓ Submitted: "${post.title.substring(0, 60)}..."`);
        submitted++;
      } else {
        console.log(`  ✗ Pain point API returned no id: ${JSON.stringify(ppRes).substring(0, 100)}`);
      }
    } catch (e) {
      console.log(`  ✗ Error submitting pain point: ${e.message}`);
    }
    await sleep(500);
  }

  await logScan(sub, posts.length, submitted, 'completed');
  return submitted;
}

async function logScan(sub, postsScanned, painPointsFound, status) {
  try {
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned,
      painPointsFound,
      status,
    });
  } catch (e) {
    console.log(`Failed to log scan for r/${sub}: ${e.message}`);
  }
}

async function main() {
  console.log('Connecting to AdsPower browser via CDP...');
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected!');
  } catch (e) {
    console.error('Failed to connect via CDP:', e.message);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const pages = context.pages();

  // Close extra tabs
  for (let i = 1; i < pages.length; i++) {
    try { await pages[i].close(); } catch {}
  }
  const page = pages[0] || await context.newPage();

  let totalPainPoints = 0;
  const results = [];

  for (const { name, category } of SUBREDDITS) {
    try {
      const count = await scanSubreddit(name, category, page);
      totalPainPoints += count;
      results.push({ sub: name, count });
    } catch (e) {
      console.log(`Error scanning r/${name}: ${e.message}`);
      results.push({ sub: name, count: 0, error: e.message });
    }
    await sleep(2000); // Pace between subreddits
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${SUBREDDITS.length}`);
  console.log(`Total pain points submitted: ${totalPainPoints}`);
  console.log('Results:', JSON.stringify(results, null, 2));

  // Don't close the browser — admin agent handles that
  await browser.close(); // disconnect only
  process.exit(0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
