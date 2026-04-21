const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:59561/devtools/browser/dd8b33ab-cb0d-4bc8-8679-974fb7f741ed';
const AGENT_ID = 'jess-m';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const SUBREDDITS = [
  { name: 'gardening', category: 'Gardening' },
  { name: 'beyondthebump', category: 'New Moms' },
  { name: 'Mommit', category: 'New Moms' },
  { name: 'running', category: 'Fitness' },
  { name: 'xxfitness', category: 'Fitness' },
  { name: 'ADHD', category: 'ADHD & Neurodivergent' },
  { name: 'languagelearning', category: 'Language Learning' },
  { name: 'remotework', category: 'Remote Work' },
  { name: 'productivity', category: 'Productivity' },
  { name: 'Meditation', category: 'Mental Health' },
  { name: 'Anxiety', category: 'Mental Health' },
];

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function apiPost(path, body) {
  const fetch = (await import('node-fetch')).default;
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

async function submitPainPoint(title, description, category, subreddit) {
  const result = await apiPost('/api/pain-points', {
    title,
    description,
    category,
    subreddit: `r/${subreddit}`,
    discoveredBy: AGENT_ID,
  });
  console.log(`  [pain-point created] id=${result.id || result} title="${title}"`);
  return result.id || result.data?.id;
}

async function submitSource(painPointId, redditPostId, redditUrl, postTitle, postBody, upvotes, commentCount, subreddit) {
  if (!painPointId) return;
  await apiPost('/api/pain-points/posts', {
    painPointId,
    redditPostId,
    redditUrl,
    postTitle,
    postBody: (postBody || '').slice(0, 2000),
    upvotes,
    commentCount,
    subreddit: `r/${subreddit}`,
    discoveredBy: AGENT_ID,
  });
  console.log(`  [source linked] painPointId=${painPointId} post=${redditPostId}`);
}

async function logScan(subreddit, postsScanned, painPointsFound, status = 'completed') {
  await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned,
    painPointsFound,
    status,
  });
  console.log(`  [scan-log] r/${subreddit} postsScanned=${postsScanned} painPointsFound=${painPointsFound} status=${status}`);
}

async function fetchSubredditJSON(sub) {
  const fetch = (await import('node-fetch')).default;
  const url = `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
      timeout: 15000,
    });
    const data = await res.json();
    return data?.data?.children?.map(c => c.data) || [];
  } catch (e) {
    console.log(`  [json-fallback failed] ${e.message}`);
    return [];
  }
}

// Analyze post list for pain points — returns array of {title, description, post}
function analyzePosts(posts, subreddit) {
  const painPoints = [];
  
  for (const post of posts) {
    if (post.stickied) continue;
    if ((post.score || 0) < 5) continue;
    
    const title = (post.title || '').toLowerCase();
    const selftext = (post.selftext || '').toLowerCase();
    const combined = title + ' ' + selftext;
    
    // Pain point signals
    const signals = [
      /is there an? (app|tool|way|method|system|software|plugin|extension)/i,
      /how do (you|i|people) (manage|track|organize|handle|deal with|keep track)/i,
      /struggling (with|to)/i,
      /can't (figure out|find|seem to)/i,
      /anyone else (have|deal with|struggle|find|notice)/i,
      /what('s| is) (your|the best|a good) (way|method|system|tool|app)/i,
      /so (hard|difficult|frustrating|annoying|overwhelming)/i,
      /wish (there was|i could|someone would|there were)/i,
      /looking for (a|an|something|recommendations|advice|help)/i,
      /does anyone (know|have|use|recommend)/i,
      /any (app|tool|tips|advice|recommendations|suggestions) for/i,
      /need (help|advice|suggestions|a system|a way|an app|a tool)/i,
      /frustrated (with|by|that)/i,
      /manually (doing|tracking|entering|logging|recording)/i,
      /too (expensive|complicated|complex|hard|overwhelming)/i,
      /keep forgetting/i,
      /hard to (stay|keep|maintain|track|manage|remember)/i,
      /overwhelming/i,
    ];
    
    const hasSignal = signals.some(s => s.test(combined));
    if (!hasSignal) continue;
    if (post.is_gallery && !post.selftext) continue; // pure image post
    
    painPoints.push(post);
  }
  
  return painPoints;
}

function buildPainPointData(post, category, subreddit) {
  const title = post.title;
  const body = post.selftext || '';
  
  // Create a clean short description
  let desc = '';
  if (body && body.length > 30) {
    desc = body.slice(0, 300).replace(/\n+/g, ' ').trim();
    if (desc.length === 300) desc += '...';
  }
  
  // Build a descriptive pain point title (max 80 chars)
  let ppTitle = title.length <= 80 ? title : title.slice(0, 77) + '...';
  
  // Build description
  let ppDesc = '';
  if (desc) {
    ppDesc = `User in r/${subreddit} reports: "${desc}" (${post.score} upvotes, ${post.num_comments} comments)`;
  } else {
    ppDesc = `User in r/${subreddit} asks: "${title}" (${post.score} upvotes, ${post.num_comments} comments)`;
  }
  ppDesc = ppDesc.slice(0, 500);
  
  return { ppTitle, ppDesc };
}

async function scanSubredditViaBrowser(page, sub, category) {
  console.log(`\n=== Scanning r/${sub} ===`);
  let postsScanned = 0;
  let painPointsFound = 0;
  
  try {
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);
    
    // Check for login wall or captcha
    const url = page.url();
    if (url.includes('login') || url.includes('captcha')) {
      console.log(`  [blocked] redirected to ${url}`);
      await logScan(sub, 0, 0, 'blocked');
      return { postsScanned: 0, painPointsFound: 0 };
    }
    
    // Scroll to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);
    
    // Try to get posts from page
    const pageContent = await page.content();
    
    // Use JSON API as reliable fallback — works well alongside browser session
    console.log(`  [fetching JSON] r/${sub}`);
    const posts = await fetchSubredditJSON(sub);
    
    if (posts.length === 0) {
      console.log(`  [no posts found] trying again...`);
      await sleep(5000);
      const retryPosts = await fetchSubredditJSON(sub);
      if (retryPosts.length === 0) {
        await logScan(sub, 0, 0, 'error');
        return { postsScanned: 0, painPointsFound: 0 };
      }
      posts.push(...retryPosts);
    }
    
    postsScanned = posts.filter(p => !p.stickied).length;
    console.log(`  [posts loaded] ${postsScanned} non-stickied posts`);
    
    const painPosts = analyzePosts(posts, sub);
    console.log(`  [pain signals] ${painPosts.length} posts with pain signals`);
    
    // Submit up to 5 pain points per subreddit
    const toSubmit = painPosts.slice(0, 5);
    for (const post of toSubmit) {
      const { ppTitle, ppDesc } = buildPainPointData(post, category, sub);
      try {
        const ppId = await submitPainPoint(ppTitle, ppDesc, category, sub);
        await sleep(500);
        
        const postId = post.id;
        const postUrl = `https://reddit.com${post.permalink}`;
        await submitSource(ppId, postId, postUrl, post.title, post.selftext, post.score, post.num_comments, sub);
        painPointsFound++;
        await sleep(500);
      } catch (e) {
        console.log(`  [submit error] ${e.message}`);
      }
    }
    
    await logScan(sub, postsScanned, painPointsFound);
    return { postsScanned, painPointsFound };
    
  } catch (e) {
    console.log(`  [error] ${e.message}`);
    await logScan(sub, postsScanned, painPointsFound, 'error');
    return { postsScanned, painPointsFound };
  }
}

async function main() {
  console.log(`[jess-m] Starting Reddit scan — ${SUBREDDITS.length} subreddits`);
  console.log(`[jess-m] CDP: ${CDP_URL}`);
  
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('[connected] Browser connected via CDP');
    
    const context = browser.contexts()[0];
    if (!context) throw new Error('No browser context found');
    
    const pages = context.pages();
    // Close extra tabs
    for (let i = 1; i < pages.length; i++) {
      try { await pages[i].close(); } catch {}
    }
    const page = pages[0] || await context.newPage();
    console.log(`[setup] Using page, ${pages.length} tabs found`);
    
    const totals = { postsScanned: 0, painPointsFound: 0 };
    const results = [];
    
    for (const { name, category } of SUBREDDITS) {
      const result = await scanSubredditViaBrowser(page, name, category);
      totals.postsScanned += result.postsScanned;
      totals.painPointsFound += result.painPointsFound;
      results.push({ subreddit: name, ...result });
      
      // Pacing between subreddits
      await sleep(3000);
    }
    
    console.log('\n=== SCAN COMPLETE ===');
    console.log(`Subreddits scanned: ${SUBREDDITS.length}`);
    console.log(`Total posts analyzed: ${totals.postsScanned}`);
    console.log(`Pain points discovered: ${totals.painPointsFound}`);
    console.log('\nBreakdown:');
    for (const r of results) {
      console.log(`  r/${r.subreddit}: ${r.postsScanned} posts, ${r.painPointsFound} pain points`);
    }
    
    // Don't disconnect — admin handles browser lifecycle
    process.exit(0);
    
  } catch (e) {
    console.error('[fatal]', e.message);
    process.exit(1);
  }
}

main();
