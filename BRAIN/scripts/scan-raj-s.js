const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

const CDP_URL = 'ws://127.0.0.1:57688/devtools/browser/359ed189-da8f-4330-aed9-4ac2a4f86e3b';
const AGENT_ID = 'raj-s';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const SUBREDDITS = ['AnalogCommunity', 'streetphotography', 'MechanicalKeyboards', 'photocritique'];

const CATEGORY_MAP = {
  AnalogCommunity: 'Photography',
  streetphotography: 'Photography',
  photocritique: 'Photography',
  MechanicalKeyboards: 'Mechanical Keyboards',
};

function apiPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(API_BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'Content-Length': Buffer.byteLength(data),
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
    req.write(data);
    req.end();
  });
}

async function fetchRedditJSON(subreddit) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.reddit.com',
      path: `/r/${subreddit}/hot.json?limit=25&raw_json=1`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
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
    req.end();
  });
}

async function fetchPostComments(subreddit, postId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.reddit.com',
      path: `/r/${subreddit}/comments/${postId}.json?limit=10&raw_json=1`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
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
    req.end();
  });
}

function isPainPoint(post) {
  const title = (post.title || '').toLowerCase();
  const body = (post.selftext || '').toLowerCase();
  const combined = title + ' ' + body;

  // Signals of pain points
  const painSignals = [
    'is there an app', 'is there a tool', 'is there a way', 'any app for',
    'any tool for', 'any software for', 'any website for',
    'frustrat', 'annoying', 'hate when', 'wish there was', 'struggling with',
    'hard to', 'difficult to', 'pain point', 'anyone else have trouble',
    'how do you manage', 'how do you keep track', 'how do you organize',
    'how do people', 'what do you use for', 'looking for a better way',
    'is there a better', 'does anyone know how', 'need help with',
    'problem with', 'issue with', 'automat', 'manually', 'workflow',
    'track', 'organize', 'catalog', 'database', 'spreadsheet',
    'too expensive', 'too complicated', 'overwhelming', 'overwhelmed',
    'can\'t figure out', 'not sure how', 'advice on', 'tips for',
    'best way to', 'recommendation for', 'recommend', 'looking for',
    'need a', 'need help', 'beginner', 'newbie', 'just starting',
  ];

  const excludeSignals = [
    'rant', 'vent', 'relationship', 'breakup', 'divorce', '[oc]', 'meme',
    'humor', 'joke', 'funny', 'lol', 'appreciation post', 'show off',
  ];

  // Must have meaningful engagement
  if (post.score < 5) return false;
  if (post.is_self === false && !post.selftext) {
    // Link post without text — only include if title is very strong
  }

  for (const exc of excludeSignals) {
    if (combined.includes(exc)) return false;
  }

  for (const sig of painSignals) {
    if (combined.includes(sig)) return true;
  }

  // Also include posts with many comments that might be discussions of problems
  if (post.num_comments >= 20 && post.score >= 20) {
    return true;
  }

  return false;
}

function extractPainPointTitle(post) {
  // Clean up the title to be concise
  let title = post.title;
  if (title.length > 80) {
    title = title.substring(0, 77) + '...';
  }
  return title;
}

function extractDescription(post, comments) {
  const body = post.selftext ? post.selftext.substring(0, 500) : '';
  const topComments = comments ? comments
    .filter(c => c.body && c.body !== '[deleted]' && c.body !== '[removed]')
    .slice(0, 3)
    .map(c => c.body.substring(0, 200))
    .join(' | ') : '';

  let desc = '';
  if (body) {
    desc = `Post: ${body.substring(0, 300)}`;
  } else {
    desc = `Discussion about: ${post.title}`;
  }
  if (topComments) {
    desc += ` Top comments: ${topComments.substring(0, 300)}`;
  }
  return desc.substring(0, 600);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function scanSubreddit(page, subreddit) {
  console.log(`\n=== Scanning r/${subreddit} ===`);
  const painPoints = [];
  let postsScanned = 0;
  let usedFallback = false;

  try {
    // Try browser-based approach first
    console.log(`Navigating to r/${subreddit}...`);
    await page.goto(`https://www.reddit.com/r/${subreddit}/hot/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await sleep(3000);

    // Check for CAPTCHA or login wall
    const pageContent = await page.content();
    if (pageContent.includes('captcha') || pageContent.includes('CAPTCHA')) {
      console.log(`CAPTCHA detected on r/${subreddit}, using JSON fallback`);
      usedFallback = true;
    } else {
      // Scroll to load more posts
      console.log('Scrolling to load posts...');
      for (let i = 0; i < 6; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
        await sleep(2000);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(1000);

      // Try to get posts from the page
      const posts = await page.evaluate(() => {
        const results = [];
        // Try shreddit-post elements
        const postEls = document.querySelectorAll('shreddit-post, [data-testid="post-container"], article');
        postEls.forEach(el => {
          const titleEl = el.querySelector('h1, h2, h3, [slot="title"], a[data-click-id="title"]');
          const title = titleEl ? titleEl.textContent.trim() : '';
          const linkEl = el.querySelector('a[href*="/comments/"]');
          const url = linkEl ? linkEl.href : '';
          if (title && url) {
            results.push({ title, url });
          }
        });
        return results;
      });

      console.log(`Found ${posts.length} posts via browser`);
      if (posts.length < 3) {
        console.log('Too few posts from browser, using JSON fallback');
        usedFallback = true;
      }
    }
  } catch (err) {
    console.log(`Browser error: ${err.message}, using JSON fallback`);
    usedFallback = true;
  }

  // JSON API approach (either as fallback or primary)
  console.log(`Using Reddit JSON API for r/${subreddit}...`);
  await sleep(2000);

  let jsonData;
  try {
    jsonData = await fetchRedditJSON(subreddit);
  } catch (err) {
    console.log(`JSON API error: ${err.message}`);
  }

  if (!jsonData || !jsonData.data || !jsonData.data.children) {
    console.log(`Could not fetch data for r/${subreddit}`);
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${subreddit}`,
      postsScanned: 0,
      painPointsFound: 0,
      status: 'error',
    });
    return { painPoints: [], postsScanned: 0 };
  }

  const posts = jsonData.data.children.map(c => c.data).filter(p => !p.stickied && p.score >= 5);
  postsScanned = posts.length;
  console.log(`Got ${postsScanned} posts from JSON API`);

  // Analyze each post
  for (const post of posts) {
    if (!isPainPoint(post)) continue;

    console.log(`  Pain point candidate: ${post.title.substring(0, 60)}`);

    // Fetch comments for context
    let topComments = [];
    try {
      await sleep(1500);
      const commentData = await fetchPostComments(subreddit, post.id);
      if (commentData && commentData[1] && commentData[1].data && commentData[1].data.children) {
        topComments = commentData[1].data.children
          .map(c => c.data)
          .filter(c => c.body && c.body !== '[deleted]' && c.body !== '[removed]' && c.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);
      }
    } catch (err) {
      console.log(`  Could not fetch comments: ${err.message}`);
    }

    const description = extractDescription(post, topComments);
    const category = CATEGORY_MAP[subreddit] || 'Photography';

    // Submit pain point
    try {
      const ppResponse = await apiPost('/api/pain-points', {
        title: extractPainPointTitle(post),
        description: description,
        category: category,
        subreddit: `r/${subreddit}`,
        discoveredBy: AGENT_ID,
      });

      console.log(`  Submitted pain point, response: ${JSON.stringify(ppResponse).substring(0, 100)}`);

      const ppId = ppResponse.id || ppResponse.data?.id;
      if (ppId) {
        // Link source post
        await apiPost('/api/pain-points/posts', {
          painPointId: ppId,
          redditPostId: post.id,
          redditUrl: `https://reddit.com/r/${subreddit}/comments/${post.id}/`,
          postTitle: post.title,
          postBody: (post.selftext || '').substring(0, 2000),
          upvotes: post.score,
          commentCount: post.num_comments,
          subreddit: `r/${subreddit}`,
          discoveredBy: AGENT_ID,
        });
        console.log(`  Linked source post ${post.id}`);
      }

      painPoints.push({
        title: extractPainPointTitle(post),
        postId: post.id,
        score: post.score,
        comments: post.num_comments,
      });
    } catch (err) {
      console.log(`  Error submitting: ${err.message}`);
    }

    await sleep(1000);
  }

  // Log scan results
  await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned: postsScanned,
    painPointsFound: painPoints.length,
    status: 'completed',
  });

  console.log(`  Done: ${postsScanned} posts scanned, ${painPoints.length} pain points found`);
  return { painPoints, postsScanned };
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
  if (!context) {
    console.error('No browser context found');
    process.exit(1);
  }

  // Close extra tabs
  const pages = context.pages();
  for (let i = 1; i < pages.length; i++) {
    await pages[i].close();
  }
  const page = pages[0] || await context.newPage();

  const results = {
    subredditsScanned: 0,
    totalPostsAnalyzed: 0,
    allPainPoints: [],
    errors: [],
  };

  for (const subreddit of SUBREDDITS) {
    try {
      const { painPoints, postsScanned } = await scanSubreddit(page, subreddit);
      results.subredditsScanned++;
      results.totalPostsAnalyzed += postsScanned;
      results.allPainPoints.push(...painPoints.map(pp => ({ ...pp, subreddit })));
    } catch (err) {
      console.error(`Error scanning r/${subreddit}: ${err.message}`);
      results.errors.push(`r/${subreddit}: ${err.message}`);
    }

    // Pace between subreddits
    if (SUBREDDITS.indexOf(subreddit) < SUBREDDITS.length - 1) {
      console.log('Waiting before next subreddit...');
      await sleep(5000);
    }
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${results.subredditsScanned}`);
  console.log(`Total posts analyzed: ${results.totalPostsAnalyzed}`);
  console.log(`Pain points discovered: ${results.allPainPoints.length}`);
  if (results.allPainPoints.length > 0) {
    console.log('Pain points:');
    results.allPainPoints.forEach(pp => {
      console.log(`  [r/${pp.subreddit}] ${pp.title} (score: ${pp.score}, comments: ${pp.comments})`);
    });
  }
  if (results.errors.length > 0) {
    console.log('Errors:', results.errors);
  }

  // Don't close the browser — admin handles that
  console.log('Disconnecting from browser (not closing)...');
  await browser.close(); // disconnect only, profile stays open
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
