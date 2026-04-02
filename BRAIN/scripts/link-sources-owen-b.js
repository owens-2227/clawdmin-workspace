// Fix script: re-fetch posts and link them to already-created pain points
const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:58450/devtools/browser/24531058-50cc-4d1f-92f4-0305f63f5c51';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const AGENT_ID = 'owen-b';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function apiPost(path, data) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(data),
  });
  return res.json();
}

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'x-api-key': API_KEY }
  });
  return res.json();
}

async function main() {
  // Get all pain points we created
  const data = await apiGet('/api/pain-points?discoveredBy=owen-b&limit=50');
  const pps = data.painPoints || data || [];
  console.log(`Found ${pps.length} existing pain points to link`);

  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.newPage();

  const subreddits = ['ADHD', 'languagelearning', 'remotework', 'productivity'];
  
  // Build title->painPoint map for matching
  const ppMap = {};
  for (const pp of pps) {
    // Normalize title for matching
    const norm = (pp.title || '').toLowerCase().replace(/[^\w\s]/g, '').trim();
    ppMap[norm] = pp;
  }

  let linked = 0;

  for (const sub of subreddits) {
    console.log(`\nFetching r/${sub} posts for linking...`);
    try {
      await page.goto(`https://www.reddit.com/r/${sub}/hot.json?limit=25`, {
        waitUntil: 'domcontentloaded', timeout: 30000
      });
      await sleep(2000);
      const jsonText = await page.evaluate(() => document.body.innerText);
      const listing = JSON.parse(jsonText);
      const children = listing?.data?.children || [];

      for (const child of children) {
        const d = child.data;
        if (d.stickied || d.score < 5) continue;
        
        const postTitleNorm = (d.title || '').toLowerCase().replace(/[^\w\s]/g, '').trim();
        
        // Try to find matching pain point
        let matchedPp = null;
        for (const [key, pp] of Object.entries(ppMap)) {
          if (pp.subreddit === `r/${sub}`) {
            // Check if pain point title contains words from post title
            const ppWords = key.split(/\s+/).filter(w => w.length > 4);
            const postWords = postTitleNorm.split(/\s+/).filter(w => w.length > 4);
            const overlap = ppWords.filter(w => postWords.includes(w)).length;
            if (overlap >= 2 || key.includes(postTitleNorm.slice(0, 20)) || postTitleNorm.includes(key.slice(0, 20))) {
              matchedPp = pp;
              break;
            }
          }
        }

        if (matchedPp) {
          console.log(`  Linking "${d.title.slice(0,50)}" -> "${matchedPp.title.slice(0,50)}"`);
          try {
            // Get post body
            let body = d.selftext || '';
            if (d.num_comments >= 5 && !body) {
              await sleep(1500);
              await page.goto(`https://www.reddit.com${d.permalink}.json?limit=5`, {
                waitUntil: 'domcontentloaded', timeout: 20000
              });
              await sleep(1000);
              const postJson = await page.evaluate(() => document.body.innerText);
              const postData = JSON.parse(postJson);
              body = postData?.[0]?.data?.children?.[0]?.data?.selftext || '';
            }

            await apiPost('/api/pain-points/posts', {
              painPointId: matchedPp.id,
              redditPostId: d.id,
              redditUrl: `https://reddit.com${d.permalink}`,
              postTitle: d.title,
              postBody: body.slice(0, 2000),
              upvotes: d.score,
              commentCount: d.num_comments,
              subreddit: `r/${sub}`,
              discoveredBy: AGENT_ID,
            });
            linked++;
            delete ppMap[Object.keys(ppMap).find(k => ppMap[k].id === matchedPp.id)];
          } catch (e) {
            console.log(`    Link error: ${e.message}`);
          }
          await sleep(500);
        }
      }
      await sleep(3000);
    } catch (e) {
      console.log(`  Error on r/${sub}: ${e.message}`);
    }
  }

  console.log(`\nLinked ${linked} source posts to pain points`);
}

main().catch(e => { console.error(e); process.exit(1); });
