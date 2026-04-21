const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

const CDP_URL = 'ws://127.0.0.1:49191/devtools/browser/b4331b4f-2e39-43b1-a422-d9502392069a';
const AGENT_ID = 'marco-v';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const SUBREDDITS = [
  { name: 'nocode', category: 'No-Code & Builders' },
  { name: 'Nootropics', category: 'Biohacking' },
  { name: 'Biohackers', category: 'Biohacking' },
  { name: 'SideProject', category: 'No-Code & Builders' },
  { name: 'personalfinance', category: 'Personal Finance' },
  { name: 'cooking', category: 'Cooking' },
  { name: 'solotravel', category: 'Solo Travel' },
  { name: 'frugal', category: 'Personal Finance' },
  { name: 'therapists', category: 'Therapy' },
  { name: 'Journaling', category: 'Journaling' },
];

function apiPost(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const url = new URL(API_BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port || 3000,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseData));
        } catch (e) {
          resolve({ raw: responseData });
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchSubredditJSON(subreddit) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.reddit.com',
      path: `/r/${subreddit}/hot.json?limit=25&raw_json=1`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(null);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

async function scanSubreddit(page, subredditInfo) {
  const { name, category } = subredditInfo;
  console.log(`\n=== Scanning r/${name} ===`);
  
  const painPoints = [];
  let postsScanned = 0;
  let posts = [];

  // Try browser first
  try {
    await page.goto(`https://www.reddit.com/r/${name}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    // Scroll to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    // Check if we hit a block/captcha
    const title = await page.title();
    console.log(`Page title: ${title}`);
    
    const content = await page.evaluate(() => document.body.innerText);
    
    if (content.includes('captcha') || content.includes('CAPTCHA') || content.toLowerCase().includes('verify you are human')) {
      console.log(`CAPTCHA detected on r/${name}, falling back to JSON API`);
      throw new Error('CAPTCHA');
    }

    // Try to extract posts from the page
    const pageText = content.substring(0, 50000); // limit
    
    // Try JSON fallback for structured data since Reddit SPA is hard to parse
    throw new Error('use JSON fallback');
    
  } catch (browserErr) {
    console.log(`Browser approach issue: ${browserErr.message}, trying JSON API...`);
  }

  // JSON API fallback
  try {
    const json = await fetchSubredditJSON(name);
    if (!json || !json.data || !json.data.children) {
      console.log(`Failed to fetch JSON for r/${name}`);
      await apiPost('/api/pain-points/scan-logs', {
        agentId: AGENT_ID,
        subreddit: `r/${name}`,
        postsScanned: 0,
        painPointsFound: 0,
        status: 'error',
      });
      return [];
    }

    posts = json.data.children
      .map(c => c.data)
      .filter(p => !p.stickied && p.score >= 5 && p.selftext !== '');
    
    postsScanned = posts.length;
    console.log(`Got ${postsScanned} posts from JSON API`);

    // Analyze each post for pain points
    for (const post of posts) {
      const title = post.title || '';
      const body = post.selftext || '';
      const combined = (title + ' ' + body).toLowerCase();
      
      // Pain point detection heuristics
      const isPainPoint = (
        combined.includes('frustrat') ||
        combined.includes('annoying') ||
        combined.includes('can\'t find') ||
        combined.includes('looking for') ||
        combined.includes('is there a') ||
        combined.includes('is there an') ||
        combined.includes('anyone know') ||
        combined.includes('does anyone') ||
        combined.includes('need help') ||
        combined.includes('struggling') ||
        combined.includes('problem') ||
        combined.includes('issue') ||
        combined.includes('hate that') ||
        combined.includes('wish there') ||
        combined.includes('wish i could') ||
        combined.includes('would be nice') ||
        combined.includes('app for') ||
        combined.includes('tool for') ||
        combined.includes('track') ||
        combined.includes('automate') ||
        combined.includes('manually') ||
        combined.includes('too expensive') ||
        combined.includes('too complex') ||
        combined.includes('overwhelmed') ||
        combined.includes('confus') ||
        combined.includes('how do i') ||
        combined.includes('how do you') ||
        combined.includes('what do you use') ||
        combined.includes('recommend') ||
        combined.includes('best way to')
      );

      // Exclude pure venting/memes/celebrations
      const isExcluded = (
        post.url && !post.is_self && body === '' // link-only post
      );

      if (isPainPoint && !isExcluded && post.score >= 10) {
        painPoints.push({
          post,
          title: title.substring(0, 80),
          description: body.substring(0, 500),
          category,
          subreddit: name,
        });
      }
    }

    console.log(`Found ${painPoints.length} potential pain points in r/${name}`);

    // Submit top pain points (max 5 per subreddit to avoid spam)
    const topPainPoints = painPoints
      .sort((a, b) => b.post.score - a.post.score)
      .slice(0, 5);

    for (const pp of topPainPoints) {
      try {
        // Build a better description
        const descBody = pp.description.replace(/\n+/g, ' ').trim();
        const descShort = descBody.substring(0, 300);
        const fullDesc = descShort 
          ? `${pp.title}. ${descShort}`
          : `Users in r/${pp.subreddit} are experiencing: ${pp.title}`;

        const createResp = await apiPost('/api/pain-points', {
          title: pp.title,
          description: fullDesc.substring(0, 600),
          category: pp.category,
          subreddit: `r/${pp.subreddit}`,
          discoveredBy: AGENT_ID,
        });

        console.log(`Created pain point: ${pp.title} -> id: ${createResp.id || JSON.stringify(createResp)}`);

        if (createResp.id) {
          const postBody = pp.post.selftext || '';
          await apiPost('/api/pain-points/posts', {
            painPointId: createResp.id,
            redditPostId: pp.post.id,
            redditUrl: `https://reddit.com${pp.post.permalink}`,
            postTitle: pp.post.title,
            postBody: postBody.substring(0, 2000),
            upvotes: pp.post.score,
            commentCount: pp.post.num_comments,
            subreddit: `r/${pp.subreddit}`,
            discoveredBy: AGENT_ID,
          });
          console.log(`  Linked source post: ${pp.post.id}`);
        }

        await sleep(500);
      } catch (err) {
        console.error(`Error submitting pain point: ${err.message}`);
      }
    }

    // Log scan results
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${name}`,
      postsScanned: postsScanned,
      painPointsFound: topPainPoints.length,
      status: 'completed',
    });

    return topPainPoints;

  } catch (jsonErr) {
    console.error(`JSON API error for r/${name}: ${jsonErr.message}`);
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${name}`,
      postsScanned: 0,
      painPointsFound: 0,
      status: 'error',
    });
    return [];
  }
}

async function main() {
  console.log('Connecting to AdsPower browser via CDP...');
  
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected!');
  } catch (err) {
    console.error(`Failed to connect to CDP: ${err.message}`);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const pages = context.pages();
  
  // Close extra tabs
  for (let i = 1; i < pages.length; i++) await pages[i].close();
  const page = pages[0] || await context.newPage();

  const allResults = [];
  
  for (const subredditInfo of SUBREDDITS) {
    try {
      const results = await scanSubreddit(page, subredditInfo);
      allResults.push({ subreddit: subredditInfo.name, painPoints: results });
    } catch (err) {
      console.error(`Error scanning r/${subredditInfo.name}: ${err.message}`);
      allResults.push({ subreddit: subredditInfo.name, painPoints: [], error: err.message });
    }
    // Natural pacing between subreddits
    await sleep(2000);
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${allResults.length}`);
  
  const totalPainPoints = allResults.reduce((sum, r) => sum + (r.painPoints ? r.painPoints.length : 0), 0);
  console.log(`Total pain points submitted: ${totalPainPoints}`);
  
  for (const r of allResults) {
    console.log(`  r/${r.subreddit}: ${r.painPoints ? r.painPoints.length : 0} pain points${r.error ? ` (ERROR: ${r.error})` : ''}`);
    if (r.painPoints) {
      for (const pp of r.painPoints) {
        console.log(`    - ${pp.title}`);
      }
    }
  }

  // Don't disconnect — admin agent handles browser lifecycle
  console.log('\nDone. Browser session left open for admin agent.');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
