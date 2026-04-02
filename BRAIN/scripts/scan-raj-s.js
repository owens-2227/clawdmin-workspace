const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:50153/devtools/browser/c18c99e2-0b4a-43cc-8f5b-140638eed70f';
const AGENT_ID = 'raj-s';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const SUBREDDITS = ['AnalogCommunity', 'streetphotography', 'MechanicalKeyboards', 'photocritique'];

const CATEGORY_MAP = {
  AnalogCommunity: 'Photography',
  streetphotography: 'Photography',
  MechanicalKeyboards: 'Mechanical Keyboards',
  photocritique: 'Photography',
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
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function isPainPoint(post) {
  const { title, selftext, score, num_comments, stickied, is_self } = post;
  if (stickied) return false;
  if (score < 5) return false;
  
  const text = (title + ' ' + (selftext || '')).toLowerCase();
  
  // Positive signals
  const painSignals = [
    'how do i', 'how to', 'is there an app', 'is there a tool', 'recommend',
    'frustrat', 'annoying', 'annoyed', 'struggle', 'struggling', 'hard to',
    'difficult', 'problem with', 'issue with', 'hate that', 'wish there was',
    'need help', 'help me', 'anyone else', 'does anyone', 'best way to',
    'workflow', 'organize', 'track', 'manage', 'automat', 'manually',
    'too expensive', 'too complex', 'complicated', 'confusing', 'overwhelm',
    'cant find', "can't find", 'looking for', 'solution', 'alternative to',
    'help identifying', 'advice', 'tips for', 'newbie', 'beginner',
    'mistake', 'error', 'wrong', 'broken', 'fix',
  ];
  
  // Exclude signals
  const excludeSignals = [
    'check out my', 'just finished', 'i made', 'sharing my', 'proud of',
    '[oc]', 'my first', 'rate my', 'critique my',
  ];
  
  // Pure image posts without text body are less interesting (unless photocritique which often is)
  // For photocritique, include posts asking for feedback
  
  const hasExclude = excludeSignals.some(s => text.includes(s));
  if (hasExclude && !text.includes('help') && !text.includes('advice')) return false;
  
  const hasPain = painSignals.some(s => text.includes(s));
  if (hasPain) return true;
  
  // High engagement might indicate a common pain
  if (num_comments >= 30 && score >= 50) return true;
  
  return false;
}

function buildPainPointFromPost(post, sub) {
  const { title, selftext, score, num_comments, id, permalink, url } = post;
  
  // Generate a clean pain point title (max 80 chars)
  let ppTitle = title.length > 80 ? title.substring(0, 77) + '...' : title;
  
  // Build description
  const bodySnippet = selftext ? selftext.substring(0, 300).replace(/\n+/g, ' ').trim() : '';
  let desc = `In r/${sub}, a user asks: "${title.substring(0, 120)}".`;
  if (bodySnippet) desc += ` Details: ${bodySnippet}`;
  if (desc.length > 500) desc = desc.substring(0, 497) + '...';
  
  return {
    title: ppTitle,
    description: desc,
    category: CATEGORY_MAP[sub] || 'Photography',
    subreddit: `r/${sub}`,
    discoveredBy: AGENT_ID,
    post: {
      redditPostId: id,
      redditUrl: `https://reddit.com${permalink}`,
      postTitle: title,
      postBody: (selftext || '').substring(0, 2000),
      upvotes: score,
      commentCount: num_comments,
      subreddit: `r/${sub}`,
      discoveredBy: AGENT_ID,
    }
  };
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  let posts = [];
  let usedFallback = false;
  
  // Try browser-based approach first
  try {
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);
    
    // Scroll to load posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);
    
    // Take snapshot to check what loaded
    const snapshot = await page.evaluate(() => document.body.innerText);
    console.log(`Page loaded, text length: ${snapshot.length}`);
    
    // If page seems empty or has login wall, fall back to JSON
    if (snapshot.length < 1000 || snapshot.includes('Log In') && snapshot.length < 5000) {
      console.log('Browser page seems thin, falling back to JSON API...');
      usedFallback = true;
    }
  } catch (e) {
    console.log(`Browser navigation failed: ${e.message}, using JSON fallback`);
    usedFallback = true;
  }
  
  // Always use JSON API for reliable post data extraction
  try {
    console.log(`Fetching r/${sub} via JSON API...`);
    const data = await fetchSubredditJSON(sub);
    const children = data.data?.children || [];
    posts = children.map(c => c.data).filter(p => p && !p.stickied);
    console.log(`Got ${posts.length} posts from JSON API`);
  } catch (e) {
    console.log(`JSON API failed: ${e.message}`);
    return { postsScanned: 0, painPointsFound: 0, error: e.message };
  }
  
  // Analyze posts for pain points
  const painPoints = [];
  for (const post of posts) {
    if (isPainPoint(post)) {
      const pp = buildPainPointFromPost(post, sub);
      painPoints.push(pp);
      console.log(`  Pain point: ${pp.title.substring(0, 60)}... (${post.score}↑ ${post.num_comments}💬)`);
    }
  }
  
  console.log(`Found ${painPoints.length} pain points out of ${posts.length} posts`);
  
  // Submit pain points
  for (const pp of painPoints) {
    try {
      const { post: postData, ...ppData } = pp;
      const result = await apiPost('/api/pain-points', ppData);
      const painPointId = result?.id || result?.data?.id;
      
      if (painPointId) {
        // Link source post
        await apiPost('/api/pain-points/posts', {
          painPointId,
          ...postData,
        });
        console.log(`  Submitted: ${ppData.title.substring(0, 50)}... (id: ${painPointId})`);
      } else {
        console.log(`  Warning: no ID returned for: ${ppData.title}`, JSON.stringify(result).substring(0, 200));
      }
      await sleep(500);
    } catch (e) {
      console.log(`  Error submitting pain point: ${e.message}`);
    }
  }
  
  // Log scan result
  await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${sub}`,
    postsScanned: posts.length,
    painPointsFound: painPoints.length,
    status: 'completed',
  });
  
  await sleep(2000);
  return { postsScanned: posts.length, painPointsFound: painPoints.length, painPoints: painPoints.map(p => p.title) };
}

async function main() {
  console.log('Connecting to AdsPower browser via CDP...');
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected!');
  } catch (e) {
    console.error('Failed to connect via CDP:', e.message);
    process.exit(1);
  }
  
  const context = browser.contexts()[0];
  const pages = context.pages();
  
  // Close extra tabs, keep one
  for (let i = 1; i < pages.length; i++) {
    try { await pages[i].close(); } catch {}
  }
  const page = pages[0] || await context.newPage();
  
  const results = {};
  let totalPosts = 0;
  let totalPainPoints = 0;
  const allPainPoints = [];
  
  for (const sub of SUBREDDITS) {
    try {
      const result = await scanSubreddit(page, sub);
      results[sub] = result;
      totalPosts += result.postsScanned || 0;
      totalPainPoints += result.painPointsFound || 0;
      if (result.painPoints) allPainPoints.push(...result.painPoints);
    } catch (e) {
      console.log(`Error scanning r/${sub}: ${e.message}`);
      results[sub] = { error: e.message };
    }
    await sleep(3000);
  }
  
  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${SUBREDDITS.length}`);
  console.log(`Total posts analyzed: ${totalPosts}`);
  console.log(`Pain points found: ${totalPainPoints}`);
  console.log('\nPain points:');
  allPainPoints.forEach((pp, i) => console.log(`  ${i+1}. ${pp}`));
  console.log('\nPer-subreddit results:');
  console.log(JSON.stringify(results, null, 2));
  
  // Don't close browser — admin handles that
  process.exit(0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
