const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

const CDP_URL = 'ws://127.0.0.1:50145/devtools/browser/162cfd6b-f369-4f6d-9b5e-a3ddd6dd34e9';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const AGENT_ID = 'maya-chen';
const SUBREDDITS = ['personalfinance', 'cooking', 'solotravel', 'frugal'];

const CATEGORY_MAP = {
  personalfinance: 'Personal Finance',
  frugal: 'Personal Finance',
  cooking: 'Cooking',
  solotravel: 'Solo Travel',
};

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function apiPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(API_BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch(e) { resolve(body); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function fetchRedditJSON(sub) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.reddit.com',
      path: `/r/${sub}/hot.json?limit=25&raw_json=1`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  const category = CATEGORY_MAP[sub] || 'General';
  const painPoints = [];
  let postsScanned = 0;

  let posts = [];

  // Try browser first
  try {
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    // Check for login wall or error
    const pageTitle = await page.title();
    console.log(`  Page title: ${pageTitle}`);

    // Scroll to load posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    // Try to extract posts from the page
    const snapshot = await page.evaluate(() => {
      const results = [];
      // Try shreddit-post elements
      const postEls = document.querySelectorAll('shreddit-post, [data-testid="post-container"], article');
      postEls.forEach(el => {
        const titleEl = el.querySelector('a[slot="title"], h3, h1, [data-click-id="body"] a');
        const title = titleEl ? titleEl.textContent.trim() : '';
        const href = titleEl ? titleEl.getAttribute('href') : '';
        const scoreEl = el.querySelector('[score], faceplate-number, [data-testid="vote-count"]');
        const score = scoreEl ? parseInt(scoreEl.textContent.replace(/[^0-9]/g, '')) || 0 : 0;
        const commentEl = el.querySelector('a[href*="comments"]');
        const commentText = commentEl ? commentEl.textContent.trim() : '0';
        const commentCount = parseInt(commentText.replace(/[^0-9]/g, '')) || 0;
        const bodyEl = el.querySelector('[data-testid="post-content"], .RichTextJSON-root');
        const body = bodyEl ? bodyEl.textContent.trim().slice(0, 2000) : '';
        if (title) {
          results.push({ title, href: href || '', score, commentCount, body });
        }
      });
      return results;
    });

    if (snapshot && snapshot.length > 3) {
      console.log(`  Found ${snapshot.length} posts via browser`);
      posts = snapshot;
    } else {
      throw new Error('Not enough posts via browser, falling back to JSON API');
    }
  } catch (err) {
    console.log(`  Browser scrape issue: ${err.message}. Using JSON API fallback...`);
    try {
      const json = await fetchRedditJSON(sub);
      if (json && json.data && json.data.children) {
        posts = json.data.children.map(c => ({
          title: c.data.title,
          href: c.data.permalink,
          score: c.data.score || 0,
          commentCount: c.data.num_comments || 0,
          body: (c.data.selftext || '').slice(0, 2000),
          id: c.data.id,
          url: 'https://reddit.com' + c.data.permalink,
          stickied: c.data.stickied,
        }));
        console.log(`  Got ${posts.length} posts via JSON API`);
      }
    } catch (jsonErr) {
      console.log(`  JSON API also failed: ${jsonErr.message}`);
    }
  }

  // Filter posts
  const filtered = posts.filter(p => {
    if (p.stickied) return false;
    if (p.score < 5) return false;
    if (!p.title) return false;
    return true;
  });

  postsScanned = filtered.length;
  console.log(`  Analyzing ${postsScanned} posts for pain points...`);

  // Analyze for pain points
  const painKeywords = [
    'how do i', 'is there an app', 'tool for', 'frustrated', 'annoying', 'struggling',
    'can\'t figure out', 'cant figure out', 'help me', 'need help', 'problem with',
    'issue with', 'difficult', 'hard to', 'tedious', 'manual', 'automate', 'track',
    'organize', 'keep track', 'losing track', 'overwhelmed', 'confused', 'complicated',
    'expensive', 'affordable', 'cheaper', 'alternatives', 'wish there was', 'if only',
    'nobody tells you', 'worst part', 'hate', 'dreading', 'nightmare', 'pain',
    'recommendation', 'advice', 'tips', 'suggestions', 'what do you use',
    'how do you manage', 'how do you deal', 'any tips', 'any suggestions',
    'best way to', 'efficient way', 'better way', 'spreadsheet',
  ];

  for (const post of filtered.slice(0, 30)) {
    const titleLower = post.title.toLowerCase();
    const bodyLower = (post.body || '').toLowerCase();

    const hasPainSignal = painKeywords.some(kw => titleLower.includes(kw) || bodyLower.includes(kw));
    if (!hasPainSignal && post.commentCount < 20) continue;

    // Score pain point relevance
    let score = 0;
    if (hasPainSignal) score += 2;
    if (post.commentCount >= 20) score += 1;
    if (post.commentCount >= 50) score += 1;
    if (post.score >= 100) score += 1;
    if (titleLower.includes('?')) score += 1; // questions often indicate problems

    if (score < 2) continue;

    // Build pain point
    const redditPostId = post.id || (post.href ? post.href.split('/')[4] : Math.random().toString(36).slice(2));
    const redditUrl = post.url || (post.href ? (post.href.startsWith('http') ? post.href : 'https://reddit.com' + post.href) : '');

    // Create concise description
    let description = post.body
      ? `${post.title}. ${post.body.slice(0, 200)}...`
      : `Reddit users in r/${sub} are experiencing: ${post.title}. This post has ${post.commentCount} comments indicating significant community interest.`;

    description = description.slice(0, 500);

    painPoints.push({
      title: post.title.slice(0, 80),
      description,
      category,
      subreddit: `r/${sub}`,
      redditPostId,
      redditUrl,
      postTitle: post.title,
      postBody: post.body || '',
      upvotes: post.score,
      commentCount: post.commentCount,
    });
  }

  console.log(`  Found ${painPoints.length} pain points in r/${sub}`);

  // Submit pain points
  let submitted = 0;
  for (const pp of painPoints) {
    try {
      const createRes = await apiPost('/api/pain-points', {
        title: pp.title,
        description: pp.description,
        category: pp.category,
        subreddit: pp.subreddit,
        discoveredBy: AGENT_ID,
      });

      console.log(`  Created pain point: ${pp.title.slice(0, 50)}... => id: ${createRes.id || JSON.stringify(createRes).slice(0, 80)}`);

      if (createRes && createRes.id) {
        await apiPost('/api/pain-points/posts', {
          painPointId: createRes.id,
          redditPostId: pp.redditPostId,
          redditUrl: pp.redditUrl,
          postTitle: pp.postTitle,
          postBody: pp.postBody.slice(0, 2000),
          upvotes: pp.upvotes,
          commentCount: pp.commentCount,
          subreddit: pp.subreddit,
          discoveredBy: AGENT_ID,
        });
      }
      submitted++;
      await sleep(500);
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
      painPointsFound: submitted,
      status: 'completed',
    });
    console.log(`  Logged scan for r/${sub}`);
  } catch (err) {
    console.log(`  Error logging scan: ${err.message}`);
  }

  return { sub, postsScanned, painPointsFound: submitted, painPointTitles: painPoints.map(p => p.title) };
}

async function main() {
  console.log('Connecting to AdsPower browser...');
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL, { timeout: 15000 });
    console.log('Connected!');
  } catch (err) {
    console.error('Failed to connect via CDP:', err.message);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const pages = context.pages();

  // Keep one page, close extras
  for (let i = 1; i < pages.length; i++) {
    await pages[i].close().catch(() => {});
  }
  const page = pages[0] || await context.newPage();

  const results = [];
  for (const sub of SUBREDDITS) {
    try {
      const result = await scanSubreddit(page, sub);
      results.push(result);
    } catch (err) {
      console.error(`Error scanning r/${sub}: ${err.message}`);
      results.push({ sub, postsScanned: 0, painPointsFound: 0, error: err.message });
    }
    await sleep(3000); // Pause between subreddits
  }

  // Summary
  console.log('\n=== SCAN COMPLETE ===');
  let totalPosts = 0, totalPainPoints = 0;
  for (const r of results) {
    console.log(`r/${r.sub}: ${r.postsScanned} posts scanned, ${r.painPointsFound} pain points`);
    if (r.painPointTitles && r.painPointTitles.length > 0) {
      r.painPointTitles.forEach(t => console.log(`  - ${t.slice(0, 70)}`));
    }
    totalPosts += r.postsScanned || 0;
    totalPainPoints += r.painPointsFound || 0;
  }
  console.log(`\nTotal: ${totalPosts} posts scanned, ${totalPainPoints} pain points submitted`);

  // Don't close browser — admin agent handles that
  await browser.close().catch(() => {});
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
