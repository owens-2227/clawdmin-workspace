/**
 * Reddit Pain Point Scanner — elise-c
 * Subreddits: cats, rawpetfood, ThriftStoreHauls, felinediabetes, EatCheapAndHealthy, lawncare
 */

const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:61219/devtools/browser/872ad4d5-d588-47ec-baa4-fc4dbd435a63';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const AGENT_ID = 'elise-c';

const SUBREDDITS = [
  { sub: 'cats', category: 'Cats & Pets' },
  { sub: 'rawpetfood', category: 'Cats & Pets' },
  { sub: 'ThriftStoreHauls', category: 'Thrifting' },
  { sub: 'felinediabetes', category: 'Cats & Pets' },
  { sub: 'EatCheapAndHealthy', category: 'Cooking' },
  { sub: 'lawncare', category: 'Gardening' },
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

// Fetch posts via the browser page (routes through AdsPower proxy)
async function fetchPostsViaBrowser(page, subreddit) {
  const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=25&raw_json=1`;
  const result = await page.evaluate(async (fetchUrl) => {
    try {
      const res = await fetch(fetchUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      });
      const text = await res.text();
      return { ok: true, text };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, url);

  if (!result.ok) throw new Error(result.error);
  const data = JSON.parse(result.text);
  return (data?.data?.children || []).map(c => c.data);
}

async function fetchCommentsViaBrowser(page, subreddit, postId) {
  const url = `https://www.reddit.com/r/${subreddit}/comments/${postId}.json?limit=10&raw_json=1`;
  try {
    const result = await page.evaluate(async (fetchUrl) => {
      try {
        const res = await fetch(fetchUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
        });
        const text = await res.text();
        return { ok: true, text };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }, url);

    if (!result.ok) return '';
    const data = JSON.parse(result.text);
    const comments = data?.[1]?.data?.children || [];
    return comments
      .filter(c => c.kind === 't1')
      .slice(0, 5)
      .map(c => c.data.body)
      .join('\n\n');
  } catch {
    return '';
  }
}

async function submitPainPoint({ title, description, category, subreddit, post }) {
  const resp = await apiPost('/api/pain-points', {
    title,
    description,
    category,
    subreddit: `r/${subreddit}`,
    discoveredBy: AGENT_ID,
  });

  // API wraps response in { painPoint: { id, ... } }
  const ppId = resp?.painPoint?.id || resp?.id;
  console.log(`  [PP created] id=${ppId} title="${title}"`);

  if (ppId && post) {
    const linkResp = await apiPost('/api/pain-points/posts', {
      painPointId: ppId,
      redditPostId: post.id,
      redditUrl: post.url,
      postTitle: post.title,
      postBody: (post.body || '').slice(0, 2000),
      upvotes: post.upvotes || 0,
      commentCount: post.commentCount || 0,
      subreddit: `r/${subreddit}`,
      discoveredBy: AGENT_ID,
    });
    console.log(`  [Post linked] ${JSON.stringify(linkResp).slice(0, 100)}`);
  }

  return ppId;
}

async function logScan({ subreddit, postsScanned, painPointsFound, status }) {
  const resp = await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned,
    painPointsFound,
    status,
  });
  console.log(`  [Scan log] r/${subreddit} → ${JSON.stringify(resp).slice(0, 100)}`);
}

function detectPainPoint(title, body, comments) {
  const fullText = `${title} ${body} ${comments}`;
  const patterns = [
    /is there (an?|any) (app|tool|way|service|website|software)/i,
    /\b(frustrat|annoying|annoyed|frustrated|struggle|struggling)\b/i,
    /\b(hard to|difficult|can't find|cannot find|no way to)\b/i,
    /\b(wish|would love|need help|looking for a)\b/i,
    /\b(recommend|suggestion|advice)\b/i.test(title) ? /\b(recommend|suggestion|advice)\b/i : null,
    /\b(manually|spreadsheet|track|tracking)\b/i,
    /\b(too expensive|overpriced|cheaper alternative|free alternative)\b/i,
    /\b(confus|overwhelm|complicated|pain in the)\b/i,
    /how do (i|you|we) (manage|track|deal with|handle|keep track)/i,
    /\b(hate that|hate when|why is it so hard|why can't)\b/i,
    /\b(no (app|tool|way|service) (to|for))\b/i,
    /\b(any (app|tool|recommendations?) for)\b/i,
  ].filter(Boolean);

  return patterns.some(r => r.test(fullText));
}

function buildPainPoint(post, sub) {
  const title = post.title || '';
  const body = (post.selftext || '').slice(0, 500);
  const fullText = `${title} ${body}`.toLowerCase();

  let ppTitle = '';
  let ppDesc = '';

  if (/is there (an?|any) (app|tool|way)|any (app|tool|recommendations?) for/i.test(fullText)) {
    ppTitle = `Tool gap in r/${sub}: ${title}`.slice(0, 80);
    ppDesc = `User in r/${sub} is seeking a tool or app: "${title}". ${body ? body.slice(0, 200) + '...' : ''} This gap represents product opportunity.`;
  } else if (/manual|manually|spreadsheet|track/i.test(fullText)) {
    ppTitle = `Manual process pain in r/${sub}: ${title}`.slice(0, 80);
    ppDesc = `Community in r/${sub} is manually handling: "${title}". ${body ? body.slice(0, 200) + '...' : ''} Automation or a dedicated tool could help.`;
  } else if (/wish|would love|need help/i.test(fullText)) {
    ppTitle = `Unmet need in r/${sub}: ${title}`.slice(0, 80);
    ppDesc = `User expressed unmet need: "${title}". ${body ? body.slice(0, 200) + '...' : ''} Opportunity to build a solution.`;
  } else if (/recommend|suggestion|advice/i.test(fullText)) {
    ppTitle = `Seeking advice in r/${sub}: ${title}`.slice(0, 80);
    ppDesc = `User asking for recommendations: "${title}". ${body ? body.slice(0, 200) + '...' : ''} Indicates lack of clear go-to solution.`;
  } else {
    ppTitle = `Frustration in r/${sub}: ${title}`.slice(0, 80);
    ppDesc = `User in r/${sub} expressed a frustration: "${title}". ${body ? body.slice(0, 200) + '...' : ''} Recurring pain that could be addressed with the right product.`;
  }

  return { ppTitle, ppDesc };
}

async function scanSubreddit(page, sub, category) {
  console.log(`\n=== Scanning r/${sub} ===`);
  const foundPainPoints = [];
  let postsScanned = 0;
  let posts = [];

  try {
    // Navigate browser to the subreddit
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    // Scroll to trigger lazy loading
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(1500);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    const pageTitle = await page.title();
    console.log(`  Page title: ${pageTitle}`);

    if (/captcha|verify|blocked|access denied/i.test(pageTitle)) {
      console.log(`  CAPTCHA/block detected, skipping r/${sub}`);
      await logScan({ subreddit: sub, postsScanned: 0, painPointsFound: 0, status: 'error' });
      return [];
    }

    // Fetch posts via browser (routes through proxy)
    posts = await fetchPostsViaBrowser(page, sub);
    console.log(`  Fetched ${posts.length} posts`);
  } catch (err) {
    console.log(`  Error on r/${sub}: ${err.message}`);
    await logScan({ subreddit: sub, postsScanned: 0, painPointsFound: 0, status: 'error' });
    return [];
  }

  // Filter posts
  const candidates = posts.filter(p =>
    !p.stickied &&
    !p.pinned &&
    p.score >= 5 &&
    (p.selftext || p.title)
  ).slice(0, 25);

  console.log(`  ${candidates.length} candidate posts`);
  postsScanned = candidates.length;

  for (const post of candidates) {
    const title = post.title || '';
    const body = post.selftext || '';

    // Fetch comments for promising posts
    let comments = '';
    if (post.num_comments >= 10 && (post.selftext || /\?/.test(title))) {
      await sleep(2000);
      comments = await fetchCommentsViaBrowser(page, sub, post.id);
    }

    const isPain = detectPainPoint(title, body, comments);
    if (!isPain) continue;

    const { ppTitle, ppDesc } = buildPainPoint(post, sub);

    console.log(`  [PAIN POINT] ${ppTitle}`);

    const postObj = {
      id: post.id,
      url: `https://reddit.com${post.permalink}`,
      title: post.title,
      body: post.selftext || '',
      upvotes: post.score,
      commentCount: post.num_comments,
    };

    try {
      const ppId = await submitPainPoint({
        title: ppTitle,
        description: ppDesc,
        category,
        subreddit: sub,
        post: postObj,
      });
      if (ppId) foundPainPoints.push(ppTitle);
    } catch (e) {
      console.log(`  [ERROR submitting PP] ${e.message}`);
    }

    await sleep(1000);
  }

  await logScan({
    subreddit: sub,
    postsScanned,
    painPointsFound: foundPainPoints.length,
    status: 'completed',
  });

  console.log(`  r/${sub} done: ${postsScanned} posts scanned, ${foundPainPoints.length} pain points`);
  return foundPainPoints;
}

async function main() {
  console.log('Connecting to AdsPower browser via CDP...');
  const browser = await chromium.connectOverCDP(CDP_URL);
  console.log('Connected!');

  const context = browser.contexts()[0];
  const pages = context.pages();

  // Keep only one page
  for (let i = 1; i < pages.length; i++) {
    await pages[i].close().catch(() => {});
  }
  const page = pages[0] || await context.newPage();

  const allPainPoints = [];

  for (const { sub, category } of SUBREDDITS) {
    try {
      const pps = await scanSubreddit(page, sub, category);
      allPainPoints.push(...pps.map(t => ({ sub, title: t })));
    } catch (err) {
      console.error(`Fatal error on r/${sub}: ${err.message}`);
      await logScan({ subreddit: sub, postsScanned: 0, painPointsFound: 0, status: 'error' }).catch(() => {});
    }
    await sleep(3000);
  }

  // DO NOT close the browser — admin agent manages that

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits: ${SUBREDDITS.length}`);
  console.log(`Pain points: ${allPainPoints.length}`);
  allPainPoints.forEach(pp => console.log(`  [r/${pp.sub}] ${pp.title}`));

  console.log('\nSUMMARY_JSON:' + JSON.stringify({
    subredditsScanned: SUBREDDITS.length,
    painPointsFound: allPainPoints.length,
    painPoints: allPainPoints,
  }));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
