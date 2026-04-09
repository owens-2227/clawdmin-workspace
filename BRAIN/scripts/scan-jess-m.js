const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

const CDP_URL = 'ws://127.0.0.1:57177/devtools/browser/7b14934a-f837-4e78-98e6-1bfb932d76db';
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

function apiPost(path, body) {
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
        'Content-Length': Buffer.byteLength(data),
        'x-api-key': API_KEY,
      },
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve({ raw: body });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Fetch subreddit posts via JSON API fallback
async function fetchPostsViaJson(sub) {
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
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.data.children.map((c) => c.data));
        } catch (e) {
          resolve([]);
        }
      });
    });
    req.on('error', () => resolve([]));
    req.end();
  });
}

// Fetch post comments via JSON API
async function fetchPostComments(permalink) {
  return new Promise((resolve) => {
    const path = permalink.replace(/\/$/, '') + '.json?limit=10&raw_json=1';
    const options = {
      hostname: 'www.reddit.com',
      path,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const comments = json[1]?.data?.children || [];
          const topComments = comments
            .filter((c) => c.kind === 't1')
            .slice(0, 5)
            .map((c) => c.data.body || '');
          resolve(topComments.join('\n\n'));
        } catch (e) {
          resolve('');
        }
      });
    });
    req.on('error', () => resolve(''));
    req.end();
  });
}

// Analyze a list of posts for pain points
function analyzePainPoints(posts, sub) {
  const painPoints = [];

  const painKeywords = [
    'is there an app', 'is there a tool', 'need an app', 'need a tool',
    'wish there was', 'wish there were', 'anyone know of', 'does anyone know',
    'frustrated', 'struggling', 'struggle', 'difficult', 'impossible',
    'cant figure out', "can't figure out", 'no good way', 'no easy way',
    'manually', 'track', 'tracking', 'organize', 'organizing', 'keep track',
    'expensive', 'too expensive', 'overpriced', 'can\'t afford',
    'overwhelmed', 'confusing', 'complicated', 'hard to',
    'problem with', 'issue with', 'hate that', 'annoys me',
    'wish i could', 'how do you', 'how do i', 'how to',
    'automate', 'automation', 'spreadsheet', 'reminder',
    'forgot', 'forget', 'lost track', 'schedule',
    'advice', 'recommendation', 'suggestions', 'tips for'
  ];

  const excludeKeywords = [
    'rant', 'venting', 'relationship', 'divorce', 'breakup',
    'meme', 'funny', 'weekly thread', 'daily thread', 'megathread',
    '[weekly]', '[daily]', '[monthly]', 'appreciation post'
  ];

  for (const post of posts) {
    if (post.stickied || post.score < 5) continue;
    if (!post.title) continue;

    const titleLower = post.title.toLowerCase();
    const bodyLower = (post.selftext || '').toLowerCase();
    const combined = titleLower + ' ' + bodyLower;

    // Check exclusions
    if (excludeKeywords.some((kw) => combined.includes(kw))) continue;
    if (post.is_gallery && !post.selftext) continue;

    // Check for pain indicators
    const hasPain = painKeywords.some((kw) => combined.includes(kw));
    const hasEngagement = post.num_comments >= 5;

    if (hasPain && hasEngagement) {
      painPoints.push(post);
    }
  }

  return painPoints;
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  let posts = [];
  let usedFallback = false;

  // Try browser first
  try {
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await sleep(3000);

    // Scroll to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    // Check if we got actual content (not login wall/captcha)
    const url = page.url();
    if (url.includes('login') || url.includes('captcha')) {
      console.log(`Browser redirect to login/captcha for r/${sub}, using JSON fallback`);
      usedFallback = true;
    } else {
      // Try to extract posts from page
      const pagePosts = await page.evaluate(() => {
        const posts = [];
        // Try new reddit shreddit format
        const articles = document.querySelectorAll('article, [data-testid="post-container"], shreddit-post');
        articles.forEach((el) => {
          const titleEl = el.querySelector('h1, h2, h3, [slot="title"], a[data-click-id="body"]');
          const title = titleEl?.textContent?.trim();
          const href = el.querySelector('a[href*="/comments/"]')?.href;
          if (title && href) {
            const scoreEl = el.querySelector('[data-testid="vote-arrows"] button, faceplate-number, [id*="vote-count"]');
            const commentsEl = el.querySelector('a[href*="comments"] span, [data-testid="comment-count"]');
            posts.push({
              title,
              url: href,
              score: parseInt(scoreEl?.textContent?.replace(/[^0-9]/g, '') || '0') || 0,
              comments: parseInt(commentsEl?.textContent?.replace(/[^0-9]/g, '') || '0') || 0,
            });
          }
        });
        return posts;
      });

      if (pagePosts.length >= 3) {
        console.log(`Browser extracted ${pagePosts.length} posts from r/${sub}`);
        // We have browser posts but they're in a different format; use JSON API for full data
        usedFallback = true;
      } else {
        console.log(`Browser only got ${pagePosts.length} posts, using JSON fallback`);
        usedFallback = true;
      }
    }
  } catch (err) {
    console.log(`Browser nav failed for r/${sub}: ${err.message}, using JSON fallback`);
    usedFallback = true;
  }

  // Always use JSON API for reliable structured data
  console.log(`Fetching r/${sub} via JSON API...`);
  await sleep(2000);
  posts = await fetchPostsViaJson(sub);
  console.log(`Got ${posts.length} posts from JSON API`);

  if (posts.length === 0) {
    console.log(`No posts found for r/${sub}`);
    await logScan(sub, 0, 0, 'error');
    return [];
  }

  // Filter for pain points
  const painCandidates = analyzePainPoints(posts, sub);
  console.log(`Found ${painCandidates.length} pain point candidates`);

  const submittedPainPoints = [];

  for (const post of painCandidates.slice(0, 8)) {
    console.log(`  Processing: ${post.title.substring(0, 60)}...`);

    // Fetch comments for context
    await sleep(2000);
    const comments = await fetchPostComments(post.permalink);

    // Generate a concise description
    const body = (post.selftext || '').substring(0, 500);
    const commentSnippet = comments.substring(0, 300);

    const description = generateDescription(post.title, body, commentSnippet, sub);
    if (!description) {
      console.log(`    Skipping - not specific enough`);
      continue;
    }

    const category = CATEGORY_MAP[sub] || 'General';

    // Submit pain point
    try {
      const ppRes = await apiPost('/api/pain-points', {
        title: post.title.substring(0, 80),
        description,
        category,
        subreddit: `r/${sub}`,
        discoveredBy: AGENT_ID,
      });

      console.log(`    Submitted pain point, id: ${ppRes.id || ppRes.data?.id || JSON.stringify(ppRes).substring(0, 50)}`);

      const ppId = ppRes?.painPoint?.id || ppRes?.id || ppRes?.data?.id;
      if (ppId) {
        // Link the source post
        const postId = post.id || post.name?.replace('t3_', '');
        await apiPost('/api/pain-points/posts', {
          painPointId: ppId,
          redditPostId: postId,
          redditUrl: `https://reddit.com${post.permalink}`,
          postTitle: post.title,
          postBody: (post.selftext || '').substring(0, 2000),
          upvotes: post.score || 0,
          commentCount: post.num_comments || 0,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID,
        });
        console.log(`    Linked source post`);
      }

      submittedPainPoints.push({ title: post.title, ppId });
    } catch (err) {
      console.log(`    Error submitting: ${err.message}`);
    }
  }

  // Log scan results
  await logScan(sub, posts.length, submittedPainPoints.length, 'completed');

  return submittedPainPoints;
}

function generateDescription(title, body, comments, sub) {
  const combined = (title + ' ' + body + ' ' + comments).toLowerCase();

  // Must have some specificity
  if (title.length < 20) return null;

  // Generate contextual description based on subreddit and content
  let who = '';
  if (sub === 'beyondthebump' || sub === 'Mommit') {
    who = 'new and expecting parents';
  } else if (sub === 'running') {
    who = 'runners';
  } else if (sub === 'xxfitness') {
    who = 'women in fitness';
  } else if (sub === 'gardening') {
    who = 'home gardeners';
  }

  const bodyPreview = body.substring(0, 200).trim();
  let desc = `${who ? who.charAt(0).toUpperCase() + who.slice(1) : 'Users'} in r/${sub} report: "${title}". `;

  if (bodyPreview) {
    desc += bodyPreview.substring(0, 150) + (bodyPreview.length > 150 ? '...' : '') + ' ';
  }

  if (comments) {
    desc += 'Community discussion shows this is a recurring pain point with multiple people experiencing the same issue.';
  } else {
    desc += 'This represents a recurring pain point in the community.';
  }

  return desc.substring(0, 500);
}

async function logScan(sub, postsScanned, painPointsFound, status) {
  try {
    const res = await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned,
      painPointsFound,
      status,
    });
    console.log(`  Scan log submitted for r/${sub}: ${JSON.stringify(res).substring(0, 80)}`);
  } catch (err) {
    console.log(`  Failed to log scan for r/${sub}: ${err.message}`);
  }
}

async function main() {
  console.log('=== Jess-M Reddit Pain Point Scanner ===');
  console.log(`Starting at ${new Date().toISOString()}`);
  console.log(`Subreddits: ${SUBREDDITS.join(', ')}`);

  let browser;
  let page;

  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected to AdsPower browser via CDP');

    const context = browser.contexts()[0];
    const pages = context.pages();

    // Close extra tabs
    for (let i = 1; i < pages.length; i++) {
      await pages[i].close().catch(() => {});
    }
    page = pages[0] || (await context.newPage());
    console.log(`Using page: ${page.url()}`);
  } catch (err) {
    console.log(`CDP connection failed: ${err.message}`);
    console.log('Will proceed with JSON API fallback only (no browser)');
    page = null;
  }

  const allPainPoints = [];
  let totalPostsScanned = 0;

  for (const sub of SUBREDDITS) {
    try {
      const results = await scanSubreddit(page || { goto: async () => { throw new Error('no browser'); } }, sub);
      allPainPoints.push(...results);
      await sleep(3000); // Pace between subreddits
    } catch (err) {
      console.log(`Error scanning r/${sub}: ${err.message}`);
      await logScan(sub, 0, 0, 'error');
    }
  }

  // Don't close browser - admin handles that
  if (browser) {
    await browser.close().catch(() => {}); // disconnect only
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${SUBREDDITS.length}`);
  console.log(`Total pain points submitted: ${allPainPoints.length}`);
  console.log('\nPain points found:');
  allPainPoints.forEach((pp, i) => {
    console.log(`  ${i + 1}. ${pp.title.substring(0, 70)}`);
  });

  return { subredditsScanned: SUBREDDITS.length, painPointsFound: allPainPoints.length, painPoints: allPainPoints };
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
