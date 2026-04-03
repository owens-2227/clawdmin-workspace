/**
 * Reddit Pain Point Scanner — owen-b
 * Subreddits: ADHD, languagelearning, remotework, productivity
 */

const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

const CDP_URL = 'ws://127.0.0.1:60379/devtools/browser/83183e6d-b09c-41d1-8663-c0b2b7163800';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const AGENT_ID = 'owen-b';

const SUBREDDITS = [
  { name: 'ADHD', category: 'ADHD & Neurodivergent' },
  { name: 'languagelearning', category: 'Language Learning' },
  { name: 'remotework', category: 'Remote Work' },
  { name: 'productivity', category: 'Productivity' },
];

function apiPost(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const url = new URL(API_BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-api-key': API_KEY,
      },
    };
    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function scanSubreddit(page, sub, category) {
  console.log(`\n=== Scanning r/${sub} ===`);
  const posts = [];

  // Try browser first
  try {
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, {
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

    // Extract posts from new Reddit (shreddit) UI
    const extractedPosts = await page.evaluate(() => {
      const results = [];

      // Try new shreddit post elements
      const articleEls = document.querySelectorAll('article, [data-testid="post-container"], shreddit-post');
      articleEls.forEach((el) => {
        try {
          const titleEl = el.querySelector('h1, h2, h3, [slot="title"], a[data-click-id="body"]');
          const title = titleEl ? titleEl.textContent.trim() : '';
          if (!title) return;

          const linkEl = el.querySelector('a[href*="/comments/"]');
          const url = linkEl ? linkEl.href : '';

          const scoreEl = el.querySelector('[id*="vote-arrows"] faceplate-number, [data-click-id="upvote"] ~ *, .score, shreddit-post');
          let score = 0;
          if (scoreEl) {
            const scoreText = scoreEl.textContent.trim().replace(/[^0-9kKmM.]/g, '');
            if (scoreText.endsWith('k') || scoreText.endsWith('K')) {
              score = parseFloat(scoreText) * 1000;
            } else {
              score = parseInt(scoreText) || 0;
            }
          }

          // Try to get score from shreddit-post attributes
          const shredditPost = el.tagName === 'SHREDDIT-POST' ? el : el.querySelector('shreddit-post');
          if (shredditPost) {
            const scoreAttr = shredditPost.getAttribute('score');
            if (scoreAttr) score = parseInt(scoreAttr) || score;
          }

          const commentEls = el.querySelectorAll('a[href*="comments"]');
          let commentCount = 0;
          commentEls.forEach(ce => {
            const text = ce.textContent.trim();
            const match = text.match(/(\d+)/);
            if (match) commentCount = Math.max(commentCount, parseInt(match[1]));
          });

          const postId = url.match(/\/comments\/([a-z0-9]+)\//)?.[1] || '';

          if (title.length > 10) {
            results.push({ title, url, score, commentCount, postId });
          }
        } catch (e) {}
      });

      // Fallback: grab all comment links
      if (results.length === 0) {
        const links = document.querySelectorAll('a[href*="/comments/"]');
        const seen = new Set();
        links.forEach(link => {
          const href = link.href;
          const match = href.match(/\/comments\/([a-z0-9]+)\//);
          if (!match || seen.has(match[1])) return;
          seen.add(match[1]);
          const title = link.textContent.trim() || link.getAttribute('aria-label') || '';
          if (title.length > 10) {
            results.push({ title, url: href, score: 0, commentCount: 0, postId: match[1] });
          }
        });
      }

      return results;
    });

    console.log(`Browser extracted ${extractedPosts.length} posts from r/${sub}`);
    posts.push(...extractedPosts.slice(0, 30));
  } catch (err) {
    console.log(`Browser navigation failed for r/${sub}: ${err.message}`);
  }

  // If we got few posts from browser, supplement with JSON API
  if (posts.length < 5) {
    console.log(`Falling back to JSON API for r/${sub}`);
    try {
      const jsonPosts = await page.evaluate(async (sub) => {
        const resp = await fetch(`https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
        });
        const data = await resp.json();
        return data.data.children.map(c => ({
          title: c.data.title,
          url: `https://reddit.com${c.data.permalink}`,
          score: c.data.score,
          commentCount: c.data.num_comments,
          postId: c.data.id,
          selftext: (c.data.selftext || '').slice(0, 2000),
          stickied: c.data.stickied,
        }));
      }, sub);

      const filtered = jsonPosts.filter(p => !p.stickied && p.score >= 5);
      console.log(`JSON API returned ${filtered.length} posts`);
      // Merge, avoiding duplicates
      const existingIds = new Set(posts.map(p => p.postId));
      filtered.forEach(p => { if (!existingIds.has(p.postId)) posts.push(p); });
    } catch (err) {
      console.log(`JSON API fallback failed: ${err.message}`);
    }
  }

  // Also use JSON API to get selftexts for posts we don't have
  if (posts.length > 0 && !posts[0].selftext) {
    console.log(`Fetching post details via JSON API for r/${sub}...`);
    try {
      const jsonPosts = await page.evaluate(async (sub) => {
        const resp = await fetch(`https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
        });
        const data = await resp.json();
        return data.data.children.map(c => ({
          postId: c.data.id,
          title: c.data.title,
          selftext: (c.data.selftext || '').slice(0, 2000),
          score: c.data.score,
          commentCount: c.data.num_comments,
          stickied: c.data.stickied,
          url: `https://reddit.com${c.data.permalink}`,
        }));
      }, sub);

      // Merge selftexts
      const jsonMap = {};
      jsonPosts.forEach(p => { jsonMap[p.postId] = p; });
      posts.forEach(p => {
        if (jsonMap[p.postId]) {
          p.selftext = jsonMap[p.postId].selftext;
          if (!p.score && jsonMap[p.postId].score) p.score = jsonMap[p.postId].score;
          if (!p.commentCount && jsonMap[p.postId].commentCount) p.commentCount = jsonMap[p.postId].commentCount;
        }
      });
    } catch (e) {
      console.log(`Could not fetch selftexts: ${e.message}`);
    }
  }

  console.log(`Total posts to analyze for r/${sub}: ${posts.length}`);

  // Analyze for pain points
  const painPoints = [];

  for (const post of posts) {
    if (!post.title || post.title.length < 10) continue;
    if (post.score !== undefined && post.score < 5 && post.score !== 0) continue;

    const title = post.title.toLowerCase();
    const body = (post.selftext || '').toLowerCase();
    const combined = title + ' ' + body;

    // Pain point indicators
    const painIndicators = [
      /is there (an? |a tool |an app |software |a way )/i,
      /how do (you|i|we) (deal with|manage|handle|track|organize|stay|keep)/i,
      /struggling (with|to)/i,
      /can't (figure out|find|seem to|stop|stay|focus|remember|manage)/i,
      /anyone else (have|struggle|deal|experience|use|tried)/i,
      /what('s| is) (your|the best|a good) (system|tool|app|method|way|approach|workflow|setup|routine)/i,
      /looking for (a tool|an app|software|recommendations|advice|help|a way|something)/i,
      /frustrated (by|with|that)/i,
      /hate (how|when|that|the way)/i,
      /wish (there was|i could|i had|it would|you could)/i,
      /problem (with|is|i have)/i,
      /too (complicated|expensive|complex|hard|difficult|slow|overwhelming)/i,
      /doesn't (work|exist|have|support|integrate)/i,
      /no (good|easy|simple|free) way/i,
      /spent (hours|days|weeks|too much time)/i,
      /manually (doing|tracking|entering|copying|managing)/i,
      /help (me|with|finding)/i,
      /advice (on|for|about|needed|wanted)/i,
      /what do you use (for|to)/i,
      /best (app|tool|software|system|way|method|plugin) (for|to)/i,
      /overwhelmed (by|with)/i,
      /keep forgetting/i,
      /hard to (stay|keep|maintain|remember|focus|track)/i,
      /does anyone (know|have|use|recommend)/i,
    ];

    // Exclusion patterns
    const excludePatterns = [
      /^(i did it|i made it|i got|success|achievement|finally|yay|happy|excited|proud)/i,
      /^(meme|joke|humor|funny|lol|😂)/i,
      /birthday|anniversary|milestone|celebration/i,
      /\[weekly\]|\[daily\]|\[monthly\]/i,
    ];

    const hasExclusion = excludePatterns.some(p => p.test(title));
    if (hasExclusion) continue;

    const hasPainIndicator = painIndicators.some(p => p.test(combined));
    const hasQuestion = title.includes('?');
    const isHelp = /\b(help|advice|suggest|recommend|tips|how to)\b/i.test(title);

    if (!hasPainIndicator && !hasQuestion && !isHelp) continue;

    // Generate pain point entry
    let ppTitle = post.title.slice(0, 80);
    let ppDesc = '';

    if (body && body.length > 50) {
      ppDesc = post.selftext.slice(0, 300).trim();
      if (ppDesc.length > 200) ppDesc = ppDesc.slice(0, 200) + '...';
      ppDesc = `${ppDesc} [r/${sub}, ${post.commentCount || 0} comments]`;
    } else {
      ppDesc = `Post from r/${sub} asking: "${post.title.slice(0, 150)}". ${post.commentCount || 0} comments engaged.`;
    }

    painPoints.push({
      title: ppTitle,
      description: ppDesc,
      category,
      subreddit: `r/${sub}`,
      post,
    });
  }

  console.log(`Found ${painPoints.length} pain points in r/${sub}`);

  // Submit pain points
  let submitted = 0;
  for (const pp of painPoints.slice(0, 10)) { // cap at 10 per subreddit
    try {
      const createResp = await apiPost('/api/pain-points', {
        title: pp.title,
        description: pp.description,
        category: pp.category,
        subreddit: pp.subreddit,
        discoveredBy: AGENT_ID,
      });

      console.log(`  Created pain point: ${createResp.status} — ${JSON.stringify(createResp.body).slice(0, 100)}`);

      const ppId = createResp.body?.id || createResp.body?.data?.id;
      if (ppId && pp.post.postId) {
        const linkResp = await apiPost('/api/pain-points/posts', {
          painPointId: ppId,
          redditPostId: pp.post.postId,
          redditUrl: pp.post.url,
          postTitle: pp.post.title,
          postBody: pp.post.selftext || '',
          upvotes: pp.post.score || 0,
          commentCount: pp.post.commentCount || 0,
          subreddit: pp.subreddit,
          discoveredBy: AGENT_ID,
        });
        console.log(`  Linked source post: ${linkResp.status}`);
      }
      submitted++;
      await sleep(500);
    } catch (err) {
      console.log(`  Error submitting pain point: ${err.message}`);
    }
  }

  // Log scan result
  try {
    const logResp = await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned: posts.length,
      painPointsFound: submitted,
      status: 'completed',
    });
    console.log(`Logged scan for r/${sub}: ${logResp.status}`);
  } catch (err) {
    console.log(`Error logging scan: ${err.message}`);
  }

  return { sub, postsScanned: posts.length, painPointsFound: submitted, allPainPoints: painPoints.map(p => p.title) };
}

async function main() {
  console.log('Connecting to AdsPower browser via CDP...');
  const browser = await chromium.connectOverCDP(CDP_URL);
  console.log('Connected!');

  const context = browser.contexts()[0];
  if (!context) {
    console.error('No browser context found!');
    process.exit(1);
  }

  // Get or create a page
  const pages = context.pages();
  for (let i = 1; i < pages.length; i++) {
    try { await pages[i].close(); } catch (e) {}
  }
  const page = pages[0] || await context.newPage();

  const results = [];

  for (const { name, category } of SUBREDDITS) {
    try {
      const result = await scanSubreddit(page, name, category);
      results.push(result);
    } catch (err) {
      console.error(`Error scanning r/${name}: ${err.message}`);
      results.push({ sub: name, postsScanned: 0, painPointsFound: 0, error: err.message });

      // Log as failed
      try {
        await apiPost('/api/pain-points/scan-logs', {
          agentId: AGENT_ID,
          subreddit: `r/${name}`,
          postsScanned: 0,
          painPointsFound: 0,
          status: 'failed',
        });
      } catch (e) {}
    }

    await sleep(3000); // pace between subreddits
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${results.length}`);
  let totalPosts = 0, totalPainPoints = 0;
  for (const r of results) {
    totalPosts += r.postsScanned || 0;
    totalPainPoints += r.painPointsFound || 0;
    console.log(`  r/${r.sub}: ${r.postsScanned} posts, ${r.painPointsFound} pain points${r.error ? ` (ERROR: ${r.error})` : ''}`);
    if (r.allPainPoints && r.allPainPoints.length > 0) {
      r.allPainPoints.forEach(t => console.log(`    - ${t}`));
    }
  }
  console.log(`Total posts analyzed: ${totalPosts}`);
  console.log(`Total pain points submitted: ${totalPainPoints}`);

  // Do NOT close the browser — admin handles that
  await browser.close(); // disconnect only (connectOverCDP close doesn't kill the browser)
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
