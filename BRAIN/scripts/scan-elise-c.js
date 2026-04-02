const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:64790/devtools/browser/7d5d78fe-6bd2-4951-ab36-150103540d5b';
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
  try {
    const res = await fetch(`https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });
    const json = await res.json();
    return json.data?.children?.map(c => c.data) || [];
  } catch (e) {
    console.error(`JSON fallback failed for ${sub}:`, e.message);
    return [];
  }
}

function isPainPoint(post) {
  if (post.score < 5) return false;
  if (post.stickied) return false;
  const text = (post.title + ' ' + (post.selftext || '')).toLowerCase();
  // Pain point signals
  const signals = [
    'how do i', 'how can i', 'struggling', 'frustrated', 'annoying', 'difficult',
    'is there an app', 'is there a tool', 'is there a way', 'anyone else have',
    'keep track', 'tracking', 'organize', 'manage', 'automate', 'manually',
    'expensive', 'complicated', 'confusing', 'overwhelmed', 'help me',
    'need advice', 'looking for', 'recommend', 'alternative to',
    'problem', 'issue', 'trouble', 'hard to', 'cant figure', "can't figure",
    'wish there was', 'why is it so', 'does anyone know', 'anyone have a solution',
    'spreadsheet', 'calculator', 'reminder', 'schedule', 'planning',
    'cost', 'budget', 'afford', 'cheap', 'free option',
    'vet', 'diagnosis', 'treatment', 'insulin', 'glucose', 'blood sugar',
    'raw diet', 'feeding', 'transition', 'recipe', 'meal prep',
    'thrift', 'resell', 'find', 'identify', 'price check',
    'lawn', 'grass', 'weed', 'fertilize', 'mow', 'disease',
  ];
  return signals.some(s => text.includes(s));
}

function extractPainPointTitle(post) {
  return post.title.substring(0, 80);
}

function extractDescription(post) {
  const body = post.selftext ? post.selftext.substring(0, 300) : '';
  return `From r/${post.subreddit}: ${post.title}${body ? '. ' + body : ''}`.substring(0, 400);
}

async function scanSubredditViaBrowser(page, sub) {
  console.log(`\n[Browser] Scanning r/${sub}...`);
  const posts = [];
  
  try {
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);
    
    // Check for CAPTCHA or error
    const title = await page.title();
    console.log(`  Page title: ${title}`);
    
    if (title.toLowerCase().includes('blocked') || title.toLowerCase().includes('captcha')) {
      console.log(`  CAPTCHA/block detected for r/${sub}, using JSON fallback`);
      return null; // signal fallback needed
    }
    
    // Scroll to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);
    
    // Try to extract posts from the page
    const pageContent = await page.content();
    
    // Check if we got real content
    if (pageContent.length < 5000) {
      console.log(`  Page content too short (${pageContent.length} chars), using JSON fallback`);
      return null;
    }
    
    console.log(`  Got page content (${pageContent.length} chars), using JSON fallback for structured data`);
    return null; // Always use JSON for structured extraction
    
  } catch (e) {
    console.error(`  Browser error for r/${sub}: ${e.message}`);
    return null;
  }
}

async function scanSubreddit(page, sub) {
  const category = CATEGORY_MAP[sub] || 'General';
  console.log(`\n=== Scanning r/${sub} (${category}) ===`);
  
  // Try browser first, fall back to JSON API
  await scanSubredditViaBrowser(page, sub);
  
  // Use JSON API for reliable structured data
  console.log(`  Fetching via JSON API...`);
  const posts = await fetchSubredditJSON(sub);
  console.log(`  Found ${posts.length} posts`);
  
  const painPointPosts = posts.filter(isPainPoint);
  console.log(`  Pain point candidates: ${painPointPosts.length}`);
  
  const submitted = [];
  
  for (const post of painPointPosts.slice(0, 5)) { // max 5 per sub
    console.log(`  → "${post.title.substring(0, 60)}..." (score: ${post.score}, comments: ${post.num_comments})`);
    
    try {
      // Create pain point
      const ppRes = await apiPost('/api/pain-points', {
        title: extractPainPointTitle(post),
        description: extractDescription(post),
        category,
        subreddit: `r/${sub}`,
        discoveredBy: AGENT_ID,
      });
      
      const ppId = ppRes?.id || ppRes?.data?.id || ppRes?.painPoint?.id;
      if (!ppId) {
        console.log(`  ⚠ No ID in response: ${JSON.stringify(ppRes).substring(0, 100)}`);
        continue;
      }
      
      // Link source post
      await apiPost('/api/pain-points/posts', {
        painPointId: ppId,
        redditPostId: post.id,
        redditUrl: `https://reddit.com${post.permalink}`,
        postTitle: post.title,
        postBody: (post.selftext || '').substring(0, 2000),
        upvotes: post.score,
        commentCount: post.num_comments,
        subreddit: `r/${sub}`,
        discoveredBy: AGENT_ID,
      });
      
      submitted.push(post.title);
      console.log(`  ✓ Submitted pain point ID: ${ppId}`);
      await sleep(500);
      
    } catch (e) {
      console.error(`  ✗ Failed to submit: ${e.message}`);
    }
  }
  
  // Log scan results
  await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${sub}`,
    postsScanned: posts.length,
    painPointsFound: submitted.length,
    status: 'completed',
  });
  
  return { sub, postsScanned: posts.length, painPointsFound: submitted.length, titles: submitted };
}

async function main() {
  console.log(`Starting scan as ${AGENT_ID}`);
  console.log(`Subreddits: ${SUBREDDITS.join(', ')}`);
  
  let browser;
  let page;
  
  try {
    console.log(`Connecting to CDP: ${CDP_URL}`);
    browser = await chromium.connectOverCDP(CDP_URL);
    const context = browser.contexts()[0];
    const pages = context.pages();
    
    // Close extra tabs
    for (let i = 1; i < pages.length; i++) await pages[i].close();
    page = pages[0] || await context.newPage();
    console.log('Connected to browser via CDP');
    
  } catch (e) {
    console.error(`CDP connection failed: ${e.message}`);
    console.log('Proceeding with JSON API fallback only (no browser)');
    page = null;
  }
  
  const results = [];
  
  for (const sub of SUBREDDITS) {
    try {
      const result = await scanSubreddit(page, sub);
      results.push(result);
    } catch (e) {
      console.error(`Error scanning r/${sub}: ${e.message}`);
      results.push({ sub, postsScanned: 0, painPointsFound: 0, error: e.message });
    }
    await sleep(2000);
  }
  
  // Summary
  console.log('\n=== SCAN COMPLETE ===');
  const totalPosts = results.reduce((s, r) => s + (r.postsScanned || 0), 0);
  const totalPP = results.reduce((s, r) => s + (r.painPointsFound || 0), 0);
  console.log(`Subreddits scanned: ${results.length}`);
  console.log(`Total posts analyzed: ${totalPosts}`);
  console.log(`Pain points submitted: ${totalPP}`);
  for (const r of results) {
    console.log(`  r/${r.sub}: ${r.postsScanned} posts → ${r.painPointsFound} pain points${r.error ? ' [ERROR: '+r.error+']' : ''}`);
    if (r.titles?.length) {
      for (const t of r.titles) console.log(`    - ${t.substring(0, 70)}`);
    }
  }
  
  // Write results to file
  const summary = { agentId: AGENT_ID, timestamp: new Date().toISOString(), results, totalPosts, totalPP };
  require('fs').writeFileSync('/tmp/scan-elise-c-results.json', JSON.stringify(summary, null, 2));
  
  if (browser) {
    await browser.close().catch(() => {}); // don't actually close - admin handles it
    // Note: connectOverCDP disconnect doesn't close the browser
  }
  
  return summary;
}

main().then(r => {
  console.log('\nDone.');
  process.exit(0);
}).catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
