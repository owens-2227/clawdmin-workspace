const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:49560/devtools/browser/e0675ff2-e54d-46eb-ad4b-4a7a26232cf9';
const AGENT_ID = 'ty-m';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const SUBREDDITS = [
  { name: 'bikecommuting', category: 'Cycling' },
  { name: 'gravelcycling', category: 'Cycling' },
  { name: 'bikewrench', category: 'Cycling' },
  { name: 'fuckcars', category: 'Cycling' },
  { name: 'Meditation', category: 'Mental Health' },
  { name: 'Anxiety', category: 'Mental Health' },
  { name: 'therapists', category: 'Therapy' },
  { name: 'Journaling', category: 'Journaling' },
  { name: 'yinyoga', category: 'Yoga' },
  { name: 'solotravel', category: 'Solo Travel' },
];

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
  console.log(`  ✓ Created pain point: ${pp.title.slice(0, 60)} → id=${result.id || result._id || JSON.stringify(result).slice(0, 80)}`);
  return result.id || result._id || result.data?.id;
}

async function submitSource(painPointId, source) {
  await apiPost('/api/pain-points/posts', {
    painPointId,
    redditPostId: source.redditPostId,
    redditUrl: source.redditUrl,
    postTitle: source.postTitle,
    postBody: source.postBody?.slice(0, 2000) || '',
    upvotes: source.upvotes,
    commentCount: source.commentCount,
    subreddit: source.subreddit,
    discoveredBy: AGENT_ID,
  });
}

async function logScan(subreddit, postsScanned, painPointsFound, status = 'completed') {
  await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned,
    painPointsFound,
    status,
  });
  console.log(`  📋 Logged scan: r/${subreddit} — ${postsScanned} posts, ${painPointsFound} pain points`);
}

function isPainPoint(post) {
  if (post.score < 5) return false;
  if (post.stickied) return false;
  if (post.is_video && !post.selftext) return false;

  const text = `${post.title} ${post.selftext || ''}`.toLowerCase();

  // Positive signals
  const painSignals = [
    'frustrated', 'frustrating', 'annoying', 'struggle', 'hard to', 'difficult',
    'wish there was', 'is there an app', 'is there a tool', 'is there a way',
    'how do you', 'how do i', 'anyone else', 'does anyone know',
    'manually', 'spreadsheet', 'no good way', 'problem with', 'issue with',
    'cant find', "can't find", 'looking for', 'recommendation', 'recommend',
    'too expensive', 'complicated', 'confusing', 'overwhelming', 'hate that',
    'wish i could', 'anyone have a solution', 'help me', 'need help',
    'improve', 'better way', 'alternative to', 'replace', 'broken',
    'keeps', 'always', 'every time', 'constant', 'chronic',
  ];

  return painSignals.some(signal => text.includes(signal));
}

function extractPainPoint(post, subreddit, category) {
  const title = post.title;
  const body = post.selftext || '';
  const combined = `${title} ${body}`.toLowerCase();

  let description = `A user in r/${subreddit} posted: "${title}". `;
  if (body.length > 20) {
    const snippet = body.slice(0, 300).replace(/\n+/g, ' ').trim();
    description += `Context: ${snippet}`;
  }
  description = description.slice(0, 500);

  return {
    title: title.slice(0, 80),
    description,
    category,
    subreddit: `r/${subreddit}`,
    source: {
      redditPostId: post.id,
      redditUrl: `https://reddit.com${post.permalink}`,
      postTitle: post.title,
      postBody: body,
      upvotes: post.score,
      commentCount: post.num_comments,
      subreddit: `r/${subreddit}`,
    },
  };
}

async function scanSubreddit(page, sub, category) {
  const { name } = sub;
  console.log(`\n🔍 Scanning r/${name}...`);
  let posts = [];

  // Try browser-based approach first
  try {
    await page.goto(`https://www.reddit.com/r/${name}/hot/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await sleep(3000);

    // Check for CAPTCHA / login wall
    const content = await page.content();
    if (content.includes('recaptcha') || content.includes('CAPTCHA')) {
      console.log(`  ⚠️ CAPTCHA detected on r/${name}, using JSON API fallback`);
      throw new Error('CAPTCHA');
    }

    // Scroll to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    // Try to extract posts via JSON API using the browser's cookies/session
    const jsonRes = await page.evaluate(async (subName) => {
      try {
        const r = await fetch(`https://www.reddit.com/r/${subName}/hot.json?limit=25&raw_json=1`, {
          headers: { 'Accept': 'application/json' }
        });
        return await r.json();
      } catch (e) {
        return null;
      }
    }, name);

    if (jsonRes?.data?.children?.length > 0) {
      posts = jsonRes.data.children.map(c => c.data);
      console.log(`  📄 Got ${posts.length} posts via browser JSON fetch`);
    }
  } catch (err) {
    console.log(`  ⚠️ Browser approach issue: ${err.message}, trying direct JSON API...`);
  }

  // Fallback: direct JSON API
  if (posts.length === 0) {
    try {
      const jsonRes = await page.evaluate(async (subName) => {
        const r = await fetch(`https://www.reddit.com/r/${subName}/hot.json?limit=25&raw_json=1`);
        return await r.json();
      }, name);
      if (jsonRes?.data?.children) {
        posts = jsonRes.data.children.map(c => c.data);
        console.log(`  📄 Got ${posts.length} posts via fallback JSON`);
      }
    } catch (err2) {
      console.log(`  ❌ JSON fallback also failed: ${err2.message}`);
    }
  }

  if (posts.length === 0) {
    console.log(`  ❌ Could not get posts for r/${name}, skipping`);
    await logScan(name, 0, 0, 'error');
    return [];
  }

  // Filter for pain points
  const painPosts = posts.filter(p => isPainPoint(p));
  console.log(`  🎯 Found ${painPosts.length} potential pain points out of ${posts.length} posts`);

  // For promising posts with lots of comments, get full details
  const detailedPosts = [];
  for (const post of painPosts.slice(0, 8)) {
    detailedPosts.push(extractPainPoint(post, name, category));
    await sleep(500);
  }

  // Submit pain points
  const submitted = [];
  for (const pp of detailedPosts) {
    try {
      const ppId = await submitPainPoint(pp);
      if (ppId) {
        await submitSource(ppId, pp.source);
      }
      submitted.push(pp.title);
      await sleep(1000);
    } catch (err) {
      console.log(`  ⚠️ Failed to submit pain point: ${err.message}`);
    }
  }

  await logScan(name, posts.length, submitted.length);
  return submitted;
}

async function main() {
  console.log(`🚴 ty-m Scanner Starting — ${SUBREDDITS.length} subreddits to scan`);
  console.log(`CDP: ${CDP_URL}\n`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('✅ Connected to AdsPower browser via CDP');
  } catch (err) {
    console.error(`❌ Failed to connect to CDP: ${err.message}`);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const pages = context.pages();

  // Close extra tabs, keep one
  for (let i = 1; i < pages.length; i++) {
    try { await pages[i].close(); } catch {}
  }
  const page = pages[0] || await context.newPage();

  const allFound = [];
  const errors = [];

  for (const sub of SUBREDDITS) {
    try {
      const found = await scanSubreddit(page, sub, sub.category);
      allFound.push(...found.map(t => `r/${sub.name}: ${t}`));
      await sleep(3000); // Pace between subreddits
    } catch (err) {
      console.log(`  ❌ Error scanning r/${sub.name}: ${err.message}`);
      errors.push(`r/${sub.name}: ${err.message}`);
      try {
        await logScan(sub.name, 0, 0, 'error');
      } catch {}
    }
  }

  console.log('\n========================================');
  console.log('✅ SCAN COMPLETE');
  console.log(`📊 Subreddits scanned: ${SUBREDDITS.length}`);
  console.log(`🎯 Pain points submitted: ${allFound.length}`);
  if (allFound.length > 0) {
    console.log('\nPain points found:');
    allFound.forEach(p => console.log(`  • ${p}`));
  }
  if (errors.length > 0) {
    console.log('\nErrors:');
    errors.forEach(e => console.log(`  ⚠️ ${e}`));
  }

  // Don't close the browser — admin agent handles that
  console.log('\nℹ️ Browser left open (admin agent will close it)');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
