const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:50999/devtools/browser/27806cda-7dbd-4da8-a598-29db4c9e581d';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const AGENT_ID = 'ty-m';
const CATEGORY = 'Cycling';
const SUBREDDITS = ['bikecommuting', 'gravelcycling', 'bikewrench', 'fuckcars'];

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function submitPainPoint(pp) {
  const result = await apiPost('/api/pain-points', {
    title: pp.title,
    description: pp.description,
    category: CATEGORY,
    subreddit: pp.subreddit,
    discoveredBy: AGENT_ID
  });
  console.log('Created pain point:', JSON.stringify(result));
  return result?.id || result?.data?.id;
}

async function linkPost(painPointId, post) {
  const result = await apiPost('/api/pain-points/posts', {
    painPointId,
    redditPostId: post.redditPostId,
    redditUrl: post.redditUrl,
    postTitle: post.postTitle,
    postBody: (post.postBody || '').slice(0, 2000),
    upvotes: post.upvotes || 0,
    commentCount: post.commentCount || 0,
    subreddit: post.subreddit,
    discoveredBy: AGENT_ID
  });
  console.log('Linked post:', JSON.stringify(result));
}

async function logScan(subreddit, postsScanned, painPointsFound, status = 'completed') {
  const result = await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned,
    painPointsFound,
    status
  });
  console.log(`Scan log for r/${subreddit}:`, JSON.stringify(result));
}

// Fetch subreddit posts via browser's own fetch (uses proxy + cookies)
async function fetchPostsViaBrowser(page, subreddit) {
  return await page.evaluate(async (sub) => {
    const url = `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`;
    try {
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' }
      });
      const data = await res.json();
      return data?.data?.children?.map(c => c.data) || [];
    } catch (e) {
      return { error: e.message };
    }
  }, subreddit);
}

// Fetch post comments via browser fetch
async function fetchCommentsViaBrowser(page, subreddit, postId) {
  return await page.evaluate(async (sub, id) => {
    const url = `https://www.reddit.com/r/${sub}/comments/${id}.json?limit=10&raw_json=1`;
    try {
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' }
      });
      const data = await res.json();
      if (!Array.isArray(data) || data.length < 2) return [];
      return data[1]?.data?.children?.map(c => c.data?.body).filter(Boolean) || [];
    } catch (e) {
      return [];
    }
  }, subreddit, postId);
}

// Extract posts from rendered page DOM (fallback)
async function extractPostsFromDOM(page) {
  return await page.evaluate(() => {
    const posts = [];
    
    // Try shreddit-post elements (new Reddit)
    const shredditPosts = document.querySelectorAll('shreddit-post');
    for (const el of shredditPosts) {
      const title = el.getAttribute('post-title') || el.querySelector('h3, [slot="title"]')?.textContent?.trim() || '';
      const score = parseInt(el.getAttribute('score') || el.getAttribute('upvotes') || '0') || 0;
      const comments = parseInt(el.getAttribute('comment-count') || '0') || 0;
      const permalink = el.getAttribute('permalink') || el.getAttribute('content-href') || '';
      const postId = el.getAttribute('id') || el.getAttribute('post-id') || '';
      
      if (title && permalink) {
        posts.push({ title, score, num_comments: comments, permalink, id: postId, selftext: '', stickied: false });
      }
    }
    
    if (posts.length > 0) return posts;
    
    // Try old Reddit / other selectors
    const postEls = document.querySelectorAll('[data-testid="post-container"], .Post, article');
    for (const el of postEls) {
      const titleEl = el.querySelector('h3, h2, [data-adclicklocation="title"] a, .title a');
      const title = titleEl?.textContent?.trim() || '';
      const permalink = titleEl?.closest('a')?.getAttribute('href') || '';
      const scoreEl = el.querySelector('[id^="vote-arrows"] button, .score, [data-testid="post-score"]');
      const score = parseInt(scoreEl?.textContent?.replace(/[^0-9]/g, '') || '0') || 0;
      
      if (title) {
        posts.push({ title, score, num_comments: 0, permalink, id: '', selftext: '', stickied: false });
      }
    }
    
    return posts;
  });
}

function isPainPoint(post) {
  if (post.stickied) return false;
  if ((post.score || 0) < 3) return false;
  
  const text = `${post.title} ${post.selftext || ''}`.toLowerCase();
  
  const painSignals = [
    'how do i', 'how do you', 'is there a way', 'is there an app', 'looking for',
    'frustrated', 'annoying', 'hate when', 'struggle with', 'problem with',
    "can't find", 'cant find', 'wish there was', 'need help', 'tips for',
    'best way to', 'any recommendations', 'what do you use', 'anyone else',
    'why is it so hard', 'manually', 'time consuming', 'expensive', 'complicated',
    'confusing', 'broken', 'unreliable', 'fails', 'keeps', 'every time',
    'question', 'help', 'advice', 'recommend', 'tracking', 'planning', 'organizing',
    'where to', 'which', 'should i', 'worth it', 'alternatives to', 'replace',
    'maintain', 'maintenance', 'fix', 'repair', 'route', 'commute', 'gear',
    'upgrade', 'budget', 'cheap', 'affordable', 'too heavy', 'too expensive',
    'dangerous', 'unsafe', 'scared', 'fear', 'worried', 'concerned',
    'infrastructure', 'drivers', 'cars', 'safety'
  ];
  
  const hasPainSignal = painSignals.some(s => text.includes(s));
  
  const excludeSignals = ['[oc]', 'appreciation post', 'just got', 'just bought', 'look at my', 'my new'];
  const hasExclude = excludeSignals.some(s => text.includes(s)) && 
                     !painSignals.some(s => text.includes(s));
  
  return hasPainSignal && !hasExclude;
}

function extractPainPointInfo(post, comments, subreddit) {
  const title = post.title.slice(0, 80);
  const body = post.selftext || '';
  const topComments = (comments || []).slice(0, 5).join(' ');
  
  let description = '';
  if (body && body.length > 30) {
    description = body.slice(0, 400).replace(/\n+/g, ' ').trim();
  } else {
    description = `r/${subreddit} users discussing: "${post.title}". `;
    if (topComments) {
      description += topComments.slice(0, 250).replace(/\n+/g, ' ');
    }
  }
  description = description.slice(0, 500);
  
  // Extract post ID from permalink if not set
  let postId = post.id;
  if (!postId && post.permalink) {
    const match = post.permalink.match(/\/comments\/([a-z0-9]+)\//);
    if (match) postId = match[1];
  }
  
  return {
    title,
    description,
    subreddit: `r/${subreddit}`,
    redditPostId: postId || '',
    redditUrl: post.permalink ? `https://reddit.com${post.permalink}` : '',
    postTitle: post.title,
    postBody: body,
    upvotes: post.score || 0,
    commentCount: post.num_comments || 0
  };
}

async function scanSubreddit(page, subreddit) {
  console.log(`\n=== Scanning r/${subreddit} ===`);
  
  const painPointsToSubmit = [];
  let postsScanned = 0;
  let posts = [];
  
  // Navigate to subreddit
  try {
    await page.goto(`https://www.reddit.com/r/${subreddit}/hot/`, { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000 
    });
    await sleep(3000);
    
    // Check for login wall / CAPTCHA
    const currentUrl = page.url();
    console.log(`Current URL: ${currentUrl}`);
    
    // Scroll to load posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);
    
  } catch (e) {
    console.log(`Navigation error: ${e.message}`);
  }
  
  // Try to get posts via browser fetch (same-origin, uses proxy + cookies)
  console.log('Trying browser-based JSON API fetch...');
  const browserFetchResult = await fetchPostsViaBrowser(page, subreddit);
  
  if (Array.isArray(browserFetchResult) && browserFetchResult.length > 0) {
    posts = browserFetchResult;
    console.log(`Got ${posts.length} posts via browser fetch`);
  } else {
    console.log('Browser fetch result:', JSON.stringify(browserFetchResult).slice(0, 200));
    
    // Fallback: extract from DOM
    console.log('Trying DOM extraction...');
    const domPosts = await extractPostsFromDOM(page);
    console.log(`DOM extraction found ${domPosts.length} posts`);
    if (domPosts.length > 0) {
      posts = domPosts;
    }
  }
  
  // If still empty, take a snapshot to debug
  if (posts.length === 0) {
    const pageTitle = await page.title();
    const pageText = await page.evaluate(() => document.body?.innerText?.slice(0, 500));
    console.log(`Page title: ${pageTitle}`);
    console.log(`Page text preview: ${pageText}`);
  }
  
  postsScanned = posts.length;
  const candidates = posts.filter(isPainPoint);
  console.log(`${candidates.length} pain point candidates from ${posts.length} posts`);
  
  for (const post of candidates.slice(0, 8)) {
    console.log(`  Analyzing: "${post.title?.slice(0, 60)}" (${post.score}↑, ${post.num_comments} comments)`);
    
    let comments = [];
    if ((post.num_comments || 0) >= 10 && post.id) {
      try {
        await sleep(2000);
        comments = await fetchCommentsViaBrowser(page, subreddit, post.id);
        console.log(`  Fetched ${comments.length} comments`);
      } catch (e) {
        console.log(`  Comment fetch error: ${e.message}`);
      }
    }
    
    const ppInfo = extractPainPointInfo(post, comments, subreddit);
    painPointsToSubmit.push(ppInfo);
    
    try {
      const ppId = await submitPainPoint(ppInfo);
      if (ppId) {
        await linkPost(ppId, ppInfo);
      }
    } catch (e) {
      console.log(`  API submission error: ${e.message}`);
    }
    
    await sleep(1500);
  }
  
  await logScan(subreddit, postsScanned, painPointsToSubmit.length);
  console.log(`Done r/${subreddit}: ${postsScanned} posts, ${painPointsToSubmit.length} pain points`);
  
  return { subreddit, postsScanned, painPointsFound: painPointsToSubmit.length };
}

async function main() {
  console.log('Connecting via CDP...');
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected!');
  } catch (e) {
    console.error('CDP connection failed:', e.message);
    process.exit(1);
  }
  
  const context = browser.contexts()[0];
  if (!context) {
    console.error('No browser context available');
    process.exit(1);
  }
  
  const pages = context.pages();
  console.log(`Found ${pages.length} pages`);
  
  for (let i = 1; i < pages.length; i++) {
    await pages[i].close().catch(() => {});
  }
  const page = pages[0] || await context.newPage();
  
  const results = [];
  let totalPosts = 0;
  let totalPainPoints = 0;
  
  for (const sub of SUBREDDITS) {
    try {
      const result = await scanSubreddit(page, sub);
      results.push(result);
      totalPosts += result.postsScanned;
      totalPainPoints += result.painPointsFound;
    } catch (e) {
      console.error(`Error scanning r/${sub}:`, e.message, e.stack);
      await logScan(sub, 0, 0, 'error').catch(() => {});
    }
    await sleep(3000);
  }
  
  console.log('\n=== FINAL SUMMARY ===');
  console.log(`Subreddits scanned: ${results.length}/4`);
  console.log(`Total posts analyzed: ${totalPosts}`);
  console.log(`Total pain points found: ${totalPainPoints}`);
  for (const r of results) {
    console.log(`  r/${r.subreddit}: ${r.postsScanned} posts, ${r.painPointsFound} pain points`);
  }
}

main().catch(e => {
  console.error('Fatal:', e.message, e.stack);
  process.exit(1);
});
