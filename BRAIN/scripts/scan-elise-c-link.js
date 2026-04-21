// Fix script: The pain points were already created but source posts weren't linked
// because we were checking ppResult.id instead of ppResult.painPoint.id
// Also runs a clean rescan with correct logic

const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:59924/devtools/browser/829255e2-559d-4ac0-ab81-300ecabcdcf5';
const AGENT_ID = 'elise-c';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const SUBREDDITS = [
  { name: 'cats', category: 'Cats & Pets' },
  { name: 'rawpetfood', category: 'Cats & Pets' },
  { name: 'ThriftStoreHauls', category: 'Thrifting' },
  { name: 'felinediabetes', category: 'Cats & Pets' },
  { name: 'EatCheapAndHealthy', category: 'Cooking' },
  { name: 'lawncare', category: 'Gardening' },
  { name: 'houseplants', category: 'Plant Parents' },
  { name: 'proplifting', category: 'Plant Parents' },
  { name: 'plantclinic', category: 'Plant Parents' },
  { name: 'IndoorGarden', category: 'Plant Parents' },
];

async function apiPost(path, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function extractId(result) {
  // Handle various response shapes: {id:...}, {painPoint:{id:...}}, {data:{id:...}}
  if (result.id) return result.id;
  if (result.painPoint && result.painPoint.id) return result.painPoint.id;
  if (result.data && result.data.id) return result.data.id;
  return null;
}

async function fetchRedditViaPage(page, subreddit) {
  const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=25&raw_json=1`;
  const result = await page.evaluate(async (fetchUrl) => {
    try {
      const resp = await fetch(fetchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'application/json',
        }
      });
      if (!resp.ok) return { error: `HTTP ${resp.status}` };
      const data = await resp.json();
      return { data };
    } catch (e) {
      return { error: e.message };
    }
  }, url);
  if (result.error) throw new Error(result.error);
  return result.data.data.children.map(c => c.data);
}

async function scanSubreddit(page, subreddit, category) {
  console.log(`\n=== Scanning r/${subreddit} ===`);
  let posts = [];

  try {
    await page.goto(`https://www.reddit.com/r/${subreddit}/hot/`, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await page.waitForTimeout(2000);
  } catch (err) {
    console.log(`  Nav error: ${err.message}`);
  }

  try {
    posts = await fetchRedditViaPage(page, subreddit);
    console.log(`  ${posts.length} posts from JSON API`);
  } catch (err) {
    console.log(`  JSON via page failed: ${err.message}, trying direct`);
    try {
      const resp = await fetch(`https://www.reddit.com/r/${subreddit}/hot.json?limit=25&raw_json=1`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' }
      });
      const data = await resp.json();
      posts = data.data.children.map(c => c.data);
      console.log(`  ${posts.length} posts (direct fallback)`);
    } catch (e2) {
      console.log(`  All methods failed: ${e2.message}`);
      await apiPost('/api/pain-points/scan-logs', {
        agentId: AGENT_ID, subreddit: `r/${subreddit}`,
        postsScanned: 0, painPointsFound: 0, status: 'error',
      });
      return 0;
    }
  }

  const validPosts = posts.filter(p => !p.stickied && (p.score >= 5 || p.num_comments >= 3));
  console.log(`  ${validPosts.length} valid posts`);

  const painPointKeywords = [
    'how do i', 'how to', 'struggling', 'frustrated', 'annoying', 'wish there was',
    'is there an app', 'is there a tool', 'is there a way', 'does anyone know',
    'keeps dying', 'keeps failing', "won't", "can't figure out", 'hard to',
    'difficult', 'problem with', 'issue with', 'help with', 'need help',
    'anyone else', 'best way to', 'what do you use for', 'looking for',
    'recommendation', 'advice', 'tips for', 'overwhelmed', 'confused',
    'not sure how', 'manually', 'spreadsheet', 'track', 'organize', 'manage',
    'expensive', 'too complex', 'overpriced', 'no good solution',
    'keep killing', 'dying', 'yellow', 'drooping', 'help me', 'what is wrong',
    'why is my', 'glucose', 'insulin', 'dosing', 'curve', 'regulate',
    'budget', 'cheap', 'afford', 'meal prep', 'price', 'cost',
    'flea', 'vet', 'sick', 'diagnose', 'symptoms',
    'raw feeding', 'transition', 'balance', 'recipe',
    'mow', 'weed', 'grass', 'lawn care', 'fertilize', 'dead',
    'find', 'identify', 'thrift', 'resell', 'flip', 'authenticate',
  ];

  const painPoints = [];
  for (const post of validPosts) {
    const combined = (post.title + ' ' + (post.selftext || '')).toLowerCase();
    const isPainPoint = painPointKeywords.some(kw => combined.includes(kw));
    const isQuestion = combined.includes('?') || post.title.toLowerCase().startsWith('help');
    const hasEngagement = post.num_comments >= 5 || post.score >= 30;
    const hasBody = post.selftext && post.selftext.length > 30;
    if ((isPainPoint || isQuestion) && (hasEngagement || hasBody)) {
      painPoints.push(post);
    }
  }

  console.log(`  ${painPoints.length} pain point candidates`);

  let submitted = 0;
  for (const post of painPoints.slice(0, 5)) {
    try {
      const bodySnippet = post.selftext ? post.selftext.slice(0, 400).replace(/\n+/g, ' ').trim() : '';
      const description = bodySnippet || `Active discussion in r/${subreddit}: "${post.title}". ${post.num_comments} comments, ${post.score} upvotes.`;
      const title = post.title.slice(0, 80);

      const ppResult = await apiPost('/api/pain-points', {
        title, description: description.slice(0, 500),
        category, subreddit: `r/${subreddit}`, discoveredBy: AGENT_ID,
      });

      const ppId = extractId(ppResult);
      console.log(`  PP create: id=${ppId} raw=${JSON.stringify(ppResult).slice(0,80)}`);

      if (ppId) {
        const linkResult = await apiPost('/api/pain-points/posts', {
          painPointId: ppId,
          redditPostId: post.id,
          redditUrl: `https://reddit.com${post.permalink}`,
          postTitle: post.title,
          postBody: (post.selftext || '').slice(0, 2000),
          upvotes: post.score,
          commentCount: post.num_comments,
          subreddit: `r/${subreddit}`,
          discoveredBy: AGENT_ID,
        });
        const linkId = extractId(linkResult);
        console.log(`  ✓ Submitted: "${title.slice(0,55)}" (pp=${ppId}, link=${linkId})`);
        submitted++;
      } else {
        console.log(`  ✗ Could not extract ID from: ${JSON.stringify(ppResult).slice(0,120)}`);
      }

      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.log(`  ✗ Error: ${err.message}`);
    }
  }

  await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID, subreddit: `r/${subreddit}`,
    postsScanned: validPosts.length, painPointsFound: submitted, status: 'completed',
  });

  console.log(`  ✓ Done: ${validPosts.length} posts, ${submitted} pain points`);
  return submitted;
}

async function main() {
  console.log(`Starting — Agent: ${AGENT_ID}`);

  // First test the API endpoint to understand response shape
  console.log('\nTesting API...');
  const test = await apiPost('/api/pain-points', {
    title: 'TEST - delete me',
    description: 'Testing API response shape',
    category: 'Cats & Pets',
    subreddit: 'r/test',
    discoveredBy: AGENT_ID,
  });
  console.log(`API test response: ${JSON.stringify(test).slice(0, 200)}`);
  const testId = extractId(test);
  console.log(`Extracted ID: ${testId}`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('✓ CDP connected');
  } catch (err) {
    console.error(`✗ CDP failed: ${err.message}`);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const pages = context.pages();
  for (let i = 1; i < pages.length; i++) { try { await pages[i].close(); } catch {} }
  const page = pages[0] || await context.newPage();

  let total = 0;
  const results = [];

  for (const { name, category } of SUBREDDITS) {
    try {
      const found = await scanSubreddit(page, name, category);
      total += found;
      results.push({ subreddit: name, found });
    } catch (err) {
      console.error(`✗ r/${name}: ${err.message}`);
      results.push({ subreddit: name, found: 0, error: err.message });
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\n=== COMPLETE ===');
  console.log(`Total: ${total} pain points across ${SUBREDDITS.length} subreddits`);
  results.forEach(r => console.log(`  r/${r.subreddit}: ${r.found}${r.error ? ` ERR: ${r.error}` : ''}`));
  process.exit(0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
