const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

const CDP_URL = 'ws://127.0.0.1:49810/devtools/browser/c8df64ed-d30c-4d72-84be-197d79bfe759';
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
      res.on('data', (chunk) => raw += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch(e) { resolve(raw); }
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
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => raw += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  const category = CATEGORY_MAP[sub] || 'General';
  let postsScanned = 0;
  let painPointsFound = 0;
  const posts = [];

  // Try browser approach first
  try {
    console.log(`Navigating to https://www.reddit.com/r/${sub}/hot/`);
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    // Scroll to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    // Check if we got redirected to login or captcha
    const url = page.url();
    console.log(`Current URL: ${url}`);
    if (url.includes('login') || url.includes('captcha')) {
      throw new Error(`Blocked: ${url}`);
    }

    // Try to grab post data from the page
    const pageTitle = await page.title();
    console.log(`Page title: ${pageTitle}`);

    // Use snapshot to read posts
    const snapshot = await page.accessibility.snapshot({ interestingOnly: false });
    const snapshotStr = JSON.stringify(snapshot || {});
    console.log(`Snapshot length: ${snapshotStr.length} chars`);

    // Check if we actually have Reddit content or just a blank page
    if (snapshotStr.length < 1000) {
      throw new Error('Page appears blank or minimal, falling back to JSON API');
    }

    // Try to extract post titles from the page
    const postData = await page.evaluate(() => {
      const results = [];
      // Try new shreddit format
      const shredditPosts = document.querySelectorAll('shreddit-post');
      shredditPosts.forEach(el => {
        const title = el.getAttribute('post-title') || el.querySelector('h3')?.textContent?.trim() || '';
        const score = parseInt(el.getAttribute('score') || '0');
        const commentCount = parseInt(el.getAttribute('comment-count') || '0');
        const permalink = el.getAttribute('permalink') || '';
        const id = el.getAttribute('id') || permalink.split('/')[6] || '';
        if (title) results.push({ title, score, commentCount, permalink, id });
      });

      if (results.length === 0) {
        // Try old Reddit format
        const oldPosts = document.querySelectorAll('.thing.link');
        oldPosts.forEach(el => {
          const titleEl = el.querySelector('a.title');
          const title = titleEl?.textContent?.trim() || '';
          const scoreEl = el.querySelector('.score.unvoted, .score.likes, .score.dislikes');
          const score = parseInt(scoreEl?.getAttribute('title') || '0');
          const commentsEl = el.querySelector('.comments');
          const commentText = commentsEl?.textContent?.trim() || '0 comments';
          const commentCount = parseInt(commentText);
          const permalink = el.getAttribute('data-permalink') || '';
          const id = el.getAttribute('data-fullname') || '';
          if (title) results.push({ title, score, commentCount, permalink, id });
        });
      }

      if (results.length === 0) {
        // Try generic article/h3 approach
        const articles = document.querySelectorAll('article, [data-testid="post-container"]');
        articles.forEach(el => {
          const titleEl = el.querySelector('h3, h1');
          const title = titleEl?.textContent?.trim() || '';
          if (title && title.length > 5) {
            results.push({ title, score: 0, commentCount: 0, permalink: '', id: '' });
          }
        });
      }

      return results;
    });

    console.log(`Found ${postData.length} posts via browser`);

    if (postData.length >= 5) {
      posts.push(...postData);
    } else {
      throw new Error('Too few posts found via browser, falling back to JSON API');
    }
  } catch (err) {
    console.log(`Browser approach issue: ${err.message}. Using JSON API fallback.`);
    // Fallback: Reddit JSON API
    try {
      const json = await fetchSubredditJson(sub);
      if (json.data && json.data.children) {
        json.data.children.forEach(child => {
          const d = child.data;
          if (!d.stickied && d.score >= 5) {
            posts.push({
              title: d.title,
              score: d.score,
              commentCount: d.num_comments,
              permalink: d.permalink,
              id: d.id,
              selftext: d.selftext || '',
              url: d.url,
            });
          }
        });
        console.log(`Got ${posts.length} posts via JSON API`);
      }
    } catch (apiErr) {
      console.error(`JSON API also failed: ${apiErr.message}`);
    }
  }

  postsScanned = posts.length;
  console.log(`Total posts to analyze: ${postsScanned}`);

  // Analyze posts for pain points
  const painPointCandidates = [];

  for (const post of posts) {
    const title = post.title || '';
    const score = post.score || 0;
    const commentCount = post.commentCount || 0;
    const selftext = post.selftext || '';

    // Skip low-engagement posts
    if (score < 5 && commentCount < 3) continue;

    // Pain point indicators
    const titleLower = title.toLowerCase();
    const textLower = selftext.toLowerCase();
    const combined = titleLower + ' ' + textLower;

    const isPainPoint =
      // Asking for tool/app/solution
      /is there (an? )?(app|tool|way|service|software|website|plugin|extension|bot|script|method)/i.test(combined) ||
      /looking for (an? )?(app|tool|way|service|software)/i.test(combined) ||
      /recommend (an? )?(app|tool|software|service)/i.test(combined) ||
      /best (app|tool|software|service|way) (to|for)/i.test(combined) ||
      // Frustration/problem signals
      /frustrated|annoying|struggling|can't figure out|don't know how|confused by|overwhelmed/i.test(combined) ||
      /wish (there was|i could|i had|someone would)/i.test(combined) ||
      /why (is it|doesn't|can't|isn't|aren't|won't)/i.test(combined) ||
      /hate (that|when|how)/i.test(combined) ||
      // Process/automation
      /manually (track|log|enter|update|do)/i.test(combined) ||
      /spreadsheet|keeping track|hard to track|no easy way/i.test(combined) ||
      /automat|streamline|simplif/i.test(combined) ||
      // Help/advice seeking with underlying problem
      /how do (i|you|we) (deal with|handle|manage|track|budget|plan|organize)/i.test(combined) ||
      /any tips|any advice|any suggestions/i.test(combined) ||
      // Cost complaints
      /too expensive|can't afford|cost too much|cheaper alternative/i.test(combined) ||
      /fee.*high|subscription.*expensive|pricing.*ridiculous/i.test(combined);

    if (isPainPoint && title.length > 10) {
      painPointCandidates.push(post);
    }
  }

  console.log(`Pain point candidates: ${painPointCandidates.length}`);

  // Submit top pain points (limit to 5 per subreddit to be thorough but not spammy)
  const toSubmit = painPointCandidates.slice(0, 5);

  for (const post of toSubmit) {
    const title = post.title.slice(0, 80);
    const selftext = post.selftext || '';
    const description = selftext
      ? `${selftext.slice(0, 200).replace(/\n/g, ' ')}... (from r/${sub} with ${post.score} upvotes and ${post.commentCount} comments)`
      : `Reddit post asking about or experiencing a problem: "${post.title}" — posted in r/${sub} with ${post.score} upvotes and ${post.commentCount} comments.`;

    const redditUrl = post.permalink
      ? `https://reddit.com${post.permalink}`
      : `https://reddit.com/r/${sub}`;
    const postId = post.id || post.permalink?.split('/')[6] || 'unknown';

    try {
      console.log(`Submitting pain point: "${title}"`);
      const ppResult = await apiPost('/api/pain-points', {
        title,
        description: description.slice(0, 400),
        category,
        subreddit: `r/${sub}`,
        discoveredBy: AGENT_ID,
      });
      console.log(`Pain point created:`, JSON.stringify(ppResult).slice(0, 200));

      const ppId = ppResult?.id || ppResult?.data?.id;
      if (ppId) {
        const postResult = await apiPost('/api/pain-points/posts', {
          painPointId: ppId,
          redditPostId: postId,
          redditUrl,
          postTitle: post.title,
          postBody: selftext.slice(0, 2000),
          upvotes: post.score || 0,
          commentCount: post.commentCount || 0,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID,
        });
        console.log(`Post linked:`, JSON.stringify(postResult).slice(0, 100));
      }
      painPointsFound++;
    } catch (err) {
      console.error(`Failed to submit pain point: ${err.message}`);
    }

    await sleep(500);
  }

  // Log scan results
  try {
    const logResult = await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned,
      painPointsFound,
      status: 'completed',
    });
    console.log(`Scan log submitted:`, JSON.stringify(logResult).slice(0, 100));
  } catch (err) {
    console.error(`Failed to log scan: ${err.message}`);
  }

  return { sub, postsScanned, painPointsFound };
}

async function main() {
  console.log('Connecting to AdsPower browser via CDP...');
  console.log(`CDP URL: ${CDP_URL}`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL, { timeout: 30000 });
    console.log('Connected!');
  } catch (err) {
    console.error(`Failed to connect via CDP: ${err.message}`);
    console.log('Will proceed with JSON API fallback for all subreddits...');
  }

  let page;
  if (browser) {
    try {
      const context = browser.contexts()[0] || await browser.newContext();
      const pages = context.pages();
      // Close extra tabs
      for (let i = 1; i < pages.length; i++) {
        try { await pages[i].close(); } catch(e) {}
      }
      page = pages[0] || await context.newPage();
      console.log(`Using page: ${page.url()}`);
    } catch (err) {
      console.error(`Error setting up page: ${err.message}`);
    }
  }

  const results = [];

  for (const sub of SUBREDDITS) {
    try {
      const result = await scanSubreddit(page, sub);
      results.push(result);
    } catch (err) {
      console.error(`Error scanning r/${sub}: ${err.message}`);
      // Log as error
      try {
        await apiPost('/api/pain-points/scan-logs', {
          agentId: AGENT_ID,
          subreddit: `r/${sub}`,
          postsScanned: 0,
          painPointsFound: 0,
          status: 'error',
        });
      } catch(e) {}
      results.push({ sub, postsScanned: 0, painPointsFound: 0, error: err.message });
    }
    await sleep(3000);
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log('Results summary:');
  let totalPosts = 0;
  let totalPainPoints = 0;
  for (const r of results) {
    console.log(`  r/${r.sub}: ${r.postsScanned} posts scanned, ${r.painPointsFound} pain points found${r.error ? ` (ERROR: ${r.error})` : ''}`);
    totalPosts += r.postsScanned || 0;
    totalPainPoints += r.painPointsFound || 0;
  }
  console.log(`TOTAL: ${totalPosts} posts, ${totalPainPoints} pain points`);

  // Don't close browser — admin handles that
  if (browser) {
    try { await browser.close(); } catch(e) {
      // Ignore close errors — profile managed by admin
    }
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
