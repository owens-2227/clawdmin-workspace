import { chromium } from 'playwright';

const CDP_URL = 'ws://127.0.0.1:49956/devtools/browser/640ba0f5-cce7-45c1-a2fa-945fa8004a57';
const AGENT_ID = 'jess-m';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const SUBREDDITS = ['gardening', 'beyondthebump', 'Mommit', 'running', 'xxfitness'];

const CATEGORY_MAP = {
  gardening: 'Gardening',
  beyondthebump: 'New Moms',
  Mommit: 'New Moms',
  running: 'Fitness',
  xxfitness: 'Fitness',
};

function sleep(ms) {
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

async function submitPainPoint({ title, description, category, subreddit, post }) {
  console.log(`  → Submitting pain point: ${title}`);
  const pp = await apiPost('/api/pain-points', {
    title: title.slice(0, 80),
    description,
    category,
    subreddit: `r/${subreddit}`,
    discoveredBy: AGENT_ID,
  });
  console.log(`    PP create response:`, JSON.stringify(pp).slice(0, 200));
  const id = pp?.id || pp?.data?.id;
  if (id && post) {
    const linkRes = await apiPost('/api/pain-points/posts', {
      painPointId: id,
      redditPostId: post.id,
      redditUrl: post.url,
      postTitle: post.title,
      postBody: (post.body || '').slice(0, 2000),
      upvotes: post.upvotes || 0,
      commentCount: post.commentCount || 0,
      subreddit: `r/${subreddit}`,
      discoveredBy: AGENT_ID,
    });
    console.log(`    PP link response:`, JSON.stringify(linkRes).slice(0, 200));
  }
  return id;
}

async function logScan({ subreddit, postsScanned, painPointsFound, status }) {
  const res = await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned,
    painPointsFound,
    status,
  });
  console.log(`  → Scan log submitted for r/${subreddit}:`, JSON.stringify(res).slice(0, 200));
}

// Fetch hot posts via JSON API fallback
async function fetchPostsViaJson(subreddit) {
  const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=25&raw_json=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  const data = await res.json();
  return (data?.data?.children || []).map(c => c.data);
}

// Extract pain points from posts using heuristics
function analyzePosts(posts, subreddit) {
  const painPoints = [];
  const category = CATEGORY_MAP[subreddit] || 'General';

  for (const post of posts) {
    if (!post || post.stickied) continue;
    if ((post.score || 0) < 5) continue;

    const title = (post.title || '').toLowerCase();
    const body = (post.selftext || '').toLowerCase();
    const combined = title + ' ' + body;

    // Pain point signals
    const signals = [
      /\bis there (an?|any) (app|tool|way|software|service)\b/i,
      /\bhow (do|can|should) (i|you|we)\b/i,
      /\bstruggling with\b/i,
      /\bfrustrat(ed|ing)\b/i,
      /\bannoying\b/i,
      /\bwish (there was|i could|i had)\b/i,
      /\bcan't figure out\b/i,
      /\bneed help\b/i,
      /\badvice (needed|wanted|please)\b/i,
      /\bwhat do you (use|do|recommend)\b/i,
      /\bbest (app|tool|way|method)\b/i,
      /\bhaving (trouble|issues|problems)\b/i,
      /\bdifficult(y)?\b/i,
      /\boverwhel(m|ming)\b/i,
      /\bkeep(ing)? track\b/i,
      /\borganiz(e|ing)\b/i,
      /\bplan(ning)?\b/i,
      /\btrack(ing)?\b/i,
      /\btoo (expensive|complex|complicated|hard|difficult)\b/i,
      /\bmanually\b/i,
    ];

    const matchCount = signals.filter(s => s.test(combined)).length;
    if (matchCount < 1) continue;

    // Skip obvious non-pain-points
    const excludePatterns = [
      /\bcelebrat(e|ing|ion)\b/i,
      /\bexcited\b/i,
      /\blook(ing)? for.*friend\b/i,
      /\bmeme\b/i,
    ];
    if (excludePatterns.some(p => p.test(combined))) continue;

    // Build pain point title from post title
    let ppTitle = post.title.slice(0, 80);
    const ppDescription = buildDescription(post, subreddit);
    if (!ppDescription) continue;

    painPoints.push({
      title: ppTitle,
      description: ppDescription,
      category,
      post: {
        id: post.id,
        url: `https://reddit.com${post.permalink}`,
        title: post.title,
        body: post.selftext || '',
        upvotes: post.score || 0,
        commentCount: post.num_comments || 0,
      },
    });
  }

  return painPoints;
}

function buildDescription(post, subreddit) {
  const title = post.title || '';
  const body = (post.selftext || '').slice(0, 500);
  const flair = post.link_flair_text || '';

  if (!title) return null;

  let desc = `Post in r/${subreddit}: "${title}"`;
  if (body && body.length > 20) {
    desc += `. Details: ${body.slice(0, 300).replace(/\n+/g, ' ')}`;
  }
  desc += `. (${post.score} upvotes, ${post.num_comments} comments)`;
  return desc.slice(0, 500);
}

async function scanSubreddit(page, subreddit) {
  console.log(`\n=== Scanning r/${subreddit} ===`);
  const category = CATEGORY_MAP[subreddit] || 'General';
  let posts = [];
  let usedFallback = false;

  try {
    // Try browser-based approach first
    await page.goto(`https://www.reddit.com/r/${subreddit}/hot/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await sleep(3000);

    // Check for CAPTCHA or error
    const pageContent = await page.content();
    if (pageContent.includes('captcha') || pageContent.includes('CAPTCHA')) {
      console.log(`  ⚠️  CAPTCHA detected on r/${subreddit}, using JSON fallback`);
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
      const extractedPosts = await page.evaluate(() => {
        const results = [];
        // Try shreddit-post elements
        const postEls = document.querySelectorAll('shreddit-post, [data-testid="post-container"], article');
        postEls.forEach(el => {
          const titleEl = el.querySelector('h1, h2, h3, [slot="title"], a[data-click-id="body"]');
          const title = titleEl?.textContent?.trim();
          if (!title) return;
          const href = titleEl?.closest('a')?.href || el.querySelector('a[href*="/comments/"]')?.href;
          const idMatch = href?.match(/\/comments\/([a-z0-9]+)\//);
          const id = idMatch?.[1];
          const scoreEl = el.querySelector('[data-post-click-location="vote"] button, faceplate-number');
          const score = parseInt(scoreEl?.textContent?.replace(/[^0-9]/g, '') || '0');
          const commentEl = el.querySelector('a[href*="comments"] span, [data-click-id="comments"]');
          const commentCount = parseInt(commentEl?.textContent?.replace(/[^0-9]/g, '') || '0');
          if (title && id) {
            results.push({ title, id, href, score, commentCount, stickied: false, selftext: '' });
          }
        });
        return results;
      });

      if (extractedPosts.length >= 5) {
        console.log(`  Browser extracted ${extractedPosts.length} posts`);
        posts = extractedPosts.map(p => ({
          title: p.title,
          id: p.id,
          permalink: p.href?.replace('https://www.reddit.com', '') || `/r/${subreddit}/comments/${p.id}/`,
          score: p.score,
          num_comments: p.commentCount,
          selftext: '',
          stickied: false,
        }));
      } else {
        console.log(`  Browser only got ${extractedPosts.length} posts, using JSON fallback`);
        usedFallback = true;
      }
    }
  } catch (err) {
    console.log(`  Browser error: ${err.message}, using JSON fallback`);
    usedFallback = true;
  }

  if (usedFallback || posts.length < 5) {
    try {
      console.log(`  Fetching via JSON API...`);
      posts = await fetchPostsViaJson(subreddit);
      console.log(`  JSON API returned ${posts.length} posts`);
    } catch (err) {
      console.log(`  JSON API also failed: ${err.message}`);
      await logScan({ subreddit, postsScanned: 0, painPointsFound: 0, status: 'error' });
      return { postsScanned: 0, painPointsFound: 0 };
    }
  }

  console.log(`  Analyzing ${posts.length} posts for pain points...`);
  const painPoints = analyzePosts(posts, subreddit);
  console.log(`  Found ${painPoints.length} actionable pain points`);

  for (const pp of painPoints) {
    await submitPainPoint({ ...pp, subreddit });
    await sleep(500);
  }

  await logScan({
    subreddit,
    postsScanned: posts.length,
    painPointsFound: painPoints.length,
    status: 'completed',
  });

  return { postsScanned: posts.length, painPointsFound: painPoints.length };
}

async function main() {
  console.log('Connecting to AdsPower browser via CDP...');
  const browser = await chromium.connectOverCDP(CDP_URL);
  console.log('Connected!');

  const context = browser.contexts()[0];
  const pages = context.pages();
  console.log(`  Open pages: ${pages.length}`);

  // Close extra tabs
  for (let i = 1; i < pages.length; i++) await pages[i].close();
  const page = pages[0] || await context.newPage();

  const results = [];
  let totalPosts = 0;
  let totalPainPoints = 0;

  for (const sub of SUBREDDITS) {
    try {
      const result = await scanSubreddit(page, sub);
      results.push({ subreddit: sub, ...result });
      totalPosts += result.postsScanned;
      totalPainPoints += result.painPointsFound;
    } catch (err) {
      console.error(`Error scanning r/${sub}:`, err.message);
      results.push({ subreddit: sub, postsScanned: 0, painPointsFound: 0, error: err.message });
      await logScan({ subreddit: sub, postsScanned: 0, painPointsFound: 0, status: 'error' });
    }
    await sleep(3000);
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${SUBREDDITS.length}`);
  console.log(`Total posts analyzed: ${totalPosts}`);
  console.log(`Total pain points found: ${totalPainPoints}`);
  console.log('\nPer-subreddit results:');
  results.forEach(r => {
    console.log(`  r/${r.subreddit}: ${r.postsScanned} posts, ${r.painPointsFound} pain points${r.error ? ' [ERROR: ' + r.error + ']' : ''}`);
  });

  // Don't disconnect — admin agent closes the browser
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
