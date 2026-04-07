const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:61681/devtools/browser/3829fec1-5474-4df0-a414-c434a9bd371a';
const AGENT_ID = 'priya-k';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const SUBREDDITS = ['Meditation', 'Anxiety', 'therapists', 'Journaling'];

const CATEGORY_MAP = {
  'Meditation': 'Mental Health',
  'Anxiety': 'Mental Health',
  'therapists': 'Therapy',
  'Journaling': 'Journaling',
};

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function submitPainPoint(pp) {
  const result = await apiPost('/api/pain-points', {
    title: pp.title.slice(0, 80),
    description: pp.description,
    category: pp.category,
    subreddit: pp.subreddit,
    discoveredBy: AGENT_ID,
  });
  console.log(`  ✅ Pain point created: ${result.id || JSON.stringify(result)}`);
  return result.id || result.data?.id;
}

async function submitPost(painPointId, post) {
  const result = await apiPost('/api/pain-points/posts', {
    painPointId,
    redditPostId: post.redditPostId,
    redditUrl: post.redditUrl,
    postTitle: post.postTitle,
    postBody: (post.postBody || '').slice(0, 2000),
    upvotes: post.upvotes,
    commentCount: post.commentCount,
    subreddit: post.subreddit,
    discoveredBy: AGENT_ID,
  });
  console.log(`  ✅ Post linked: ${JSON.stringify(result).slice(0, 100)}`);
}

async function logScan(subreddit, postsScanned, painPointsFound, status = 'completed') {
  await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned,
    painPointsFound,
    status,
  });
  console.log(`  📝 Logged scan for r/${subreddit}: ${postsScanned} posts, ${painPointsFound} pain points`);
}

async function fetchSubredditJSON(subreddit) {
  const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=25&raw_json=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
  });
  const data = await res.json();
  return data?.data?.children?.map(c => c.data) || [];
}

function extractPostId(url) {
  const m = url.match(/\/comments\/([a-z0-9]+)\//i);
  return m ? m[1] : url.split('/').filter(Boolean).pop();
}

function isPainPoint(post) {
  if (post.stickied || post.pinned) return false;
  if (post.score < 5) return false;
  // Need text content
  const text = (post.title + ' ' + (post.selftext || '')).toLowerCase();
  
  // Exclusions
  if (text.includes('meme') || text.includes('humor')) return false;
  
  // Pain point signals
  const signals = [
    'how do i', 'how to', 'struggling with', 'can\'t find', 'can\'t seem',
    'is there an app', 'is there a tool', 'wish there was', 'anyone know',
    'frustrated', 'frustrating', 'hard to', 'difficult to', 'problem with',
    'keep forgetting', 'can\'t stick', 'can\'t stay', 'don\'t know how',
    'need help', 'advice', 'recommendation', 'looking for', 'help me',
    'overwhelmed', 'anxious', 'anxiety', 'track', 'organize', 'manage',
    'habit', 'routine', 'consistent', 'accountability', 'app', 'tool',
    'journal', 'meditate', 'meditation', 'therapist', 'therapy', 'finding',
    'afford', 'expensive', 'cost', 'free', 'budget', 'waitlist',
    'too many', 'complicated', 'confusing', 'lost', 'overwhelm',
    'progress', 'measure', 'track my', 'how long', 'how often',
  ];
  
  return signals.some(s => text.includes(s));
}

function buildPainPointFromPost(post, subreddit) {
  const category = CATEGORY_MAP[subreddit] || 'Mental Health';
  const title = post.title.slice(0, 80);
  const body = post.selftext || '';
  
  // Build a 2-3 sentence description
  let desc = `Reddit users in r/${subreddit} are dealing with: "${post.title}".`;
  if (body && body.length > 20) {
    desc += ` ${body.slice(0, 200).replace(/\n/g, ' ')}`;
  }
  desc = desc.slice(0, 400);
  
  return {
    title,
    description: desc,
    category,
    subreddit: `r/${subreddit}`,
    redditPostId: post.id,
    redditUrl: `https://reddit.com${post.permalink}`,
    postTitle: post.title,
    postBody: body,
    upvotes: post.score,
    commentCount: post.num_comments,
  };
}

async function scanSubredditViaBrowser(page, subreddit) {
  console.log(`\n🔍 Scanning r/${subreddit} via browser...`);
  
  try {
    await page.goto(`https://www.reddit.com/r/${subreddit}/hot/`, { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000 
    });
    await sleep(3000);
    
    // Scroll to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);
    
    // Take snapshot to read content
    const content = await page.content();
    
    // Check for CAPTCHA or login wall
    if (content.includes('verify you are human') || content.includes('captcha') || 
        content.includes('reddit.com/login')) {
      console.log(`  ⚠️ Hit CAPTCHA/login wall on r/${subreddit}, falling back to JSON API`);
      return null; // signal fallback
    }
    
    console.log(`  ✅ Browser loaded r/${subreddit}, page size: ${content.length} chars`);
    return content;
  } catch (err) {
    console.log(`  ⚠️ Browser error on r/${subreddit}: ${err.message}, falling back to JSON API`);
    return null;
  }
}

async function scanSubreddit(page, subreddit) {
  console.log(`\n📡 Starting r/${subreddit}...`);
  const painPointsSubmitted = [];
  
  // Try browser first
  const browserContent = await scanSubredditViaBrowser(page, subreddit);
  
  // Always use JSON API for reliable data extraction
  console.log(`  📥 Fetching posts via JSON API...`);
  let posts = [];
  try {
    posts = await fetchSubredditJSON(subreddit);
    console.log(`  📦 Got ${posts.length} posts`);
  } catch (err) {
    console.log(`  ❌ JSON API failed: ${err.message}`);
    await logScan(subreddit, 0, 0, 'error');
    return { postsScanned: 0, painPointsFound: 0 };
  }
  
  await sleep(2000);
  
  // Filter for pain points
  const actionablePosts = posts.filter(isPainPoint);
  console.log(`  🎯 ${actionablePosts.length} actionable pain points from ${posts.length} posts`);
  
  // Submit top pain points (max 5 per subreddit)
  const toSubmit = actionablePosts.slice(0, 5);
  
  for (const post of toSubmit) {
    const pp = buildPainPointFromPost(post, subreddit);
    console.log(`\n  📌 Submitting: "${pp.title}" (${pp.upvotes} upvotes, ${pp.commentCount} comments)`);
    
    try {
      const ppId = await submitPainPoint(pp);
      if (ppId) {
        await submitPost(ppId, pp);
        painPointsSubmitted.push(pp.title);
      }
    } catch (err) {
      console.log(`  ⚠️ Submit error: ${err.message}`);
    }
    
    await sleep(1000);
  }
  
  // Log scan results
  await logScan(subreddit, posts.length, painPointsSubmitted.length);
  
  return { 
    postsScanned: posts.length, 
    painPointsFound: painPointsSubmitted.length,
    painPoints: painPointsSubmitted,
  };
}

async function main() {
  console.log('🚀 Priya-K scanner starting...');
  console.log(`📡 Connecting to CDP: ${CDP_URL}`);
  
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('✅ Connected to AdsPower browser');
  } catch (err) {
    console.error(`❌ Failed to connect: ${err.message}`);
    process.exit(1);
  }
  
  const context = browser.contexts()[0];
  const pages = context.pages();
  
  // Close extra tabs, keep one
  for (let i = 1; i < pages.length; i++) {
    try { await pages[i].close(); } catch {}
  }
  const page = pages[0] || await context.newPage();
  
  console.log(`📄 Working with page: ${await page.title() || '(no title)'}`);
  
  const results = {
    subredditsScanned: 0,
    totalPostsAnalyzed: 0,
    allPainPoints: [],
    errors: [],
  };
  
  for (const subreddit of SUBREDDITS) {
    try {
      const result = await scanSubreddit(page, subreddit);
      results.subredditsScanned++;
      results.totalPostsAnalyzed += result.postsScanned;
      results.allPainPoints.push(...(result.painPoints || []));
    } catch (err) {
      console.log(`❌ Error scanning r/${subreddit}: ${err.message}`);
      results.errors.push(`r/${subreddit}: ${err.message}`);
      await logScan(subreddit, 0, 0, 'error');
    }
    
    // Pace between subreddits
    await sleep(3000);
  }
  
  // Do NOT disconnect/close the browser (admin handles that)
  
  console.log('\n🎉 Scan complete!');
  console.log('='.repeat(50));
  console.log(`📊 Subreddits scanned: ${results.subredditsScanned}`);
  console.log(`📰 Total posts analyzed: ${results.totalPostsAnalyzed}`);
  console.log(`💡 Pain points found: ${results.allPainPoints.length}`);
  if (results.allPainPoints.length > 0) {
    console.log('\nPain points discovered:');
    results.allPainPoints.forEach((pp, i) => console.log(`  ${i+1}. ${pp}`));
  }
  if (results.errors.length > 0) {
    console.log('\nErrors:');
    results.errors.forEach(e => console.log(`  - ${e}`));
  }
  
  return results;
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
