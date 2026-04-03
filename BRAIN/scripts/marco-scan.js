const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:60646/devtools/browser/7f0147db-bade-42ed-b6e1-73beec4bd6bc';
const AGENT_ID = 'marco-v';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const SUBREDDITS = ['nocode', 'Nootropics', 'Biohackers', 'SideProject'];

const CATEGORY_MAP = {
  nocode: 'No-Code & Builders',
  SideProject: 'No-Code & Builders',
  Nootropics: 'Biohacking',
  Biohackers: 'Biohacking',
};

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

async function fetchSubredditPostsJSON(sub) {
  const url = `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
  });
  const data = await res.json();
  if (!data || !data.data || !data.data.children) return [];
  return data.data.children.map(c => c.data).filter(p => !p.stickied && p.score >= 5);
}

async function fetchPostComments(sub, postId) {
  const url = `https://www.reddit.com/r/${sub}/comments/${postId}.json?limit=10&raw_json=1`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });
    const data = await res.json();
    if (!Array.isArray(data) || data.length < 2) return [];
    const comments = data[1].data.children
      .filter(c => c.kind === 't1')
      .map(c => c.data.body)
      .slice(0, 8);
    return comments;
  } catch {
    return [];
  }
}

function analyzePainPoints(posts, sub, comments_map) {
  const painPoints = [];

  const painKeywords = [
    'frustrated', 'annoying', 'pain', 'struggle', 'hard to', 'difficult',
    'wish there was', 'is there a tool', 'is there an app', 'looking for',
    'manually', 'no good way', 'can\'t find', 'expensive', 'complicated',
    'overwhelming', 'confusing', 'broken', 'doesn\'t work', 'hate',
    'impossible', 'nightmare', 'hours', 'tedious', 'automat', 'track',
    'organize', 'manage', 'keep track', 'remind', 'forget',
    'need help', 'any recommendations', 'advice', 'best way to',
    'how do you', 'how does', 'without coding', 'no-code', 'nocode',
    'brain fog', 'focus', 'productivity', 'supplement', 'stack',
    'protocol', 'optimize', 'biohack', 'side project', 'startup',
    'monetize', 'launch', 'build', 'mvp', 'validate'
  ];

  for (const post of posts) {
    const title = post.title || '';
    const body = post.selftext || '';
    const combined = (title + ' ' + body).toLowerCase();

    const matchCount = painKeywords.filter(k => combined.includes(k)).length;
    if (matchCount < 1) continue;

    // Skip pure memes, images without much text
    if (post.is_video || (post.post_hint === 'image' && body.length < 50)) continue;

    const comments = comments_map[post.id] || [];
    const commentText = comments.join(' ').toLowerCase();
    const extraMatches = painKeywords.filter(k => commentText.includes(k)).length;

    if (matchCount + extraMatches < 2 && body.length < 100) continue;

    // Build pain point description
    const bodySnippet = body.slice(0, 500).trim();
    const description = bodySnippet
      ? `${title}. ${bodySnippet}`.slice(0, 400)
      : title;

    painPoints.push({
      post,
      title: title.slice(0, 80),
      description: description.slice(0, 600),
      sub,
      score: matchCount + extraMatches,
    });
  }

  // Sort by score descending, take top 5
  painPoints.sort((a, b) => b.score - a.score);
  return painPoints.slice(0, 5);
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  const category = CATEGORY_MAP[sub] || 'No-Code & Builders';

  let posts = [];
  let usedFallback = false;

  // Try browser first
  try {
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await sleep(3000);

    // Scroll to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    // Check if we hit a login wall or CAPTCHA
    const pageContent = await page.content();
    if (pageContent.includes('Log In') && pageContent.includes('Sign Up') && !pageContent.includes('hot')) {
      console.log(`r/${sub}: Possible login wall, falling back to JSON API`);
      usedFallback = true;
    }
  } catch (err) {
    console.log(`r/${sub}: Browser navigation failed (${err.message}), using JSON API`);
    usedFallback = true;
  }

  // Always use JSON API for reliable post extraction
  console.log(`r/${sub}: Fetching posts via JSON API...`);
  try {
    posts = await fetchSubredditPostsJSON(sub);
    console.log(`r/${sub}: Got ${posts.length} posts from JSON API`);
  } catch (err) {
    console.log(`r/${sub}: JSON API also failed: ${err.message}`);
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned: 0,
      painPointsFound: 0,
      status: 'error',
    });
    return { sub, postsScanned: 0, painPointsFound: 0, error: err.message };
  }

  // Fetch comments for top posts with 10+ comments
  const comments_map = {};
  const postsWithComments = posts.filter(p => p.num_comments >= 10).slice(0, 8);
  for (const post of postsWithComments) {
    await sleep(1500);
    comments_map[post.id] = await fetchPostComments(sub, post.id);
  }

  // Analyze for pain points
  const painPoints = analyzePainPoints(posts, sub, comments_map);
  console.log(`r/${sub}: Found ${painPoints.length} pain points`);

  // Submit pain points
  let submitted = 0;
  for (const pp of painPoints) {
    try {
      const result = await apiPost('/api/pain-points', {
        title: pp.title,
        description: `r/${sub} pain point: ${pp.description}`.slice(0, 500),
        category,
        subreddit: `r/${sub}`,
        discoveredBy: AGENT_ID,
      });

      console.log(`  Submitted pain point: ${pp.title.slice(0, 60)}...`);
      console.log(`  API response:`, JSON.stringify(result).slice(0, 200));

      const painPointId = result.id || result.data?.id || result._id;

      if (painPointId) {
        const post = pp.post;
        const postBody = (post.selftext || '').slice(0, 2000);
        await apiPost('/api/pain-points/posts', {
          painPointId,
          redditPostId: post.id,
          redditUrl: `https://reddit.com${post.permalink}`,
          postTitle: post.title,
          postBody,
          upvotes: post.score,
          commentCount: post.num_comments,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID,
        });
      }

      submitted++;
      await sleep(500);
    } catch (err) {
      console.log(`  Error submitting pain point: ${err.message}`);
    }
  }

  // Log scan result
  await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${sub}`,
    postsScanned: posts.length,
    painPointsFound: submitted,
    status: 'completed',
  });

  return {
    sub,
    postsScanned: posts.length,
    painPointsFound: submitted,
    painPointTitles: painPoints.map(p => p.title),
  };
}

async function main() {
  console.log('Connecting to AdsPower browser via CDP...');
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];

  // Close extra tabs, keep one
  const pages = context.pages();
  for (let i = 1; i < pages.length; i++) await pages[i].close();
  const page = pages[0] || await context.newPage();

  console.log('Connected. Starting scan...');

  const results = [];
  for (const sub of SUBREDDITS) {
    const result = await scanSubreddit(page, sub);
    results.push(result);
    await sleep(3000); // Pause between subreddits
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log(JSON.stringify(results, null, 2));

  // Do NOT close browser — admin agent handles that
  await browser.close(); // Just disconnect, doesn't kill AdsPower

  return results;
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
