// Second pass: scan woodworking and smoking with scrolling to load more posts
const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:60359/devtools/browser/2c8b8db0-1519-430b-920a-03f32a5ba147';
const AGENT_ID = 'dave-r';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const SUBREDDITS = [
  { name: 'HomeImprovement', category: 'Home & DIY' },
  { name: 'DIY', category: 'Home & DIY' },
  { name: 'woodworking', category: 'Home & DIY' },
  { name: 'smoking', category: 'BBQ & Grilling' },
];

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function apiPost(path, data) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(data),
  });
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; }
  catch { return { status: res.status, data: text }; }
}

async function submitPainPoint(pp) {
  const res = await apiPost('/api/pain-points', {
    title: pp.title.slice(0, 80),
    description: pp.description,
    category: pp.category,
    subreddit: pp.subreddit,
    discoveredBy: AGENT_ID,
  });
  console.log(`  [API] PP created: ${res.status}`, JSON.stringify(res.data).slice(0, 120));
  return res.data;
}

async function submitPost(ppId, post) {
  const res = await apiPost('/api/pain-points/posts', {
    painPointId: ppId,
    redditPostId: post.id,
    redditUrl: post.url,
    postTitle: post.title,
    postBody: (post.body || '').slice(0, 2000),
    upvotes: post.score,
    commentCount: post.commentCount,
    subreddit: post.subreddit,
    discoveredBy: AGENT_ID,
  });
  console.log(`  [API] Post linked: ${res.status}`);
}

async function logScan(subreddit, postsScanned, painPointsFound, status) {
  const res = await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned,
    painPointsFound,
    status,
  });
  console.log(`  [API] Log: ${res.status}`);
}

function extractPostId(url) {
  const m = url.match(/\/comments\/([a-z0-9]+)\//i);
  return m ? m[1] : '';
}

// Scroll to load more posts
async function loadMorePosts(page, targetCount = 20) {
  let prev = 0;
  for (let i = 0; i < 8; i++) {
    const count = await page.$$eval('shreddit-post', els => els.length);
    if (count >= targetCount) break;
    if (count === prev && i > 2) break;
    prev = count;
    await page.evaluate(() => window.scrollBy(0, 1500));
    await sleep(2000);
  }
  return await page.$$eval('shreddit-post', els =>
    els.map(el => ({
      title: el.getAttribute('post-title') || '',
      permalink: el.getAttribute('permalink') || '',
      id: (el.getAttribute('thingid') || '').replace('t3_', ''),
      score: parseInt(el.getAttribute('score') || '0') || 0,
      commentCount: parseInt(el.getAttribute('comment-count') || '0') || 0,
    })).filter(p => p.permalink && p.permalink.includes('/comments/'))
  );
}

async function readPostContent(page, postLink, subredditName) {
  const fullUrl = postLink.permalink.startsWith('http')
    ? postLink.permalink
    : `https://www.reddit.com${postLink.permalink}`;

  await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
  await sleep(2500);

  let title = postLink.title;
  let body = '';
  let score = postLink.score || 0;
  let commentCount = postLink.commentCount || 0;
  let id = postLink.id || extractPostId(fullUrl);

  try {
    const h1 = await page.$('h1');
    if (h1) title = (await h1.textContent())?.trim() || title;
  } catch {}

  try {
    const sp = await page.$('shreddit-post');
    if (sp) {
      score = parseInt(await sp.getAttribute('score') || String(score)) || score;
      commentCount = parseInt(await sp.getAttribute('comment-count') || String(commentCount)) || commentCount;
      const tid = await sp.getAttribute('thingid');
      if (tid) id = tid.replace('t3_', '');
      const slot = await sp.$('[slot="text-body"]');
      if (slot) body = (await slot.textContent())?.trim() || '';
    }
  } catch {}

  // Fallback body
  if (!body) {
    for (const sel of ['[data-testid="post-content"]', '.Post__body', '[data-adclicklocation="text_body"]', '.RichTextJSON-root']) {
      try {
        const el = await page.$(sel);
        if (el) { body = (await el.textContent())?.trim() || ''; if (body) break; }
      } catch {}
    }
  }

  // Top comments
  const comments = [];
  for (const sel of ['shreddit-comment', '[data-testid="comment"]']) {
    try {
      const els = await page.$$(sel);
      for (const el of els.slice(0, 10)) {
        const t = (await el.textContent())?.trim();
        if (t && t.length > 15) comments.push(t.slice(0, 300));
      }
      if (comments.length > 0) break;
    } catch {}
  }
  if (comments.length > 0) body += '\n\nTop comments:\n' + comments.join('\n---\n');

  return { id, title: title.slice(0, 300), body: body.slice(0, 3000), score, commentCount, url: fullUrl, subreddit: `r/${subredditName}` };
}

const PAIN_PATTERNS = [
  /is there (an? )?(app|tool|software|way|service)/i,
  /how do (i|you|we) (track|manage|organize|automate|keep track)/i,
  /frustrated|frustrating|annoying|nightmare|struggling/i,
  /wish there was|wish i (could|had)|would love (a|an|to)/i,
  /can't find (an? )?(good|decent|reliable|easy)/i,
  /too (expensive|complex|complicated|hard|difficult)/i,
  /manually|by hand|spreadsheet|pen and paper/i,
  /no good (way|tool|app|solution)/i,
  /what do you use (for|to)/i,
  /recommendation.{0,30}(app|tool|software)/i,
  /best (app|tool|software|way|method) (for|to)/i,
  /keep (losing|forgetting|messing up)/i,
  /problem with|trouble with|issue with/i,
  /waste of time|takes forever|time consuming/i,
  /how (do|should) i (start|begin|approach)/i,
  /beginner.{0,20}(confused|lost|overwhelmed)/i,
  /where (do|should) i (start|buy|find)/i,
  /which (wood|lumber|tool|saw|drill|smoker|pellet|charcoal)/i,
  /temp(erature)?.{0,20}(control|stall|drop|rise)/i,
  /how long.{0,30}(smoke|cook|rest|brine)/i,
  /wood.{0,20}(choice|type|species|recommendation)/i,
];

function analyzePainPoints(posts, category, subredditName) {
  const results = [];
  for (const post of posts) {
    const text = `${post.title} ${post.body}`;
    let hits = 0;
    for (const p of PAIN_PATTERNS) { if (p.test(text)) hits++; }
    if (hits < 1 || post.title.length < 10) continue;

    let title = post.title.replace(/^\[.*?\]\s*/i, '').replace(/^(UPDATE|PSA|HELP|QUESTION|RANT|ADVICE):?\s*/i, '').trim();
    if (title.length > 80) title = title.slice(0, 77) + '...';

    let desc = '';
    if (post.body && post.body.length > 50) {
      desc = post.body.replace(/\s+/g, ' ').slice(0, 350);
      const lastDot = desc.lastIndexOf('. ', 300);
      if (lastDot > 80) desc = desc.slice(0, lastDot + 1);
    } else {
      desc = `Community member in r/${subredditName}: "${post.title.slice(0, 150)}". Common pain point around ${subredditName} workflows.`;
    }
    if (post.score > 5 || post.commentCount > 5) {
      desc += ` (${post.score} upvotes, ${post.commentCount} comments)`;
    }

    results.push({ title, description: desc.trim(), category, subreddit: `r/${subredditName}`, sourcePost: post });
    if (results.length >= 5) break;
  }
  return results;
}

async function scanSubreddit(page, info) {
  const { name, category } = info;
  console.log(`\n=== Scanning r/${name} ===`);
  const posts = [];
  const painPoints = [];

  try {
    await page.goto(`https://www.reddit.com/r/${name}/hot/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(3000);

    const url = page.url();
    console.log(`  URL: ${url}`);
    if (url.includes('/login') || url.includes('/register')) {
      console.log(`  Login wall!`);
      await logScan(name, 0, 0, 'login_wall');
      return { postsScanned: 0, painPoints: [] };
    }

    console.log(`  Scrolling to load posts...`);
    const postLinks = await loadMorePosts(page, 22);
    console.log(`  Got ${postLinks.length} post links`);

    if (postLinks.length === 0) {
      await logScan(name, 0, 0, 'no_posts_found');
      return { postsScanned: 0, painPoints: [] };
    }

    const toRead = postLinks.slice(0, 20);
    for (const pl of toRead) {
      try {
        await sleep(2500);
        const pd = await readPostContent(page, pl, name);
        posts.push(pd);
        console.log(`  ✓ "${pd.title.slice(0, 55)}" (↑${pd.score} 💬${pd.commentCount})`);
      } catch (e) {
        console.log(`  [skip] ${e.message.slice(0, 60)}`);
      }
    }

    // Return to listing
    await page.goto(`https://www.reddit.com/r/${name}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2000);

    const found = analyzePainPoints(posts, category, name);
    console.log(`  Pain points: ${found.length}`);

    for (const pp of found) {
      try {
        const created = await submitPainPoint(pp);
        const ppId = created?.id || created?._id;
        if (ppId && pp.sourcePost) await submitPost(ppId, pp.sourcePost);
        painPoints.push(pp);
      } catch (e) { console.log(`  [ERR] ${e.message.slice(0, 60)}`); }
    }

    await logScan(name, posts.length, painPoints.length, 'completed');
    return { postsScanned: posts.length, painPoints };

  } catch (e) {
    console.error(`  [ERROR]: ${e.message}`);
    await logScan(name, posts.length, painPoints.length, `error: ${e.message.slice(0, 100)}`);
    return { postsScanned: posts.length, painPoints };
  }
}

async function main() {
  console.log('[dave-r] Pass 2 scanner starting');
  const browser = await chromium.connectOverCDP(CDP_URL);
  console.log('[dave-r] Connected');

  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  const page = pages[0] || await ctx.newPage();
  for (let i = 1; i < pages.length; i++) await pages[i].close().catch(() => {});

  let totalPosts = 0, totalPP = 0;

  for (const info of SUBREDDITS) {
    const r = await scanSubreddit(page, info);
    totalPosts += r.postsScanned;
    totalPP += r.painPoints.length;
    await sleep(4000);
  }

  console.log('\n=== FINAL SUMMARY ===');
  console.log(`Subreddits: ${SUBREDDITS.length}`);
  console.log(`Posts: ${totalPosts}`);
  console.log(`Pain points: ${totalPP}`);

  setTimeout(() => process.exit(0), 1000);
}

main().catch(e => { console.error('[FATAL]', e.message); process.exit(1); });
