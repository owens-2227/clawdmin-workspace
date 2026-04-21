const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:59924/devtools/browser/829255e2-559d-4ac0-ab81-300ecabcdcf5';
const AGENT_ID = 'elise-c';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const SUBREDDITS = [
  { name: 'cats', category: 'Cats & Pets' },
  { name: 'rawpetfood', category: 'Cats & Pets' },
  { name: 'ThriftStoreHauls', category: 'Thrifting' },
  { name: 'felinediabetes', category: 'Cats & Pets' },
  { name: 'EatCheapAndHealthy', category: 'Cooking' },
  { name: 'lawncare', category: 'Gardening' },
  { name: 'houseplants', category: 'Plant Parents' },
  { name: 'proplifting', category: 'Plant Parents' },
  { name: 'plantclinic', category: 'Plant Parents' },
  { name: 'IndoorGarden', category: 'Plant Parents' },
];

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function apiPost(path, data) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify(data),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function submitPainPoint(painPoint, sourcePost) {
  try {
    const pp = await apiPost('/api/pain-points', painPoint);
    const ppId = pp.id || pp.data?.id || pp.painPoint?.id;
    if (ppId && sourcePost) {
      await apiPost('/api/pain-points/posts', {
        painPointId: ppId,
        ...sourcePost,
        discoveredBy: AGENT_ID,
      });
    }
    return ppId;
  } catch (e) {
    console.error('Error submitting pain point:', e.message);
    return null;
  }
}

async function logScan(subreddit, postsScanned, painPointsFound, status = 'completed') {
  try {
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${subreddit}`,
      postsScanned,
      painPointsFound,
      status,
    });
    console.log(`Logged scan for r/${subreddit}: ${postsScanned} posts, ${painPointsFound} pain points`);
  } catch (e) {
    console.error('Error logging scan:', e.message);
  }
}

async function getSubredditPostsViaJSON(subredditName) {
  try {
    const url = `https://www.reddit.com/r/${subredditName}/hot.json?limit=25&raw_json=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });
    const data = await res.json();
    return data?.data?.children?.map(c => c.data) || [];
  } catch (e) {
    console.error(`JSON fallback failed for r/${subredditName}:`, e.message);
    return [];
  }
}

async function scanSubreddit(page, subredditName, category) {
  console.log(`\n=== Scanning r/${subredditName} ===`);
  let posts = [];
  let usedFallback = false;

  try {
    await page.goto(`https://www.reddit.com/r/${subredditName}/hot/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await sleep(3000);

    // Check for CAPTCHA or error
    const pageContent = await page.content();
    if (pageContent.includes('captcha') || pageContent.includes('CAPTCHA')) {
      console.log(`CAPTCHA detected on r/${subredditName}, using JSON fallback`);
      posts = await getSubredditPostsViaJSON(subredditName);
      usedFallback = true;
    } else {
      // Scroll to load more posts
      for (let i = 0; i < 6; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
        await sleep(2000);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(1000);

      // Try to extract posts from page
      const snapshot = await page.content();
      
      // Use JSON API for structured data (more reliable)
      posts = await getSubredditPostsViaJSON(subredditName);
      usedFallback = true;
    }
  } catch (e) {
    console.error(`Browser error for r/${subredditName}: ${e.message}`);
    console.log('Using JSON API fallback...');
    posts = await getSubredditPostsViaJSON(subredditName);
    usedFallback = true;
  }

  if (posts.length === 0) {
    console.log(`No posts found for r/${subredditName}`);
    await logScan(subredditName, 0, 0, 'error');
    return { postsScanned: 0, painPointsFound: 0 };
  }

  console.log(`Got ${posts.length} posts from r/${subredditName}`);

  // Filter out stickied/low score/pure image posts
  const filtered = posts.filter(p => 
    !p.stickied && 
    p.score >= 5 && 
    (p.selftext || p.title) &&
    !p.is_video
  );

  console.log(`${filtered.length} posts after filtering`);

  // Analyze for pain points
  const painPointKeywords = [
    'how do i', 'is there an app', 'tool for', 'wish there was', 'frustrated', 
    'struggling', 'problem with', 'annoying', 'anyone else', 'help me', 
    'recommendation', 'advice', 'manually', 'track', 'organize', 'manage',
    'can\'t find', 'looking for', 'need help', 'question', 'confused',
    'too expensive', 'too complex', 'too complicated', 'doesn\'t work',
    'overwhelmed', 'hard to', 'difficult to', 'hate when', 'why is it',
    'keeps happening', 'every time', 'no good', 'best way to', 'tips for',
    'what do you use', 'software', 'spreadsheet', 'tracking', 'routine'
  ];

  const painPoints = [];

  for (const post of filtered.slice(0, 25)) {
    const titleLower = (post.title || '').toLowerCase();
    const bodyLower = (post.selftext || '').toLowerCase();
    const combined = titleLower + ' ' + bodyLower;

    const hasPainKeyword = painPointKeywords.some(kw => combined.includes(kw));
    
    // Also check for question posts and help requests
    const isQuestion = post.link_flair_text?.toLowerCase().includes('question') ||
                       post.link_flair_text?.toLowerCase().includes('help') ||
                       titleLower.startsWith('?') ||
                       titleLower.includes('?');

    if (hasPainKeyword || isQuestion) {
      // Check it's not a meme/celebration/pure venting
      const excludeKeywords = ['just wanted to share', 'look at my', 'introducing', 'meet my', 
                                'adoption', 'cute', 'beautiful', 'adorable', 'lovely', 'love my'];
      const isExcluded = excludeKeywords.some(kw => combined.includes(kw)) && 
                         !hasPainKeyword;
      
      if (!isExcluded) {
        painPoints.push({
          post,
          matched: painPointKeywords.filter(kw => combined.includes(kw))
        });
      }
    }
  }

  console.log(`Found ${painPoints.length} potential pain points`);

  // Submit top pain points (cap at 5 per subreddit to avoid spam)
  let submitted = 0;
  for (const { post } of painPoints.slice(0, 5)) {
    const title = post.title.substring(0, 80);
    const bodyPreview = (post.selftext || '').substring(0, 500);
    
    // Create a descriptive pain point
    let description = `Reddit users in r/${subredditName} are experiencing: "${post.title}". `;
    if (bodyPreview) {
      description += bodyPreview.substring(0, 200);
    }
    description = description.substring(0, 500);

    const ppId = await submitPainPoint(
      {
        title: title,
        description: description,
        category: category,
        subreddit: `r/${subredditName}`,
        discoveredBy: AGENT_ID,
      },
      {
        redditPostId: post.id,
        redditUrl: `https://reddit.com${post.permalink}`,
        postTitle: post.title,
        postBody: (post.selftext || '').substring(0, 2000),
        upvotes: post.score,
        commentCount: post.num_comments,
        subreddit: `r/${subredditName}`,
      }
    );

    if (ppId) {
      submitted++;
      console.log(`  ✓ Submitted: "${title}"`);
    }

    await sleep(500);
  }

  await logScan(subredditName, filtered.length, submitted);
  await sleep(2000); // Pacing between subreddits

  return { postsScanned: filtered.length, painPointsFound: submitted };
}

async function main() {
  console.log('Elise-C Reddit Scanner starting...');
  console.log(`CDP URL: ${CDP_URL}`);
  console.log(`Subreddits: ${SUBREDDITS.map(s => s.name).join(', ')}`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected to AdsPower browser via CDP');
  } catch (e) {
    console.error('Failed to connect via CDP:', e.message);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const pages = context.pages();
  
  // Close extra tabs
  for (let i = 1; i < pages.length; i++) {
    try { await pages[i].close(); } catch {}
  }
  
  const page = pages[0] || await context.newPage();
  console.log(`Using page: ${await page.url()}`);

  const results = {
    totalPostsScanned: 0,
    totalPainPointsFound: 0,
    subredditsScanned: 0,
    errors: [],
    painPoints: [],
  };

  for (const { name, category } of SUBREDDITS) {
    try {
      const { postsScanned, painPointsFound } = await scanSubreddit(page, name, category);
      results.totalPostsScanned += postsScanned;
      results.totalPainPointsFound += painPointsFound;
      results.subredditsScanned++;
    } catch (e) {
      console.error(`Error scanning r/${name}:`, e.message);
      results.errors.push({ subreddit: name, error: e.message });
      await logScan(name, 0, 0, 'error');
    }
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${results.subredditsScanned}/${SUBREDDITS.length}`);
  console.log(`Total posts analyzed: ${results.totalPostsScanned}`);
  console.log(`Pain points submitted: ${results.totalPainPointsFound}`);
  if (results.errors.length > 0) {
    console.log(`Errors: ${JSON.stringify(results.errors)}`);
  }

  // Don't close the browser - admin handles that
  await browser.close().catch(() => {}); // Just disconnect, not close
  
  return results;
}

main().then(results => {
  console.log('Final results:', JSON.stringify(results, null, 2));
  process.exit(0);
}).catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
