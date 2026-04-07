const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:61786/devtools/browser/a7512840-8b27-4c62-8194-62db63e423a1';
const AGENT_ID = 'marcus-j';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const SUBREDDITS = ['Guitar', 'guitarpedals', 'Blues', 'homerecording'];

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function submitPainPoint(pp) {
  console.log(`  → Submitting pain point: ${pp.title}`);
  const result = await apiPost('/api/pain-points', {
    title: pp.title,
    description: pp.description,
    category: 'Music',
    subreddit: pp.subreddit,
    discoveredBy: AGENT_ID
  });
  console.log(`    Pain point created:`, JSON.stringify(result));
  const id = result?.id || result?.data?.id;
  if (id && pp.post) {
    const linkResult = await apiPost('/api/pain-points/posts', {
      painPointId: id,
      redditPostId: pp.post.id,
      redditUrl: pp.post.url,
      postTitle: pp.post.title,
      postBody: (pp.post.body || '').slice(0, 2000),
      upvotes: pp.post.upvotes || 0,
      commentCount: pp.post.commentCount || 0,
      subreddit: pp.subreddit,
      discoveredBy: AGENT_ID
    });
    console.log(`    Post linked:`, JSON.stringify(linkResult));
  }
  return id;
}

async function logScan(subreddit, postsScanned, painPointsFound, status = 'completed') {
  const result = await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned,
    painPointsFound,
    status
  });
  console.log(`  → Scan log for r/${subreddit}:`, JSON.stringify(result));
}

async function fetchRedditJSON(subreddit) {
  const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=25&raw_json=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
  });
  const data = await res.json();
  return data?.data?.children?.map(c => c.data) || [];
}

function analyzePosts(posts, subreddit) {
  const painPoints = [];
  for (const post of posts) {
    if (post.stickied) continue;
    if ((post.score || 0) < 5) continue;

    const title = post.title || '';
    const body = post.selftext || '';
    const combined = (title + ' ' + body).toLowerCase();

    // Pain point signals
    const signals = [
      /is there (an? )?(app|tool|plugin|software|website|service|way) (to|for)/i,
      /\bwish (there was|i could|i had|we had)\b/i,
      /\bhow do (you|i|we) (manage|track|organize|find|keep track|deal with)\b/i,
      /\bfrustrat(ed|ing|ion)\b/i,
      /\bstruggl(e|ing|ed)\b/i,
      /\bpain point\b/i,
      /\bcan't (find|figure out|afford|justify)\b/i,
      /\btoo (expensive|complex|complicated|hard|difficult)\b/i,
      /\bmanually\b/i,
      /\b(no|none of the) (free |good |decent )?(apps?|tools?|options?|software|solutions?)\b/i,
      /\bwhat (do you use|software|tool|app|plugin|pedal board|app)\b/i,
      /\bannoying\b/i,
      /\bproblem (with|is)\b/i,
      /\b(every time|always have to|keep having to)\b/i,
      /\bwasted (time|money|hours)\b/i,
      /\bwish .* (exist|existed|had)\b/i,
      /\bneed (a |an )?(better|good|decent|free)\b/i,
      /\b(hard|difficult|pain) to\b/i,
    ];

    const matchedSignals = signals.filter(s => s.test(combined));
    if (matchedSignals.length === 0) continue;

    // Skip memes/celebrations/humor with no body
    if (!body && post.url && !post.url.includes('reddit.com/r/' + subreddit + '/comments')) continue;

    // Build pain point
    const desc = body.slice(0, 500).trim() || title;
    const shortDesc = desc.length > 300 ? desc.slice(0, 300) + '...' : desc;

    painPoints.push({
      title: title.slice(0, 80),
      description: `From r/${subreddit}: ${shortDesc}`,
      subreddit: `r/${subreddit}`,
      post: {
        id: post.id,
        url: `https://reddit.com${post.permalink}`,
        title: title,
        body: post.selftext || '',
        upvotes: post.score || 0,
        commentCount: post.num_comments || 0
      }
    });
  }
  return painPoints;
}

async function scanSubredditWithBrowser(page, subreddit) {
  console.log(`\n=== Scanning r/${subreddit} via browser ===`);
  try {
    await page.goto(`https://www.reddit.com/r/${subreddit}/hot/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await page.waitForTimeout(3000);

    // Scroll to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await page.waitForTimeout(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1000);

    // Try to extract posts from page
    const posts = await page.evaluate(() => {
      const results = [];
      // shreddit-post elements
      const postEls = document.querySelectorAll('shreddit-post, [data-testid="post-container"], article');
      for (const el of postEls) {
        const titleEl = el.querySelector('h1, h2, h3, [slot="title"], a[data-click-id="body"]');
        const title = titleEl?.textContent?.trim() || '';
        const href = el.querySelector('a[href*="/comments/"]')?.href || '';
        const scoreEl = el.querySelector('[data-testid="vote-count"], faceplate-number, [aria-label*="upvote"]');
        const score = parseInt(scoreEl?.textContent?.replace(/[^0-9]/g, '') || '0');
        if (title) results.push({ title, href, score });
      }
      return results;
    });
    console.log(`  Browser found ${posts.length} post elements on page`);
    return posts.length;
  } catch (err) {
    console.log(`  Browser scan error for r/${subreddit}: ${err.message}`);
    return 0;
  }
}

async function main() {
  console.log('Starting marcus-j scanner...');
  console.log(`CDP URL: ${CDP_URL}`);
  console.log(`Subreddits: ${SUBREDDITS.join(', ')}`);

  let browser;
  let page;

  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected to AdsPower browser via CDP');
    const context = browser.contexts()[0];
    const pages = context.pages();
    for (let i = 1; i < pages.length; i++) await pages[i].close();
    page = pages[0] || await context.newPage();
    console.log('Browser page ready');
  } catch (err) {
    console.log(`CDP connection failed: ${err.message}. Proceeding with JSON API fallback only.`);
  }

  let totalPostsAnalyzed = 0;
  let totalPainPoints = 0;
  const allPainPoints = [];

  for (const subreddit of SUBREDDITS) {
    console.log(`\n========== r/${subreddit} ==========`);
    let postsScanned = 0;
    let painPointsFound = 0;

    try {
      // Try browser scan first if available
      if (page) {
        const browserPostCount = await scanSubredditWithBrowser(page, subreddit);
        postsScanned = Math.max(postsScanned, browserPostCount);
        await page.waitForTimeout(2000);
      }

      // Always use JSON API for reliable data extraction
      console.log(`  Fetching r/${subreddit} via JSON API...`);
      const posts = await fetchRedditJSON(subreddit);
      console.log(`  JSON API returned ${posts.length} posts`);
      postsScanned = Math.max(postsScanned, posts.length);

      const painPoints = analyzePosts(posts, subreddit);
      console.log(`  Found ${painPoints.length} potential pain points`);

      for (const pp of painPoints) {
        await submitPainPoint(pp);
        painPointsFound++;
        totalPainPoints++;
        allPainPoints.push(pp.title);
        await new Promise(r => setTimeout(r, 500));
      }

      totalPostsAnalyzed += postsScanned;
    } catch (err) {
      console.error(`  Error scanning r/${subreddit}: ${err.message}`);
      await logScan(subreddit, postsScanned, painPointsFound, 'error');
      continue;
    }

    await logScan(subreddit, postsScanned, painPointsFound, 'completed');
    console.log(`  Done: ${postsScanned} posts, ${painPointsFound} pain points`);

    // Pacing between subreddits
    if (SUBREDDITS.indexOf(subreddit) < SUBREDDITS.length - 1) {
      console.log('  Waiting 3s before next subreddit...');
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  console.log('\n========== SCAN COMPLETE ==========');
  console.log(`Subreddits scanned: ${SUBREDDITS.length}`);
  console.log(`Total posts analyzed: ${totalPostsAnalyzed}`);
  console.log(`Total pain points submitted: ${totalPainPoints}`);
  if (allPainPoints.length > 0) {
    console.log('Pain points found:');
    allPainPoints.forEach((t, i) => console.log(`  ${i+1}. ${t}`));
  }

  // Note: Do NOT close the browser — admin agent handles that
  if (browser) {
    await browser.close().catch(() => {}); // disconnect only, AdsPower profile stays open
  }

  return { subredditsScanned: SUBREDDITS.length, totalPostsAnalyzed, totalPainPoints, painPoints: allPainPoints };
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
