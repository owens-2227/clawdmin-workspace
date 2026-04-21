const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:49425/devtools/browser/c6b305a3-451a-4474-b8c6-8ca523cb77bd';
const AGENT_ID = 'elise-c';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const SUBREDDITS = [
  'cats', 'rawpetfood', 'ThriftStoreHauls', 'felinediabetes',
  'EatCheapAndHealthy', 'lawncare', 'houseplants', 'proplifting',
  'plantclinic', 'IndoorGarden'
];

const CATEGORY_MAP = {
  cats: 'Cats & Pets',
  rawpetfood: 'Cats & Pets',
  felinediabetes: 'Cats & Pets',
  ThriftStoreHauls: 'Thrifting',
  EatCheapAndHealthy: 'Cooking',
  lawncare: 'Gardening',
  houseplants: 'Plant Parents',
  proplifting: 'Plant Parents',
  plantclinic: 'Plant Parents',
  IndoorGarden: 'Plant Parents',
};

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function fetchSubredditJSON(sub) {
  const url = `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.data.children.map(c => c.data);
}

function isPainPoint(post) {
  if (post.stickied) return false;
  if (post.score < 5) return false;
  const text = (post.title + ' ' + (post.selftext || '')).toLowerCase();
  const painKeywords = [
    'help', 'how do i', 'how to', 'struggling', 'frustrated', 'problem',
    'issue', 'anyone else', 'is there a', 'app for', 'tool for', 'tracking',
    'manage', 'organize', 'can\'t find', 'annoying', 'wish', 'difficult',
    'hard to', 'need advice', 'recommendations', 'what do you use',
    'vet', 'insulin', 'glucose', 'diagnosis', 'sick', 'dying', 'diet',
    'thrift', 'find', 'score', 'haul', 'cheap', 'budget', 'afford',
    'lawn', 'dead', 'yellow', 'brown', 'dying', 'pest', 'weed', 'fungus',
    'plant', 'overwatered', 'underwatered', 'soil', 'propagate', 'root rot',
    'raw food', 'recipe', 'balanced', 'homemade', 'commercial',
  ];
  const excludeKeywords = ['lol', 'meme', 'cute', 'adorable', 'look at', 'my cat being'];
  const hasExclude = excludeKeywords.some(k => text.includes(k));
  const hasPain = painKeywords.some(k => text.includes(k));
  return hasPain && !hasExclude && post.num_comments >= 3;
}

function buildPainPointTitle(post) {
  // Create a concise title from the post title
  let title = post.title;
  if (title.length > 80) title = title.substring(0, 77) + '...';
  return title;
}

function buildDescription(post) {
  const body = post.selftext ? post.selftext.substring(0, 300) : '';
  const engagement = `Posted in r/${post.subreddit} with ${post.score} upvotes and ${post.num_comments} comments.`;
  if (body) {
    return `${body.substring(0, 200)}... ${engagement}`;
  }
  return `${post.title} ${engagement}`;
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  const category = CATEGORY_MAP[sub] || 'General';
  let posts = [];
  
  // Try browser approach first
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
    
    // Check if we got content
    const title = await page.title();
    console.log(`  Page title: ${title}`);
    
    // Try to extract post data via JSON API as primary method (more reliable)
    throw new Error('Use JSON API for reliability');
  } catch (e) {
    console.log(`  Using JSON API fallback for r/${sub}`);
  }
  
  // Use JSON API
  try {
    posts = await fetchSubredditJSON(sub);
    console.log(`  Fetched ${posts.length} posts via JSON API`);
  } catch (e) {
    console.error(`  Failed to fetch r/${sub}: ${e.message}`);
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID, subreddit: `r/${sub}`, postsScanned: 0,
      painPointsFound: 0, status: 'error'
    });
    return 0;
  }
  
  // Filter posts
  const nonStickied = posts.filter(p => !p.stickied);
  const painPosts = nonStickied.filter(isPainPoint);
  console.log(`  ${nonStickied.length} posts scanned, ${painPosts.length} pain points found`);
  
  let submitted = 0;
  for (const post of painPosts.slice(0, 5)) { // Cap at 5 per subreddit
    try {
      const ppRes = await apiPost('/api/pain-points', {
        title: buildPainPointTitle(post),
        description: buildDescription(post),
        category,
        subreddit: `r/${sub}`,
        discoveredBy: AGENT_ID,
      });
      
      console.log(`  Created pain point: ${ppRes.id || JSON.stringify(ppRes).substring(0, 80)}`);
      
      if (ppRes.id) {
        const postUrl = `https://reddit.com/r/${sub}/comments/${post.id}/`;
        await apiPost('/api/pain-points/posts', {
          painPointId: ppRes.id,
          redditPostId: post.id,
          redditUrl: postUrl,
          postTitle: post.title,
          postBody: (post.selftext || '').substring(0, 2000),
          upvotes: post.score,
          commentCount: post.num_comments,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID,
        });
      }
      submitted++;
    } catch (e) {
      console.error(`  Error submitting pain point: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  
  // Log scan result
  await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${sub}`,
    postsScanned: nonStickied.length,
    painPointsFound: submitted,
    status: 'completed',
  });
  
  return submitted;
}

async function main() {
  console.log('Connecting to AdsPower browser via CDP...');
  const browser = await chromium.connectOverCDP(CDP_URL);
  console.log('Connected!');
  
  const context = browser.contexts()[0];
  const pages = context.pages();
  
  // Close extra tabs
  for (let i = 1; i < pages.length; i++) await pages[i].close();
  const page = pages[0] || await context.newPage();
  
  let totalPainPoints = 0;
  const results = [];
  
  for (const sub of SUBREDDITS) {
    const count = await scanSubreddit(page, sub);
    totalPainPoints += count;
    results.push({ sub, count });
    await new Promise(r => setTimeout(r, 2000)); // Pause between subreddits
  }
  
  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${SUBREDDITS.length}`);
  console.log(`Total pain points submitted: ${totalPainPoints}`);
  for (const r of results) {
    console.log(`  r/${r.sub}: ${r.count} pain points`);
  }
  
  // Don't close browser — admin handles that
  await browser.close(); // Just disconnect, not stop
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
