const { chromium } = require('playwright');
const http = require('http');

const CDP_URL = process.env.CDP_URL || 'ws://127.0.0.1:64318/devtools/browser/ca09af2e-3eb2-40d1-82d4-c7c0163d1e9f';
const API_KEY = 'openclaw-scanner-key';
const AGENT_ID = 'claire-t';

const SUBREDDITS = [
  { name: 'insomnia', category: 'Sleep & Recovery' },
  { name: 'CBTi', category: 'Sleep & Recovery' },
  { name: 'TMJ', category: 'TMJ & Chronic Pain' },
  { name: 'yinyoga', category: 'Yoga' },
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function apiPost(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const options = {
      hostname: 'localhost', port: 3000, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'Content-Length': Buffer.byteLength(body) },
    };
    const req = http.request(options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({ raw: d }); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function submitPainPoint(pp) {
  try {
    const r = await apiPost('/api/pain-points', { title: pp.title, description: pp.description, category: pp.category, subreddit: pp.subreddit, discoveredBy: AGENT_ID });
    const id = r?.id || r?.data?.id || r?.painPoint?.id;
    console.log(`  Created PP id=${id}: ${pp.title.slice(0, 60)}`);
    return r;
  } catch (e) { console.error('  submitPainPoint error:', e.message); return null; }
}

async function linkPost(ppId, post) {
  try {
    await apiPost('/api/pain-points/posts', { painPointId: ppId, redditPostId: post.redditPostId, redditUrl: post.redditUrl, postTitle: post.postTitle, postBody: (post.postBody||'').slice(0,2000), upvotes: post.upvotes||0, commentCount: post.commentCount||0, subreddit: post.subreddit, discoveredBy: AGENT_ID });
    console.log('  Linked source post');
  } catch (e) { console.error('  linkPost error:', e.message); }
}

async function logScan(sub, scanned, found, status) {
  try {
    await apiPost('/api/pain-points/scan-logs', { agentId: AGENT_ID, subreddit: `r/${sub}`, postsScanned: scanned, painPointsFound: found, status });
    console.log(`  Scan log: ${status} posts=${scanned} pp=${found}`);
  } catch (e) { console.error('  logScan error:', e.message); }
}

function hasPainSignal(text) {
  const lower = text.toLowerCase();
  return [
    "can't sleep","cant sleep","unable to sleep","tried everything","nothing works",
    "nothing helps","doesn't work","what works","any app","any tool","any advice",
    "tracking","looking for","recommendation","is there a","hard to","wish there",
    "jaw pain","tmj pain","grinding","clenching","flare","relief","treatment",
    "cbti","sleep restriction","stimulus control","sleep hygiene",
    "yin yoga","tension","how do you","how do i","anyone else","pain management",
    "frustrated","exhausted","desperate","help me","manual","spreadsheet",
    "expensive","complicated","symptoms","trigger","track my",
  ].some(s => lower.includes(s));
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max - 3) + '...' : str;
}

async function scanSubreddit(page, subName, category) {
  console.log(`\n=== Scanning r/${subName} ===`);

  // Navigate to old Reddit
  try {
    await page.goto(`https://old.reddit.com/r/${subName}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);
  } catch (e) {
    console.error(`  Nav error: ${e.message}`);
    await logScan(subName, 0, 0, 'error');
    return { postsScanned: 0, painPointsFound: 0 };
  }

  const currentUrl = page.url();
  const title = await page.title().catch(() => '');
  console.log(`  Title: "${title}" URL: ${currentUrl.slice(0,80)}`);

  const bodyText = await page.evaluate(() => (document.body?.innerText || '').slice(0, 500)).catch(() => '');
  if (bodyText.toLowerCase().includes('complete the captcha') || currentUrl.includes('/login') || bodyText.toLowerCase().includes('i am not a robot')) {
    console.log('  CAPTCHA/login wall — skipping');
    await logScan(subName, 0, 0, 'captcha');
    return { postsScanned: 0, painPointsFound: 0 };
  }

  // Extract posts from old Reddit listing
  let posts = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('.thing.link:not(.stickied):not(.promoted)').forEach(el => {
      const titleEl = el.querySelector('a.title');
      const fullname = el.getAttribute('data-fullname') || '';
      const postId = fullname.replace('t3_', '');
      if (!titleEl || !postId) return;
      const href = titleEl.getAttribute('href') || '';
      const url = href.startsWith('http') ? href : `https://www.reddit.com${href}`;
      const scoreEl = el.querySelector('.score.unvoted, .score.likes, .score.dislikes');
      const commentsEl = el.querySelector('a.comments');
      const scoreText = (scoreEl?.textContent || '').trim();
      const score = parseInt(scoreText.replace(/[^0-9]/g, '')) || 0;
      const cmatch = (commentsEl?.textContent || '').match(/(\d+)/);
      const commentCount = cmatch ? parseInt(cmatch[1]) : 0;
      results.push({ title: titleEl.textContent.trim(), url, postId, score, commentCount });
    });
    return results;
  }).catch(() => []);

  // If old Reddit failed, try new Reddit
  if (posts.length === 0) {
    console.log('  Falling back to new Reddit...');
    try {
      await page.goto(`https://www.reddit.com/r/${subName}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(3000);
      posts = await page.evaluate(() => {
        const results = [];
        document.querySelectorAll('shreddit-post').forEach(el => {
          const titleEl = el.querySelector('[slot="title"]') || el.shadowRoot?.querySelector('[slot="title"]');
          const permalink = el.getAttribute('permalink') || '';
          const match = permalink.match(/\/comments\/([a-z0-9]+)\//);
          if (!match || !titleEl) return;
          const postId = match[1];
          const score = parseInt(el.getAttribute('score') || '0') || 0;
          const commentCount = parseInt(el.getAttribute('comment-count') || '0') || 0;
          const fullUrl = permalink.startsWith('http') ? permalink : `https://www.reddit.com${permalink}`;
          results.push({ title: titleEl.textContent.trim(), url: fullUrl, postId, score, commentCount });
        });
        return results;
      });
    } catch (e) {
      console.error('  New Reddit fallback error:', e.message);
    }
  }

  console.log(`  Found ${posts.length} posts`);
  const filtered = posts.filter(p => p.score >= 5).slice(0, 22);
  console.log(`  Analyzing ${filtered.length} posts (score>=5)`);

  const candidates = [];

  for (const post of filtered) {
    // Quick title check for low-comment posts
    if (post.commentCount < 10) {
      if (hasPainSignal(post.title)) {
        candidates.push({ ...post, body: '', topComments: [] });
      }
      continue;
    }

    await sleep(2500);
    try {
      const oldUrl = `https://old.reddit.com/r/${subName}/comments/${post.postId}/`;
      await page.goto(oldUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await sleep(2000);

      const postData = await page.evaluate(() => {
        const bodyEl = document.querySelector('.usertext-body .md');
        const commentEls = document.querySelectorAll('.commentarea .comment:not(.deleted) .usertext-body .md');
        const topComments = [];
        commentEls.forEach((el, i) => { if (i < 8) topComments.push(el.innerText.trim().slice(0, 400)); });
        return { body: bodyEl ? bodyEl.innerText.trim() : '', topComments };
      }).catch(() => ({ body: '', topComments: [] }));

      const fullText = `${post.title} ${postData.body} ${postData.topComments.join(' ')}`;
      if (hasPainSignal(fullText)) {
        candidates.push({ ...post, body: postData.body, topComments: postData.topComments });
      }

      // Navigate back to listing
      await page.goto(`https://old.reddit.com/r/${subName}/hot/`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      await sleep(1500);
    } catch (e) {
      console.error(`  Error reading post ${post.postId}:`, e.message);
      if (hasPainSignal(post.title)) candidates.push({ ...post, body: '', topComments: [] });
    }
  }

  console.log(`  ${candidates.length} pain point candidates`);

  let submitted = 0;
  for (const c of candidates) {
    const ppTitle = truncate(c.title, 80);
    let desc = '';
    if (c.body && c.body.length > 50) {
      desc = truncate(c.body, 400);
    } else if (c.topComments.length > 0) {
      desc = `r/${subName} post: "${truncate(c.title, 100)}". Community: ${truncate(c.topComments[0], 250)}`;
    } else {
      desc = `Post in r/${subName} with ${c.score} upvotes, ${c.commentCount} comments: "${c.title}"`;
    }
    if (!ppTitle) continue;

    const result = await submitPainPoint({ title: ppTitle, description: desc, category, subreddit: `r/${subName}` });
    const ppId = result?.id || result?.data?.id || result?.painPoint?.id;
    if (ppId) {
      submitted++;
      await linkPost(ppId, { redditPostId: c.postId, redditUrl: c.url, postTitle: c.title, postBody: c.body, upvotes: c.score, commentCount: c.commentCount, subreddit: `r/${subName}` });
    }
    await sleep(400);
  }

  await logScan(subName, filtered.length, submitted, 'completed');
  return { postsScanned: filtered.length, painPointsFound: submitted };
}

async function main() {
  console.log('Claire-T Scanner starting...');
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected to browser');
  } catch (e) {
    console.error('CDP connect failed:', e.message);
    process.exit(1);
  }

  // Get existing context and page — do NOT create new ones
  const contexts = browser.contexts();
  console.log(`  Contexts available: ${contexts.length}`);
  const context = contexts[0];
  if (!context) { console.error('No browser context available'); process.exit(1); }

  const existingPages = context.pages();
  console.log(`  Existing pages: ${existingPages.length}`);
  
  let page;
  if (existingPages.length > 0) {
    page = existingPages[0];
    console.log('  Reusing existing page');
  } else {
    // Try to create one if somehow there are none
    page = await context.newPage();
    console.log('  Created new page');
  }

  let totalPosts = 0, totalPP = 0;
  const errors = [];

  for (const { name, category } of SUBREDDITS) {
    try {
      const r = await scanSubreddit(page, name, category);
      totalPosts += r.postsScanned;
      totalPP += r.painPointsFound;
    } catch (e) {
      console.error(`Error scanning r/${name}:`, e.message);
      errors.push(`r/${name}: ${e.message}`);
      await logScan(name, 0, 0, 'error');
    }
    await sleep(3000);
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits: ${SUBREDDITS.length}`);
  console.log(`Posts analyzed: ${totalPosts}`);
  console.log(`Pain points submitted: ${totalPP}`);
  if (errors.length) console.log('Errors:', errors.join(' | '));
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
