const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:52135/devtools/browser/efff1b8d-3441-4647-b8d8-44bb7414edcf';
const AGENT_ID = 'ty-m';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const SUBREDDITS = ['bikecommuting', 'gravelcycling', 'bikewrench', 'fuckcars'];
const CATEGORY = 'Cycling';

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

async function submitPainPoint({ title, description, subreddit }) {
  const pp = await apiPost('/api/pain-points', {
    title,
    description,
    category: CATEGORY,
    subreddit: `r/${subreddit}`,
    discoveredBy: AGENT_ID,
  });
  console.log(`  → Created pain point: ${pp.id || JSON.stringify(pp)}`);
  return pp.id;
}

async function submitPost(painPointId, { redditPostId, redditUrl, postTitle, postBody, upvotes, commentCount, subreddit }) {
  const res = await apiPost('/api/pain-points/posts', {
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
  console.log(`  → Linked post: ${JSON.stringify(res)}`);
}

async function logScan({ subreddit, postsScanned, painPointsFound, status }) {
  const res = await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned,
    painPointsFound,
    status,
  });
  console.log(`  → Logged scan for r/${subreddit}: ${JSON.stringify(res)}`);
}

// Fetch posts via JSON API fallback
async function fetchPostsJSON(subreddit) {
  const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=25&raw_json=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  const data = await res.json();
  if (!data?.data?.children) return [];
  return data.data.children
    .map(c => c.data)
    .filter(p => !p.stickied && p.score >= 5);
}

// Try browser approach, fall back to JSON API
async function fetchPosts(page, subreddit) {
  try {
    console.log(`  Navigating to r/${subreddit}...`);
    await page.goto(`https://www.reddit.com/r/${subreddit}/hot/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await sleep(3000);

    // Check for CAPTCHA or login wall
    const pageContent = await page.content();
    if (pageContent.includes('captcha') || pageContent.includes('verify you are human')) {
      console.log(`  CAPTCHA detected on r/${subreddit}, falling back to JSON API`);
      return await fetchPostsJSON(subreddit);
    }

    // Scroll to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    // Extract posts from page
    const posts = await page.evaluate(() => {
      const results = [];
      // Try shreddit post elements
      const postEls = document.querySelectorAll('shreddit-post');
      if (postEls.length > 0) {
        postEls.forEach(el => {
          const title = el.getAttribute('post-title') || el.querySelector('h1,h2,h3,[slot="title"]')?.innerText || '';
          const score = parseInt(el.getAttribute('score') || '0');
          const commentCount = parseInt(el.getAttribute('comment-count') || '0');
          const permalink = el.getAttribute('permalink') || '';
          const id = el.getAttribute('id') || permalink.split('/')[6] || '';
          const selfText = el.querySelector('[slot="text-body"]')?.innerText || '';
          if (title && score >= 5) {
            results.push({ title, score, commentCount, permalink, id, selfText });
          }
        });
      } else {
        // Fallback: old Reddit-style
        document.querySelectorAll('.thing[data-fullname]').forEach(el => {
          const title = el.querySelector('.title a')?.innerText || '';
          const score = parseInt(el.querySelector('.score.unvoted')?.innerText || '0');
          const commentCount = parseInt(el.querySelector('.comments')?.innerText || '0');
          const permalink = el.getAttribute('data-permalink') || '';
          const id = el.getAttribute('data-id') || '';
          const selfText = '';
          if (title && score >= 5) {
            results.push({ title, score, commentCount, permalink, id, selfText });
          }
        });
      }
      return results;
    });

    if (posts.length < 3) {
      console.log(`  Only ${posts.length} posts from browser, falling back to JSON API`);
      return await fetchPostsJSON(subreddit);
    }

    console.log(`  Got ${posts.length} posts from browser`);
    return posts.map(p => ({
      ...p,
      url: p.permalink ? `https://reddit.com${p.permalink}` : '',
      post_id: p.id,
      selftext: p.selfText,
      num_comments: p.commentCount,
      ups: p.score,
    }));
  } catch (err) {
    console.log(`  Browser error: ${err.message}, falling back to JSON API`);
    return await fetchPostsJSON(subreddit);
  }
}

function isPainPoint(post) {
  const text = `${post.title} ${post.selftext || post.selfText || ''}`.toLowerCase();
  const painSignals = [
    'how do i', 'is there an app', 'is there a tool', 'looking for', 'need help',
    'frustrated', 'annoying', 'hate that', 'wish there was', 'anyone else',
    'problem with', 'issue with', 'struggling', 'hard to', 'difficult to',
    'can\'t find', 'no way to', 'manually', 'spreadsheet', 'track', 'manage',
    'organize', 'expensive', 'too complex', 'complicated', 'pain in',
    'best way to', 'advice', 'recommendation', 'app for', 'tool for',
    'software for', 'how to deal', 'alternative to', 'replace', 'substitute',
    'budget', 'cheap', 'affordable', 'free option',
  ];
  return painSignals.some(s => text.includes(s));
}

function extractPainPointDetails(post, subreddit) {
  const title = (post.title || '').slice(0, 80);
  const body = post.selftext || post.selfText || '';
  const bodySnippet = body.slice(0, 200);
  const description = `Posted in r/${subreddit}: "${title}". ${bodySnippet ? bodySnippet + ' ' : ''}This post (${post.ups || post.score} upvotes, ${post.num_comments || post.commentCount || 0} comments) represents a recurring frustration in the cycling community.`;
  return { title, description };
}

async function scanSubreddit(page, subreddit) {
  console.log(`\nScanning r/${subreddit}...`);
  const posts = await fetchPosts(page, subreddit);
  console.log(`  Total posts: ${posts.length}`);

  let painPointsFound = 0;
  const promising = posts.filter(p => isPainPoint(p)).slice(0, 8); // max 8 per subreddit
  console.log(`  Pain point candidates: ${promising.length}`);

  for (const post of promising) {
    const { title, description } = extractPainPointDetails(post, subreddit);
    console.log(`  Pain point: "${title}"`);

    try {
      const ppId = await submitPainPoint({ title, description, subreddit });
      if (ppId) {
        const redditPostId = post.id || post.post_id || post.name?.replace('t3_', '') || '';
        const redditUrl = post.url || `https://reddit.com${post.permalink || ''}`;
        await submitPost(ppId, {
          redditPostId,
          redditUrl,
          postTitle: post.title,
          postBody: post.selftext || post.selfText || '',
          upvotes: post.ups || post.score || 0,
          commentCount: post.num_comments || post.commentCount || 0,
          subreddit,
        });
        painPointsFound++;
      }
    } catch (err) {
      console.log(`  Error submitting pain point: ${err.message}`);
    }

    await sleep(1000);
  }

  await logScan({ subreddit, postsScanned: posts.length, painPointsFound, status: 'completed' });
  return { postsScanned: posts.length, painPointsFound };
}

async function main() {
  console.log('Connecting to AdsPower browser via CDP...');
  const browser = await chromium.connectOverCDP(CDP_URL);
  console.log('Connected!');

  const context = browser.contexts()[0];
  const pages = context.pages();
  console.log(`Found ${pages.length} existing page(s)`);

  // Close extra tabs
  for (let i = 1; i < pages.length; i++) await pages[i].close();
  const page = pages[0] || await context.newPage();

  const summary = { totalPosts: 0, totalPainPoints: 0, subreddits: [] };

  for (const sub of SUBREDDITS) {
    try {
      const result = await scanSubreddit(page, sub);
      summary.totalPosts += result.postsScanned;
      summary.totalPainPoints += result.painPointsFound;
      summary.subreddits.push({ sub, ...result });
    } catch (err) {
      console.log(`Error scanning r/${sub}: ${err.message}`);
      await logScan({ subreddit: sub, postsScanned: 0, painPointsFound: 0, status: 'error' });
    }
    await sleep(3000);
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${SUBREDDITS.length}`);
  console.log(`Total posts analyzed: ${summary.totalPosts}`);
  console.log(`Pain points discovered: ${summary.totalPainPoints}`);
  summary.subreddits.forEach(s => {
    console.log(`  r/${s.sub}: ${s.postsScanned} posts, ${s.painPointsFound} pain points`);
  });

  // Don't close browser — admin handles that
  await browser.close(); // Just disconnect, not quit
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
