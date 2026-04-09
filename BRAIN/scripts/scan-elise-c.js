const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

const CDP_URL = 'ws://127.0.0.1:50997/devtools/browser/26ff073c-1e59-4165-96bb-cec09fb55f7f';
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
    const opts = {
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
    const req = http.request(opts, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function fetchSubredditJSON(sub) {
  return new Promise((resolve, reject) => {
    const url = `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`;
    const opts = {
      hostname: 'www.reddit.com',
      path: `/r/${sub}/hot.json?limit=25&raw_json=1`,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    };
    https.get(opts, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function scanSubredditViaBrowser(page, sub) {
  console.log(`\n📌 Scanning r/${sub} via browser...`);
  const posts = [];
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

    // Try to extract post data from page
    const postData = await page.evaluate(() => {
      const results = [];
      // Try shreddit-post elements
      const shredditPosts = document.querySelectorAll('shreddit-post');
      if (shredditPosts.length > 0) {
        shredditPosts.forEach((el) => {
          const title = el.getAttribute('post-title') || el.querySelector('[slot="title"]')?.textContent?.trim() || '';
          const score = parseInt(el.getAttribute('score') || '0', 10);
          const comments = parseInt(el.getAttribute('comment-count') || '0', 10);
          const permalink = el.getAttribute('permalink') || '';
          const postId = el.getAttribute('id') || '';
          if (title && score >= 5) {
            results.push({ title, score, comments, permalink, postId });
          }
        });
        return results;
      }
      // Fallback: look for old-reddit style posts
      const oldPosts = document.querySelectorAll('.thing.link');
      oldPosts.forEach((el) => {
        const titleEl = el.querySelector('a.title');
        const score = parseInt(el.querySelector('.score.unvoted')?.getAttribute('title') || '0', 10);
        const commentsEl = el.querySelector('a.comments');
        const comments = parseInt(commentsEl?.textContent?.match(/\d+/)?.[0] || '0', 10);
        const permalink = el.getAttribute('data-permalink') || '';
        const postId = el.getAttribute('data-fullname') || '';
        if (titleEl && score >= 5) {
          results.push({ title: titleEl.textContent.trim(), score, comments, permalink, postId });
        }
      });
      return results;
    });

    console.log(`  Found ${postData.length} posts via browser DOM`);
    return postData;
  } catch (err) {
    console.log(`  Browser scan failed for r/${sub}: ${err.message}`);
    return [];
  }
}

async function scanSubredditViaJSON(sub) {
  console.log(`  Trying JSON fallback for r/${sub}...`);
  try {
    const data = await fetchSubredditJSON(sub);
    if (!data?.data?.children) return [];
    return data.data.children
      .map((c) => c.data)
      .filter((p) => !p.stickied && p.score >= 5)
      .map((p) => ({
        title: p.title,
        score: p.score,
        comments: p.num_comments,
        permalink: p.permalink,
        postId: p.id,
        selftext: p.selftext || '',
        url: p.url,
      }));
  } catch (err) {
    console.log(`  JSON fallback failed: ${err.message}`);
    return [];
  }
}

function analyzePainPoints(posts, sub) {
  const painKeywords = [
    /\b(frustrated?|frustrating)\b/i,
    /\b(struggling?|struggle)\b/i,
    /\b(can't find|can not find|cannot find)\b/i,
    /\bneed.*(app|tool|way|solution|help)\b/i,
    /\bis there.*(app|tool|way|something)\b/i,
    /\b(app|tool) for\b/i,
    /\bhow do (i|you|we)\b/i,
    /\bwhy is.*(so hard|so difficult|so expensive|so complicated)\b/i,
    /\b(wish|wishlist|want)\b.*\b(app|tool|feature|option|exist)\b/i,
    /\b(manually|by hand)\b/i,
    /\bkeep track\b/i,
    /\borganize|organising\b/i,
    /\bexpensive|overpriced|cost too much\b/i,
    /\btoo complex|too complicated|too hard\b/i,
    /\bno (good |)option\b/i,
    /\banyone else deal\b/i,
    /\bhelp me\b/i,
    /\badvice|recommend\b/i,
    /\bwhat do you use\b/i,
  ];

  const painPoints = [];
  for (const post of posts) {
    const text = `${post.title} ${post.selftext || ''}`;
    const matchCount = painKeywords.filter((rx) => rx.test(text)).length;
    if (matchCount >= 1 && post.comments >= 5) {
      painPoints.push(post);
    }
  }
  return painPoints;
}

function buildPainPointPayload(post, sub) {
  const title = post.title.slice(0, 80);
  const desc = post.selftext
    ? `${post.selftext.slice(0, 300).replace(/\n/g, ' ')}...`
    : `Community members in r/${sub} are discussing: "${post.title}" (${post.score} upvotes, ${post.comments} comments).`;
  return {
    title,
    description: desc.slice(0, 500),
    category: CATEGORY_MAP[sub] || 'General',
    subreddit: `r/${sub}`,
    discoveredBy: AGENT_ID,
  };
}

async function submitPainPoint(post, sub) {
  try {
    const payload = buildPainPointPayload(post, sub);
    console.log(`    → Submitting: "${payload.title}"`);
    const result = await apiPost('/api/pain-points', payload);
    const painPointId = result?.id || result?.data?.id;
    if (!painPointId) {
      console.log(`    ⚠️  No ID in response:`, JSON.stringify(result).slice(0, 200));
      return null;
    }

    const redditUrl = post.permalink
      ? `https://reddit.com${post.permalink}`
      : `https://reddit.com/r/${sub}`;

    const sourcePayload = {
      painPointId,
      redditPostId: post.postId || post.id || '',
      redditUrl,
      postTitle: post.title,
      postBody: (post.selftext || '').slice(0, 2000),
      upvotes: post.score || 0,
      commentCount: post.comments || 0,
      subreddit: `r/${sub}`,
      discoveredBy: AGENT_ID,
    };
    await apiPost('/api/pain-points/posts', sourcePayload);
    console.log(`    ✅ Submitted pain point ID: ${painPointId}`);
    return painPointId;
  } catch (err) {
    console.log(`    ❌ Submit error: ${err.message}`);
    return null;
  }
}

async function logScan(sub, postsScanned, painPointsFound, status = 'completed') {
  try {
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned,
      painPointsFound,
      status,
    });
    console.log(`  📝 Logged scan for r/${sub}: ${postsScanned} posts, ${painPointsFound} pain points`);
  } catch (err) {
    console.log(`  ⚠️  Log error: ${err.message}`);
  }
}

async function main() {
  console.log('🚀 Starting elise-c scan session');
  console.log(`Subreddits: ${SUBREDDITS.join(', ')}`);

  let browser;
  let page;

  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('✅ Connected to AdsPower browser via CDP');
    const context = browser.contexts()[0];
    const pages = context.pages();
    for (let i = 1; i < pages.length; i++) await pages[i].close();
    page = pages[0] || await context.newPage();
  } catch (err) {
    console.log(`⚠️  CDP connect failed: ${err.message}. Will use JSON API fallback only.`);
  }

  const summary = {
    subredditsScanned: 0,
    totalPostsAnalyzed: 0,
    painPointsFound: [],
    errors: [],
  };

  for (const sub of SUBREDDITS) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📌 r/${sub}`);
    let posts = [];

    // Try browser first, fall back to JSON
    if (page) {
      posts = await scanSubredditViaBrowser(page, sub);
    }
    if (posts.length < 5) {
      const jsonPosts = await scanSubredditViaJSON(sub);
      if (jsonPosts.length > posts.length) {
        posts = jsonPosts;
        console.log(`  Using JSON results: ${posts.length} posts`);
      }
    }

    console.log(`  Total posts: ${posts.length}`);
    const painPosts = analyzePainPoints(posts, sub);
    console.log(`  Pain points identified: ${painPosts.length}`);

    let submitted = 0;
    for (const post of painPosts.slice(0, 5)) { // cap at 5 per sub
      await sleep(1000);
      const id = await submitPainPoint(post, sub);
      if (id) {
        submitted++;
        summary.painPointsFound.push(`r/${sub}: ${post.title.slice(0, 60)}`);
      }
    }

    await logScan(sub, posts.length, submitted);
    summary.subredditsScanned++;
    summary.totalPostsAnalyzed += posts.length;
    await sleep(2000);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('✅ Scan complete!');
  console.log(`Subreddits scanned: ${summary.subredditsScanned}`);
  console.log(`Total posts analyzed: ${summary.totalPostsAnalyzed}`);
  console.log(`Pain points submitted: ${summary.painPointsFound.length}`);
  if (summary.painPointsFound.length > 0) {
    console.log('\nPain points found:');
    summary.painPointsFound.forEach((p) => console.log(`  - ${p}`));
  }
  if (summary.errors.length > 0) {
    console.log('\nErrors:');
    summary.errors.forEach((e) => console.log(`  - ${e}`));
  }

  // Don't close browser — admin handles that
  if (browser) {
    try { await browser.close(); } catch {}
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
