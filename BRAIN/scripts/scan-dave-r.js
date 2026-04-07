const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:51673/devtools/browser/c91f63a9-c5fd-45f5-a391-89efdbb48905';
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

async function postJson(path, data) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify(data),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function fetchSubredditJson(sub) {
  const url = `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function isPainPoint(post) {
  const title = (post.title || '').toLowerCase();
  const body = (post.selftext || '').toLowerCase();
  const text = title + ' ' + body;

  // Skip low-engagement, stickied, pure media
  if (post.stickied) return false;
  if (post.score < 5) return false;
  if (!post.is_self && !post.selftext && post.score < 50) return false;

  // Skip memes, humor, celebrations
  const skipPatterns = [/meme/i, /\bfunny\b/i, /\bjoke\b/i, /finally finished/i, /just wanted to share/i, /proud of/i, /look what i/i];
  for (const p of skipPatterns) {
    if (p.test(text)) return false;
  }

  // Pain point signals
  const painSignals = [
    /\bhow (do|can|should) (i|you)\b/i,
    /\bbest (way|method|tool|app|software)\b/i,
    /\bfrustrat/i,
    /\bstruggl/i,
    /\bproblem\b/i,
    /\bissue\b/i,
    /\bkeep (failing|messing|getting)\b/i,
    /\bcan't figure\b/i,
    /\bkeep (having|running into)\b/i,
    /\bany (advice|recommendations|tips|suggestions)\b/i,
    /\bwhat (should|would)\b/i,
    /\bworthwhile\b/i,
    /\bneed help\b/i,
    /\bhelp me\b/i,
    /\bnewbie\b/i,
    /\bbeginner\b/i,
    /\bmistake\b/i,
    /\bwrong\b/i,
    /\bfailed\b/i,
    /\bnot working\b/i,
    /\bwaste of\b/i,
    /\btoo expensive\b/i,
    /\btoo complicated\b/i,
    /\bautomati/i,
    /\btrack(ing)?\b/i,
    /\borganiz/i,
    /\bplan(ning)?\b/i,
    /\bapp for\b/i,
    /\btool for\b/i,
    /\bsoftware for\b/i,
  ];

  for (const p of painSignals) {
    if (p.test(text)) return true;
  }

  // High engagement self-posts often contain pain
  if (post.is_self && post.num_comments >= 20 && post.score >= 30) return true;

  return false;
}

function buildPainPointTitle(post) {
  // Trim to 80 chars
  let t = post.title;
  if (t.length > 80) t = t.substring(0, 77) + '...';
  return t;
}

function buildDescription(post) {
  const body = post.selftext ? post.selftext.substring(0, 300).replace(/\n+/g, ' ').trim() : '';
  let desc = `From r/${post.subreddit}: ${post.title}.`;
  if (body) desc += ` ${body}`;
  if (desc.length > 400) desc = desc.substring(0, 397) + '...';
  return desc;
}

async function scanSubredditBrowser(page, sub) {
  console.log(`\n--- Scanning r/${sub} via browser ---`);
  const posts = [];

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

    // Extract post data from new Reddit (shreddit)
    const postData = await page.evaluate(() => {
      const results = [];
      // Try shreddit-post elements
      const shredditPosts = document.querySelectorAll('shreddit-post');
      shredditPosts.forEach(el => {
        const title = el.getAttribute('post-title') || el.querySelector('h1,h2,h3,[slot="title"]')?.textContent?.trim() || '';
        const score = parseInt(el.getAttribute('score') || el.getAttribute('upvotes') || '0');
        const comments = parseInt(el.getAttribute('comment-count') || '0');
        const permalink = el.getAttribute('permalink') || el.getAttribute('content-href') || '';
        const id = el.getAttribute('id') || permalink.split('/')[6] || '';
        const isSelf = el.getAttribute('post-type') === 'self' || el.getAttribute('domain')?.includes('self.') || false;
        if (title) {
          results.push({ title, score, num_comments: comments, permalink, id, is_self: isSelf, selftext: '' });
        }
      });

      // Fallback: try anchor tags with post titles
      if (results.length === 0) {
        const links = document.querySelectorAll('a[data-testid="post-title"], a[slot="title"], h3 a, [data-click-id="body"] h3');
        links.forEach(el => {
          const title = el.textContent.trim();
          const href = el.href || el.closest('a')?.href || '';
          if (title && href.includes('/comments/')) {
            const id = href.split('/comments/')[1]?.split('/')[0] || '';
            results.push({ title, score: 0, num_comments: 0, permalink: href, id, is_self: true, selftext: '' });
          }
        });
      }
      return results;
    });

    console.log(`Found ${postData.length} posts on page`);
    posts.push(...postData.map(p => ({ ...p, subreddit: sub })));

  } catch (err) {
    console.log(`Browser scan failed for r/${sub}: ${err.message}. Falling back to JSON API.`);
    return null; // signal to use fallback
  }

  return posts;
}

async function scanSubredditJson(sub) {
  console.log(`--- Scanning r/${sub} via JSON API ---`);
  try {
    const data = await fetchSubredditJson(sub);
    const children = data.data.children.map(c => ({ ...c.data, subreddit: sub }));
    console.log(`Got ${children.length} posts via JSON API`);
    return children;
  } catch (err) {
    console.log(`JSON API fallback also failed for r/${sub}: ${err.message}`);
    return [];
  }
}

async function openPostForDetails(page, permalink) {
  try {
    const url = permalink.startsWith('http') ? permalink : `https://www.reddit.com${permalink}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(2000);

    const details = await page.evaluate(() => {
      // Try to get post body text
      const bodyEl = document.querySelector('[data-testid="post-container"] [data-click-id="text"]') ||
        document.querySelector('shreddit-post [slot="text-body"]') ||
        document.querySelector('.Post [data-adclicklocation="title"] + div') ||
        document.querySelector('[data-test-id="post-content"]');
      const body = bodyEl?.textContent?.trim() || '';

      // Get top comments
      const commentEls = document.querySelectorAll('[data-testid="comment"], shreddit-comment');
      const comments = Array.from(commentEls).slice(0, 5).map(el => el.textContent?.trim()?.substring(0, 200) || '').filter(Boolean);
      return { body: body.substring(0, 2000), comments };
    });
    return details;
  } catch (err) {
    console.log(`Could not open post: ${err.message}`);
    return { body: '', comments: [] };
  }
}

async function main() {
  console.log(`Dave-R Scanner starting. Subreddits: ${SUBREDDITS.join(', ')}`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected to AdsPower browser via CDP');
  } catch (err) {
    console.error(`Failed to connect to CDP: ${err.message}`);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const pages = context.pages();
  // Close extra tabs
  for (let i = 1; i < pages.length; i++) {
    try { await pages[i].close(); } catch {}
  }
  const page = pages[0] || await context.newPage();

  const totalResults = {
    subredditsScanned: 0,
    totalPostsAnalyzed: 0,
    painPointsFound: [],
    errors: [],
  };

  for (const sub of SUBREDDITS) {
    console.log(`\n========== r/${sub} ==========`);
    const category = CATEGORY_MAP[sub] || 'Home & DIY';
    let posts = [];

    // Try browser-based scan first
    const browserPosts = await scanSubredditBrowser(page, sub);
    if (browserPosts && browserPosts.length > 0) {
      posts = browserPosts;
    } else {
      // Fallback to JSON API
      posts = await scanSubredditJson(sub);
    }

    // If browser gave posts but no selftext, try to enrich top ones via JSON
    if (posts.length > 0 && posts.every(p => !p.selftext)) {
      console.log('Enriching via JSON API for post bodies...');
      try {
        const jsonData = await fetchSubredditJson(sub);
        const jsonPosts = jsonData.data.children.map(c => c.data);
        // Merge selftext from JSON into browser posts by matching title
        const jsonMap = {};
        for (const jp of jsonPosts) {
          jsonMap[jp.id] = jp;
        }
        posts = posts.map(p => {
          const match = jsonMap[p.id] || jsonPosts.find(jp => jp.title === p.title);
          if (match) return { ...match, subreddit: sub };
          return p;
        });
        // Add any JSON posts not in browser results
        for (const jp of jsonPosts) {
          if (!posts.find(p => p.id === jp.id)) posts.push({ ...jp, subreddit: sub });
        }
      } catch (err) {
        console.log(`Could not enrich posts: ${err.message}`);
      }
    }

    // Filter for pain points
    const painPosts = posts.filter(p => isPainPoint(p));
    console.log(`Posts analyzed: ${posts.length}, Pain points candidates: ${painPosts.length}`);

    totalResults.totalPostsAnalyzed += posts.length;

    // For top pain point posts with comments, try to open them
    const toEnrich = painPosts.filter(p => p.num_comments >= 10).slice(0, 3);
    for (const post of toEnrich) {
      if (post.permalink && !post.selftext) {
        const details = await openPostForDetails(page, post.permalink);
        if (details.body) post.selftext = details.body;
        await sleep(2500);
      }
    }

    // Submit pain points
    let subPainPointCount = 0;
    for (const post of painPosts.slice(0, 8)) { // Cap at 8 per subreddit
      const painPointData = {
        title: buildPainPointTitle(post),
        description: buildDescription(post),
        category,
        subreddit: `r/${sub}`,
        discoveredBy: AGENT_ID,
      };

      try {
        const created = await postJson('/api/pain-points', painPointData);
        const ppId = created.id || created.painPoint?.id;
        console.log(`Created pain point: "${painPointData.title}" (id: ${ppId})`);

        if (ppId) {
          // Link the source post
          const postLink = {
            painPointId: ppId,
            redditPostId: post.id || '',
            redditUrl: post.permalink
              ? (post.permalink.startsWith('http') ? post.permalink : `https://reddit.com${post.permalink}`)
              : `https://reddit.com/r/${sub}`,
            postTitle: post.title || '',
            postBody: (post.selftext || '').substring(0, 2000),
            upvotes: post.score || 0,
            commentCount: post.num_comments || 0,
            subreddit: `r/${sub}`,
            discoveredBy: AGENT_ID,
          };
          await postJson('/api/pain-points/posts', postLink);
          console.log(`Linked source post for pain point ${ppId}`);
        }

        totalResults.painPointsFound.push(painPointData.title);
        subPainPointCount++;
      } catch (err) {
        console.log(`Failed to submit pain point: ${err.message}`);
        totalResults.errors.push(`r/${sub}: ${err.message}`);
      }

      await sleep(500);
    }

    // Log scan result for this subreddit
    try {
      await postJson('/api/pain-points/scan-logs', {
        agentId: AGENT_ID,
        subreddit: `r/${sub}`,
        postsScanned: posts.length,
        painPointsFound: subPainPointCount,
        status: 'completed',
      });
      console.log(`Logged scan for r/${sub}: ${posts.length} posts, ${subPainPointCount} pain points`);
    } catch (err) {
      console.log(`Failed to log scan: ${err.message}`);
    }

    totalResults.subredditsScanned++;
    await sleep(3000); // Pause between subreddits
  }

  // Summary
  console.log('\n========== SCAN COMPLETE ==========');
  console.log(`Subreddits scanned: ${totalResults.subredditsScanned}`);
  console.log(`Total posts analyzed: ${totalResults.totalPostsAnalyzed}`);
  console.log(`Pain points found: ${totalResults.painPointsFound.length}`);
  totalResults.painPointsFound.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
  if (totalResults.errors.length) {
    console.log(`Errors: ${totalResults.errors.join(', ')}`);
  }

  // Don't close browser — admin agent handles that
  await browser.close(); // This disconnects CDP without closing the profile
  console.log('Disconnected from CDP (profile remains open)');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
