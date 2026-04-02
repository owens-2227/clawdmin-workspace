// Re-link source posts using browser CDP (has residential proxy)
const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:50153/devtools/browser/c18c99e2-0b4a-43cc-8f5b-140638eed70f';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const AGENT_ID = 'raj-s';

const painPointMap = {
  'BBC News Article on Film Photography': 'c5102a5f-0345-45a1-8bd0-44430181b45e',
  'TSA Burned my film': '3e893c42-de33-440f-a492-c1c23787b8d2',
  'Lightest SLR for travel': 'c2269d4d-6618-41c7-b76b-223cc0b9ebf7',
  "I have a problem, or I don't have a problem.": '2cfd6458-2490-49f5-b6c4-063529fd5ba2',
  'why do all of my photos come out so muted/flat?': 'e76fd291-5947-4830-b06d-c926be277230',
  "Anyone know where to get Konica Autorex CLA'ed": 'd3600eaf-3284-4726-947b-255f07d50e9b',
  'Like New Yashica Mat 124G': '3130425a-73ab-44bf-99bb-33fad61f9315',
  'I rewired a broken double-8 camera': 'c0bfc00c-4112-4333-9ac5-29d74ac49ab3',
  'I feel like there are way too many switches': '51257199-38e8-4346-b4c6-dd2bfe832e5d',
  'Fixed broken keyboard': '992c8e7d-d31e-479a-9fa0-1a8c9b2c1661',
  'I powered my display boards': 'ab822124-17c2-4aa2-80ce-e8cb2c68e935',
  "Beginner here, I can't figure out how to emphasize the biker": 'cf3fce51-7829-4c3c-8660-899ea735f7d1',
};

function findPainPointId(postTitle) {
  for (const [key, id] of Object.entries(painPointMap)) {
    if (postTitle.toLowerCase().includes(key.toLowerCase().substring(0, 20))) {
      return id;
    }
  }
  return null;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const pages = context.pages();
  const page = pages[0] || await context.newPage();

  const SUBREDDITS = ['AnalogCommunity', 'MechanicalKeyboards', 'photocritique'];
  let linked = 0;

  for (const sub of SUBREDDITS) {
    console.log(`\nFetching r/${sub} via browser...`);
    try {
      const response = await page.evaluate(async (sub) => {
        const res = await fetch(`https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
        });
        return { status: res.status, body: await res.text() };
      }, sub);

      if (response.status !== 200) {
        console.log(`  HTTP ${response.status}`);
        continue;
      }

      const data = JSON.parse(response.body);
      const posts = (data.data?.children || []).map(c => c.data).filter(p => p && !p.stickied);
      console.log(`  ${posts.length} posts`);

      for (const post of posts) {
        const ppId = findPainPointId(post.title);
        if (!ppId) continue;

        console.log(`  Linking: "${post.title.substring(0, 60)}" → ${ppId}`);
        const result = await apiPost('/api/pain-points/posts', {
          painPointId: ppId,
          redditPostId: post.id,
          redditUrl: `https://reddit.com${post.permalink}`,
          postTitle: post.title,
          postBody: (post.selftext || '').substring(0, 2000),
          upvotes: post.score,
          commentCount: post.num_comments,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID,
        });
        console.log(`    Result: ${JSON.stringify(result).substring(0, 150)}`);
        linked++;
        await sleep(300);
      }
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }
    await sleep(2000);
  }

  console.log(`\nLinked ${linked} source posts`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
