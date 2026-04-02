const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:54019/devtools/browser/25506a8c-77db-4e19-a265-c8575b9c6270';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const AGENT_ID = 'dave-r';
const SUBREDDITS = ['HomeImprovement', 'DIY', 'woodworking', 'smoking'];

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function apiPost(path, data) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY
    },
    body: JSON.stringify(data)
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch(e) {
    return { raw: text };
  }
}

async function submitPainPoint(pp) {
  console.log(`\n  📌 Submitting pain point: ${pp.title}`);
  const result = await apiPost('/api/pain-points', {
    title: pp.title,
    description: pp.description,
    category: pp.category,
    subreddit: pp.subreddit,
    discoveredBy: AGENT_ID
  });
  console.log(`  → ID: ${result.id || JSON.stringify(result)}`);
  
  if (result.id && pp.post) {
    const linkResult = await apiPost('/api/pain-points/posts', {
      painPointId: result.id,
      redditPostId: pp.post.id,
      redditUrl: pp.post.url,
      postTitle: pp.post.title,
      postBody: (pp.post.body || '').slice(0, 2000),
      upvotes: pp.post.upvotes,
      commentCount: pp.post.commentCount,
      subreddit: pp.subreddit,
      discoveredBy: AGENT_ID
    });
    console.log(`  → Linked post: ${linkResult.id || JSON.stringify(linkResult)}`);
  }
  return result;
}

async function logScanResult(subreddit, postsScanned, painPointsFound, status = 'completed') {
  const result = await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned,
    painPointsFound,
    status
  });
  console.log(`  → Scan log: ${JSON.stringify(result)}`);
}

async function fetchSubredditJSON(subreddit) {
  const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=25&raw_json=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function scanWithBrowser(page, subreddit) {
  console.log(`\n🔍 Scanning r/${subreddit} via browser...`);
  
  try {
    await page.goto(`https://www.reddit.com/r/${subreddit}/hot/`, { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000 
    });
    await sleep(3000);

    // Scroll to load posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    // Take snapshot and get post data
    const posts = await page.evaluate(() => {
      const results = [];
      
      // Try shreddit-post elements (new Reddit)
      const shredditPosts = document.querySelectorAll('shreddit-post');
      if (shredditPosts.length > 0) {
        shredditPosts.forEach(el => {
          const title = el.getAttribute('post-title') || el.querySelector('[slot="title"]')?.textContent?.trim();
          const score = parseInt(el.getAttribute('score') || '0');
          const commentCount = parseInt(el.getAttribute('comment-count') || '0');
          const permalink = el.getAttribute('permalink') || '';
          const id = el.getAttribute('id') || permalink.split('/')[6] || '';
          const bodyEl = el.querySelector('[slot="text-body"]');
          const body = bodyEl ? bodyEl.textContent?.trim() : '';
          
          if (title) {
            results.push({ title, score, commentCount, id, permalink, body });
          }
        });
      }
      
      // Fallback: try article elements
      if (results.length === 0) {
        const articles = document.querySelectorAll('article');
        articles.forEach(el => {
          const titleEl = el.querySelector('h1, h2, h3, [data-click-id="text"]');
          const title = titleEl?.textContent?.trim();
          const scoreEl = el.querySelector('[id*="vote-arrows"]');
          const score = parseInt(scoreEl?.textContent || '0');
          const href = el.querySelector('a[href*="/comments/"]')?.getAttribute('href') || '';
          if (title) {
            results.push({ title, score, commentCount: 0, id: '', permalink: href, body: '' });
          }
        });
      }
      
      return results;
    });

    console.log(`  Found ${posts.length} posts via browser`);
    return posts;
  } catch (err) {
    console.log(`  Browser scan failed: ${err.message}, trying JSON fallback...`);
    return null;
  }
}

async function scanSubreddit(page, subreddit) {
  let posts = [];
  
  // Try browser first
  const browserPosts = await scanWithBrowser(page, subreddit);
  
  if (browserPosts && browserPosts.length > 5) {
    posts = browserPosts;
  } else {
    // JSON fallback
    console.log(`  Using JSON API fallback for r/${subreddit}...`);
    try {
      const json = await fetchSubredditJSON(subreddit);
      posts = json.data.children
        .filter(c => !c.data.stickied && c.data.score >= 5)
        .map(c => ({
          title: c.data.title,
          score: c.data.score,
          commentCount: c.data.num_comments,
          id: c.data.id,
          permalink: c.data.permalink,
          body: c.data.selftext || ''
        }));
      console.log(`  Found ${posts.length} posts via JSON API`);
    } catch (err) {
      console.log(`  JSON API also failed: ${err.message}`);
      await logScanResult(subreddit, 0, 0, 'error');
      return { postsScanned: 0, painPointsFound: 0 };
    }
  }

  // Filter and analyze posts
  const validPosts = posts.filter(p => p.score >= 5);
  console.log(`  Analyzing ${validPosts.length} posts for pain points...`);

  const painPoints = analyzePainPoints(validPosts, subreddit);
  console.log(`  Found ${painPoints.length} pain points`);

  // Submit pain points
  for (const pp of painPoints) {
    try {
      await submitPainPoint(pp);
      await sleep(500);
    } catch (err) {
      console.log(`  Error submitting: ${err.message}`);
    }
  }

  // Log scan result
  await logScanResult(subreddit, validPosts.length, painPoints.length, 'completed');

  return { postsScanned: validPosts.length, painPointsFound: painPoints.length };
}

function analyzePainPoints(posts, subreddit) {
  const category = subreddit === 'smoking' ? 'BBQ & Grilling' : 'Home & DIY';
  const painPoints = [];

  // Keywords that indicate pain points
  const painKeywords = [
    'how do i', 'how to', 'struggling', 'frustrated', 'annoyed', 'problem',
    'issue', 'help', 'advice', 'best way', 'anyone else', 'is there an app',
    'is there a tool', 'need help', 'confused', 'expensive', 'complicated',
    'takes forever', 'waste of time', 'wish there was', 'looking for',
    'recommendation', 'what do you use', 'alternatives', 'can\'t figure out',
    'keep making mistakes', 'keeps failing', 'not working', 'won\'t work',
    'dealing with', 'sick of', 'hate', 'difficult', 'hard to', 'impossible to'
  ];

  for (const post of posts) {
    const titleLower = post.title.toLowerCase();
    const bodyLower = (post.body || '').toLowerCase();
    const combinedText = titleLower + ' ' + bodyLower;

    // Skip non-pain-point content
    if (
      titleLower.includes('check out') ||
      titleLower.includes('look what') ||
      titleLower.includes('finished') ||
      titleLower.includes('finally done') ||
      titleLower.includes('just completed') ||
      titleLower.includes('showing off') ||
      titleLower.includes('[rate my') ||
      (post.score > 500 && post.commentCount < 10) // likely pure showoff post
    ) {
      continue;
    }

    const hasPainKeyword = painKeywords.some(kw => combinedText.includes(kw));
    
    if (!hasPainKeyword && post.commentCount < 20) continue;
    if (post.score < 5) continue;

    // Generate a pain point from this post
    const pp = generatePainPoint(post, subreddit, category);
    if (pp) painPoints.push(pp);

    if (painPoints.length >= 5) break; // Cap at 5 per subreddit
  }

  return painPoints;
}

function generatePainPoint(post, subreddit, category) {
  const title = post.title;
  const body = post.body || '';
  const titleLower = title.toLowerCase();

  // Derive a clean pain point title (max 80 chars)
  let ppTitle = title.length > 80 ? title.slice(0, 77) + '...' : title;
  
  // Build description
  let description = `User in r/${subreddit} posted: "${title}".`;
  if (body && body.length > 50) {
    description += ` Context: ${body.slice(0, 150).trim()}`;
    if (body.length > 150) description += '...';
  }
  description += ` Post had ${post.score} upvotes and ${post.commentCount} comments, indicating community resonance.`;

  // Ensure description is 2-3 sentences max
  description = description.slice(0, 400);

  const postId = post.id || '';
  const permalink = post.permalink || `/r/${subreddit}/comments/${postId}/`;
  const fullUrl = permalink.startsWith('http') ? permalink : `https://reddit.com${permalink}`;

  return {
    title: ppTitle,
    description,
    category,
    subreddit: `r/${subreddit}`,
    post: {
      id: postId,
      url: fullUrl,
      title: post.title,
      body: body,
      upvotes: post.score,
      commentCount: post.commentCount
    }
  };
}

async function main() {
  console.log('🚀 Dave-R scanner starting...');
  console.log(`CDP: ${CDP_URL}`);
  
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('✅ Connected to AdsPower browser');
  } catch (err) {
    console.error(`❌ Failed to connect: ${err.message}`);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  if (!context) {
    console.error('❌ No browser context available');
    process.exit(1);
  }

  // Close extra tabs, keep one
  const pages = context.pages();
  for (let i = 1; i < pages.length; i++) {
    try { await pages[i].close(); } catch(e) {}
  }
  const page = pages[0] || await context.newPage();

  const summary = {
    totalPosts: 0,
    totalPainPoints: 0,
    subreddits: []
  };

  for (const subreddit of SUBREDDITS) {
    try {
      const result = await scanSubreddit(page, subreddit);
      summary.totalPosts += result.postsScanned;
      summary.totalPainPoints += result.painPointsFound;
      summary.subreddits.push({ subreddit, ...result });
      
      // Pace between subreddits
      await sleep(3000);
    } catch (err) {
      console.error(`❌ Error scanning r/${subreddit}: ${err.message}`);
      await logScanResult(subreddit, 0, 0, 'error');
      summary.subreddits.push({ subreddit, postsScanned: 0, painPointsFound: 0, error: err.message });
    }
  }

  console.log('\n\n📊 SCAN SUMMARY');
  console.log('================');
  console.log(`Agent: ${AGENT_ID}`);
  console.log(`Subreddits: ${SUBREDDITS.join(', ')}`);
  console.log(`Total posts analyzed: ${summary.totalPosts}`);
  console.log(`Total pain points found: ${summary.totalPainPoints}`);
  console.log('\nPer subreddit:');
  for (const s of summary.subreddits) {
    console.log(`  r/${s.subreddit}: ${s.postsScanned} posts, ${s.painPointsFound} pain points${s.error ? ` (ERROR: ${s.error})` : ''}`);
  }

  // Disconnect (don't close — admin handles that)
  await browser.close();
  console.log('\n✅ Scan complete.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
