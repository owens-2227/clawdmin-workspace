const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

const CDP_URL = 'ws://127.0.0.1:61872/devtools/browser/caa1bc0d-595c-4f14-85fa-17c451603dc9';
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

function apiPost(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
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
        try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchRedditJson(sub) {
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
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function isPainPoint(post) {
  if (!post.title) return false;
  if (post.stickied) return false;
  if ((post.score || 0) < 5) return false;

  const text = (post.title + ' ' + (post.selftext || '')).toLowerCase();
  const painIndicators = [
    'how do i', 'how do you', 'is there an app', 'is there a tool', 'is there a way',
    'does anyone know', 'struggling with', 'frustrated', 'frustrating', 'annoying',
    'problem with', 'issue with', 'help me', 'need help', 'anyone else',
    'wish there was', 'wish i could', 'can\'t find', 'can\'t figure out',
    'manually', 'too expensive', 'too complicated', 'hard to', 'difficult to',
    'confusing', 'pain point', 'workaround', 'spreadsheet', 'track', 'manage',
    'organize', 'automate', 'tired of', 'sick of', 'hate when', 'anyone have',
    'advice', 'recommendation', 'suggest', 'alternative to', 'better way',
    'keeps dying', 'won\'t eat', 'refusing', 'not eating', 'blood glucose',
    'insulin', 'dosing', 'remission', 'monitor', 'glucose', 'diagnosis',
    'raw food', 'feeding', 'transition', 'recipe', 'balance', 'supplement',
    'thrift', 'find', 'score', 'haul', 'resell', 'flip', 'pricing',
    'weed', 'lawn', 'grass', 'brown', 'dying', 'fertilizer', 'pest', 'fungus',
    'budget meal', 'cheap', 'meal prep', 'nutrition', 'calories', 'protein',
  ];
  
  return painIndicators.some((kw) => text.includes(kw));
}

function buildPainPointTitle(post) {
  // Truncate to 80 chars
  let title = post.title;
  if (title.length > 80) title = title.substring(0, 77) + '...';
  return title;
}

function buildDescription(post) {
  const body = post.selftext ? post.selftext.substring(0, 300) : '';
  let desc = `Reddit post in r/${post.subreddit} (${post.score} upvotes, ${post.num_comments} comments). `;
  if (body) desc += `Post body: "${body.replace(/\n+/g, ' ').trim()}"`;
  else desc += 'Image/link post — title captures the problem.';
  if (desc.length > 500) desc = desc.substring(0, 497) + '...';
  return desc;
}

async function scanSubredditWithBrowser(page, sub) {
  console.log(`\n[${sub}] Navigating via browser...`);
  const posts = [];

  try {
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await sleep(3000);

    // Check for CAPTCHA/login wall
    const url = page.url();
    if (url.includes('login') || url.includes('captcha')) {
      console.log(`[${sub}] Hit login/captcha wall, falling back to JSON API`);
      return null;
    }

    // Scroll to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    // Try to read post data from the page
    const pageContent = await page.content();
    
    // Check if it looks like Reddit new UI (shreddit)
    const isShreddit = pageContent.includes('shreddit-post') || pageContent.includes('faceplate-');
    
    if (isShreddit) {
      // Parse shreddit posts
      const postData = await page.evaluate(() => {
        const items = document.querySelectorAll('shreddit-post');
        return Array.from(items).map((el) => ({
          id: el.getAttribute('id') || el.getAttribute('name') || '',
          title: el.getAttribute('post-title') || el.querySelector('h3')?.textContent?.trim() || '',
          score: parseInt(el.getAttribute('score') || '0'),
          commentCount: parseInt(el.getAttribute('comment-count') || '0'),
          permalink: el.getAttribute('permalink') || '',
          subreddit: el.getAttribute('subreddit-prefixed-name') || '',
          stickied: el.getAttribute('stickied') === 'true',
          selftext: '',
        }));
      });
      console.log(`[${sub}] Found ${postData.length} posts via shreddit parser`);
      return postData;
    }
    
    // Try old Reddit style
    const oldRedditPosts = await page.evaluate(() => {
      const items = document.querySelectorAll('.thing.link');
      return Array.from(items).map((el) => ({
        id: el.getAttribute('data-fullname') || '',
        title: el.querySelector('a.title')?.textContent?.trim() || '',
        score: parseInt(el.getAttribute('data-score') || '0'),
        commentCount: parseInt(el.querySelector('.comments')?.textContent?.match(/\d+/)?.[0] || '0'),
        permalink: el.getAttribute('data-permalink') || '',
        subreddit: el.getAttribute('data-subreddit') || sub,
        stickied: el.classList.contains('stickied'),
        selftext: '',
      }));
    });
    
    if (oldRedditPosts.length > 0) {
      console.log(`[${sub}] Found ${oldRedditPosts.length} posts via old Reddit parser`);
      return oldRedditPosts;
    }

    console.log(`[${sub}] Browser parsing returned 0 posts, falling back to JSON API`);
    return null;
  } catch (err) {
    console.log(`[${sub}] Browser error: ${err.message}, falling back to JSON API`);
    return null;
  }
}

async function scanSubredditJson(sub) {
  console.log(`[${sub}] Using JSON API fallback...`);
  try {
    const data = await fetchRedditJson(sub);
    if (!data || !data.data || !data.data.children) {
      console.log(`[${sub}] JSON API returned unexpected format`);
      return [];
    }
    const posts = data.data.children.map((c) => ({
      id: c.data.id,
      title: c.data.title,
      score: c.data.score,
      num_comments: c.data.num_comments,
      commentCount: c.data.num_comments,
      permalink: c.data.permalink,
      subreddit: c.data.subreddit,
      stickied: c.data.stickied,
      selftext: c.data.selftext || '',
      url: c.data.url,
    }));
    console.log(`[${sub}] JSON API returned ${posts.length} posts`);
    return posts;
  } catch (err) {
    console.log(`[${sub}] JSON API error: ${err.message}`);
    return [];
  }
}

async function main() {
  console.log('Starting Reddit scan as elise-c');
  console.log('Connecting to CDP:', CDP_URL);

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected to browser');
  } catch (err) {
    console.error('Failed to connect to CDP:', err.message);
    // Fall back to JSON-only mode
    browser = null;
  }

  let page = null;
  if (browser) {
    try {
      const context = browser.contexts()[0];
      const pages = context.pages();
      for (let i = 1; i < pages.length; i++) await pages[i].close();
      page = pages[0] || (await context.newPage());
      console.log('Got page, current URL:', page.url());
    } catch (err) {
      console.log('Error setting up page:', err.message);
      page = null;
    }
  }

  const totalResults = {
    subredditsScanned: 0,
    totalPostsAnalyzed: 0,
    painPointsFound: [],
    errors: [],
  };

  for (const sub of SUBREDDITS) {
    console.log(`\n========== Scanning r/${sub} ==========`);
    let posts = [];
    let usedBrowser = false;

    // Try browser first, fall back to JSON
    if (page) {
      const browserPosts = await scanSubredditWithBrowser(page, sub);
      if (browserPosts && browserPosts.length > 0) {
        posts = browserPosts;
        usedBrowser = true;
      }
    }

    if (!usedBrowser || posts.length === 0) {
      posts = await scanSubredditJson(sub);
    }

    if (posts.length === 0) {
      console.log(`[${sub}] No posts found, logging as error`);
      totalResults.errors.push(`${sub}: no posts retrieved`);
      await apiPost('/api/pain-points/scan-logs', {
        agentId: AGENT_ID,
        subreddit: `r/${sub}`,
        postsScanned: 0,
        painPointsFound: 0,
        status: 'error',
      });
      continue;
    }

    // Filter for pain points
    const painPosts = posts.filter(isPainPoint);
    console.log(`[${sub}] ${posts.length} posts scanned, ${painPosts.length} pain points identified`);

    totalResults.subredditsScanned++;
    totalResults.totalPostsAnalyzed += posts.length;

    const category = CATEGORY_MAP[sub] || 'General';
    let painPointsSubmitted = 0;

    for (const post of painPosts.slice(0, 5)) { // Cap at 5 per subreddit
      try {
        const title = buildPainPointTitle(post);
        const description = buildDescription(post);
        const redditUrl = post.permalink
          ? `https://reddit.com${post.permalink}`
          : `https://reddit.com/r/${sub}`;

        // Create pain point
        const ppResp = await apiPost('/api/pain-points', {
          title,
          description,
          category,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID,
        });

        const ppId = ppResp?.id || ppResp?.data?.id;
        console.log(`  [PP Created] id=${ppId} title="${title}"`);

        if (ppId) {
          // Link source post
          await apiPost('/api/pain-points/posts', {
            painPointId: ppId,
            redditPostId: post.id || '',
            redditUrl,
            postTitle: post.title || '',
            postBody: (post.selftext || '').substring(0, 2000),
            upvotes: post.score || 0,
            commentCount: post.commentCount || post.num_comments || 0,
            subreddit: `r/${sub}`,
            discoveredBy: AGENT_ID,
          });
          console.log(`  [PP Linked] source post linked`);
        }

        totalResults.painPointsFound.push(title);
        painPointsSubmitted++;
        await sleep(500);
      } catch (err) {
        console.log(`  [PP Error] ${err.message}`);
        totalResults.errors.push(`${sub} post submission: ${err.message}`);
      }
    }

    // Log scan result for this subreddit
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned: posts.length,
      painPointsFound: painPointsSubmitted,
      status: 'completed',
    });
    console.log(`[${sub}] Scan log submitted. ${painPointsSubmitted} pain points submitted.`);

    await sleep(2000); // Pace between subreddits
  }

  // Summary
  console.log('\n========== SCAN COMPLETE ==========');
  console.log(`Subreddits scanned: ${totalResults.subredditsScanned}`);
  console.log(`Total posts analyzed: ${totalResults.totalPostsAnalyzed}`);
  console.log(`Pain points found: ${totalResults.painPointsFound.length}`);
  totalResults.painPointsFound.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
  if (totalResults.errors.length) {
    console.log(`Errors: ${totalResults.errors.length}`);
    totalResults.errors.forEach((e) => console.log(`  - ${e}`));
  }

  return totalResults;
}

main().then((results) => {
  console.log('\nFinal results:', JSON.stringify(results, null, 2));
  process.exit(0);
}).catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
