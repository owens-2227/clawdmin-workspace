const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:61820/devtools/browser/ac6b044d-a404-464a-8fd4-7fdbf26546fa';
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
  return res.json();
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  const category = CATEGORY_MAP[sub] || 'General';
  let postsScanned = 0;
  let painPointsFound = 0;
  const posts = [];

  // Try browser-based approach first
  try {
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    // Check for login wall or CAPTCHA
    const pageContent = await page.content();
    if (pageContent.includes('Log in to Reddit') && pageContent.includes('Continue with Google') && !pageContent.includes('shreddit-post')) {
      console.log(`Login wall detected on r/${sub} — using JSON API fallback`);
      throw new Error('login wall');
    }

    // Scroll to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    // Extract posts from page
    const rawPosts = await page.evaluate(() => {
      const items = [];
      // shreddit-post elements
      const postEls = document.querySelectorAll('shreddit-post');
      postEls.forEach(el => {
        const title = el.getAttribute('post-title') || el.querySelector('h3')?.innerText || '';
        const score = parseInt(el.getAttribute('score') || '0');
        const commentCount = parseInt(el.getAttribute('comment-count') || '0');
        const permalink = el.getAttribute('permalink') || '';
        const postId = el.getAttribute('id') || permalink.split('/')[4] || '';
        const postBody = el.querySelector('[slot="text-body"]')?.innerText || '';
        if (title) {
          items.push({ title, score, commentCount, permalink, postId, postBody });
        }
      });

      // Fallback: look for article/div-based posts
      if (items.length === 0) {
        document.querySelectorAll('[data-testid="post-container"], article').forEach(el => {
          const titleEl = el.querySelector('h3, h1');
          const title = titleEl?.innerText || '';
          const href = el.querySelector('a[data-click-id="body"]')?.getAttribute('href') || '';
          if (title) {
            items.push({ title, score: 0, commentCount: 0, permalink: href, postId: '', postBody: '' });
          }
        });
      }
      return items;
    });

    console.log(`Found ${rawPosts.length} posts via browser`);

    if (rawPosts.length < 5) {
      console.log('Too few posts from browser, falling back to JSON API');
      throw new Error('too few posts');
    }

    posts.push(...rawPosts);

  } catch (err) {
    // JSON API fallback
    console.log(`Using JSON API fallback for r/${sub}: ${err.message}`);
    try {
      const json = await fetchSubredditJSON(sub);
      const children = json?.data?.children || [];
      for (const child of children) {
        const d = child.data;
        if (!d || d.stickied) continue;
        posts.push({
          title: d.title,
          score: d.score || 0,
          commentCount: d.num_comments || 0,
          permalink: d.permalink,
          postId: d.id,
          postBody: d.selftext || '',
        });
      }
      console.log(`Got ${posts.length} posts via JSON API`);
    } catch (err2) {
      console.error(`JSON API also failed for r/${sub}: ${err2.message}`);
      await apiPost('/api/pain-points/scan-logs', {
        agentId: AGENT_ID,
        subreddit: `r/${sub}`,
        postsScanned: 0,
        painPointsFound: 0,
        status: 'error',
      });
      return;
    }
  }

  // Filter and analyze posts
  const eligible = posts.filter(p => p.score >= 5 || p.score === 0);
  postsScanned = eligible.length;
  console.log(`Analyzing ${postsScanned} eligible posts for pain points...`);

  // For promising posts, open and read body + comments
  const promising = eligible
    .filter(p => p.commentCount >= 10 && !p.postBody && p.permalink)
    .slice(0, 5); // Limit to 5 deep reads per subreddit

  for (const post of promising) {
    try {
      const url = post.permalink.startsWith('http') ? post.permalink : `https://www.reddit.com${post.permalink}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(2000);

      const detail = await page.evaluate(() => {
        const body = document.querySelector('[data-testid="post-content"] [data-click-id="text"]')?.innerText
          || document.querySelector('shreddit-post [slot="text-body"]')?.innerText
          || document.querySelector('.post-content')?.innerText
          || '';
        const comments = Array.from(document.querySelectorAll('shreddit-comment, [data-testid="comment"]'))
          .slice(0, 10)
          .map(el => el.querySelector('p, [slot="comment"]')?.innerText || '')
          .filter(Boolean);
        return { body, comments };
      });

      post.postBody = detail.body;
      post.topComments = detail.comments;
      await sleep(2000);

      // Navigate back
      await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(2000);
    } catch (e) {
      console.log(`Error reading post detail: ${e.message}`);
    }
  }

  // Analyze each post for pain points
  for (const post of eligible) {
    if (post.score < 5 && post.score !== 0) continue;

    const text = `${post.title} ${post.postBody || ''}`.toLowerCase();
    const comments = (post.topComments || []).join(' ').toLowerCase();
    const allText = text + ' ' + comments;

    // Pain point detection heuristics
    const painIndicators = [
      /\b(frustrat|annoying|annoys|hate|struggle|struggling|difficult|hard time|can'?t figure|can'?t find|no way to|wish there was|need a (tool|app|way)|is there (an?|any) (app|tool|way)|manually (track|doing|keep|log)|spending (too much time|hours)|overwhelm|exhausted|exhausting)\b/i,
      /\b(app for|tool for|software for|tracker for|way to track|how do you (manage|track|keep track|organize|plan))\b/i,
      /\b(too expensive|costs too much|can'?t afford|overpriced|better option|cheaper alternative|free version|paid (wall|subscription))\b/i,
      /\b(confusing|complicated|clunky|outdated|doesn'?t work|broken|missing (feature|option)|no (option|feature|setting))\b/i,
    ];

    const isPainPoint = painIndicators.some(rx => rx.test(allText));

    if (!isPainPoint) continue;
    if (post.commentCount < 3 && post.score < 20) continue;

    // Build pain point description
    const desc = [
      post.title,
      post.postBody ? post.postBody.slice(0, 300) : '',
    ].filter(Boolean).join(' — ').slice(0, 500);

    console.log(`  → Pain point: "${post.title.slice(0, 60)}..."`);

    try {
      const painPointRes = await apiPost('/api/pain-points', {
        title: post.title.slice(0, 80),
        description: `${desc.slice(0, 400)} (r/${sub}, ${post.commentCount} comments, ${post.score} upvotes)`,
        category,
        subreddit: `r/${sub}`,
        discoveredBy: AGENT_ID,
      });

      const painPointId = painPointRes?.id || painPointRes?.data?.id;
      console.log(`  → Created pain point ID: ${painPointId}`);

      if (painPointId) {
        const postId = post.postId || (post.permalink ? post.permalink.split('/')[4] : '');
        const redditUrl = post.permalink
          ? (post.permalink.startsWith('http') ? post.permalink : `https://reddit.com${post.permalink}`)
          : `https://reddit.com/r/${sub}`;

        await apiPost('/api/pain-points/posts', {
          painPointId,
          redditPostId: postId,
          redditUrl,
          postTitle: post.title,
          postBody: (post.postBody || '').slice(0, 2000),
          upvotes: post.score,
          commentCount: post.commentCount,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID,
        });
        console.log(`  → Linked source post`);
      }

      painPointsFound++;
    } catch (e) {
      console.error(`  → Failed to submit pain point: ${e.message}`);
    }
  }

  // Log scan results
  const logRes = await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${sub}`,
    postsScanned,
    painPointsFound,
    status: 'completed',
  });
  console.log(`r/${sub} scan logged: ${postsScanned} posts, ${painPointsFound} pain points. Log ID: ${logRes?.id || JSON.stringify(logRes)}`);

  return { sub, postsScanned, painPointsFound };
}

async function main() {
  console.log('Connecting to AdsPower via CDP...');
  const browser = await chromium.connectOverCDP(CDP_URL);
  console.log('Connected!');

  const context = browser.contexts()[0];
  const pages = context.pages();

  // Close extra tabs
  for (let i = 1; i < pages.length; i++) {
    await pages[i].close();
  }
  const page = pages[0] || await context.newPage();

  const results = [];
  let totalPosts = 0;
  let totalPainPoints = 0;

  for (const sub of SUBREDDITS) {
    const result = await scanSubreddit(page, sub);
    if (result) {
      results.push(result);
      totalPosts += result.postsScanned;
      totalPainPoints += result.painPointsFound;
    }
    // Pacing between subreddits
    await sleep(3000);
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${results.length}`);
  console.log(`Total posts analyzed: ${totalPosts}`);
  console.log(`Total pain points found: ${totalPainPoints}`);
  console.log('\nBreakdown:');
  for (const r of results) {
    console.log(`  r/${r.sub}: ${r.postsScanned} posts, ${r.painPointsFound} pain points`);
  }

  // Don't disconnect — admin agent closes the browser
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
