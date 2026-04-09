/**
 * Reddit Pain Point Scanner — claire-t
 * Subreddits: insomnia, CBTi, TMJ, yinyoga
 */

const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:50609/devtools/browser/a31005de-f071-4f9d-8679-a109aaeb5cdd';
const AGENT_ID = 'claire-t';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const SUBREDDITS = ['insomnia', 'CBTi', 'TMJ', 'yinyoga'];

const CATEGORY_MAP = {
  insomnia: 'Sleep & Recovery',
  CBTi: 'Sleep & Recovery',
  TMJ: 'TMJ & Chronic Pain',
  yinyoga: 'Yoga',
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

async function getSubredditPostsViaJson(sub) {
  // Fallback: use Reddit JSON API
  const url = `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  const data = await res.json();
  return data?.data?.children?.map(c => c.data) || [];
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  const category = CATEGORY_MAP[sub] || 'General';
  let posts = [];
  let usedFallback = false;

  try {
    // Navigate to subreddit
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    // Check for CAPTCHA or error
    const content = await page.content();
    if (content.includes('captcha') || content.includes('CAPTCHA')) {
      console.log(`CAPTCHA detected on r/${sub}, using JSON fallback`);
      usedFallback = true;
    }

    if (!usedFallback) {
      // Scroll to load more posts
      for (let i = 0; i < 6; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
        await sleep(2000);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(1000);

      // Extract posts from page
      posts = await page.evaluate(() => {
        const results = [];
        // Try shreddit article elements
        const articles = document.querySelectorAll('article, shreddit-post, [data-testid="post-container"]');
        articles.forEach(el => {
          const titleEl = el.querySelector('h1, h2, h3, [slot="title"], a[data-click-id="body"]');
          const title = titleEl?.textContent?.trim();
          if (!title) return;

          const scoreEl = el.querySelector('[id*="vote-arrows"] faceplate-number, shreddit-post [score], .score, [data-click-id="upvote"]');
          const score = parseInt(scoreEl?.getAttribute('number') || scoreEl?.textContent || '0') || 0;

          const commentEl = el.querySelector('a[href*="comments"] faceplate-number, [data-click-id="comments"] span');
          const comments = parseInt(commentEl?.textContent || '0') || 0;

          // Get link
          const linkEl = el.querySelector('a[data-click-id="body"], a[href*="/comments/"]');
          const href = linkEl?.href || '';

          // Get post ID from URL
          const match = href.match(/\/comments\/([a-z0-9]+)\//i);
          const postId = match ? match[1] : '';

          if (title && postId) {
            results.push({ title, score, comments, url: href, postId });
          }
        });
        return results;
      });

      console.log(`Found ${posts.length} posts via browser`);
    }

    // Fallback to JSON if browser extraction fails or got too few posts
    if (posts.length < 3 || usedFallback) {
      console.log(`Using JSON API fallback for r/${sub}`);
      const jsonPosts = await getSubredditPostsViaJson(sub);
      posts = jsonPosts.map(p => ({
        title: p.title,
        score: p.score || 0,
        comments: p.num_comments || 0,
        url: `https://www.reddit.com${p.permalink}`,
        postId: p.id,
        selftext: p.selftext || '',
        is_self: p.is_self,
        stickied: p.stickied,
        upvote_ratio: p.upvote_ratio,
      }));
      usedFallback = true;
    }

    console.log(`Total posts available: ${posts.length}`);

    // Filter out stickied, low-score, non-text posts
    const filtered = posts.filter(p => !p.stickied && p.score >= 2 && p.title);
    console.log(`After filtering: ${filtered.length} posts`);

    // For browser mode, get selftext for top posts by visiting them
    const postsToDetail = filtered.slice(0, 20);

    // Analyze for pain points
    const painPoints = [];

    for (const post of postsToDetail) {
      let body = post.selftext || '';

      // If browser mode and no body, optionally fetch post detail
      if (!usedFallback && !body && post.comments >= 10 && painPoints.length < 8) {
        try {
          await page.goto(post.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await sleep(2000);
          body = await page.evaluate(() => {
            const bodyEl = document.querySelector('[data-click-id="text"] div, .RichTextJSON-root, shreddit-post [slot="text-body"]');
            return bodyEl?.textContent?.trim() || '';
          });
          await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          await sleep(2000);
        } catch (e) {
          console.log(`Could not load post detail: ${e.message}`);
        }
      }

      const fullText = `${post.title} ${body}`.toLowerCase();

      // Pain point detection heuristics
      const isPainPoint = (
        // Seeking solutions / tools
        /is there (an app|a tool|a way|software|something)/i.test(fullText) ||
        /anyone (know|tried|using|recommend)/i.test(fullText) ||
        /what (do you|does everyone|should i|works)/i.test(fullText) ||
        /how (do|can|should) (i|you|we)/i.test(fullText) ||
        /looking for (a|an|something|help|advice|recommendations)/i.test(fullText) ||
        // Frustrations
        /frustrated|struggling|can't sleep|can't figure|doesn't work|nothing works|tried everything/i.test(fullText) ||
        /so hard|so difficult|overwhelming|exhausted|desperate/i.test(fullText) ||
        // Problems that could be solved
        /track(ing)?|manage|organize|reminder|schedule|log(ging)?|monitor/i.test(fullText) ||
        /app|tool|software|program|device|gadget/i.test(fullText) ||
        // Chronic pain / condition management
        /pain|flare|symptoms|trigger|relief|treatment|therapy/i.test(fullText)
      );

      // Exclude clearly non-actionable posts
      const isExcluded = (
        /\[meme\]|\[humor\]|\[celebration\]|\[rant\]/i.test(post.title) ||
        post.score < 2
      );

      if (isPainPoint && !isExcluded && post.title.length > 15) {
        painPoints.push({ post, body, category });
      }
    }

    console.log(`Pain points identified: ${painPoints.length}`);

    // Submit pain points
    let submitted = 0;
    for (const { post, body, category } of painPoints.slice(0, 6)) {
      try {
        // Create pain point
        const ppRes = await apiPost('/api/pain-points', {
          title: post.title.slice(0, 80),
          description: `From r/${sub}: ${(body || post.title).slice(0, 300)}`.slice(0, 400),
          category,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID,
        });

        const ppId = ppRes?.id || ppRes?.data?.id;
        console.log(`Created pain point: ${ppId} — "${post.title.slice(0, 60)}"`);

        if (ppId) {
          // Link source post
          await apiPost('/api/pain-points/posts', {
            painPointId: ppId,
            redditPostId: post.postId,
            redditUrl: post.url,
            postTitle: post.title,
            postBody: (body || '').slice(0, 2000),
            upvotes: post.score,
            commentCount: post.comments,
            subreddit: `r/${sub}`,
            discoveredBy: AGENT_ID,
          });
          submitted++;
        }

        await sleep(500);
      } catch (e) {
        console.log(`Error submitting pain point: ${e.message}`);
      }
    }

    // Log scan results
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned: postsToDetail.length,
      painPointsFound: submitted,
      status: 'completed',
    });

    console.log(`r/${sub} done. Submitted ${submitted} pain points.`);
    return { sub, postsScanned: postsToDetail.length, painPointsFound: submitted, painPointTitles: painPoints.map(p => p.post.title.slice(0, 70)) };

  } catch (err) {
    console.error(`Error scanning r/${sub}:`, err.message);

    // Log error
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned: 0,
      painPointsFound: 0,
      status: 'error',
      error: err.message,
    }).catch(() => {});

    return { sub, postsScanned: 0, painPointsFound: 0, error: err.message };
  }
}

async function main() {
  console.log('Connecting to AdsPower browser via CDP...');
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected!');
  } catch (e) {
    console.error('Failed to connect via CDP:', e.message);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  if (!context) {
    console.error('No browser context found');
    process.exit(1);
  }

  // Get/create a page
  const pages = context.pages();
  for (let i = 1; i < pages.length; i++) {
    await pages[i].close().catch(() => {});
  }
  const page = pages[0] || await context.newPage();

  const results = [];
  for (const sub of SUBREDDITS) {
    const result = await scanSubreddit(page, sub);
    results.push(result);
    // Pause between subreddits
    if (sub !== SUBREDDITS[SUBREDDITS.length - 1]) {
      console.log('Waiting 5s before next subreddit...');
      await sleep(5000);
    }
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log(JSON.stringify(results, null, 2));

  const totalPosts = results.reduce((a, r) => a + (r.postsScanned || 0), 0);
  const totalPP = results.reduce((a, r) => a + (r.painPointsFound || 0), 0);
  console.log(`\nSummary: ${results.length} subreddits, ${totalPosts} posts scanned, ${totalPP} pain points submitted`);

  // Don't close the browser — admin handles that
  process.exit(0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
