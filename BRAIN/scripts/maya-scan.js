const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:57350/devtools/browser/3710a2c0-bdcb-46a4-a52a-4c012180f046';
const AGENT_ID = 'maya-chen';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const SUBREDDITS = ['personalfinance', 'cooking', 'solotravel', 'frugal'];

const CATEGORY_MAP = {
  personalfinance: 'Personal Finance',
  frugal: 'Personal Finance',
  cooking: 'Cooking',
  solotravel: 'Solo Travel',
};

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

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

async function fetchRedditJSON(sub) {
  try {
    const res = await fetch(
      `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' } }
    );
    const json = await res.json();
    return json.data?.children?.map(c => c.data) || [];
  } catch (e) {
    console.error(`JSON fallback failed for ${sub}:`, e.message);
    return [];
  }
}

function isPainPoint(post) {
  const text = (post.title + ' ' + (post.selftext || '')).toLowerCase();
  const painKeywords = [
    'how do i', 'how to', 'is there an app', 'is there a tool', 'is there a way',
    'frustrated', 'frustrating', 'annoying', 'struggle', 'struggling', 'problem',
    'manually', 'spreadsheet', 'track', 'tracking', 'organize', 'managing',
    'complicated', 'expensive', 'too much', 'wish there was', 'need help',
    'overwhelmed', 'confusing', 'confused', 'automate', 'automation',
    'anyone else', 'does anyone', 'best way to', 'better way',
  ];
  return painKeywords.some(kw => text.includes(kw));
}

function extractPainPoint(post, sub) {
  const title = post.title.slice(0, 80);
  const body = (post.selftext || '').slice(0, 2000);
  const fullText = post.title + ' ' + body;
  
  // Generate a concise description
  let description = '';
  if (body.length > 50) {
    description = body.slice(0, 300).replace(/\n+/g, ' ').trim();
  } else {
    description = post.title;
  }
  if (description.length > 250) {
    description = description.slice(0, 250) + '...';
  }

  return {
    title,
    description: `${description} (${post.ups} upvotes, ${post.num_comments} comments)`,
    category: CATEGORY_MAP[sub] || 'General',
    subreddit: `r/${sub}`,
    discoveredBy: AGENT_ID,
    postId: post.id,
    postUrl: `https://reddit.com${post.permalink}`,
    postTitle: post.title,
    postBody: body,
    upvotes: post.ups,
    commentCount: post.num_comments,
  };
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  const postsScanned = [];
  const painPoints = [];

  // Try browser-based scan first
  let posts = [];
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

    // Check for CAPTCHA or login wall
    const url = page.url();
    const content = await page.content();
    if (content.includes('recaptcha') || url.includes('login') || url.includes('captcha')) {
      console.log(`CAPTCHA/login wall detected on r/${sub}, using JSON fallback`);
      posts = await fetchRedditJSON(sub);
    } else {
      // Try to get post data from page
      posts = await page.evaluate(() => {
        const postEls = document.querySelectorAll('shreddit-post, [data-testid="post-container"], article');
        const results = [];
        postEls.forEach(el => {
          const titleEl = el.querySelector('h1, h2, h3, [slot="title"], a[href*="/comments/"]');
          const title = titleEl?.textContent?.trim();
          if (!title) return;
          
          const href = titleEl?.getAttribute('href') || el.querySelector('a[href*="/comments/"]')?.getAttribute('href') || '';
          const idMatch = href.match(/\/comments\/([a-z0-9]+)\//);
          const id = idMatch?.[1] || '';
          
          const scoreEl = el.querySelector('[data-score], faceplate-number, [aria-label*="upvote"], .score');
          const score = parseInt(scoreEl?.textContent?.replace(/[^0-9]/g, '') || '0') || 0;
          
          const commentEl = el.querySelector('a[href*="comments"]');
          const commentText = commentEl?.textContent || '0';
          const comments = parseInt(commentText.replace(/[^0-9]/g, '') || '0') || 0;
          
          const selftext = el.querySelector('p, [slot="text-body"]')?.textContent?.trim() || '';
          
          if (id) {
            results.push({ id, title, ups: score, num_comments: comments, selftext, permalink: href });
          }
        });
        return results;
      });
      
      console.log(`Browser scrape got ${posts.length} posts from r/${sub}`);
      
      if (posts.length < 3) {
        console.log(`Too few posts from browser, using JSON fallback`);
        posts = await fetchRedditJSON(sub);
      }
    }
  } catch (e) {
    console.error(`Browser error for r/${sub}: ${e.message}, trying JSON fallback`);
    posts = await fetchRedditJSON(sub);
  }

  console.log(`Total posts fetched for r/${sub}: ${posts.length}`);

  // Filter and analyze posts
  for (const post of posts) {
    if (!post.title) continue;
    if (post.stickied) continue;
    if ((post.ups || 0) < 5) continue;
    
    postsScanned.push(post);
    
    if (isPainPoint(post)) {
      const pp = extractPainPoint(post, sub);
      painPoints.push(pp);
      console.log(`  PAIN POINT: ${pp.title}`);
    }
  }

  console.log(`  Posts scanned: ${postsScanned.length}, Pain points: ${painPoints.length}`);

  // Submit pain points
  for (const pp of painPoints) {
    try {
      const created = await apiPost('/api/pain-points', {
        title: pp.title,
        description: pp.description,
        category: pp.category,
        subreddit: pp.subreddit,
        discoveredBy: pp.discoveredBy,
      });
      console.log(`  Submitted pain point: ${pp.title}, id=${created.id}`);

      if (created.id) {
        await apiPost('/api/pain-points/posts', {
          painPointId: created.id,
          redditPostId: pp.postId,
          redditUrl: pp.postUrl,
          postTitle: pp.postTitle,
          postBody: pp.postBody,
          upvotes: pp.upvotes,
          commentCount: pp.commentCount,
          subreddit: pp.subreddit,
          discoveredBy: pp.discoveredBy,
        });
        console.log(`  Linked source post for id=${created.id}`);
      }
    } catch (e) {
      console.error(`  Error submitting pain point: ${e.message}`);
    }
    await sleep(500);
  }

  // Log scan results
  try {
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned: postsScanned.length,
      painPointsFound: painPoints.length,
      status: 'completed',
    });
    console.log(`  Scan log submitted for r/${sub}`);
  } catch (e) {
    console.error(`  Error submitting scan log: ${e.message}`);
  }

  return { sub, postsScanned: postsScanned.length, painPoints: painPoints.map(p => p.title) };
}

async function main() {
  console.log('Connecting to AdsPower via CDP...');
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected!');
  } catch (e) {
    console.error('Failed to connect via CDP:', e.message);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const pages = context.pages();
  
  // Close extra tabs
  for (let i = 1; i < pages.length; i++) {
    await pages[i].close();
  }
  const page = pages[0] || await context.newPage();

  const results = [];
  for (const sub of SUBREDDITS) {
    const result = await scanSubreddit(page, sub);
    results.push(result);
    await sleep(3000); // Pause between subreddits
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${results.length}`);
  const totalPosts = results.reduce((s, r) => s + r.postsScanned, 0);
  const totalPainPoints = results.reduce((s, r) => s + r.painPoints.length, 0);
  console.log(`Total posts analyzed: ${totalPosts}`);
  console.log(`Total pain points discovered: ${totalPainPoints}`);
  for (const r of results) {
    console.log(`\nr/${r.sub}: ${r.postsScanned} posts, ${r.painPoints.length} pain points`);
    r.painPoints.forEach(pp => console.log(`  - ${pp}`));
  }

  // Do NOT disconnect/close browser — admin handles that
  console.log('\nDone. Browser left open for admin to close.');
  process.exit(0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
