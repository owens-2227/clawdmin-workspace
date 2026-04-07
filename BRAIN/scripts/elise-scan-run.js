const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:58160/devtools/browser/b9c2632c-08a8-4750-a9d5-ebe2aca704e4';
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
];

async function apiPost(path, data) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify(data),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function getPostsViaJson(subreddit) {
  console.log(`  Fetching via JSON API: r/${subreddit}`);
  const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=25&raw_json=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
  });
  const data = await res.json();
  if (!data.data || !data.data.children) return [];
  return data.data.children.map(c => c.data).filter(p => !p.stickied && p.score >= 5);
}

function isPainPoint(post) {
  const text = (post.title + ' ' + (post.selftext || '')).toLowerCase();
  const painIndicators = [
    'how do i', 'how to', 'is there an app', 'is there a tool', 'struggling',
    'frustrated', 'annoying', 'hate', 'wish there was', 'looking for',
    'anyone else', 'help', 'advice', 'recommend', 'problem', 'issue',
    'difficult', 'hard time', 'can\'t figure', 'confused', 'overwhelmed',
    'manually', 'tedious', 'time consuming', 'expensive', 'too complex',
    'complicated', 'nightmare', 'ugh', 'pain', 'struggle'
  ];
  return painIndicators.some(ind => text.includes(ind));
}

function extractPainPointTitle(post) {
  let title = post.title;
  if (title.length > 80) title = title.substring(0, 77) + '...';
  return title;
}

function extractPainPointDescription(post) {
  const body = post.selftext ? post.selftext.substring(0, 300) : '';
  if (body) {
    return `Community members in r/${post.subreddit} are experiencing: "${post.title}". ${body.substring(0, 200)}`;
  }
  return `Community members in r/${post.subreddit} are expressing: "${post.title}" with ${post.num_comments} comments and ${post.score} upvotes.`;
}

async function scanSubreddit(page, sub, category) {
  console.log(`\n=== Scanning r/${sub} ===`);
  let posts = [];
  let usedFallback = false;

  try {
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    // Check for login wall or error
    const pageContent = await page.content();
    if (pageContent.includes('Log In') && pageContent.includes('Sign Up') && !pageContent.includes('shreddit-post')) {
      console.log(`  Login wall detected, using JSON fallback`);
      posts = await getPostsViaJson(sub);
      usedFallback = true;
    } else {
      // Scroll to load more posts
      for (let i = 0; i < 6; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
        await sleep(2000);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(1000);

      // Try to extract posts from page
      const snapshot = await page.evaluate(() => {
        const posts = [];
        // Try shreddit-post elements
        const postEls = document.querySelectorAll('shreddit-post');
        postEls.forEach(el => {
          const title = el.getAttribute('post-title') || el.querySelector('[slot="title"]')?.textContent?.trim() || '';
          const score = parseInt(el.getAttribute('score') || '0');
          const commentCount = parseInt(el.getAttribute('comment-count') || '0');
          const permalink = el.getAttribute('permalink') || '';
          const postId = el.getAttribute('id') || permalink.split('/')[4] || '';
          if (title && score >= 5) {
            posts.push({ title, score, comment_count: commentCount, permalink, id: postId });
          }
        });
        
        // Fallback: try article elements
        if (posts.length === 0) {
          document.querySelectorAll('article').forEach(el => {
            const titleEl = el.querySelector('h3, h2, [data-click-id="body"] h3');
            const title = titleEl?.textContent?.trim() || '';
            if (title) posts.push({ title, score: 10, comment_count: 0, permalink: '', id: '' });
          });
        }
        
        return posts;
      });

      if (snapshot.length < 3) {
        console.log(`  Page returned ${snapshot.length} posts, using JSON fallback`);
        posts = await getPostsViaJson(sub);
        usedFallback = true;
      } else {
        posts = snapshot.map(p => ({
          ...p,
          title: p.title,
          score: p.score,
          num_comments: p.comment_count,
          selftext: '',
          subreddit: sub,
          url: `https://reddit.com${p.permalink}`,
          id: p.id || p.permalink?.split('/')[4] || Math.random().toString(36).substr(2, 9),
        }));
      }
    }
  } catch (err) {
    console.log(`  Browser error: ${err.message}, using JSON fallback`);
    posts = await getPostsViaJson(sub);
    usedFallback = true;
  }

  console.log(`  Found ${posts.length} posts (fallback: ${usedFallback})`);

  // Analyze for pain points
  const painPoints = posts.filter(isPainPoint);
  console.log(`  Pain points identified: ${painPoints.length}`);

  // Submit pain points
  let submitted = 0;
  for (const post of painPoints.slice(0, 8)) {
    try {
      const title = extractPainPointTitle(post);
      const description = extractPainPointDescription(post);
      
      const ppRes = await apiPost('/api/pain-points', {
        title,
        description,
        category,
        subreddit: `r/${sub}`,
        discoveredBy: AGENT_ID,
      });

      console.log(`  Submitted: "${title}" → id: ${ppRes.id || ppRes.raw}`);

      if (ppRes.id) {
        const postUrl = post.url || `https://reddit.com/r/${sub}/comments/${post.id}/`;
        await apiPost('/api/pain-points/posts', {
          painPointId: ppRes.id,
          redditPostId: post.id || post.name || '',
          redditUrl: postUrl,
          postTitle: post.title,
          postBody: (post.selftext || '').substring(0, 2000),
          upvotes: post.score || 0,
          commentCount: post.num_comments || 0,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID,
        });
      }
      submitted++;
      await sleep(500);
    } catch (err) {
      console.log(`  Error submitting pain point: ${err.message}`);
    }
  }

  // Log scan result
  try {
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned: posts.length,
      painPointsFound: submitted,
      status: 'completed',
    });
    console.log(`  Scan log submitted for r/${sub}`);
  } catch (err) {
    console.log(`  Error logging scan: ${err.message}`);
  }

  return { sub, postsScanned: posts.length, painPointsFound: submitted };
}

async function main() {
  console.log('Starting elise-c scanner...');
  console.log(`CDP URL: ${CDP_URL}`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected to AdsPower browser via CDP');
  } catch (err) {
    console.error('Failed to connect to CDP:', err.message);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const pages = context.pages();
  
  // Close extra tabs
  for (let i = 1; i < pages.length; i++) {
    await pages[i].close().catch(() => {});
  }
  const page = pages[0] || await context.newPage();

  const results = [];
  for (const { name, category } of SUBREDDITS) {
    try {
      const result = await scanSubreddit(page, name, category);
      results.push(result);
      await sleep(3000); // Pace between subreddits
    } catch (err) {
      console.log(`Error scanning r/${name}: ${err.message}`);
      results.push({ sub: name, postsScanned: 0, painPointsFound: 0, error: err.message });
    }
  }

  // Summary
  console.log('\n=== SCAN COMPLETE ===');
  let totalPosts = 0, totalPainPoints = 0;
  for (const r of results) {
    console.log(`r/${r.sub}: ${r.postsScanned} posts, ${r.painPointsFound} pain points${r.error ? ` (ERROR: ${r.error})` : ''}`);
    totalPosts += r.postsScanned || 0;
    totalPainPoints += r.painPointsFound || 0;
  }
  console.log(`\nTOTAL: ${results.length} subreddits, ${totalPosts} posts, ${totalPainPoints} pain points submitted`);

  // Don't close browser — admin handles that
  await browser.close().catch(() => {});
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
