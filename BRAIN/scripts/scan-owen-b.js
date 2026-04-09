const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

const CDP_URL = 'ws://127.0.0.1:50047/devtools/browser/3717d3d7-318e-4ba0-92aa-bb35cc99d772';
const AGENT_ID = 'owen-b';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const SUBREDDITS = ['ADHD', 'languagelearning', 'remotework', 'productivity'];

const CATEGORY_MAP = {
  'ADHD': 'ADHD & Neurodivergent',
  'languagelearning': 'Language Learning',
  'remotework': 'Remote Work',
  'productivity': 'Productivity',
};

async function apiPost(path, data) {
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
        'Content-Length': Buffer.byteLength(body),
        'x-api-key': API_KEY,
      },
    };
    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
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

async function fetchRedditJson(subreddit) {
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
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchPostDetails(subreddit, postId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.reddit.com',
      path: `/r/${subreddit}/comments/${postId}.json?limit=10&raw_json=1`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isPainPoint(post) {
  const title = (post.title || '').toLowerCase();
  const body = (post.selftext || '').toLowerCase();
  const combined = title + ' ' + body;

  // Skip low-engagement or non-text posts
  if (post.score < 5) return false;
  if (post.stickied) return false;
  if (post.is_video) return false;

  // Skip clearly off-topic
  const skipPatterns = [
    /meme/i, /\bfunny\b/i, /\bjoke\b/i, /rant$/i, /\bcelebrat/i,
    /\bthank you\b/i, /\bthankful\b/i, /\bwin\b/i, /\bsuccess stor/i,
  ];
  for (const p of skipPatterns) {
    if (p.test(title)) return false;
  }

  // Strong pain point signals
  const painPatterns = [
    /is there an? (app|tool|way|method|plugin|extension|software)/i,
    /looking for (an?|a) (app|tool|software|solution|way)/i,
    /how do (you|I|people) (manage|track|deal|handle|organize|stay)/i,
    /anyone else (struggle|find it hard|have trouble|can't|cant)/i,
    /can't (seem to|figure out|find|stop|keep|stay)/i,
    /wish there (was|were|is)/i,
    /frustrat/i,
    /overwhelm/i,
    /struggle with/i,
    /hard to (keep|stay|track|manage|focus|remember)/i,
    /what do you use (for|to)/i,
    /recommend(ation)?s? (for|on)/i,
    /best (app|tool|method|way|system) (for|to)/i,
    /hate (that|how|when)/i,
    /annoying/i,
    /problem with/i,
    /issue with/i,
    /manual(ly)?/i,
    /automat/i,
    /too (expensive|complicated|complex|hard)/i,
    /doesn'?t work/i,
    /not working/i,
  ];

  return painPatterns.some(p => p.test(combined));
}

function extractPainPointTitle(post) {
  let title = post.title.trim();
  if (title.length > 80) title = title.substring(0, 77) + '...';
  return title;
}

function extractDescription(post, comments) {
  let desc = '';
  const body = (post.selftext || '').trim();
  if (body && body !== '[deleted]' && body !== '[removed]') {
    desc = body.substring(0, 300);
  } else {
    desc = post.title;
  }

  // Add context from top comment if available
  if (comments && comments.length > 0) {
    const topComment = comments[0];
    if (topComment && topComment.body && topComment.body !== '[deleted]') {
      desc += ` Top response: "${topComment.body.substring(0, 150)}"`;
    }
  }

  if (desc.length > 500) desc = desc.substring(0, 497) + '...';
  return desc;
}

async function scanSubreddit(page, subreddit) {
  console.log(`\n=== Scanning r/${subreddit} ===`);
  const category = CATEGORY_MAP[subreddit] || 'General';
  const painPoints = [];
  let postsScanned = 0;

  let posts = [];

  // Try browser first
  try {
    console.log(`Navigating to r/${subreddit}...`);
    await page.goto(`https://www.reddit.com/r/${subreddit}/hot/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await sleep(3000);

    // Scroll to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    const pageContent = await page.content();
    if (pageContent.includes('reddit.com') && pageContent.length > 5000) {
      console.log('Browser navigation succeeded, using JSON API for structured data...');
    }
  } catch (e) {
    console.log(`Browser navigation issue: ${e.message}, falling back to JSON API`);
  }

  // Use JSON API for reliable structured data
  console.log(`Fetching r/${subreddit} via JSON API...`);
  await sleep(2000);

  try {
    const data = await fetchRedditJson(subreddit);
    if (data && data.data && data.data.children) {
      posts = data.data.children.map(c => c.data).filter(p => !p.stickied);
      postsScanned = posts.length;
      console.log(`Got ${postsScanned} posts`);
    }
  } catch (e) {
    console.log(`JSON API error: ${e.message}`);
    await logScan(subreddit, 0, 0, 'error');
    return { painPoints: [], postsScanned: 0 };
  }

  // Analyze posts for pain points
  const candidatePosts = posts.filter(isPainPoint);
  console.log(`Found ${candidatePosts.length} candidate pain points from ${postsScanned} posts`);

  for (const post of candidatePosts.slice(0, 8)) {
    console.log(`\nAnalyzing: "${post.title.substring(0, 60)}..."`);
    console.log(`  Score: ${post.score}, Comments: ${post.num_comments}`);

    let comments = [];
    if (post.num_comments >= 10) {
      await sleep(2000);
      try {
        const details = await fetchPostDetails(subreddit, post.id);
        if (details && details[1] && details[1].data && details[1].data.children) {
          comments = details[1].data.children
            .map(c => c.data)
            .filter(c => c.body && c.body !== '[deleted]' && c.body !== '[removed]')
            .slice(0, 5);
        }
      } catch (e) {
        console.log(`  Could not fetch comments: ${e.message}`);
      }
    }

    const title = extractPainPointTitle(post);
    const description = extractDescription(post, comments);

    try {
      // Create pain point
      const ppResult = await apiPost('/api/pain-points', {
        title,
        description,
        category,
        subreddit: `r/${subreddit}`,
        discoveredBy: AGENT_ID,
      });

      console.log(`  Created pain point: ${ppResult.id || JSON.stringify(ppResult).substring(0, 100)}`);

      const painPointId = ppResult.id || ppResult.painPoint?.id;
      if (painPointId) {
        // Link source post
        const postBody = (post.selftext || '').substring(0, 2000);
        const linkResult = await apiPost('/api/pain-points/posts', {
          painPointId,
          redditPostId: post.id,
          redditUrl: `https://reddit.com${post.permalink}`,
          postTitle: post.title,
          postBody,
          upvotes: post.score,
          commentCount: post.num_comments,
          subreddit: `r/${subreddit}`,
          discoveredBy: AGENT_ID,
        });
        console.log(`  Linked post: ${JSON.stringify(linkResult).substring(0, 80)}`);
      }

      painPoints.push({ title, postId: post.id });
    } catch (e) {
      console.log(`  Error submitting pain point: ${e.message}`);
    }

    await sleep(1500);
  }

  // Log scan results
  await logScan(subreddit, postsScanned, painPoints.length, 'completed');

  return { painPoints, postsScanned };
}

async function logScan(subreddit, postsScanned, painPointsFound, status) {
  try {
    const result = await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${subreddit}`,
      postsScanned,
      painPointsFound,
      status,
    });
    console.log(`Logged scan for r/${subreddit}: ${JSON.stringify(result).substring(0, 100)}`);
  } catch (e) {
    console.log(`Error logging scan: ${e.message}`);
  }
}

async function main() {
  console.log('Connecting to AdsPower browser via CDP...');
  let browser;
  let page;

  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected!');
    const context = browser.contexts()[0];
    const pages = context.pages();
    for (let i = 1; i < pages.length; i++) await pages[i].close();
    page = pages[0] || await context.newPage();
    console.log('Browser page ready');
  } catch (e) {
    console.log(`CDP connection error: ${e.message}`);
    console.log('Proceeding with JSON API only...');
    page = null;
  }

  const results = {
    totalSubreddits: 0,
    totalPosts: 0,
    totalPainPoints: 0,
    painPoints: [],
    errors: [],
  };

  // Create a minimal page mock if browser failed
  if (!page) {
    page = {
      goto: async () => {},
      waitForTimeout: async () => {},
      evaluate: async () => {},
      content: async () => '<html></html>',
    };
  }

  for (const subreddit of SUBREDDITS) {
    try {
      const { painPoints, postsScanned } = await scanSubreddit(page, subreddit);
      results.totalSubreddits++;
      results.totalPosts += postsScanned;
      results.totalPainPoints += painPoints.length;
      results.painPoints.push(...painPoints.map(p => ({ ...p, subreddit })));
    } catch (e) {
      console.log(`Error scanning r/${subreddit}: ${e.message}`);
      results.errors.push(`r/${subreddit}: ${e.message}`);
      await logScan(subreddit, 0, 0, 'error');
    }

    // Pacing between subreddits
    if (SUBREDDITS.indexOf(subreddit) < SUBREDDITS.length - 1) {
      console.log('\nWaiting 3s before next subreddit...');
      await sleep(3000);
    }
  }

  // Final report
  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${results.totalSubreddits}`);
  console.log(`Total posts analyzed: ${results.totalPosts}`);
  console.log(`Pain points discovered: ${results.totalPainPoints}`);
  console.log('\nPain points:');
  results.painPoints.forEach(p => {
    console.log(`  [r/${p.subreddit}] ${p.title}`);
  });
  if (results.errors.length > 0) {
    console.log('\nErrors:');
    results.errors.forEach(e => console.log(`  ${e}`));
  }

  // Don't close browser — admin agent handles that
  if (browser && browser.isConnected && browser.isConnected()) {
    await browser.close().catch(() => {});
  }

  return results;
}

main().then(results => {
  process.exit(0);
}).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
