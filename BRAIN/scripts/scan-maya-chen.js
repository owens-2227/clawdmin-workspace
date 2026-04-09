const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:60405/devtools/browser/8d506ff3-c215-4bee-a5f4-45d1b197ba84';
const AGENT_ID = 'maya-chen';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const SUBREDDITS = [
  { sub: 'personalfinance', category: 'Personal Finance' },
  { sub: 'frugal', category: 'Personal Finance' },
  { sub: 'cooking', category: 'Cooking' },
  { sub: 'solotravel', category: 'Solo Travel' },
];

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function apiPost(path, body) {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function submitPainPoint(title, description, category, subreddit) {
  const result = await apiPost('/api/pain-points', {
    title,
    description,
    category,
    subreddit: `r/${subreddit}`,
    discoveredBy: AGENT_ID,
  });
  return result;
}

async function submitRedditPost(painPointId, post, subreddit) {
  return await apiPost('/api/pain-points/posts', {
    painPointId,
    redditPostId: post.id,
    redditUrl: `https://reddit.com${post.permalink}`,
    postTitle: post.title,
    postBody: (post.body || '').slice(0, 2000),
    upvotes: post.score,
    commentCount: post.numComments,
    subreddit: `r/${subreddit}`,
    discoveredBy: AGENT_ID,
  });
}

async function logScan(subreddit, postsScanned, painPointsFound, status) {
  return await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned,
    painPointsFound,
    status,
  });
}

async function scanSubreddit(page, sub, category) {
  console.log(`\n=== Scanning r/${sub} ===`);
  let postsScanned = 0;
  let painPointsFound = 0;
  const painPoints = [];

  try {
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await sleep(3000);

    // Take snapshot of the listing page
    const content = await page.content();
    console.log(`Loaded r/${sub} - page length: ${content.length}`);

    // Try to get post data from Reddit's JSON API for reliability
    await page.goto(`https://www.reddit.com/r/${sub}/hot.json?limit=25`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await sleep(2000);

    const jsonText = await page.evaluate(() => document.body.innerText);
    let posts = [];
    
    try {
      const data = JSON.parse(jsonText);
      posts = data.data.children
        .filter(p => !p.data.stickied && p.data.score >= 5)
        .map(p => ({
          id: p.data.id,
          title: p.data.title,
          score: p.data.score,
          numComments: p.data.num_comments,
          permalink: p.data.permalink,
          body: p.data.selftext,
          url: p.data.url,
        }));
      console.log(`Found ${posts.length} posts`);
    } catch (e) {
      console.log('Failed to parse JSON, trying HTML scrape');
    }

    // Read promising posts (10+ comments)
    const promisingPosts = posts.filter(p => p.numComments >= 10).slice(0, 15);
    console.log(`Promising posts (10+ comments): ${promisingPosts.length}`);

    for (const post of promisingPosts) {
      postsScanned++;
      console.log(`\nReading: "${post.title.slice(0, 80)}" (score: ${post.score}, comments: ${post.numComments})`);

      // Load post comments via JSON API
      await sleep(2500);
      try {
        await page.goto(`https://www.reddit.com${post.permalink}.json?limit=10`, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        await sleep(2000);

        const commentText = await page.evaluate(() => document.body.innerText);
        let topComments = '';
        try {
          const commentData = JSON.parse(commentText);
          const comments = commentData[1]?.data?.children || [];
          topComments = comments
            .filter(c => c.kind === 't1')
            .slice(0, 8)
            .map(c => c.data?.body || '')
            .join('\n---\n');
          post.topComments = topComments;
          post.body = post.body || commentData[0]?.data?.children?.[0]?.data?.selftext || '';
        } catch (e) {
          console.log('Could not parse comments JSON');
        }
      } catch (e) {
        console.log(`Error reading post: ${e.message}`);
      }

      // Analyze for pain points
      const fullText = `TITLE: ${post.title}\nBODY: ${post.body}\nCOMMENTS: ${post.topComments || ''}`;
      const painPoint = analyzePainPoint(post, fullText, sub, category);
      
      if (painPoint) {
        painPoints.push({ ...painPoint, post });
        console.log(`✓ Pain point found: ${painPoint.title}`);
      }
    }

    // Also scan high-score posts with few comments
    const highScorePosts = posts
      .filter(p => p.score >= 50 && p.numComments < 10)
      .slice(0, 5);
    
    for (const post of highScorePosts) {
      postsScanned++;
      const fullText = `TITLE: ${post.title}\nBODY: ${post.body}`;
      const painPoint = analyzePainPoint(post, fullText, sub, category);
      if (painPoint) {
        painPoints.push({ ...painPoint, post });
        console.log(`✓ Pain point found (high score): ${painPoint.title}`);
      }
    }

    // Submit pain points
    for (const pp of painPoints) {
      try {
        const result = await submitPainPoint(pp.title, pp.description, category, sub);
        console.log(`Submitted pain point: ${pp.title}`, result);
        
        const ppId = result?.painPoint?.id || result?.id || result?.data?.id;
        if (ppId) {
          await submitRedditPost(ppId, pp.post, sub);
        }
        painPointsFound++;
        await sleep(500);
      } catch (e) {
        console.log(`Error submitting pain point: ${e.message}`);
      }
    }

    await logScan(sub, postsScanned, painPointsFound, 'completed');
    console.log(`\nr/${sub} done: ${postsScanned} posts scanned, ${painPointsFound} pain points submitted`);

  } catch (e) {
    console.log(`Error scanning r/${sub}: ${e.message}`);
    await logScan(sub, postsScanned, painPointsFound, 'error');
  }

  return { postsScanned, painPointsFound };
}

function analyzePainPoint(post, fullText, sub, category) {
  const text = fullText.toLowerCase();
  const title = post.title.toLowerCase();

  // Skip memes, celebrations, pure venting
  const skipPatterns = [
    /^\[weekly\]/i, /^\[daily\]/i, /megathread/i, /ama\b/i,
    /i did it/i, /i finally/i, /celebrating/i, /so happy/i,
    /meme/i, /humor/i, /\bfunny\b/i,
  ];
  for (const p of skipPatterns) {
    if (p.test(post.title)) return null;
  }

  // Pain point indicators
  const painIndicators = [
    // App/tool requests
    /is there (an? |)(app|tool|service|website|software|platform|way to automate)/i,
    /app for (this|tracking|managing|organizing)/i,
    /looking for (an? |)(app|tool|service|software)/i,
    /recommend.*(app|tool|software|tracker)/i,
    /best (app|tool|software|way) to/i,
    /any (app|tool|software|service) that/i,

    // Frustration with current tools
    /too (expensive|complicated|complex|overwhelming|confusing)/i,
    /hate (using|that|how|the fact)/i,
    /frustrated (with|by|that)/i,
    /sick of (manually|doing|having to)/i,
    /wish (there was|i could|i had|someone would)/i,
    /why (is there no|isn't there|doesn't|can't)/i,
    /can't find (an? |)(good |)(app|tool|way)/i,
    /nothing (works|out there)/i,
    /struggle (with|to)/i,

    // Manual process that could be automated
    /manually (track|enter|log|record|calculate|update)/i,
    /spreadsheet (for|to track|doesn't)/i,
    /keeping track of/i,
    /hard to (keep track|manage|organize|remember|stay on top)/i,
    /forget to/i,

    // Specific pain patterns per category
    ...(category === 'Personal Finance' ? [
      /budget(ing)? (app|tool|spreadsheet|method)/i,
      /track(ing)? (expenses|spending|bills|subscriptions|debt)/i,
      /debt (payoff|snowball|avalanche|tracker)/i,
      /subscription (management|tracker|cancel)/i,
      /net worth tracker/i,
      /emergency fund/i,
    ] : []),
    ...(category === 'Cooking' ? [
      /meal plan(ning)?/i,
      /grocery (list|shopping|budget)/i,
      /recipe (organiz|manag|track|sav)/i,
      /what (to|can I) (cook|make|eat)/i,
      /use up (leftover|ingredient)/i,
      /reduce (food )?waste/i,
      /cooking for one/i,
    ] : []),
    ...(category === 'Solo Travel' ? [
      /itinerary (plan|organiz|manag)/i,
      /travel (budget|expense|cost) tracker/i,
      /solo (travel|trip) (plan|safety|budget)/i,
      /hostel (find|book|compar)/i,
      /packing (list|organiz)/i,
      /travel document/i,
      /visa (requirement|process|application)/i,
    ] : []),
  ];

  // Check if any pain indicator matches
  const matched = painIndicators.some(p => p.test(text) || p.test(post.title));
  if (!matched) return null;

  // Build title and description
  let ppTitle = post.title.slice(0, 80);
  let ppDescription = '';

  const body = post.body || '';
  const firstSentences = body.split(/[.!?]/).slice(0, 3).join('. ').trim();
  
  if (firstSentences.length > 20) {
    ppDescription = `Reddit user asks: "${firstSentences.slice(0, 200)}". This reflects a common need in r/${sub} for better tools or processes. Multiple community members upvoted (${post.score}) and engaged (${post.numComments} comments), indicating widespread pain.`;
  } else {
    ppDescription = `Post titled "${post.title.slice(0, 100)}" on r/${sub} highlights a recurring need. With ${post.score} upvotes and ${post.numComments} comments, it shows community interest in better solutions. This represents an actionable gap in current tools available to the ${category} audience.`;
  }

  return {
    title: ppTitle,
    description: ppDescription.slice(0, 500),
  };
}

async function main() {
  console.log('Starting Maya Chen Reddit scan...');
  console.log(`CDP URL: ${CDP_URL}`);
  
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected to browser via CDP');

    const context = browser.contexts()[0];
    if (!context) {
      throw new Error('No browser context available');
    }

    // Get or create a page
    let pages = context.pages();
    let page;
    if (pages.length > 0) {
      page = pages[0];
      // Close extra tabs
      for (let i = 1; i < pages.length; i++) {
        await pages[i].close().catch(() => {});
      }
    } else {
      page = await context.newPage();
    }

    console.log('Page ready');

    const results = {
      subreddits: 0,
      totalPostsScanned: 0,
      totalPainPoints: 0,
      errors: [],
    };

    for (const { sub, category } of SUBREDDITS) {
      const { postsScanned, painPointsFound } = await scanSubreddit(page, sub, category);
      results.subreddits++;
      results.totalPostsScanned += postsScanned;
      results.totalPainPoints += painPointsFound;
      
      // Pace between subreddits
      if (sub !== SUBREDDITS[SUBREDDITS.length - 1].sub) {
        console.log('\nPausing 5 seconds before next subreddit...');
        await sleep(5000);
      }
    }

    console.log('\n=== SCAN COMPLETE ===');
    console.log(`Subreddits scanned: ${results.subreddits}`);
    console.log(`Total posts analyzed: ${results.totalPostsScanned}`);
    console.log(`Pain points discovered: ${results.totalPainPoints}`);
    
    return results;

  } catch (e) {
    console.error('Fatal error:', e.message);
    process.exit(1);
  }
  // Note: NOT disconnecting/closing browser - admin agent handles that
}

main().then(results => {
  console.log('\nFinal results:', JSON.stringify(results, null, 2));
  process.exit(0);
}).catch(e => {
  console.error('Unhandled error:', e);
  process.exit(1);
});
