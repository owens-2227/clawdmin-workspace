const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:57122/devtools/browser/8f8a0954-992b-4a8a-b27a-2d34cb2e4b43';
const AGENT_ID = 'marcus-j';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const SUBREDDITS = [
  { name: 'therapists', category: 'Therapy' },
  { name: 'Journaling', category: 'Journaling' },
  { name: 'Guitar', category: 'Music' },
  { name: 'guitarpedals', category: 'Music' },
  { name: 'Blues', category: 'Music' },
  { name: 'homerecording', category: 'Music' },
  { name: 'cats', category: 'Cats & Pets' },
  { name: 'rawpetfood', category: 'Cats & Pets' },
  { name: 'ThriftStoreHauls', category: 'Thrifting' },
  { name: 'felinediabetes', category: 'Cats & Pets' },
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function apiPost(path, data) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${path} failed ${res.status}: ${text}`);
  }
  return res.json();
}

function isPainPoint(post) {
  const text = (post.title + ' ' + (post.body || '')).toLowerCase();
  const painKeywords = [
    'how do i', 'how to', 'struggling', 'frustrat', 'annoying', 'wish there was',
    'is there an app', 'is there a tool', 'does anyone know', 'looking for',
    'can\'t find', 'hard to', 'difficult', 'complicated', 'expensive',
    'manually', 'spreadsheet', 'keep track', 'organize', 'track my',
    'automat', 'help me', 'anyone else', 'problem with', 'issue with',
    'need a way', 'looking for something', 'recommendation', 'suggest',
  ];
  const excludeKeywords = [
    'meme', 'lol', 'haha', 'funny', 'oc photo', 'appreciation post',
  ];
  const hasPain = painKeywords.some(k => text.includes(k));
  const isExcluded = excludeKeywords.some(k => text.includes(k));
  return hasPain && !isExcluded && post.commentCount >= 5;
}

async function scanSubreddit(page, sub) {
  // Go straight to JSON API — avoids HTML/JS recaptcha script references
  const jsonUrl = `https://www.reddit.com/r/${sub.name}/hot.json?limit=25`;
  console.log(`\n[${sub.name}] Fetching ${jsonUrl}`);

  let posts = [];
  try {
    await page.goto(jsonUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2500);

    const bodyText = await page.evaluate(() => document.body.innerText);

    // Actual CAPTCHA challenge: body is an HTML page with visible captcha, not JSON
    if (bodyText.trim().startsWith('<') || bodyText.includes('"error"') && bodyText.includes('429')) {
      // Try once more after a pause
      console.log(`[${sub.name}] Non-JSON response or rate limit, retrying in 10s...`);
      await sleep(10000);
      await page.goto(jsonUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(3000);
    }

    const retryText = await page.evaluate(() => document.body.innerText);
    let data;
    try {
      data = JSON.parse(retryText);
    } catch (pe) {
      console.log(`[${sub.name}] Could not parse JSON: ${retryText.slice(0, 200)}`);
      return { postsScanned: 0, painPointsFound: 0, status: 'error', error: 'parse_error' };
    }

    if (data?.error) {
      console.log(`[${sub.name}] Reddit API error: ${data.error} ${data.message}`);
      return { postsScanned: 0, painPointsFound: 0, status: 'error', error: String(data.error) };
    }

    const children = data?.data?.children || [];
    posts = children
      .filter(c => !c.data.stickied && c.data.score >= 5)
      .map(c => ({
        id: c.data.id,
        title: c.data.title,
        score: c.data.score,
        commentCount: c.data.num_comments,
        permalink: c.data.permalink,
        body: c.data.selftext || '',
        subreddit: c.data.subreddit,
      }));
    console.log(`[${sub.name}] Found ${posts.length} posts`);
  } catch (e) {
    console.log(`[${sub.name}] Fetch error: ${e.message}`);
    return { postsScanned: 0, painPointsFound: 0, status: 'error', error: e.message };
  }

  // For promising posts, fetch comments
  const postsWithComments = [];
  for (const post of posts.slice(0, 25)) {
    if (post.commentCount >= 10) {
      try {
        await sleep(2000);
        const commentsUrl = `https://www.reddit.com${post.permalink}.json?limit=10`;
        await page.goto(commentsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(1500);
        const jsonText = await page.evaluate(() => document.body.innerText);
        const data = JSON.parse(jsonText);
        const comments = (data?.[1]?.data?.children || [])
          .filter(c => c.kind === 't1')
          .slice(0, 8)
          .map(c => c.data.body)
          .join('\n\n');
        post.comments = comments;
        postsWithComments.push(post);
      } catch (e) {
        console.log(`[${sub.name}] Failed to fetch comments for ${post.id}: ${e.message}`);
        postsWithComments.push(post);
      }
    } else {
      postsWithComments.push(post);
    }
  }

  // Analyze for pain points
  let painPointsFound = 0;
  const painPosts = postsWithComments.filter(p => isPainPoint(p));
  console.log(`[${sub.name}] Pain point candidates: ${painPosts.length}`);

  for (const post of painPosts.slice(0, 10)) {
    try {
      // Create pain point
      const combinedText = post.body ? `${post.title}. ${post.body.slice(0, 300)}` : post.title;
      const description = `Reddit users in r/${sub.name} are experiencing: "${post.title}". ${post.body ? post.body.slice(0, 200) : 'See thread for details.'} This post has ${post.commentCount} comments and ${post.score} upvotes.`;
      
      const ppResult = await apiPost('/api/pain-points', {
        title: post.title.slice(0, 80),
        description: description.slice(0, 500),
        category: sub.category,
        subreddit: `r/${sub.name}`,
        discoveredBy: AGENT_ID,
      });

      const painPointId = ppResult?.data?.id || ppResult?.id;
      if (!painPointId) {
        console.log(`[${sub.name}] No ID returned for pain point, response: ${JSON.stringify(ppResult).slice(0, 200)}`);
        continue;
      }

      // Link source post
      await apiPost('/api/pain-points/posts', {
        painPointId,
        redditPostId: post.id,
        redditUrl: `https://reddit.com${post.permalink}`,
        postTitle: post.title,
        postBody: (post.body || '').slice(0, 2000),
        upvotes: post.score,
        commentCount: post.commentCount,
        subreddit: `r/${sub.name}`,
        discoveredBy: AGENT_ID,
      });

      painPointsFound++;
      console.log(`[${sub.name}] ✓ Submitted pain point: ${post.title.slice(0, 60)}`);
    } catch (e) {
      console.log(`[${sub.name}] Error submitting pain point: ${e.message}`);
    }
  }

  // Log scan
  try {
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub.name}`,
      postsScanned: posts.length,
      painPointsFound,
      status: 'completed',
    });
  } catch (e) {
    console.log(`[${sub.name}] Error logging scan: ${e.message}`);
  }

  return { postsScanned: posts.length, painPointsFound, status: 'completed' };
}

async function main() {
  console.log('Connecting to AdsPower browser via CDP...');
  const browser = await chromium.connectOverCDP(CDP_URL);
  console.log('Connected!');

  const contexts = browser.contexts();
  const context = contexts[0];
  const pages = context.pages();
  const page = pages[0] || await context.newPage();

  // Close extra tabs
  for (let i = 1; i < pages.length; i++) {
    await pages[i].close().catch(() => {});
  }

  const results = {};
  let totalPosts = 0;
  let totalPainPoints = 0;

  for (const sub of SUBREDDITS) {
    const result = await scanSubreddit(page, sub);
    results[sub.name] = result;
    totalPosts += result.postsScanned || 0;
    totalPainPoints += result.painPointsFound || 0;
    console.log(`[${sub.name}] Done: ${JSON.stringify(result)}`);
    await sleep(3000); // Pause between subreddits
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${SUBREDDITS.length}`);
  console.log(`Total posts analyzed: ${totalPosts}`);
  console.log(`Total pain points discovered: ${totalPainPoints}`);
  console.log('Per-subreddit results:', JSON.stringify(results, null, 2));

  // Don't disconnect — admin handles browser lifecycle
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
