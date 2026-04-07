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

async function fetchRedditJSON(sub) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.reddit.com',
      path: `/r/${sub}/hot.json?limit=25&raw_json=1`,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
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

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  const category = CATEGORY_MAP[sub] || 'General';
  let posts = [];
  let usedFallback = false;

  // Try browser approach first
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

    // Try to extract posts via browser
    const extracted = await page.evaluate(() => {
      const results = [];
      // Try shreddit-post elements
      const postEls = document.querySelectorAll('shreddit-post');
      if (postEls.length > 0) {
        postEls.forEach((el) => {
          const title = el.getAttribute('post-title') || el.querySelector('[slot="title"]')?.textContent?.trim() || '';
          const permalink = el.getAttribute('permalink') || '';
          const score = parseInt(el.getAttribute('score') || '0', 10);
          const comments = parseInt(el.getAttribute('comment-count') || '0', 10);
          const postId = el.getAttribute('id') || permalink.split('/')[6] || '';
          const isStickied = el.getAttribute('is-promoted') === 'true' || el.getAttribute('pinned') === 'true';
          if (title && !isStickied && score >= 5) {
            results.push({ title, permalink, score, comments, postId });
          }
        });
        return results;
      }
      // Fallback: look for article/div patterns
      const articles = document.querySelectorAll('article, [data-testid="post-container"]');
      articles.forEach((el) => {
        const titleEl = el.querySelector('h1, h2, h3, [data-click-id="text"]');
        const title = titleEl?.textContent?.trim() || '';
        const link = el.querySelector('a[href*="/comments/"]');
        const permalink = link?.getAttribute('href') || '';
        if (title && permalink) {
          results.push({ title, permalink, score: 0, comments: 0, postId: permalink.split('/')[4] || '' });
        }
      });
      return results;
    });
    
    if (extracted.length > 0) {
      posts = extracted;
      console.log(`  Browser extracted ${posts.length} posts`);
    }
  } catch (err) {
    console.log(`  Browser navigation error: ${err.message}`);
  }

  // Fallback to JSON API if browser didn't get enough
  if (posts.length < 5) {
    console.log(`  Using JSON API fallback for r/${sub}`);
    usedFallback = true;
    try {
      const json = await fetchRedditJSON(sub);
      const children = json?.data?.children || [];
      posts = children
        .filter((c) => !c.data.stickied && c.data.score >= 5 && c.data.post_hint !== 'image')
        .map((c) => ({
          title: c.data.title,
          permalink: c.data.permalink,
          score: c.data.score,
          comments: c.data.num_comments,
          postId: c.data.id,
          selftext: c.data.selftext || '',
          url: c.data.url,
        }));
      console.log(`  JSON API got ${posts.length} posts`);
    } catch (err) {
      console.log(`  JSON API also failed: ${err.message}`);
    }
  }

  console.log(`  Total posts to analyze: ${posts.length}`);

  // Analyze each post for pain points
  const painPoints = [];
  const painKeywords = [
    'frustrated', 'frustrating', 'struggling', 'struggle', 'hate', 'annoying', 'annoyed',
    'wish there was', 'is there an app', 'is there a tool', 'app for', 'tool for',
    'manually', 'keeping track', 'track of', 'how do i', 'help me', 'anyone else',
    'tired of', 'sick of', 'nobody tells you', 'hard to', 'difficult to',
    'can\'t find', 'can\'t figure', 'overwhelmed', 'confusing', 'confused',
    'need advice', 'need help', 'need a way', 'need something', 'organize',
    'impossible', 'exhausted', 'burnout', 'no one talks about', 'struggling with'
  ];

  for (const post of posts.slice(0, 25)) {
    const titleLower = post.title.toLowerCase();
    const bodyLower = (post.selftext || '').toLowerCase();
    const combined = titleLower + ' ' + bodyLower;

    const matchCount = painKeywords.filter((kw) => combined.includes(kw)).length;
    const hasQuestion = post.title.includes('?');
    const highEngagement = post.comments >= 10 || post.score >= 50;

    if (matchCount >= 1 || (hasQuestion && highEngagement)) {
      // Read post body via browser if we don't have it
      let postBody = post.selftext || '';
      if (!postBody && !usedFallback && post.permalink) {
        try {
          await page.goto(`https://www.reddit.com${post.permalink}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await sleep(2000);
          postBody = await page.evaluate(() => {
            const bodyEl = document.querySelector('[data-testid="post-content"]') ||
              document.querySelector('shreddit-post') ||
              document.querySelector('.md');
            return bodyEl?.textContent?.trim()?.slice(0, 2000) || '';
          });
          await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          await sleep(2000);
        } catch (e) {
          // Skip individual post read
        }
      }

      painPoints.push({
        title: post.title.slice(0, 80),
        description: generateDescription(post.title, postBody, sub),
        category,
        subreddit: `r/${sub}`,
        redditPostId: post.postId,
        redditUrl: `https://reddit.com${post.permalink}`,
        postTitle: post.title,
        postBody: postBody.slice(0, 2000),
        upvotes: post.score,
        commentCount: post.comments,
      });
    }
  }

  console.log(`  Pain points found: ${painPoints.length}`);

  // Submit pain points
  for (const pp of painPoints) {
    try {
      const createRes = await apiPost('/api/pain-points', {
        title: pp.title,
        description: pp.description,
        category: pp.category,
        subreddit: pp.subreddit,
        discoveredBy: AGENT_ID,
      });
      console.log(`  Submitted: "${pp.title}" → id=${createRes.id || createRes._id || JSON.stringify(createRes).slice(0, 60)}`);

      const painPointId = createRes.id || createRes._id || createRes.painPoint?.id;
      if (painPointId) {
        await apiPost('/api/pain-points/posts', {
          painPointId,
          redditPostId: pp.redditPostId,
          redditUrl: pp.redditUrl,
          postTitle: pp.postTitle,
          postBody: pp.postBody,
          upvotes: pp.upvotes,
          commentCount: pp.commentCount,
          subreddit: pp.subreddit,
          discoveredBy: AGENT_ID,
        });
      }
      await sleep(500);
    } catch (err) {
      console.log(`  Error submitting pain point: ${err.message}`);
    }
  }

  // Log scan results
  try {
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned: posts.length,
      painPointsFound: painPoints.length,
      status: 'completed',
    });
    console.log(`  Scan log submitted for r/${sub}`);
  } catch (err) {
    console.log(`  Error submitting scan log: ${err.message}`);
  }

  return { sub, postsScanned: posts.length, painPointsFound: painPoints.length, painPoints };
}

function generateDescription(title, body, sub) {
  // Generate a 2-3 sentence description based on available context
  const truncBody = body ? body.slice(0, 300).replace(/\n+/g, ' ') : '';
  const context = sub === 'beyondthebump' || sub === 'Mommit' ? 'new and expecting parents' :
    sub === 'running' || sub === 'xxfitness' ? 'fitness enthusiasts' :
    sub === 'gardening' ? 'home gardeners' : 'community members';
  
  if (truncBody) {
    return `${context.charAt(0).toUpperCase() + context.slice(1)} on r/${sub} report: "${truncBody.slice(0, 150)}..." This represents a recurring pain point with potential for a tool or service solution.`;
  }
  return `${context.charAt(0).toUpperCase() + context.slice(1)} on r/${sub} are experiencing challenges related to: "${title}". This appears to be a common issue with demand for better tools or resources.`;
}

async function main() {
  console.log('Jess-M Scanner starting...');
  console.log(`CDP: ${CDP_URL}`);
  console.log(`Subreddits: ${SUBREDDITS.join(', ')}`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected to browser via CDP');
  } catch (err) {
    console.error('Failed to connect via CDP:', err.message);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const pages = context.pages();
  
  // Close extra tabs
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
      console.log(`Error scanning r/${sub}: ${err.message}`);
      results.push({ sub, postsScanned: 0, painPointsFound: 0, error: err.message });
    }
    await sleep(3000); // Pause between subreddits
  }

  // Summary
  console.log('\n=== SCAN COMPLETE ===');
  let totalPosts = 0;
  let totalPainPoints = 0;
  for (const r of results) {
    console.log(`r/${r.sub}: ${r.postsScanned} posts, ${r.painPointsFound} pain points${r.error ? ' (ERROR: ' + r.error + ')' : ''}`);
    totalPosts += r.postsScanned || 0;
    totalPainPoints += r.painPointsFound || 0;
  }
  console.log(`\nTotal: ${SUBREDDITS.length} subreddits, ${totalPosts} posts, ${totalPainPoints} pain points`);

  // Print all pain point titles
  for (const r of results) {
    if (r.painPoints?.length > 0) {
      console.log(`\nr/${r.sub} pain points:`);
      r.painPoints.forEach((pp) => console.log(`  - ${pp.title}`));
    }
  }

  // Don't close browser — admin handles that
  await browser.close().catch(() => {});
  
  return results;
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
