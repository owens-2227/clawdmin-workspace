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
    return { status: res.status, data: JSON.parse(text) };
  } catch {
    return { status: res.status, data: text };
  }
}

async function submitPainPoint(pp) {
  const res = await apiPost('/api/pain-points', {
    title: pp.title.slice(0, 80),
    description: pp.description,
    category: pp.category,
    subreddit: pp.subreddit,
    discoveredBy: AGENT_ID,
  });
  console.log(`  [API] Pain point: status=${res.status}`, JSON.stringify(res.data).slice(0, 150));
  return res.data;
}

async function submitPost(painPointId, post) {
  const res = await apiPost('/api/pain-points/posts', {
    painPointId,
    redditPostId: post.id,
    redditUrl: post.url,
    postTitle: post.title,
    postBody: (post.body || '').slice(0, 2000),
    upvotes: post.score,
    commentCount: post.commentCount,
    subreddit: post.subreddit,
    discoveredBy: AGENT_ID,
  });
  console.log(`  [API] Post linked: status=${res.status}`);
}

async function logScan(subreddit, postsScanned, painPointsFound, status) {
  const res = await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned,
    painPointsFound,
    status,
  });
  console.log(`  [API] Scan log: status=${res.status}`);
}

// Extract post ID from Reddit URL
function extractPostId(url) {
  const m = url.match(/\/comments\/([a-z0-9]+)\//i);
  return m ? m[1] : url.split('/').filter(Boolean).pop() || '';
}

async function getPostLinks(page) {
  // Try shreddit-post (new Reddit SPA)
  try {
    const posts = await page.$$eval('shreddit-post', els =>
      els.map(el => ({
        title: el.getAttribute('post-title') || '',
        permalink: el.getAttribute('permalink') || '',
        id: el.getAttribute('thingid') || '',
        score: parseInt(el.getAttribute('score') || '0') || 0,
        commentCount: parseInt(el.getAttribute('comment-count') || '0') || 0,
      })).filter(p => p.permalink && p.permalink.includes('/comments/'))
    );
    if (posts.length > 0) { console.log(`  [posts] shreddit-post: ${posts.length}`); return posts; }
  } catch (e) { console.log(`  shreddit-post fail: ${e.message.slice(0,60)}`); }

  // Try data-click-id=body links
  try {
    const posts = await page.$$eval('a[data-click-id="body"][href*="/comments/"]', els => {
      const seen = new Set();
      return els.map(el => {
        const href = el.getAttribute('href') || '';
        const m = href.match(/\/comments\/([a-z0-9]+)\//i);
        if (!m || seen.has(m[1])) return null;
        seen.add(m[1]);
        return { title: el.textContent?.trim() || '', permalink: href, id: m[1], score: 0, commentCount: 0 };
      }).filter(Boolean);
    });
    if (posts.length > 0) { console.log(`  [posts] data-click-id=body: ${posts.length}`); return posts; }
  } catch (e) { console.log(`  click-id fail: ${e.message.slice(0,60)}`); }

  // Generic /comments/ links
  try {
    const posts = await page.$$eval('a[href*="/comments/"]', els => {
      const seen = new Set();
      return els.map(el => {
        const href = el.getAttribute('href') || '';
        const m = href.match(/\/comments\/([a-z0-9]+)\//i);
        if (!m || seen.has(m[1])) return null;
        seen.add(m[1]);
        const text = el.textContent?.trim() || '';
        if (text.length < 5) return null;
        return { title: text, permalink: href, id: m[1], score: 0, commentCount: 0 };
      }).filter(Boolean);
    });
    if (posts.length > 0) { console.log(`  [posts] generic links: ${posts.length}`); return posts; }
  } catch (e) { console.log(`  generic fail: ${e.message.slice(0,60)}`); }

  return [];
}

async function readPostContent(page, post) {
  const fullUrl = post.permalink.startsWith('http')
    ? post.permalink
    : `https://www.reddit.com${post.permalink}`;

  await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
  await sleep(2500);

  let title = post.title;
  let body = '';
  let score = post.score || 0;
  let commentCount = post.commentCount || 0;
  let id = post.id;

  // Get title
  try {
    const h1 = await page.$('h1');
    if (h1) title = (await h1.textContent())?.trim() || title;
  } catch {}

  // Get shreddit-post attributes
  try {
    const sp = await page.$('shreddit-post');
    if (sp) {
      score = parseInt(await sp.getAttribute('score') || String(score)) || score;
      commentCount = parseInt(await sp.getAttribute('comment-count') || String(commentCount)) || commentCount;
      id = (await sp.getAttribute('thingid') || id).replace('t3_', '');
      // Try text body slot
      const slot = await sp.$('[slot="text-body"]');
      if (slot) body = (await slot.textContent())?.trim() || '';
    }
  } catch {}

  // Fallback body selectors
  if (!body) {
    for (const sel of [
      '[data-testid="post-content"]',
      '.Post__body',
      '[data-adclicklocation="text_body"]',
      '.RichTextJSON-root',
    ]) {
      try {
        const el = await page.$(sel);
        if (el) { body = (await el.textContent())?.trim() || ''; if (body) break; }
      } catch {}
    }
  }

  // Get top comments
  const commentTexts = [];
  try {
    const commentEls = await page.$$('shreddit-comment');
    for (const el of commentEls.slice(0, 8)) {
      const t = (await el.textContent())?.trim();
      if (t && t.length > 15) commentTexts.push(t.slice(0, 250));
    }
  } catch {}
  if (commentTexts.length === 0) {
    try {
      const commentEls = await page.$$('[data-testid="comment"]');
      for (const el of commentEls.slice(0, 8)) {
        const t = (await el.textContent())?.trim();
        if (t && t.length > 15) commentTexts.push(t.slice(0, 250));
      }
    } catch {}
  }

  if (commentTexts.length > 0) {
    body += '\n\nTop comments:\n' + commentTexts.join('\n---\n');
  }

  return {
    id: id || extractPostId(fullUrl),
    title: title.slice(0, 300),
    body: body.trim().slice(0, 3000),
    score,
    commentCount,
    url: fullUrl,
    subreddit: post.subreddit || '',
  };
}

// Pain point analysis
const PAIN_PATTERNS = [
  /is there (an? )?(app|tool|software|way|service|website|plugin)/i,
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
  /never know|don't know where to start/i,
  /beginner.{0,20}(confused|lost|overwhelmed)/i,
  /how (do|should) i (start|begin|approach)/i,
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
      desc = `Community member in r/${subredditName} asks: "${post.title.slice(0, 150)}". Reflects a recurring pain point around ${subredditName}-related tasks.`;
    }
    if (post.score > 10 || post.commentCount > 5) {
      desc += ` (${post.score} upvotes, ${post.commentCount} comments)`;
    }

    results.push({
      title,
      description: desc.trim(),
      category,
      subreddit: `r/${subredditName}`,
      sourcePost: post,
    });

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
    await page.goto(`https://www.reddit.com/r/${name}/hot/`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    await sleep(3000);

    const url = page.url();
    console.log(`  Loaded: ${url}`);

    // Check for redirect/wall
    if (url.includes('reddit.com/login') || url.includes('reddit.com/register')) {
      console.log(`  [WARN] Login wall hit on r/${name}`);
      await logScan(name, 0, 0, 'login_wall');
      return { postsScanned: 0, painPoints: [] };
    }

    const postLinks = await getPostLinks(page);
    if (postLinks.length === 0) {
      console.log(`  No posts found`);
      await logScan(name, 0, 0, 'no_posts_found');
      return { postsScanned: 0, painPoints: [] };
    }

    // Filter posts worth reading (score > 0 preferred, or take all if score unknown)
    const toRead = postLinks
      .filter(p => p.score >= 0) // keep all
      .slice(0, 18);

    console.log(`  Reading ${toRead.length} posts...`);
    for (const postLink of toRead) {
      try {
        await sleep(2500);
        const postData = {
          ...await readPostContent(page, { ...postLink, subreddit: `r/${name}` }),
          subreddit: `r/${name}`,
        };
        posts.push(postData);
        console.log(`  ✓ "${postData.title.slice(0, 55)}" (↑${postData.score} 💬${postData.commentCount})`);
      } catch (e) {
        console.log(`  [SKIP] ${e.message.slice(0, 80)}`);
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
        const ppId = created?.id || created?._id || created?.painPointId;
        if (ppId && pp.sourcePost) {
          await submitPost(ppId, pp.sourcePost);
        }
        painPoints.push(pp);
      } catch (e) {
        console.log(`  [ERR] Submit failed: ${e.message.slice(0, 80)}`);
      }
    }

    await logScan(name, posts.length, painPoints.length, 'completed');
    return { postsScanned: posts.length, painPoints };

  } catch (e) {
    console.error(`  [ERROR] r/${name}: ${e.message}`);
    await logScan(name, posts.length, painPoints.length, `error: ${e.message.slice(0, 100)}`);
    return { postsScanned: posts.length, painPoints };
  }
}

async function main() {
  console.log('[dave-r] Reddit pain point scanner starting');
  console.log('CDP:', CDP_URL);

  const browser = await chromium.connectOverCDP(CDP_URL);
  console.log('[dave-r] Browser connected, contexts:', browser.contexts().length);

  const ctx = browser.contexts()[0] || await browser.newContext();
  const existingPages = ctx.pages();
  const page = existingPages[0] || await ctx.newPage();

  // Close extra pages
  for (let i = 1; i < existingPages.length; i++) {
    await existingPages[i].close().catch(() => {});
  }

  let totalPosts = 0;
  let totalPP = 0;
  const errors = [];

  for (const info of SUBREDDITS) {
    try {
      const r = await scanSubreddit(page, info);
      totalPosts += r.postsScanned;
      totalPP += r.painPoints.length;
    } catch (e) {
      console.error(`[ERR] ${info.name}: ${e.message}`);
      errors.push(info.name);
    }
    await sleep(4000);
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits: ${SUBREDDITS.length}`);
  console.log(`Posts analyzed: ${totalPosts}`);
  console.log(`Pain points submitted: ${totalPP}`);
  if (errors.length) console.log(`Errors in: ${errors.join(', ')}`);
}

main().catch(e => { console.error('[FATAL]', e.message); process.exit(1); });
