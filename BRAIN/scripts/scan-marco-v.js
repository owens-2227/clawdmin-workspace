const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:49482/devtools/browser/ff771bf5-9330-41d7-aaa4-3abeab8da774';
const AGENT_ID = 'marco-v';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const SUBREDDITS = ['nocode', 'Nootropics', 'Biohackers', 'SideProject'];

const CATEGORY_MAP = {
  nocode: 'No-Code & Builders',
  SideProject: 'No-Code & Builders',
  Nootropics: 'Biohacking',
  Biohackers: 'Biohacking',
};

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
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function fetchSubredditJSON(sub) {
  const url = `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function isPainPoint(post) {
  if (post.stickied || post.pinned) return false;
  if (post.score < 5) return false;
  const text = (post.title + ' ' + (post.selftext || '')).toLowerCase();
  // Pain point signals
  const signals = [
    'frustrated', 'frustrating', 'annoying', 'annoyed', 'hate', 'wish',
    'is there a', 'looking for', 'need help', 'struggling', 'problem',
    'issue', 'anyone else', 'how do you', 'how do i', 'best way to',
    'automate', 'manual', 'too expensive', 'too complex', 'complicated',
    'workflow', 'tool for', 'app for', 'no good', "can't find",
    'keep track', 'organize', 'manage', 'solution', 'anyone know',
    'recommend', 'suggestion', 'alternative to', 'replace', 'tired of',
  ];
  return signals.some(s => text.includes(s));
}

function extractPainPoint(post, sub) {
  const title = post.title.substring(0, 80);
  const body = post.selftext ? post.selftext.substring(0, 2000) : '';
  const description = body
    ? `${post.title}. ${body.substring(0, 200).replace(/\n/g, ' ')}`.substring(0, 300)
    : `${post.title} — posted in r/${sub} with ${post.score} upvotes and ${post.num_comments} comments.`;

  return {
    title: title,
    description: description.substring(0, 400),
    category: CATEGORY_MAP[sub] || 'No-Code & Builders',
    subreddit: `r/${sub}`,
    discoveredBy: AGENT_ID,
    redditPostId: post.id,
    redditUrl: `https://reddit.com${post.permalink}`,
    postTitle: post.title,
    postBody: body.substring(0, 2000),
    upvotes: post.score,
    commentCount: post.num_comments,
  };
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  let posts = [];
  let usedFallback = false;

  // Try browser-based first
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

    // Check if we got any posts via browser
    const url = page.url();
    console.log(`Current URL: ${url}`);

    // Try to get post data from the page
    const pageContent = await page.content();
    if (pageContent.includes('CAPTCHA') || pageContent.includes('captcha')) {
      console.log('CAPTCHA detected, falling back to JSON API');
      usedFallback = true;
    } else if (!pageContent.includes('reddit') || pageContent.length < 5000) {
      console.log('Page seems empty, falling back to JSON API');
      usedFallback = true;
    }
  } catch (err) {
    console.log(`Browser navigation failed: ${err.message}, using JSON fallback`);
    usedFallback = true;
  }

  // Always use JSON API for reliable data extraction
  try {
    console.log(`Fetching JSON API for r/${sub}...`);
    const data = await fetchSubredditJSON(sub);
    if (data && data.data && data.data.children) {
      posts = data.data.children.map(c => c.data);
      console.log(`Got ${posts.length} posts via JSON API`);
    }
  } catch (err) {
    console.log(`JSON API also failed: ${err.message}`);
  }

  if (posts.length === 0) {
    console.log(`No posts found for r/${sub}`);
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned: 0,
      painPointsFound: 0,
      status: 'error',
    });
    return { postsScanned: 0, painPointsFound: 0 };
  }

  // Filter for pain points
  const painPointPosts = posts.filter(p => isPainPoint(p));
  console.log(`Found ${painPointPosts.length} potential pain points out of ${posts.length} posts`);

  let submitted = 0;
  for (const post of painPointPosts.slice(0, 8)) { // cap at 8 per subreddit
    const pp = extractPainPoint(post, sub);
    console.log(`  Submitting: "${pp.title}"`);

    try {
      const created = await apiPost('/api/pain-points', {
        title: pp.title,
        description: pp.description,
        category: pp.category,
        subreddit: pp.subreddit,
        discoveredBy: pp.discoveredBy,
      });

      const painPointId = created?.id || created?.painPoint?.id;
      if (painPointId) {
        await apiPost('/api/pain-points/posts', {
          painPointId: painPointId,
          redditPostId: pp.redditPostId,
          redditUrl: pp.redditUrl,
          postTitle: pp.postTitle,
          postBody: pp.postBody,
          upvotes: pp.upvotes,
          commentCount: pp.commentCount,
          subreddit: pp.subreddit,
          discoveredBy: pp.discoveredBy,
        });
        submitted++;
        console.log(`    ✓ Pain point ID: ${painPointId} (upserted: ${created?.upserted ?? 'n/a'})`);
      } else {
        console.log(`    ✗ Unexpected response: ${JSON.stringify(created)}`);
      }
    } catch (err) {
      console.log(`    ✗ Error submitting: ${err.message}`);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  // Log scan results
  await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${sub}`,
    postsScanned: posts.length,
    painPointsFound: submitted,
    status: 'completed',
  });

  console.log(`r/${sub} done: ${posts.length} scanned, ${submitted} pain points submitted`);
  return { postsScanned: posts.length, painPointsFound: submitted };
}

async function main() {
  console.log(`Starting scan — agent: ${AGENT_ID}`);
  console.log(`Subreddits: ${SUBREDDITS.join(', ')}`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected to AdsPower browser via CDP');
  } catch (err) {
    console.error(`Failed to connect via CDP: ${err.message}`);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  if (!context) {
    console.error('No browser context found');
    process.exit(1);
  }

  // Close extra tabs, keep one
  const pages = context.pages();
  for (let i = 1; i < pages.length; i++) await pages[i].close();
  const page = pages[0] || await context.newPage();

  const results = [];
  for (const sub of SUBREDDITS) {
    const result = await scanSubreddit(page, sub);
    results.push({ sub, ...result });
    // Pace between subreddits
    await new Promise(r => setTimeout(r, 3000));
  }

  // Summary
  const totalPosts = results.reduce((a, r) => a + r.postsScanned, 0);
  const totalPainPoints = results.reduce((a, r) => a + r.painPointsFound, 0);

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${results.length}`);
  console.log(`Total posts analyzed: ${totalPosts}`);
  console.log(`Total pain points submitted: ${totalPainPoints}`);
  results.forEach(r => {
    console.log(`  r/${r.sub}: ${r.postsScanned} posts, ${r.painPointsFound} pain points`);
  });

  // Don't close browser — admin agent handles that
  await browser.close(); // Just disconnect, not shut down
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
