const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

const CDP_URL = 'ws://127.0.0.1:52291/devtools/browser/4182e569-c442-4f77-a33b-295c0554a01d';
const AGENT_ID = 'marcus-j';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const SUBREDDITS = ['Guitar', 'guitarpedals', 'Blues', 'homerecording'];
const CATEGORY = 'Music';

function apiPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(API_BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port || 3000,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'Content-Length': Buffer.byteLength(data)
      }
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

async function fetchSubredditJSON(sub) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.reddit.com',
      path: `/r/${sub}/hot.json?limit=25&raw_json=1`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    };
    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function isPainPoint(post) {
  const title = (post.title || '').toLowerCase();
  const body = (post.selftext || '').toLowerCase();
  const text = title + ' ' + body;
  
  // Skip if low score or stickied
  if (post.score < 5) return false;
  if (post.stickied) return false;
  if (post.is_gallery && !post.selftext) return false;
  
  // Pain point indicators
  const painIndicators = [
    'frustrat', 'annoying', 'annoyed', 'struggle', 'struggling', 'hard to', 'difficult',
    'can\'t figure', 'can\'t find', 'looking for', 'is there an app', 'is there a tool',
    'is there a way', 'need help', 'how do i', 'how do you', 'anyone else',
    'why is it so', 'wish there was', 'would love', 'any recommendations',
    'best way to', 'alternatives to', 'replacing', 'expensive', 'too complex',
    'confusing', 'overwhelming', 'lost', 'stuck', 'can\'t afford', 'need a solution',
    'problem with', 'issue with', 'what do you use', 'workflow', 'organize',
    'track', 'manage', 'keep track', 'record', 'organize my', 'help me'
  ];
  
  return painIndicators.some(indicator => text.includes(indicator));
}

function extractPainPointTitle(post) {
  const title = post.title;
  if (title.length <= 80) return title;
  return title.substring(0, 77) + '...';
}

function buildDescription(post) {
  const parts = [];
  parts.push(`User asks: "${post.title}"`);
  if (post.selftext && post.selftext.length > 10) {
    const snippet = post.selftext.substring(0, 200).replace(/\n/g, ' ').trim();
    parts.push(`Context: ${snippet}`);
  }
  parts.push(`Posted in r/${post.subreddit} with ${post.score} upvotes and ${post.num_comments} comments.`);
  return parts.join(' ');
}

async function scanWithBrowser(page, sub) {
  const results = [];
  let postsScanned = 0;
  
  try {
    console.log(`\n[${sub}] Navigating to r/${sub}...`);
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000 
    });
    await page.waitForTimeout(3000);
    
    // Scroll to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await page.waitForTimeout(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1000);
    
    // Take snapshot and extract content
    const content = await page.content();
    console.log(`[${sub}] Page loaded, content length: ${content.length}`);
    
    // Try to get post data from the page
    const postData = await page.evaluate(() => {
      const posts = [];
      // Try new Reddit shreddit elements
      const postElements = document.querySelectorAll('shreddit-post, [data-testid="post-container"], article');
      postElements.forEach(el => {
        const titleEl = el.querySelector('h1, h2, h3, [slot="title"], [data-click-id="text"] a');
        const title = titleEl ? titleEl.textContent.trim() : '';
        if (title) {
          const scoreEl = el.querySelector('[score-label], faceplate-number, [data-testid="score"]');
          const score = scoreEl ? scoreEl.textContent.trim() : '0';
          const linkEl = el.querySelector('a[href*="/comments/"]');
          const url = linkEl ? linkEl.href : '';
          posts.push({ title, score, url });
        }
      });
      return posts;
    });
    
    console.log(`[${sub}] Found ${postData.length} posts via browser`);
    postsScanned = postData.length;
    
    if (postData.length < 5) {
      console.log(`[${sub}] Fewer than 5 posts found via browser, falling back to JSON API`);
      return null; // Signal to use fallback
    }
    
    // Analyze posts from browser
    for (const post of postData) {
      const titleLower = post.title.toLowerCase();
      const painIndicators = [
        'frustrat', 'annoying', 'struggle', 'hard to', 'difficult',
        'can\'t find', 'looking for', 'is there', 'need help', 'how do i',
        'how do you', 'anyone else', 'why is', 'wish', 'recommend',
        'best way', 'alternative', 'expensive', 'confusing', 'overwhelming',
        'stuck', 'problem with', 'issue with', 'what do you use', 'workflow',
        'organize', 'track', 'manage', 'help me', 'beginner', 'lost',
        'overwhelmed', 'advice', 'tips', 'newbie', 'not sure how'
      ];
      
      const isPain = painIndicators.some(ind => titleLower.includes(ind));
      if (isPain) {
        results.push({
          title: post.title.substring(0, 80),
          description: `Community question/frustration: "${post.title}" Posted in r/${sub}.`,
          url: post.url,
          postId: post.url.match(/comments\/([a-z0-9]+)\//)?.[1] || '',
          upvotes: 0,
          commentCount: 0
        });
      }
    }
    
    return { results, postsScanned };
  } catch (err) {
    console.error(`[${sub}] Browser scan error: ${err.message}`);
    return null;
  }
}

async function scanWithJSON(sub) {
  console.log(`[${sub}] Using JSON API fallback...`);
  const results = [];
  
  try {
    const data = await fetchSubredditJSON(sub);
    if (!data || !data.data || !data.data.children) {
      console.error(`[${sub}] Invalid JSON response`);
      return { results: [], postsScanned: 0 };
    }
    
    const posts = data.data.children.map(c => c.data).filter(p => !p.stickied && p.score >= 5);
    console.log(`[${sub}] Got ${posts.length} posts from JSON API`);
    
    for (const post of posts) {
      if (isPainPoint(post)) {
        results.push({
          title: extractPainPointTitle(post),
          description: buildDescription(post),
          url: `https://reddit.com${post.permalink}`,
          postId: post.id,
          postTitle: post.title,
          postBody: (post.selftext || '').substring(0, 2000),
          upvotes: post.score,
          commentCount: post.num_comments,
          subreddit: sub
        });
      }
    }
    
    return { results, postsScanned: posts.length };
  } catch (err) {
    console.error(`[${sub}] JSON API error: ${err.message}`);
    return { results: [], postsScanned: 0 };
  }
}

async function submitPainPoint(pp, sub) {
  try {
    const ppResp = await apiPost('/api/pain-points', {
      title: pp.title,
      description: pp.description,
      category: CATEGORY,
      subreddit: `r/${sub}`,
      discoveredBy: AGENT_ID
    });
    console.log(`  Submitted pain point: ${pp.title.substring(0, 50)}...`);
    console.log(`  Response:`, JSON.stringify(ppResp).substring(0, 200));
    
    const ppId = ppResp.id || ppResp._id || (ppResp.data && ppResp.data.id);
    if (ppId && pp.postId) {
      const postResp = await apiPost('/api/pain-points/posts', {
        painPointId: ppId,
        redditPostId: pp.postId,
        redditUrl: pp.url,
        postTitle: pp.postTitle || pp.title,
        postBody: pp.postBody || pp.description,
        upvotes: pp.upvotes || 0,
        commentCount: pp.commentCount || 0,
        subreddit: `r/${sub}`,
        discoveredBy: AGENT_ID
      });
      console.log(`  Linked source post:`, JSON.stringify(postResp).substring(0, 100));
    }
    return true;
  } catch (err) {
    console.error(`  Error submitting pain point: ${err.message}`);
    return false;
  }
}

async function logScan(sub, postsScanned, painPointsFound, status = 'completed') {
  try {
    const resp = await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned,
      painPointsFound,
      status
    });
    console.log(`[${sub}] Scan logged:`, JSON.stringify(resp).substring(0, 100));
  } catch (err) {
    console.error(`[${sub}] Error logging scan: ${err.message}`);
  }
}

async function main() {
  let browser;
  const summary = {
    subredditsScanned: 0,
    totalPostsAnalyzed: 0,
    painPointsFound: [],
    errors: []
  };
  
  try {
    console.log('Connecting to AdsPower browser via CDP...');
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected!');
    
    const context = browser.contexts()[0];
    const pages = context.pages();
    
    // Close extra tabs, keep one
    for (let i = 1; i < pages.length; i++) {
      try { await pages[i].close(); } catch(e) {}
    }
    const page = pages[0] || await context.newPage();
    console.log('Got browser page');
    
    for (const sub of SUBREDDITS) {
      console.log(`\n========== Scanning r/${sub} ==========`);
      
      let scanResult = await scanWithBrowser(page, sub);
      
      if (!scanResult) {
        // Fallback to JSON API
        scanResult = await scanWithJSON(sub);
      }
      
      const { results, postsScanned } = scanResult;
      console.log(`[${sub}] Found ${results.length} pain points from ${postsScanned} posts`);
      
      // Submit pain points
      let submitted = 0;
      for (const pp of results) {
        const ok = await submitPainPoint(pp, sub);
        if (ok) {
          submitted++;
          summary.painPointsFound.push(pp.title);
        }
        await new Promise(r => setTimeout(r, 1000)); // Pace API calls
      }
      
      // Log scan results
      await logScan(sub, postsScanned, submitted);
      
      summary.subredditsScanned++;
      summary.totalPostsAnalyzed += postsScanned;
      
      // Pause between subreddits
      if (sub !== SUBREDDITS[SUBREDDITS.length - 1]) {
        console.log(`Pausing 3 seconds before next subreddit...`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
    
  } catch (err) {
    console.error('Fatal error:', err.message);
    summary.errors.push(err.message);
  }
  
  // Print summary
  console.log('\n========== SCAN COMPLETE ==========');
  console.log(`Subreddits scanned: ${summary.subredditsScanned}`);
  console.log(`Total posts analyzed: ${summary.totalPostsAnalyzed}`);
  console.log(`Pain points found: ${summary.painPointsFound.length}`);
  summary.painPointsFound.forEach((t, i) => console.log(`  ${i+1}. ${t}`));
  if (summary.errors.length > 0) {
    console.log('Errors:', summary.errors);
  }
  
  // Output JSON for parent agent
  console.log('\nSUMMARY_JSON:' + JSON.stringify(summary));
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
