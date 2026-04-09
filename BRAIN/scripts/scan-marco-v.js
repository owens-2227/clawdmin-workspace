const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:61202/devtools/browser/5a70ca87-41c0-4b4f-b0e1-4cf6494e9916';
const AGENT_ID = 'marco-v';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const SUBREDDITS = [
  { name: 'nocode', category: 'No-Code & Builders' },
  { name: 'Nootropics', category: 'Biohacking' },
  { name: 'Biohackers', category: 'Biohacking' },
  { name: 'SideProject', category: 'No-Code & Builders' },
];

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

async function submitPainPoint({ title, description, category, subreddit, post }) {
  const pp = await apiPost('/api/pain-points', {
    title,
    description,
    category,
    subreddit: `r/${subreddit}`,
    discoveredBy: AGENT_ID,
  });
  const ppId = pp?.painPoint?.id || pp?.id || pp?.data?.id;
  console.log(`  [pain-point created] id=${ppId} title="${title}"`);

  if (ppId && post) {
    const link = await apiPost('/api/pain-points/posts', {
      painPointId: ppId,
      redditPostId: post.id,
      redditUrl: post.url,
      postTitle: post.title,
      postBody: (post.body || '').slice(0, 2000),
      upvotes: post.upvotes,
      commentCount: post.commentCount,
      subreddit: `r/${subreddit}`,
      discoveredBy: AGENT_ID,
    });
    console.log(`  [post linked] painPointId=${ppId}`);
  }
  return pp;
}

async function logScan({ subreddit, postsScanned, painPointsFound, status }) {
  await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned,
    painPointsFound,
    status,
  });
  console.log(`  [scan-log] r/${subreddit} posts=${postsScanned} pain=${painPointsFound} status=${status}`);
}

// Try to get posts via JSON API fallback
async function fetchPostsViaJSON(subreddit) {
  try {
    const res = await fetch(
      `https://www.reddit.com/r/${subreddit}/hot.json?limit=25&raw_json=1`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' } }
    );
    const data = await res.json();
    return data.data.children.map(c => c.data);
  } catch (e) {
    console.log(`  JSON fallback failed: ${e.message}`);
    return [];
  }
}

async function scanSubreddit(page, sub) {
  const { name, category } = sub;
  console.log(`\n=== Scanning r/${name} ===`);
  let postsScanned = 0;
  let painPointsFound = 0;
  let posts = [];

  try {
    await page.goto(`https://www.reddit.com/r/${name}/hot/`, {
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

    // Try to get post data from page
    const pageContent = await page.content();
    
    // Check for login wall or captcha
    if (pageContent.includes('Log In') && pageContent.includes('Sign Up') && !pageContent.includes('shreddit-post')) {
      console.log(`  Possible login wall detected, trying JSON fallback...`);
      posts = await fetchPostsViaJSON(name);
    } else {
      // Extract posts from page using evaluate
      posts = await page.evaluate(() => {
        const postEls = document.querySelectorAll('shreddit-post, [data-testid="post-container"], article');
        const results = [];
        postEls.forEach(el => {
          const title = el.getAttribute('post-title') || el.querySelector('h1, h2, h3, [slot="title"]')?.textContent?.trim() || '';
          const id = el.getAttribute('id') || el.getAttribute('post-id') || '';
          const permalink = el.getAttribute('permalink') || el.querySelector('a[href*="/comments/"]')?.getAttribute('href') || '';
          const score = parseInt(el.getAttribute('score') || el.querySelector('[data-testid="vote-count"]')?.textContent || '0');
          const comments = parseInt(el.getAttribute('comment-count') || '0');
          const isStickied = el.getAttribute('is-pinned') === 'true' || el.getAttribute('stickied') === 'true';
          if (title && !isStickied) {
            results.push({ title, id, permalink, score, comments });
          }
        });
        return results;
      });

      if (posts.length === 0) {
        console.log(`  No posts extracted from page, trying JSON fallback...`);
        const jsonPosts = await fetchPostsViaJSON(name);
        posts = jsonPosts.map(p => ({
          title: p.title,
          id: p.id,
          permalink: p.permalink,
          score: p.score,
          comments: p.num_comments,
          selftext: p.selftext,
        }));
      }
    }
  } catch (err) {
    console.log(`  Page load error: ${err.message}, trying JSON fallback...`);
    const jsonPosts = await fetchPostsViaJSON(name);
    posts = jsonPosts.map(p => ({
      title: p.title,
      id: p.id,
      permalink: p.permalink,
      score: p.score,
      comments: p.num_comments,
      selftext: p.selftext,
    }));
  }

  console.log(`  Found ${posts.length} posts`);

  // Filter out low-value posts
  const viable = posts.filter(p => {
    const score = p.score || p.ups || 0;
    return score >= 5 && p.title && p.title.length > 10;
  });

  console.log(`  ${viable.length} viable posts after filtering`);
  postsScanned = viable.length;

  // Analyze each viable post for pain points
  const painPoints = [];

  for (const post of viable) {
    const title = post.title || '';
    const body = post.selftext || post.body || '';
    const titleLower = title.toLowerCase();
    const bodyLower = body.toLowerCase();

    // Pain point signals
    const isPainPoint = (
      titleLower.match(/\b(frustrated|frustrating|annoying|hate|wish|problem|issue|struggle|difficult|hard to|can't|cannot|need|looking for|is there|anyone else|help|stuck|broken|doesn't work|won't work|failing|failed|why is|how do i|how to)\b/) ||
      titleLower.match(/\b(app|tool|software|solution|alternative|recommendation|suggest)\b/) ||
      bodyLower.match(/\b(frustrated|wish there was|need a way|is there a tool|can't find|no good solution|painful|time.consuming|manually|automate)\b/)
    );

    // Exclusion signals
    const isExcluded = (
      titleLower.match(/\b(meme|lol|haha|funny|humor|rant|vent|celebrate|achievement|proud|congrats)\b/) ||
      title.length < 20
    );

    if (isPainPoint && !isExcluded) {
      const postId = post.id || post.permalink?.split('/')[6] || '';
      const redditUrl = post.permalink
        ? (post.permalink.startsWith('http') ? post.permalink : `https://reddit.com${post.permalink}`)
        : `https://reddit.com/r/${name}`;

      painPoints.push({
        title: title.slice(0, 80),
        body,
        postId,
        redditUrl,
        upvotes: post.score || post.ups || 0,
        commentCount: post.comments || post.num_comments || 0,
      });
    }
  }

  console.log(`  ${painPoints.length} pain points identified`);

  // For top promising posts, try to get more context via JSON API
  const topPosts = painPoints.slice(0, 8); // Limit to top 8

  for (const pp of topPosts) {
    // Try to enrich with post body via JSON if we don't have it
    if (!pp.body && pp.postId) {
      try {
        const res = await fetch(
          `https://www.reddit.com/r/${name}/comments/${pp.postId}.json?raw_json=1`,
          { headers: { 'User-Agent': 'Mozilla/5.0' } }
        );
        const data = await res.json();
        if (data[0]?.data?.children?.[0]?.data) {
          pp.body = data[0].data.children[0].data.selftext || '';
          // Also grab top comments
          const comments = data[1]?.data?.children?.slice(0, 5).map(c => c.data?.body).filter(Boolean) || [];
          pp.topComments = comments;
        }
        await sleep(1500);
      } catch (e) {
        // ignore
      }
    }

    // Generate a clean description
    const bodySnippet = (pp.body || '').slice(0, 200).replace(/\n/g, ' ').trim();
    const commentsSnippet = (pp.topComments || []).slice(0, 2).join(' | ').slice(0, 100);
    
    let description = '';
    if (bodySnippet) {
      description = `${bodySnippet}`;
    } else {
      description = `Reddit user experiencing issues with: ${pp.title}`;
    }
    if (commentsSnippet) {
      description += ` Community response: ${commentsSnippet}`;
    }
    description = description.slice(0, 400);

    const result = await submitPainPoint({
      title: pp.title,
      description,
      category,
      subreddit: name,
      post: {
        id: pp.postId,
        url: pp.redditUrl,
        title: pp.title,
        body: pp.body || '',
        upvotes: pp.upvotes,
        commentCount: pp.commentCount,
      },
    });
    painPointsFound++;
    await sleep(1000);
  }

  await logScan({ subreddit: name, postsScanned, painPointsFound, status: 'completed' });
  return { postsScanned, painPointsFound };
}

async function main() {
  console.log(`[marco-v scanner] Starting. CDP: ${CDP_URL}`);
  
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('[marco-v scanner] Connected to browser');
  } catch (err) {
    console.error(`[marco-v scanner] Failed to connect: ${err.message}`);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const pages = context.pages();
  
  // Close extra tabs, keep one
  for (let i = 1; i < pages.length; i++) {
    try { await pages[i].close(); } catch {}
  }
  const page = pages[0] || await context.newPage();

  let totalPostsScanned = 0;
  let totalPainPoints = 0;
  const errors = [];

  for (const sub of SUBREDDITS) {
    try {
      const result = await scanSubreddit(page, sub);
      totalPostsScanned += result.postsScanned;
      totalPainPoints += result.painPointsFound;
    } catch (err) {
      console.error(`  ERROR scanning r/${sub.name}: ${err.message}`);
      errors.push(`r/${sub.name}: ${err.message}`);
      await logScan({ subreddit: sub.name, postsScanned: 0, painPointsFound: 0, status: 'error' });
    }
    await sleep(3000); // Pause between subreddits
  }

  console.log(`\n=== SCAN COMPLETE ===`);
  console.log(`Subreddits: ${SUBREDDITS.length}`);
  console.log(`Posts scanned: ${totalPostsScanned}`);
  console.log(`Pain points submitted: ${totalPainPoints}`);
  if (errors.length) console.log(`Errors: ${errors.join(', ')}`);

  // Don't close browser — admin handles that
  await browser.close(); // Just disconnect, not close
  
  return { totalPostsScanned, totalPainPoints, errors };
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
