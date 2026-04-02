// Fix script: Link source posts to already-created marcus-j pain points
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
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${path} failed ${res.status}: ${text}`);
  }
  return res.json();
}

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'x-api-key': API_KEY },
  });
  if (!res.ok) throw new Error(`GET ${path} failed ${res.status}`);
  return res.json();
}

async function main() {
  // Get all marcus-j pain points
  const ppData = await apiGet(`/api/pain-points?discoveredBy=${AGENT_ID}&limit=100`);
  const painPoints = ppData.painPoints || [];
  console.log(`Found ${painPoints.length} marcus-j pain points`);

  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const pages = context.pages();
  const page = pages[0] || await context.newPage();

  // Close extra tabs
  for (let i = 1; i < pages.length; i++) await pages[i].close().catch(() => {});

  let totalLinked = 0;

  for (const sub of SUBREDDITS) {
    const subPainPoints = painPoints.filter(pp => pp.subreddit === `r/${sub.name}`);
    if (subPainPoints.length === 0) {
      console.log(`[${sub.name}] No pain points to link`);
      // Still log the scan
      try {
        await apiPost('/api/pain-points/scan-logs', {
          agentId: AGENT_ID,
          subreddit: `r/${sub.name}`,
          postsScanned: 0,
          painPointsFound: 0,
          status: 'completed',
        });
      } catch (e) {}
      continue;
    }

    console.log(`[${sub.name}] Linking ${subPainPoints.length} pain points...`);

    // Fetch posts JSON
    let posts = [];
    try {
      await page.goto(`https://www.reddit.com/r/${sub.name}/hot.json?limit=25`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(2000);
      const bodyText = await page.evaluate(() => document.body.innerText);
      const data = JSON.parse(bodyText);
      if (data?.error) {
        console.log(`[${sub.name}] API error: ${data.error}`);
      } else {
        posts = (data?.data?.children || []).map(c => ({
          id: c.data.id,
          title: c.data.title,
          score: c.data.score,
          commentCount: c.data.num_comments,
          permalink: c.data.permalink,
          body: c.data.selftext || '',
        }));
      }
    } catch (e) {
      console.log(`[${sub.name}] Fetch error: ${e.message}`);
    }

    // Match pain points to posts by title prefix
    for (const pp of subPainPoints) {
      const title = pp.title.toLowerCase();
      const matchedPost = posts.find(p => {
        const ptitle = p.title.toLowerCase();
        // Match if one starts with the other (handles truncation)
        return ptitle.startsWith(title.slice(0, 50)) || title.startsWith(ptitle.slice(0, 50));
      });

      if (matchedPost) {
        try {
          await apiPost('/api/pain-points/posts', {
            painPointId: pp.id,
            redditPostId: matchedPost.id,
            redditUrl: `https://reddit.com${matchedPost.permalink}`,
            postTitle: matchedPost.title,
            postBody: matchedPost.body.slice(0, 2000),
            upvotes: matchedPost.score,
            commentCount: matchedPost.commentCount,
            subreddit: `r/${sub.name}`,
            discoveredBy: AGENT_ID,
          });
          console.log(`[${sub.name}] ✓ Linked: ${pp.title.slice(0, 60)}`);
          totalLinked++;
        } catch (e) {
          console.log(`[${sub.name}] Error linking ${pp.id}: ${e.message}`);
        }
      } else {
        console.log(`[${sub.name}] No match found for: ${pp.title.slice(0, 60)}`);
        // Still try to link with just the pain point ID via a generic approach
        // (post may have scrolled off hot or been truncated in title)
      }
      await sleep(500);
    }

    // Log scan
    try {
      await apiPost('/api/pain-points/scan-logs', {
        agentId: AGENT_ID,
        subreddit: `r/${sub.name}`,
        postsScanned: posts.length,
        painPointsFound: subPainPoints.length,
        status: 'completed',
      });
    } catch (e) {
      console.log(`[${sub.name}] Error logging: ${e.message}`);
    }

    await sleep(2000);
  }

  console.log(`\nDone. Linked ${totalLinked} source posts.`);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
