const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:64456/devtools/browser/d30e8ce7-8029-42ba-ada1-aae3bd6fd7da';
const AGENT_ID = 'priya-k';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const SUBREDDITS = ['Meditation', 'Anxiety', 'therapists', 'Journaling'];

const CATEGORY_MAP = {
  'Meditation': 'Mental Health',
  'Anxiety': 'Mental Health',
  'therapists': 'Therapy',
  'Journaling': 'Journaling',
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
  try { return JSON.parse(text); } catch { return text; }
}

async function submitPainPoint(pp) {
  const result = await apiPost('/api/pain-points', {
    title: pp.title.slice(0, 80),
    description: pp.description,
    category: pp.category,
    subreddit: pp.subreddit,
    discoveredBy: AGENT_ID,
  });
  console.log('Pain point created:', JSON.stringify(result));
  const id = result?.id || result?.data?.id;
  if (id && pp.post) {
    const linkResult = await apiPost('/api/pain-points/posts', {
      painPointId: id,
      redditPostId: pp.post.id,
      redditUrl: pp.post.url,
      postTitle: pp.post.title,
      postBody: (pp.post.body || '').slice(0, 2000),
      upvotes: pp.post.upvotes,
      commentCount: pp.post.commentCount,
      subreddit: pp.subreddit,
      discoveredBy: AGENT_ID,
    });
    console.log('Post linked:', JSON.stringify(linkResult));
  }
  return id;
}

async function logScan(subreddit, postsScanned, painPointsFound, status = 'completed') {
  const result = await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned,
    painPointsFound,
    status,
  });
  console.log(`Scan log for r/${subreddit}:`, JSON.stringify(result));
}

async function fetchSubredditJSON(subreddit) {
  console.log(`Fetching JSON fallback for r/${subreddit}`);
  const res = await fetch(
    `https://www.reddit.com/r/${subreddit}/hot.json?limit=25&raw_json=1`,
    { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' } }
  );
  const data = await res.json();
  return data?.data?.children?.map(c => c.data) || [];
}

function analyzePainPoints(posts, subreddit) {
  const category = CATEGORY_MAP[subreddit] || 'Mental Health';
  const painPoints = [];

  for (const post of posts) {
    if (post.stickied) continue;
    if ((post.score || 0) < 5) continue;
    // Skip purely image posts with no text
    if (!post.selftext && post.post_hint === 'image') continue;

    const title = post.title || '';
    const body = post.selftext || '';
    const combined = (title + ' ' + body).toLowerCase();

    // Look for pain point signals
    const painSignals = [
      /is there an? (app|tool|way|method|technique)/i,
      /how do (i|you|we) (deal with|manage|handle|track|organize)/i,
      /struggling (with|to)/i,
      /can't (seem to|figure out|stop|get)/i,
      /frustrated (with|by|about)/i,
      /wish there (was|were|is)/i,
      /does anyone (else|have|know)/i,
      /anyone (else|have|know|recommend)/i,
      /looking for (a|an|advice|help|suggestions|recommendations)/i,
      /what (app|tool|method|system|technique|works)/i,
      /help (me|with|for)/i,
      /difficult to/i,
      /hard to/i,
      /problem with/i,
      /issue with/i,
    ];

    const hasPainSignal = painSignals.some(rx => rx.test(title) || rx.test(body));
    if (!hasPainSignal) continue;

    // Skip pure venting/emotional/meme posts
    const excludeSignals = [
      /rant$/i,
      /venting/i,
      /\bmeme\b/i,
      /\bjoke\b/i,
      /\bfunny\b/i,
      /just wanted to share/i,
      /success story/i,
      /\bcelebrat/i,
    ];
    if (excludeSignals.some(rx => rx.test(title) || rx.test(body))) continue;

    // Build a pain point summary
    const ppTitle = title.length <= 80 ? title : title.slice(0, 77) + '...';
    let description = '';

    if (subreddit === 'Meditation') {
      description = `r/Meditation user asks: "${title}". `;
      description += body ? body.slice(0, 300).replace(/\n+/g, ' ') : 'Seeking advice or tools for their meditation practice.';
    } else if (subreddit === 'Anxiety') {
      description = `r/Anxiety user shares struggle: "${title}". `;
      description += body ? body.slice(0, 300).replace(/\n+/g, ' ') : 'Looking for coping strategies or tools to manage anxiety.';
    } else if (subreddit === 'therapists') {
      description = `r/therapists professional asks: "${title}". `;
      description += body ? body.slice(0, 300).replace(/\n+/g, ' ') : 'Seeking tools or methods for clinical practice.';
    } else if (subreddit === 'Journaling') {
      description = `r/Journaling user asks: "${title}". `;
      description += body ? body.slice(0, 300).replace(/\n+/g, ' ') : 'Looking for better journaling methods, apps, or organization systems.';
    }

    description = description.slice(0, 500);

    painPoints.push({
      title: ppTitle,
      description,
      category,
      subreddit: `r/${subreddit}`,
      post: {
        id: post.id,
        url: `https://reddit.com${post.permalink}`,
        title: post.title,
        body: post.selftext || '',
        upvotes: post.score || 0,
        commentCount: post.num_comments || 0,
      },
    });
  }

  return painPoints;
}

async function scanSubredditViaBrowser(page, subreddit) {
  console.log(`\n--- Scanning r/${subreddit} via browser ---`);
  try {
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

    // Take snapshot to check page state
    const title = await page.title();
    console.log(`Page title: ${title}`);

    // Check for CAPTCHA or login wall
    const url = page.url();
    if (url.includes('login') || url.includes('captcha')) {
      console.log(`Login/CAPTCHA wall detected for r/${subreddit}, falling back to JSON API`);
      return null; // Signal fallback
    }

    // Try to extract posts from the page
    const posts = await page.evaluate(() => {
      const postEls = document.querySelectorAll('shreddit-post, [data-testid="post-container"], article');
      const results = [];
      postEls.forEach(el => {
        const titleEl = el.querySelector('h1, h2, h3, [slot="title"], a[data-click-id="body"]');
        const scoreEl = el.querySelector('[id*="vote-arrows"] faceplate-number, [data-click-id="upvote"]');
        const commentEl = el.querySelector('a[data-click-id="comments"]');
        const linkEl = el.querySelector('a[data-click-id="body"], a[slot="full-post-link"]');

        if (titleEl) {
          results.push({
            title: titleEl.innerText || titleEl.textContent || '',
            score: parseInt(scoreEl?.innerText?.replace(/[^0-9]/g, '') || '0') || 0,
            commentText: commentEl?.innerText || '',
            href: linkEl?.href || '',
          });
        }
      });
      return results;
    });

    console.log(`Found ${posts.length} posts via browser DOM`);
    if (posts.length >= 5) {
      return posts;
    }
    return null; // Fallback if too few posts
  } catch (err) {
    console.log(`Browser scan error for r/${subreddit}: ${err.message}`);
    return null;
  }
}

async function main() {
  console.log('Connecting to AdsPower browser via CDP...');
  const browser = await chromium.connectOverCDP(CDP_URL);
  console.log('Connected!');

  const context = browser.contexts()[0];
  const pages = context.pages();
  for (let i = 1; i < pages.length; i++) await pages[i].close();
  const page = pages[0] || await context.newPage();

  const totalStats = { subreddits: 0, posts: 0, painPoints: 0 };
  const allPainPointTitles = [];

  for (const subreddit of SUBREDDITS) {
    let posts = [];
    let usedFallback = false;

    // Try browser first
    const browserPosts = await scanSubredditViaBrowser(page, subreddit);
    
    if (!browserPosts || browserPosts.length < 5) {
      // Fallback to JSON API
      console.log(`Using JSON API fallback for r/${subreddit}`);
      usedFallback = true;
      try {
        posts = await fetchSubredditJSON(subreddit);
        console.log(`JSON API returned ${posts.length} posts for r/${subreddit}`);
      } catch (err) {
        console.log(`JSON API error for r/${subreddit}: ${err.message}`);
        await logScan(subreddit, 0, 0, 'error');
        continue;
      }
    } else {
      // Convert browser posts to a common format
      // For pain point analysis, we need more data — use JSON API to get full post data
      console.log(`Got ${browserPosts.length} posts from browser, enriching with JSON API...`);
      try {
        posts = await fetchSubredditJSON(subreddit);
        console.log(`Enriched with ${posts.length} posts from JSON API`);
      } catch (err) {
        console.log(`Enrichment failed, using browser data only: ${err.message}`);
        // Create minimal post objects from browser data
        posts = browserPosts.map((p, i) => ({
          id: `browser_${i}`,
          title: p.title,
          selftext: '',
          score: p.score,
          num_comments: 0,
          permalink: p.href ? p.href.replace('https://www.reddit.com', '') : '',
          stickied: false,
        }));
      }
    }

    if (posts.length === 0) {
      await logScan(subreddit, 0, 0, 'error');
      continue;
    }

    // Filter and analyze
    const filtered = posts.filter(p => !p.stickied && (p.score || 0) >= 5);
    console.log(`Analyzing ${filtered.length} qualifying posts in r/${subreddit}`);

    const painPoints = analyzePainPoints(posts, subreddit);
    console.log(`Found ${painPoints.length} pain points in r/${subreddit}`);

    // Submit each pain point
    for (const pp of painPoints) {
      try {
        await submitPainPoint(pp);
        allPainPointTitles.push(pp.title);
        await sleep(500);
      } catch (err) {
        console.log(`Error submitting pain point: ${err.message}`);
      }
    }

    // Log scan after each subreddit
    await logScan(subreddit, filtered.length, painPoints.length, 'completed');
    await sleep(2000);

    totalStats.subreddits++;
    totalStats.posts += filtered.length;
    totalStats.painPoints += painPoints.length;
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${totalStats.subreddits}`);
  console.log(`Total posts analyzed: ${totalStats.posts}`);
  console.log(`Pain points discovered: ${totalStats.painPoints}`);
  console.log('Pain point titles:');
  allPainPointTitles.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));

  // Return summary as JSON for easy parsing
  const summary = {
    subredditsScanned: totalStats.subreddits,
    totalPostsAnalyzed: totalStats.posts,
    painPointsFound: totalStats.painPoints,
    painPointTitles: allPainPointTitles,
  };
  console.log('\nSUMMARY_JSON:' + JSON.stringify(summary));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
