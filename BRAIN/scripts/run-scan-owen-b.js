const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

const CDP_URL = 'ws://127.0.0.1:60904/devtools/browser/5ec86fa1-e202-414a-9df2-8d9d645c0850';
const AGENT_ID = 'owen-b';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const SUBREDDITS = ['ADHD', 'languagelearning', 'remotework', 'productivity'];

const CATEGORY_MAP = {
  ADHD: 'ADHD & Neurodivergent',
  languagelearning: 'Language Learning',
  remotework: 'Remote Work',
  productivity: 'Productivity',
};

function apiPost(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const url = new URL(API_BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (e) { resolve({ raw }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function fetchSubredditJson(sub) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.reddit.com',
      path: `/r/${sub}/hot.json?limit=25&raw_json=1`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    };
    https.get(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function isPainPoint(post) {
  const title = (post.title || '').toLowerCase();
  const body = (post.selftext || '').toLowerCase();
  const text = title + ' ' + body;

  // Exclude memes, images, low-effort
  if (post.score < 5) return false;
  if (post.stickied) return false;
  if (post.post_hint === 'image' && !post.selftext) return false;

  // Include signals
  const painSignals = [
    'is there an app', 'is there a tool', 'any app', 'any tool',
    'struggling', 'frustrat', 'annoying', 'wish there was', 'can\'t find',
    'how do you manage', 'how do you track', 'manually', 'tedious',
    'too expensive', 'too complex', 'too complicated', 'overwhelming',
    'help me', 'need help', 'advice needed', 'tips for',
    'anyone else have trouble', 'anyone else struggle',
    'automate', 'workflow', 'organize', 'track', 'reminder',
    'forget', 'lost', 'overwhelm', 'procrastinat',
  ];

  return painSignals.some((s) => text.includes(s));
}

function extractPainPointTitle(post, sub) {
  let title = post.title;
  if (title.length > 80) title = title.substring(0, 77) + '...';
  return title;
}

function extractDescription(post, sub) {
  const body = post.selftext ? post.selftext.substring(0, 300) : '';
  const base = body
    ? `${post.title}. ${body}`
    : post.title;
  return `[${sub}] ${base}`.substring(0, 400);
}

async function scanSubreddit(page, sub) {
  const category = CATEGORY_MAP[sub] || 'Productivity';
  console.log(`\n--- Scanning r/${sub} ---`);
  let posts = [];

  // Try browser navigation first
  try {
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, {
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

    // Try to extract posts from page
    const pagePosts = await page.evaluate(() => {
      const results = [];
      // Try shreddit-post elements
      const shredditPosts = document.querySelectorAll('shreddit-post');
      shredditPosts.forEach((el) => {
        const title = el.getAttribute('post-title') || el.querySelector('h1,h2,h3,[slot="title"]')?.textContent?.trim() || '';
        const score = parseInt(el.getAttribute('score') || '0');
        const commentCount = parseInt(el.getAttribute('comment-count') || '0');
        const permalink = el.getAttribute('permalink') || '';
        const id = el.getAttribute('id') || permalink.split('/')[4] || '';
        if (title) results.push({ title, score, commentCount, permalink, id, selftext: '' });
      });

      if (results.length === 0) {
        // Fallback: try article or post elements
        const articles = document.querySelectorAll('article, [data-testid="post-container"]');
        articles.forEach((el) => {
          const titleEl = el.querySelector('h1, h2, h3, [data-testid="post-title"]');
          const title = titleEl?.textContent?.trim() || '';
          if (title) results.push({ title, score: 10, commentCount: 0, permalink: '', id: '', selftext: '' });
        });
      }
      return results;
    });

    if (pagePosts.length > 0) {
      console.log(`  Browser extracted ${pagePosts.length} posts from r/${sub}`);
      posts = pagePosts;
    } else {
      console.log(`  Browser got 0 posts, falling back to JSON API for r/${sub}`);
    }
  } catch (err) {
    console.log(`  Browser nav error for r/${sub}: ${err.message}`);
  }

  // Fallback: JSON API
  if (posts.length === 0) {
    try {
      const json = await fetchSubredditJson(sub);
      if (json?.data?.children) {
        posts = json.data.children.map((c) => c.data);
        console.log(`  JSON API returned ${posts.length} posts for r/${sub}`);
      }
    } catch (err) {
      console.log(`  JSON API error for r/${sub}: ${err.message}`);
    }
  }

  // Also try JSON API to supplement browser results
  if (posts.length > 0 && posts[0].selftext === '') {
    try {
      const json = await fetchSubredditJson(sub);
      if (json?.data?.children) {
        posts = json.data.children.map((c) => c.data);
        console.log(`  Supplemented with JSON API: ${posts.length} posts`);
      }
    } catch (err) {
      // ignore
    }
  }

  const painPoints = [];
  let postsScanned = 0;

  for (const post of posts) {
    if (!post.title) continue;
    postsScanned++;

    if (isPainPoint(post)) {
      painPoints.push(post);
    }
  }

  console.log(`  Scanned ${postsScanned} posts, found ${painPoints.length} pain points`);

  // Submit pain points
  for (const post of painPoints) {
    try {
      const ppTitle = extractPainPointTitle(post, sub);
      const ppDesc = extractDescription(post, sub);

      const createResp = await apiPost('/api/pain-points', {
        title: ppTitle,
        description: ppDesc,
        category,
        subreddit: `r/${sub}`,
        discoveredBy: AGENT_ID,
      });

      const painPointId = createResp?.id || createResp?.painPoint?.id || createResp?.data?.id;
      console.log(`  Submitted: "${ppTitle}" → id=${painPointId}`);

      if (painPointId) {
        const redditUrl = post.permalink
          ? `https://reddit.com${post.permalink}`
          : `https://reddit.com/r/${sub}/comments/${post.id}/`;
        await apiPost('/api/pain-points/posts', {
          painPointId,
          redditPostId: post.id || '',
          redditUrl,
          postTitle: post.title,
          postBody: (post.selftext || '').substring(0, 2000),
          upvotes: post.score || 0,
          commentCount: post.num_comments || post.commentCount || 0,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID,
        });
      }

      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      console.log(`  Error submitting pain point: ${err.message}`);
    }
  }

  // Log scan result
  try {
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned,
      painPointsFound: painPoints.length,
      status: 'completed',
    });
    console.log(`  Logged scan for r/${sub}`);
  } catch (err) {
    console.log(`  Error logging scan: ${err.message}`);
  }

  return { sub, postsScanned, painPointsFound: painPoints.length, titles: painPoints.map((p) => p.title) };
}

async function main() {
  console.log(`Owen-B Scanner starting — ${SUBREDDITS.join(', ')}`);

  let browser;
  let page;

  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected to AdsPower browser via CDP');

    const context = browser.contexts()[0];
    const pages = context.pages();
    for (let i = 1; i < pages.length; i++) await pages[i].close();
    page = pages[0] || await context.newPage();
  } catch (err) {
    console.log(`CDP connection error: ${err.message}`);
    console.log('Will use JSON API fallback for all subreddits');
    page = null;
  }

  const results = [];

  for (const sub of SUBREDDITS) {
    const result = await scanSubreddit(page, sub);
    results.push(result);
    await new Promise((r) => setTimeout(r, 3000)); // Pace between subreddits
  }

  // Summary
  console.log('\n=== SCAN COMPLETE ===');
  let totalPosts = 0;
  let totalPain = 0;
  for (const r of results) {
    console.log(`r/${r.sub}: ${r.postsScanned} posts, ${r.painPointsFound} pain points`);
    if (r.titles.length > 0) {
      r.titles.forEach((t) => console.log(`  - ${t}`));
    }
    totalPosts += r.postsScanned;
    totalPain += r.painPointsFound;
  }
  console.log(`\nTotal: ${totalPosts} posts scanned, ${totalPain} pain points submitted`);

  // Don't close the browser — parent agent handles that
  if (browser) {
    await browser.close().catch(() => {});
  }

  return results;
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
