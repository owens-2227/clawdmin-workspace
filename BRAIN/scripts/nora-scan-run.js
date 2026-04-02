const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

const CDP_URL = 'ws://127.0.0.1:54216/devtools/browser/76f0645d-5f1b-4acf-8036-20029f3562a6';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const AGENT_ID = 'nora-p';
const SUBREDDITS = ['houseplants', 'proplifting', 'plantclinic', 'IndoorGarden'];
const CATEGORY = 'Plant Parents';

function apiPost(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const url = new URL(API_BASE + path);
    const opts = {
      hostname: url.hostname,
      port: url.port || 3000,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = http.request(opts, (res) => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch(e) { resolve({ raw: d }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function fetchRedditJson(sub) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'www.reddit.com',
      path: `/r/${sub}/hot.json?limit=25&raw_json=1`,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
    };
    const req = https.request(opts, (res) => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  let posts = [];

  // Try browser approach first
  try {
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Scroll to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await page.waitForTimeout(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1000);

    // Try to extract posts from the page
    const snapshot = await page.content();
    console.log(`Page loaded, content length: ${snapshot.length}`);

    // Check for login wall or captcha
    if (snapshot.includes('Log in to Reddit') && snapshot.length < 20000) {
      console.log('Hit login wall, falling back to JSON API');
      throw new Error('login wall');
    }
  } catch (e) {
    console.log(`Browser error: ${e.message}, trying JSON API fallback`);
  }

  // Use JSON API as reliable fallback
  try {
    console.log(`Fetching r/${sub} via JSON API...`);
    const data = await fetchRedditJson(sub);
    if (data && data.data && data.data.children) {
      posts = data.data.children
        .map(c => c.data)
        .filter(p => !p.stickied && p.score >= 5);
      console.log(`Got ${posts.length} posts from JSON API`);
    }
  } catch (e) {
    console.log(`JSON API also failed: ${e.message}`);
    return { postsScanned: 0, painPoints: [] };
  }

  // Analyze posts for pain points
  const painPoints = [];

  for (const post of posts) {
    const title = post.title || '';
    const body = post.selftext || '';
    const combined = (title + ' ' + body).toLowerCase();
    const score = post.score || 0;
    const comments = post.num_comments || 0;

    // Skip pure memes, celebrations
    if (post.is_video || (post.post_hint === 'image' && !body)) continue;

    // Look for pain point signals
    const painSignals = [
      /\b(help|struggling|problem|issue|trouble|can't|cannot|won't|failed|dying|dead|yellowing|drooping|wilting|overwater|underwater)\b/,
      /\b(app|tool|tracker|organizer|reminder|schedule|calendar|spreadsheet|track|log)\b/,
      /\b(how do i|how to|advice|recommend|suggestion|need help|confused|frustrated)\b/,
      /\b(too expensive|can't afford|looking for|alternative|replace|substitute)\b/,
      /\b(lost|killed|saved|rescue|revive|diagnose|identify|pest|disease|mold|fungus)\b/,
      /\b(automat|remind|forget|remember|consistent|routine|system|organize)\b/
    ];

    const hasPainSignal = painSignals.some(r => r.test(combined));
    if (!hasPainSignal) continue;

    // Categorize the pain point
    let painTitle = '';
    let painDesc = '';

    if (/track|log|reminder|forget|remember|calendar|schedule|organiz|app|tool|spreadsheet/.test(combined)) {
      painTitle = `Plant care tracking/reminder system needed`;
      painDesc = `Plant parents struggle to track watering schedules, fertilizing routines, and care history across multiple plants. They resort to spreadsheets, paper notes, or just forgetting — leading to plant loss. Post: "${title.substring(0, 100)}"`;
    } else if (/identify|diagnose|pest|disease|mold|fungus|bug|spider mite|gnat|scale/.test(combined)) {
      painTitle = `Plant pest/disease identification difficulty`;
      painDesc = `Plant owners have difficulty identifying pests, diseases, and deficiencies from visual symptoms alone. They post photos to Reddit hoping for crowd-diagnosis. Post: "${title.substring(0, 100)}"`;
    } else if (/yellowing|drooping|wilting|dying|dead|overwater|underwater|root rot/.test(combined)) {
      painTitle = `Overwatering/underwatering diagnosis confusion`;
      painDesc = `Plant parents frequently misdiagnose watering issues — symptoms of overwatering and underwatering can look similar, leading to wrong treatment. Post: "${title.substring(0, 100)}"`;
    } else if (/propagat|prop|cutting|root|water prop|soil prop/.test(combined)) {
      painTitle = `Propagation tracking and success rate monitoring`;
      painDesc = `Plant propagators struggle to track which cuttings are rooting, when to check them, and what methods work best for different species. Post: "${title.substring(0, 100)}"`;
    } else if (/light|window|direction|lux|grow light|artificial/.test(combined)) {
      painTitle = `Plant light requirement matching and placement advice`;
      painDesc = `Plant owners are unsure which plants work for their specific light conditions (window direction, lux levels) and need help matching plants to available light. Post: "${title.substring(0, 100)}"`;
    } else {
      // Generic plant care pain point
      painTitle = `Plant care knowledge gap: ${title.substring(0, 50)}`;
      painDesc = `Plant owner seeking help with a care issue that suggests need for better guidance tools or resources. Post: "${title.substring(0, 120)}"`;
    }

    // Only add if we have enough engagement to validate
    if (score >= 10 || comments >= 5) {
      painPoints.push({
        title: painTitle,
        description: painDesc,
        post: {
          id: post.id,
          title: post.title,
          body: (post.selftext || '').substring(0, 2000),
          url: `https://reddit.com${post.permalink}`,
          upvotes: post.score,
          commentCount: post.num_comments,
          subreddit: `r/${sub}`
        }
      });
    }
  }

  // Deduplicate by title
  const seen = new Set();
  const unique = painPoints.filter(p => {
    if (seen.has(p.title)) return false;
    seen.add(p.title);
    return true;
  });

  console.log(`Found ${unique.length} pain points in r/${sub}`);
  return { postsScanned: posts.length, painPoints: unique };
}

async function main() {
  let browser;
  const results = [];

  try {
    console.log('Connecting to AdsPower browser via CDP...');
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected!');

    const context = browser.contexts()[0];
    const pages = context.pages();
    for (let i = 1; i < pages.length; i++) await pages[i].close();
    const page = pages[0] || await context.newPage();

    for (const sub of SUBREDDITS) {
      const { postsScanned, painPoints } = await scanSubreddit(page, sub);

      // Submit each pain point
      let submitted = 0;
      for (const pp of painPoints) {
        try {
          console.log(`  Submitting: ${pp.title}`);
          const created = await apiPost('/api/pain-points', {
            title: pp.title.substring(0, 80),
            description: pp.description,
            category: CATEGORY,
            subreddit: `r/${sub}`,
            discoveredBy: AGENT_ID
          });

          console.log(`  Created pain point:`, JSON.stringify(created).substring(0, 200));

          const ppId = created.id || (created.data && created.data.id);
          if (ppId && pp.post) {
            await apiPost('/api/pain-points/posts', {
              painPointId: ppId,
              redditPostId: pp.post.id,
              redditUrl: pp.post.url,
              postTitle: pp.post.title,
              postBody: pp.post.body,
              upvotes: pp.post.upvotes,
              commentCount: pp.post.commentCount,
              subreddit: `r/${sub}`,
              discoveredBy: AGENT_ID
            });
            console.log(`  Linked source post`);
          }
          submitted++;
          await new Promise(r => setTimeout(r, 1000));
        } catch (e) {
          console.log(`  Error submitting pain point: ${e.message}`);
        }
      }

      // Log scan result
      try {
        await apiPost('/api/pain-points/scan-logs', {
          agentId: AGENT_ID,
          subreddit: `r/${sub}`,
          postsScanned,
          painPointsFound: submitted,
          status: 'completed'
        });
        console.log(`  Logged scan for r/${sub}`);
      } catch (e) {
        console.log(`  Error logging scan: ${e.message}`);
      }

      results.push({ sub, postsScanned, painPointsFound: submitted });
      await new Promise(r => setTimeout(r, 3000));
    }

  } catch (e) {
    console.error('Fatal error:', e.message);
    console.error(e.stack);
  }

  // Summary
  console.log('\n=== SCAN COMPLETE ===');
  let totalPosts = 0, totalPP = 0;
  for (const r of results) {
    console.log(`r/${r.sub}: ${r.postsScanned} posts scanned, ${r.painPointsFound} pain points found`);
    totalPosts += r.postsScanned;
    totalPP += r.painPointsFound;
  }
  console.log(`TOTAL: ${SUBREDDITS.length} subreddits, ${totalPosts} posts, ${totalPP} pain points`);
  return results;
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
