const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

const CDP_URL = 'ws://127.0.0.1:50241/devtools/browser/194fbae4-3f08-4ba0-a4cb-de081c6a1362';
const AGENT_ID = 'dave-r';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const SUBREDDITS = ['HomeImprovement', 'DIY', 'woodworking', 'smoking'];

const CATEGORY_MAP = {
  HomeImprovement: 'Home & DIY',
  DIY: 'Home & DIY',
  woodworking: 'Home & DIY',
  smoking: 'BBQ & Grilling',
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
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (e) { resolve(raw); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function fetchSubredditJSON(sub) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'www.reddit.com',
      path: `/r/${sub}/hot.json?limit=25&raw_json=1`,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    };
    https.get(opts, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (e) { resolve(null); }
      });
    }).on('error', reject);
  });
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  const painPoints = [];
  let posts = [];

  // Try browser first
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

    // Try to extract posts from page
    const pageContent = await page.content();
    
    // Check for CAPTCHA or login wall
    if (pageContent.includes('recaptcha') || pageContent.includes('sign-in') || pageContent.includes('Log In')) {
      console.log(`Warning: Possible login wall on r/${sub}, falling back to JSON API`);
      throw new Error('Login wall detected');
    }

    // Extract post data using page evaluation
    posts = await page.evaluate(() => {
      const results = [];
      
      // Try new Reddit (shreddit) selectors
      const postElements = document.querySelectorAll('shreddit-post, [data-testid="post-container"], article');
      
      postElements.forEach((el) => {
        try {
          // shreddit-post attributes
          const title = el.getAttribute('post-title') || 
                        el.querySelector('h1, h2, h3, [data-testid="post-title"]')?.textContent?.trim() || '';
          const permalink = el.getAttribute('permalink') || 
                            el.querySelector('a[href*="/comments/"]')?.getAttribute('href') || '';
          const score = parseInt(el.getAttribute('score') || el.querySelector('[data-testid="post-karma"]')?.textContent || '0');
          const commentCount = parseInt(el.getAttribute('comment-count') || '0');
          const postId = permalink.split('/comments/')[1]?.split('/')[0] || '';

          if (title && permalink) {
            results.push({ title, permalink, score, commentCount, postId });
          }
        } catch (e) {}
      });

      return results;
    });

    console.log(`Browser scan found ${posts.length} posts`);
  } catch (err) {
    console.log(`Browser approach failed or insufficient: ${err.message}`);
  }

  // Fall back to JSON API if browser didn't yield enough posts
  if (posts.length < 5) {
    console.log(`Using JSON API fallback for r/${sub}...`);
    try {
      const data = await fetchSubredditJSON(sub);
      if (data && data.data && data.data.children) {
        posts = data.data.children.map((c) => ({
          title: c.data.title,
          permalink: c.data.permalink,
          score: c.data.score,
          commentCount: c.data.num_comments,
          postId: c.data.id,
          selftext: c.data.selftext || '',
          stickied: c.data.stickied,
        }));
        console.log(`JSON API returned ${posts.length} posts`);
      }
    } catch (err) {
      console.log(`JSON API also failed: ${err.message}`);
    }
  }

  // Filter posts
  const eligiblePosts = posts.filter(
    (p) => !p.stickied && p.score >= 5 && p.title && p.title.length > 5
  );
  console.log(`Eligible posts after filter: ${eligiblePosts.length}`);

  // Analyze each post for pain points
  const category = CATEGORY_MAP[sub];
  let postsScanned = 0;

  for (const post of eligiblePosts.slice(0, 20)) {
    postsScanned++;
    const title = post.title.toLowerCase();
    const body = (post.selftext || '').toLowerCase();
    const combined = title + ' ' + body;

    // Pain point signals
    const isPainPoint =
      /\b(frustrat|annoy|struggle|problem|issue|difficult|hate|can't figure|need help|any app|any tool|software for|is there a|wish there was|nightmare|pain|confus|overwhelm|manual|tedious|time.consuming|expensive|complex|too hard|doesn't work|broke|fail|stuck)\b/.test(combined) ||
      /\?(.*)(app|tool|software|way to|how to|anyone else|help)/i.test(post.title) ||
      /(is there|anyone know|looking for|need a|want a|best way to|how do you).*(track|manage|organi|automat|plan|schedule|find|keep|remember)/i.test(combined);

    if (!isPainPoint) continue;
    if (post.commentCount < 2 && post.score < 10) continue;

    // Fetch post body if needed via JSON API
    let postBody = post.selftext || '';
    if (!postBody && post.postId && post.commentCount >= 5) {
      try {
        const detailData = await fetchSubredditJSON(`${sub}/comments/${post.postId}`);
        if (detailData && Array.isArray(detailData)) {
          postBody = detailData[0]?.data?.children?.[0]?.data?.selftext || '';
        }
        await new Promise((r) => setTimeout(r, 2000));
      } catch (e) {}
    }

    // Build pain point
    const ppTitle = post.title.slice(0, 80);
    const description = `User in r/${sub} ${
      post.title.endsWith('?') ? 'asks: "' + post.title + '"' : 'reports: "' + post.title + '"'
    }${postBody ? ' ' + postBody.slice(0, 200) : ''}`.slice(0, 400);

    console.log(`  Pain point: ${ppTitle}`);

    try {
      // Submit pain point
      const ppResp = await apiPost('/api/pain-points', {
        title: ppTitle,
        description: description.slice(0, 500),
        category,
        subreddit: `r/${sub}`,
        discoveredBy: AGENT_ID,
      });

      const ppId = ppResp.id || ppResp.painPoint?.id || ppResp._id;
      console.log(`    Created pain point ID: ${ppId}`);

      if (ppId) {
        // Link source post
        const redditUrl = `https://reddit.com${post.permalink}`;
        await apiPost('/api/pain-points/posts', {
          painPointId: ppId,
          redditPostId: post.postId,
          redditUrl,
          postTitle: post.title,
          postBody: postBody.slice(0, 2000),
          upvotes: post.score,
          commentCount: post.commentCount,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID,
        });
        console.log(`    Linked source post`);
      }

      painPoints.push({ title: ppTitle, id: ppId });
    } catch (err) {
      console.log(`    Error submitting pain point: ${err.message}`);
    }

    await new Promise((r) => setTimeout(r, 1500));
  }

  // Log scan results
  try {
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned,
      painPointsFound: painPoints.length,
      status: 'completed',
    });
    console.log(`  Logged scan: ${postsScanned} posts scanned, ${painPoints.length} pain points found`);
  } catch (err) {
    console.log(`  Error logging scan: ${err.message}`);
  }

  return { sub, postsScanned, painPoints };
}

async function main() {
  console.log('dave-r scanner starting...');
  console.log(`CDP URL: ${CDP_URL}`);

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

  // Clean up extra tabs
  const pages = context.pages();
  for (let i = 1; i < pages.length; i++) await pages[i].close();
  const page = pages[0] || await context.newPage();

  const results = [];

  for (const sub of SUBREDDITS) {
    try {
      const result = await scanSubreddit(page, sub);
      results.push(result);
    } catch (err) {
      console.error(`Error scanning r/${sub}: ${err.message}`);
      results.push({ sub, postsScanned: 0, painPoints: [], error: err.message });

      // Log failure
      try {
        await apiPost('/api/pain-points/scan-logs', {
          agentId: AGENT_ID,
          subreddit: `r/${sub}`,
          postsScanned: 0,
          painPointsFound: 0,
          status: 'failed',
        });
      } catch (e) {}
    }

    // Pause between subreddits
    if (SUBREDDITS.indexOf(sub) < SUBREDDITS.length - 1) {
      console.log('Pausing 5s before next subreddit...');
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  // Summary
  console.log('\n=== SCAN COMPLETE ===');
  let totalPosts = 0;
  let totalPainPoints = 0;
  const allPainPoints = [];

  for (const r of results) {
    totalPosts += r.postsScanned;
    totalPainPoints += r.painPoints.length;
    allPainPoints.push(...r.painPoints.map((p) => p.title));
    console.log(`r/${r.sub}: ${r.postsScanned} posts, ${r.painPoints.length} pain points`);
    if (r.error) console.log(`  Error: ${r.error}`);
  }

  console.log(`\nTotal: ${totalPosts} posts scanned, ${totalPainPoints} pain points found`);
  console.log('Pain points:');
  allPainPoints.forEach((t) => console.log(`  - ${t}`));

  // Don't close browser — admin handles that
  await browser.close(); // just disconnect, not stop
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
