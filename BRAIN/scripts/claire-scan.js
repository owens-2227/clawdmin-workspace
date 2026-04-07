/**
 * Claire-T Reddit Scanner
 * Subreddits: insomnia, CBTi, TMJ, yinyoga
 * CDP: ws://127.0.0.1:57765/devtools/browser/552d3cae-4239-4d13-8d05-ed6ec91300a4
 */

const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

const CDP_URL = 'ws://127.0.0.1:57765/devtools/browser/552d3cae-4239-4d13-8d05-ed6ec91300a4';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const AGENT_ID = 'claire-t';

const SUBREDDITS = ['insomnia', 'CBTi', 'TMJ', 'yinyoga'];

const CATEGORY_MAP = {
  insomnia: 'Sleep & Recovery',
  CBTi: 'Sleep & Recovery',
  TMJ: 'TMJ & Chronic Pain',
  yinyoga: 'Yoga',
};

async function apiPost(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const url = new URL(API_BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch { resolve({ raw }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function scrollAndLoad(page) {
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
    await sleep(2000);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(1000);
}

async function fetchSubredditJSON(sub) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.reddit.com',
      path: `/r/${sub}/hot.json?limit=25&raw_json=1`,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  const category = CATEGORY_MAP[sub] || 'General';
  const painPoints = [];
  let postsScanned = 0;
  let posts = [];

  // Try browser approach first
  try {
    const url = `https://www.reddit.com/r/${sub}/hot/`;
    console.log(`Navigating to ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);
    await scrollAndLoad(page);

    // Try to get post titles/links from page
    const pageContent = await page.content();
    const titleMatches = pageContent.match(/data-testid="post-title"[^>]*>([^<]+)</g) || [];
    console.log(`Browser loaded, found ${titleMatches.length} title matches`);
  } catch (err) {
    console.log(`Browser navigation issue: ${err.message}, falling back to JSON API`);
  }

  // Use JSON API for reliable data
  try {
    console.log(`Fetching JSON for r/${sub}...`);
    const json = await fetchSubredditJSON(sub);
    if (json && json.data && json.data.children) {
      posts = json.data.children
        .map((c) => c.data)
        .filter((p) => !p.stickied && p.score >= 5 && (p.selftext || p.title));
      console.log(`Got ${posts.length} posts from JSON API`);
      postsScanned = posts.length;
    }
  } catch (err) {
    console.log(`JSON API error: ${err.message}`);
  }

  // Analyze posts for pain points
  for (const post of posts) {
    const title = post.title || '';
    const body = post.selftext || '';
    const combined = (title + ' ' + body).toLowerCase();
    const upvotes = post.score || 0;
    const commentCount = post.num_comments || 0;
    const postId = post.id;
    const redditUrl = `https://reddit.com${post.permalink}`;

    // Pain point detection heuristics
    const painSignals = [
      /help\b/i, /struggling\b/i, /can'?t\b/i, /unable\b/i, /frustrated\b/i,
      /anyone else\b/i, /is there (an? |a )?(app|tool|way|method)/i,
      /how do (you|i)\b/i, /what (works|do you use|helped)\b/i,
      /nothing (works|helps)\b/i, /tried everything/i, /desperate/i,
      /app for\b/i, /track(ing|er)?\b/i, /manage\b/i, /keep track\b/i,
      /recommend\b/i, /advice\b/i, /tips?\b/i,
      /months?\b.*still\b/i, /years?\b.*still\b/i,
      /flare.?up/i, /chronic\b/i, /worsening\b/i, /relief\b/i,
      /jaw\b/i, /pain\b/i, /sleep\b/i, /insomnia\b/i, /cbti/i,
      /awake\b/i, /wake up\b/i, /can'?t sleep/i,
    ];

    const signalMatches = painSignals.filter((r) => r.test(combined)).length;

    // Exclude non-actionable posts
    const exclude = [
      /meme\b/i, /\bfunny\b/i, /\bjoke\b/i, /\bcelebrat/i,
      /\bthank you\b/i, /\bthanks everyone\b/i,
    ].some((r) => r.test(combined));

    if (exclude || signalMatches < 2) continue;

    // Build a pain point
    let ppTitle = title.slice(0, 80);
    let description = '';

    if (body.length > 10) {
      const sentences = body.split(/[.!?]\s+/).slice(0, 3).join('. ');
      description = sentences.slice(0, 500);
    } else {
      description = `User in r/${sub} reports: "${title.slice(0, 200)}"`;
    }

    // Categorize more precisely
    let specificCategory = category;
    if (/app|tool|track|software|recommend/i.test(combined)) {
      specificCategory = category + ' (Tool Gap)';
    }

    painPoints.push({
      title: ppTitle,
      description: description.trim() || title,
      category: specificCategory,
      subreddit: `r/${sub}`,
      discoveredBy: AGENT_ID,
      redditPostId: postId,
      redditUrl,
      postTitle: title,
      postBody: (post.selftext || '').slice(0, 2000),
      upvotes,
      commentCount,
    });
  }

  console.log(`Found ${painPoints.length} pain points in r/${sub}`);

  // Submit each pain point
  for (const pp of painPoints) {
    try {
      console.log(`  Submitting: "${pp.title}"`);
      const createResp = await apiPost('/api/pain-points', {
        title: pp.title,
        description: pp.description,
        category: pp.category,
        subreddit: pp.subreddit,
        discoveredBy: pp.discoveredBy,
      });
      console.log(`  Created: ${JSON.stringify(createResp).slice(0, 100)}`);

      const painPointId = createResp.id || createResp.painPoint?.id || createResp._id;
      if (painPointId) {
        const linkResp = await apiPost('/api/pain-points/posts', {
          painPointId,
          redditPostId: pp.redditPostId,
          redditUrl: pp.redditUrl,
          postTitle: pp.postTitle,
          postBody: pp.postBody,
          upvotes: pp.upvotes,
          commentCount: pp.commentCount,
          subreddit: pp.subreddit,
          discoveredBy: pp.discoveredBy,
        });
        console.log(`  Linked post: ${JSON.stringify(linkResp).slice(0, 80)}`);
      }
      await sleep(500);
    } catch (err) {
      console.log(`  Error submitting pain point: ${err.message}`);
    }
  }

  // Log scan results
  try {
    const logResp = await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned,
      painPointsFound: painPoints.length,
      status: 'completed',
    });
    console.log(`  Scan log: ${JSON.stringify(logResp).slice(0, 80)}`);
  } catch (err) {
    console.log(`  Scan log error: ${err.message}`);
  }

  return { sub, postsScanned, painPointsFound: painPoints.length, painPoints };
}

async function main() {
  console.log('Claire-T Scanner starting...');
  console.log(`CDP: ${CDP_URL}`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected to AdsPower browser via CDP');
  } catch (err) {
    console.log(`CDP connection error: ${err.message}`);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  if (!context) {
    console.log('No browser context found');
    await browser.close();
    process.exit(1);
  }

  const pages = context.pages();
  for (let i = 1; i < pages.length; i++) {
    try { await pages[i].close(); } catch {}
  }
  const page = pages[0] || (await context.newPage());

  const results = [];
  let totalPosts = 0;
  let totalPainPoints = 0;
  const allPainPointTitles = [];

  for (const sub of SUBREDDITS) {
    try {
      const result = await scanSubreddit(page, sub);
      results.push(result);
      totalPosts += result.postsScanned;
      totalPainPoints += result.painPointsFound;
      allPainPointTitles.push(...result.painPoints.map((p) => p.title));
      await sleep(3000); // pacing between subreddits
    } catch (err) {
      console.log(`Error scanning r/${sub}: ${err.message}`);
      results.push({ sub, postsScanned: 0, painPointsFound: 0, error: err.message });
      try {
        await apiPost('/api/pain-points/scan-logs', {
          agentId: AGENT_ID,
          subreddit: `r/${sub}`,
          postsScanned: 0,
          painPointsFound: 0,
          status: 'error',
        });
      } catch {}
    }
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${results.length}`);
  console.log(`Total posts analyzed: ${totalPosts}`);
  console.log(`Pain points found: ${totalPainPoints}`);
  console.log('Pain point titles:');
  allPainPointTitles.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));

  // Write summary JSON for parent agent
  const summaryPath = `/Users/owen/.openclaw/workspace/BRAIN/summaries/claire-scan-${Date.now()}.json`;
  const fs = require('fs');
  fs.writeFileSync(summaryPath, JSON.stringify({
    agentId: AGENT_ID,
    timestamp: new Date().toISOString(),
    subredditsScanned: results.length,
    totalPostsAnalyzed: totalPosts,
    painPointsFound: totalPainPoints,
    results,
    painPointTitles: allPainPointTitles,
  }, null, 2));
  console.log(`Summary written to ${summaryPath}`);

  // Don't close the browser — admin handles that
  await browser.close(); // Just disconnect, not destroy
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
