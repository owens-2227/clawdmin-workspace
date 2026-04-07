const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:57688/devtools/browser/359ed189-da8f-4330-aed9-4ac2a4f86e3b';
const AGENT_ID = 'raj-s';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const SUBREDDITS = ['AnalogCommunity', 'streetphotography', 'MechanicalKeyboards', 'photocritique'];

const CATEGORY_MAP = {
  'AnalogCommunity': 'Photography',
  'streetphotography': 'Photography',
  'MechanicalKeyboards': 'Mechanical Keyboards',
  'photocritique': 'Photography',
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

async function fetchRedditJson(sub) {
  const url = `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  const category = CATEGORY_MAP[sub] || 'Photography';
  let postsScanned = 0;
  let painPointsFound = 0;
  const results = [];

  // Try browser navigation first
  let posts = [];
  try {
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    // Check for login wall or captcha
    const content = await page.content();
    if (content.includes('Log in to Reddit') || content.includes('captcha')) {
      console.log(`Login wall detected on r/${sub} — trying JSON API fallback`);
      throw new Error('login wall');
    }

    // Scroll to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    // Extract posts from shreddit UI
    posts = await page.evaluate(() => {
      const postEls = document.querySelectorAll('shreddit-post, [data-testid="post-container"], article');
      const extracted = [];
      postEls.forEach(el => {
        try {
          const titleEl = el.querySelector('a[slot="title"], h3, [data-click-id="body"] h3, .Post h3');
          const title = titleEl ? titleEl.textContent.trim() : '';
          const link = el.querySelector('a[slot="full-post-link"], a[data-click-id="body"]');
          const href = link ? link.getAttribute('href') : '';
          const scoreEl = el.querySelector('[id^="vote-arrows"] faceplate-number, shreddit-post');
          const score = el.getAttribute('score') || el.getAttribute('data-score') || '0';
          const comments = el.getAttribute('comment-count') || el.getAttribute('data-comment-count') || '0';
          const stickied = el.getAttribute('stickied') === 'true' || el.classList.contains('stickied');
          if (title && !stickied) {
            extracted.push({
              title,
              href: href ? (href.startsWith('http') ? href : 'https://reddit.com' + href) : '',
              score: parseInt(score) || 0,
              comments: parseInt(comments) || 0,
            });
          }
        } catch(e) {}
      });
      return extracted;
    });

    console.log(`Browser found ${posts.length} posts`);
  } catch (e) {
    console.log(`Browser approach error: ${e.message} — using JSON API fallback`);
  }

  // JSON API fallback if browser got nothing
  if (posts.length < 3) {
    try {
      const json = await fetchRedditJson(sub);
      const children = json.data?.children || [];
      posts = children
        .filter(c => !c.data.stickied && c.data.score >= 5)
        .map(c => ({
          title: c.data.title,
          href: `https://reddit.com${c.data.permalink}`,
          score: c.data.score,
          comments: c.data.num_comments,
          body: c.data.selftext || '',
          id: c.data.id,
        }));
      console.log(`JSON API returned ${posts.length} posts`);
    } catch (e2) {
      console.log(`JSON API also failed: ${e2.message}`);
    }
  }

  // Filter viable posts
  const viablePosts = posts.filter(p => p.score >= 5 && p.title);
  postsScanned = viablePosts.length;
  console.log(`Analyzing ${postsScanned} viable posts...`);

  // For top posts with comments, try to get body text
  const topPosts = viablePosts.sort((a, b) => (b.comments || 0) - (a.comments || 0)).slice(0, 15);

  for (const post of topPosts) {
    await sleep(1500);
    // Try to get post body if missing
    if (!post.body && post.href && post.comments >= 5) {
      try {
        // Extract reddit post ID from URL
        const match = post.href.match(/\/comments\/([a-z0-9]+)\//i);
        if (match) {
          post.id = match[1];
          const jsonUrl = `https://www.reddit.com/r/${sub}/comments/${post.id}.json?raw_json=1&limit=10`;
          const res = await fetch(jsonUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
          });
          if (res.ok) {
            const data = await res.json();
            const postData = data[0]?.data?.children[0]?.data;
            post.body = postData?.selftext || '';
            post.score = postData?.score || post.score;
            post.comments = postData?.num_comments || post.comments;
            // Get top comments
            const comments = data[1]?.data?.children?.slice(0, 5) || [];
            post.topComments = comments.map(c => c.data?.body || '').filter(Boolean).join('\n---\n');
          }
        }
      } catch (e) {
        // ignore
      }
    }
  }

  // Analyze for pain points
  const painPointKeywords = [
    'frustrated', 'annoying', 'wish', 'hate', 'problem', 'issue', 'struggle',
    'hard to', 'difficult', 'can\'t find', 'anyone know', 'is there a way',
    'app for', 'tool for', 'software for', 'how do you', 'help me',
    'manually', 'tedious', 'overwhelming', 'confusing', 'expensive', 'workflow',
    'organize', 'track', 'manage', 'automate', 'recommend', 'alternative to',
    'need a', 'looking for', 'seeking', 'advice on', 'best way to',
    'workflow', 'process', 'pain point', 'nobody talks about',
  ];

  for (const post of topPosts) {
    const textToAnalyze = (post.title + ' ' + (post.body || '') + ' ' + (post.topComments || '')).toLowerCase();
    const matchCount = painPointKeywords.filter(kw => textToAnalyze.includes(kw)).length;

    // Exclude memes/celebrations/pure images
    const excludePatterns = ['meme', 'oc]', '[oc]', 'appreciation', 'check out my', 'just got', 'look what i found', 'happy', 'beautiful', 'amazing'];
    const isExcluded = excludePatterns.some(p => post.title.toLowerCase().includes(p));

    if (matchCount >= 1 && !isExcluded && post.comments >= 3) {
      // This looks like a pain point - generate a clean title and description
      const painPoint = analyzePainPoint(post, sub, category);
      if (painPoint) {
        results.push({ post, painPoint });
        console.log(`  ✓ Pain point: ${painPoint.title}`);
      }
    }
  }

  // Submit pain points
  for (const { post, painPoint } of results) {
    try {
      const ppRes = await apiPost('/api/pain-points', {
        title: painPoint.title,
        description: painPoint.description,
        category: category,
        subreddit: `r/${sub}`,
        discoveredBy: AGENT_ID,
      });
      console.log(`  Submitted: ${JSON.stringify(ppRes)}`);

      const ppId = ppRes.id || ppRes.data?.id;
      if (ppId && post.id) {
        await apiPost('/api/pain-points/posts', {
          painPointId: ppId,
          redditPostId: post.id,
          redditUrl: post.href,
          postTitle: post.title,
          postBody: (post.body || '').slice(0, 2000),
          upvotes: post.score,
          commentCount: post.comments,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID,
        });
      }
      painPointsFound++;
    } catch (e) {
      console.log(`  Error submitting pain point: ${e.message}`);
    }
    await sleep(500);
  }

  // Log scan result
  try {
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned,
      painPointsFound,
      status: 'completed',
    });
    console.log(`  Logged scan: ${postsScanned} posts, ${painPointsFound} pain points`);
  } catch (e) {
    console.log(`  Error logging scan: ${e.message}`);
  }

  return { postsScanned, painPointsFound, titles: results.map(r => r.painPoint.title) };
}

function analyzePainPoint(post, sub, category) {
  const title = post.title;
  const body = post.body || '';
  const full = (title + ' ' + body).toLowerCase();

  // Skip if too short or no real content
  if (title.length < 10) return null;

  // Generate a clean pain point title
  let ppTitle = '';
  let ppDesc = '';

  if (full.includes('app') || full.includes('tool') || full.includes('software') || full.includes('is there a way')) {
    ppTitle = `Need for tool: ${title.slice(0, 70)}`;
  } else if (full.includes('workflow') || full.includes('process') || full.includes('how do you') || full.includes('best way')) {
    ppTitle = `Workflow challenge: ${title.slice(0, 65)}`;
  } else if (full.includes('frustrat') || full.includes('annoying') || full.includes('hate') || full.includes('struggle')) {
    ppTitle = `Frustration: ${title.slice(0, 70)}`;
  } else if (full.includes('organize') || full.includes('track') || full.includes('manage')) {
    ppTitle = `Organization problem: ${title.slice(0, 65)}`;
  } else {
    ppTitle = title.slice(0, 80);
  }

  // Description: combine post title + body excerpt
  if (body && body.length > 50) {
    ppDesc = `Reddit user asks: "${title}". ${body.slice(0, 200).replace(/\n/g, ' ')}... (r/${sub}, ${post.comments} comments, ${post.score} upvotes)`;
  } else {
    ppDesc = `Reddit user in r/${sub} asks: "${title}". This post has ${post.comments} comments and ${post.score} upvotes, indicating community relevance for ${category} enthusiasts.`;
  }

  return {
    title: ppTitle.slice(0, 80),
    description: ppDesc.slice(0, 500),
  };
}

async function main() {
  console.log(`Starting raj-s scan at ${new Date().toISOString()}`);
  console.log(`CDP URL: ${CDP_URL}`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected to AdsPower browser via CDP');
  } catch (e) {
    console.error(`Failed to connect to CDP: ${e.message}`);
    process.exit(1);
  }

  const contexts = browser.contexts();
  const context = contexts[0] || await browser.newContext();

  // Get or create a page
  const pages = context.pages();
  // Close extra tabs
  for (let i = 1; i < pages.length; i++) {
    try { await pages[i].close(); } catch {}
  }
  const page = pages[0] || await context.newPage();

  const summary = {
    subredditsScanned: 0,
    totalPostsAnalyzed: 0,
    totalPainPoints: 0,
    painPointTitles: [],
    errors: [],
  };

  for (const sub of SUBREDDITS) {
    try {
      const result = await scanSubreddit(page, sub);
      summary.subredditsScanned++;
      summary.totalPostsAnalyzed += result.postsScanned;
      summary.totalPainPoints += result.painPointsFound;
      summary.painPointTitles.push(...result.titles.map(t => `[r/${sub}] ${t}`));
    } catch (e) {
      console.error(`Error scanning r/${sub}: ${e.message}`);
      summary.errors.push(`r/${sub}: ${e.message}`);
      // Still log the scan as errored
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
    await sleep(3000); // pause between subreddits
  }

  // Don't close the browser — admin handles that
  await browser.close().catch(() => {});

  console.log('\n=== SCAN COMPLETE ===');
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

main().then(summary => {
  console.log('\nFinal summary:', JSON.stringify(summary, null, 2));
  process.exit(0);
}).catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
