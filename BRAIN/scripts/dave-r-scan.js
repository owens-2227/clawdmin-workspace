const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:61101/devtools/browser/9789f680-9be6-4b2c-a6d9-8986509db198';
const AGENT_ID = 'dave-r';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const SUBREDDITS = ['HomeImprovement', 'DIY', 'woodworking', 'smoking'];

const CATEGORY_MAP = {
  HomeImprovement: 'Home & DIY',
  DIY: 'Home & DIY',
  woodworking: 'Home & DIY',
  smoking: 'BBQ & Grilling',
};

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function getRedditPostsJSON(sub) {
  const url = `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  const data = await res.json();
  return data?.data?.children?.map(c => c.data) || [];
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  let posts = [];

  // Try browser approach first
  try {
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    // Scroll to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    // Try to extract posts from page
    const pageTitle = await page.title();
    console.log(`Page title: ${pageTitle}`);

    // Check for login wall or CAPTCHA
    const url = page.url();
    if (url.includes('reddit.com/login') || url.includes('reddit.com/register')) {
      console.log('Login wall detected, falling back to JSON API');
      posts = await getRedditPostsJSON(sub);
    } else {
      // Try to extract post data from the page
      posts = await page.evaluate(() => {
        const results = [];
        // Try shreddit-post elements (new Reddit)
        const postEls = document.querySelectorAll('shreddit-post, [data-testid="post-container"], article');
        postEls.forEach(el => {
          const title = el.getAttribute('post-title') || el.querySelector('h1,h2,h3,[slot="title"]')?.textContent?.trim();
          const score = parseInt(el.getAttribute('score') || el.querySelector('[data-click-id="upvote"]')?.textContent || '0');
          const comments = parseInt(el.getAttribute('comment-count') || '0');
          const permalink = el.getAttribute('permalink') || el.querySelector('a[href*="/comments/"]')?.getAttribute('href');
          const postId = el.getAttribute('id') || (permalink ? permalink.split('/comments/')[1]?.split('/')[0] : null);
          if (title && permalink) {
            results.push({ title, score, num_comments: comments, permalink, id: postId });
          }
        });
        return results;
      });

      if (!posts || posts.length < 3) {
        console.log(`Only got ${posts?.length || 0} posts from browser, falling back to JSON API`);
        posts = await getRedditPostsJSON(sub);
      }
    }
  } catch (err) {
    console.log(`Browser approach failed: ${err.message}, using JSON API fallback`);
    posts = await getRedditPostsJSON(sub);
  }

  console.log(`Total posts loaded: ${posts.length}`);

  // Filter out stickied, low-score, and irrelevant posts
  const filtered = posts.filter(p =>
    !p.stickied &&
    (p.score || 0) >= 5 &&
    p.title &&
    !p.is_gallery // skip pure gallery posts with no text
  );

  console.log(`Posts after filtering: ${filtered.length}`);

  // Analyze for pain points
  const painPoints = [];
  const painKeywords = [
    'how do i', 'how to', 'best way to', 'struggling with', 'problem with',
    'issue with', 'help with', 'need help', 'any app', 'any tool', 'any software',
    'is there a', 'looking for', 'recommend', 'frustrated', 'annoying', 'pain',
    'waste', 'expensive', 'complicated', 'hard to', 'difficult', 'can\'t figure',
    'confused', 'advice', 'tips', 'suggestions', 'what\'s the best', 'help me',
    'anyone else', 'fix', 'broken', 'mistake', 'wrong', 'failed', 'keeps',
    'always have to', 'manually', 'track', 'manage', 'organize', 'automate'
  ];

  for (const post of filtered) {
    const titleLower = (post.title || '').toLowerCase();
    const selftext = (post.selftext || '').toLowerCase();
    const combinedText = titleLower + ' ' + selftext;

    const matchCount = painKeywords.filter(kw => combinedText.includes(kw)).length;
    if (matchCount >= 1 && post.num_comments >= 5) {
      // Dig into the post for more context if it has many comments
      let bodyText = post.selftext || '';

      // Try to get post content via JSON if selftext is short but comments are high
      if (post.num_comments >= 10 && bodyText.length < 50) {
        try {
          const postUrl = `https://www.reddit.com/r/${sub}/comments/${post.id}.json?raw_json=1&limit=5`;
          const pRes = await fetch(postUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
          });
          const pData = await pRes.json();
          bodyText = pData?.[0]?.data?.children?.[0]?.data?.selftext || bodyText;
          await sleep(1000);
        } catch (e) {
          // ignore
        }
      }

      painPoints.push({
        title: post.title.substring(0, 80),
        subreddit: sub,
        redditId: post.id,
        url: `https://reddit.com${post.permalink || `/r/${sub}/comments/${post.id}/`}`,
        score: post.score || 0,
        comments: post.num_comments || 0,
        body: bodyText.substring(0, 2000),
        category: CATEGORY_MAP[sub] || 'Home & DIY',
      });
    }
    await sleep(300); // natural pacing
  }

  console.log(`Pain points identified: ${painPoints.length}`);

  // Submit pain points
  let submitted = 0;
  for (const pp of painPoints.slice(0, 10)) { // cap at 10 per subreddit
    // Generate a meaningful description
    const description = pp.body
      ? `Users in r/${sub} report: "${pp.title}". ${pp.body.substring(0, 200).replace(/\n/g, ' ')}...`
      : `Users in r/${sub} are asking/struggling with: "${pp.title}". This post has ${pp.comments} comments and ${pp.score} upvotes suggesting it resonates with the community.`;

    try {
      const createRes = await apiPost('/api/pain-points', {
        title: pp.title,
        description: description.substring(0, 500),
        category: pp.category,
        subreddit: `r/${sub}`,
        discoveredBy: AGENT_ID,
      });

      console.log(`  Created pain point: "${pp.title}" → id: ${createRes.id || createRes._id || JSON.stringify(createRes).substring(0, 60)}`);

      const painPointId = createRes.id || createRes._id;
      if (painPointId) {
        await apiPost('/api/pain-points/posts', {
          painPointId,
          redditPostId: pp.redditId,
          redditUrl: pp.url,
          postTitle: pp.title,
          postBody: pp.body,
          upvotes: pp.score,
          commentCount: pp.comments,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID,
        });
        submitted++;
      }
    } catch (err) {
      console.log(`  Error submitting pain point: ${err.message}`);
    }
    await sleep(500);
  }

  // Log scan results
  try {
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned: filtered.length,
      painPointsFound: submitted,
      status: 'completed',
    });
    console.log(`  Scan log submitted for r/${sub}`);
  } catch (err) {
    console.log(`  Error logging scan: ${err.message}`);
  }

  return { sub, postsScanned: filtered.length, painPointsFound: submitted, painPoints };
}

async function main() {
  console.log('Dave-r scanner starting...');
  console.log(`CDP: ${CDP_URL}`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected to AdsPower browser');
  } catch (err) {
    console.error(`Failed to connect via CDP: ${err.message}`);
    // Fall back to JSON-only scanning without browser
    console.log('Falling back to JSON-only mode...');
    const results = [];
    for (const sub of SUBREDDITS) {
      const posts = await getRedditPostsJSON(sub);
      console.log(`r/${sub}: got ${posts.length} posts via JSON API`);
      // Process same way
      results.push({ sub, postsScanned: posts.length, painPointsFound: 0 });
      await sleep(2000);
    }
    return;
  }

  const context = browser.contexts()[0];
  const pages = context.pages();
  for (let i = 1; i < pages.length; i++) await pages[i].close();
  const page = pages[0] || await context.newPage();

  const summary = [];
  for (const sub of SUBREDDITS) {
    const result = await scanSubreddit(page, sub);
    summary.push(result);
    await sleep(3000); // pause between subreddits
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${summary.length}`);
  let totalPosts = 0, totalPain = 0;
  for (const r of summary) {
    console.log(`  r/${r.sub}: ${r.postsScanned} posts, ${r.painPointsFound} pain points submitted`);
    totalPosts += r.postsScanned;
    totalPain += r.painPointsFound;
    if (r.painPoints) {
      r.painPoints.forEach(pp => console.log(`    - ${pp.title}`));
    }
  }
  console.log(`Total: ${totalPosts} posts scanned, ${totalPain} pain points submitted`);

  // Don't close the browser — admin handles that
  console.log('Done. Browser left open for admin cleanup.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
