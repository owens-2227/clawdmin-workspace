const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:50498/devtools/browser/9abeec99-0f02-4d55-ae84-6ed98aeb483f';
const AGENT_ID = 'raj-s';
const SUBREDDITS = ['AnalogCommunity', 'streetphotography', 'MechanicalKeyboards', 'photocritique'];
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchRedditJSON(sub) {
  const url = `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchPostComments(sub, postId) {
  const url = `https://www.reddit.com/r/${sub}/comments/${postId}.json?limit=10&raw_json=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
  });
  if (!res.ok) return null;
  return res.json();
}

function analyzePainPoints(posts, sub) {
  const painPoints = [];
  const painKeywords = [
    'frustrat', 'annoy', 'wish', 'hard to', 'difficult', 'struggle', 'problem',
    'issue', 'help', 'how do i', 'how do you', 'any app', 'any tool', 'any software',
    'any way to', 'is there a', 'does anyone', 'overwhelm', 'confus', 'expensiv',
    'too complicat', 'manually', 'tedious', 'time-consuming', 'organize', 'track',
    'workflow', 'recommend', 'alternative', 'better way', 'need help', 'can\'t figure',
    'anyone know', 'best way', 'looking for'
  ];

  for (const post of posts) {
    const d = post.data;
    if (!d || d.stickied || d.score < 5) continue;
    if (!d.title) continue;
    
    const titleLower = d.title.toLowerCase();
    const bodyLower = (d.selftext || '').toLowerCase();
    const combined = titleLower + ' ' + bodyLower;
    
    // Check if it matches pain point keywords
    const matchCount = painKeywords.filter(kw => combined.includes(kw)).length;
    if (matchCount < 1) continue;
    
    // Skip pure image/link posts with no body if title isn't a question/frustration
    if (!d.selftext && !titleLower.includes('?') && !titleLower.includes('how') && 
        !titleLower.includes('help') && !titleLower.includes('best') && 
        !titleLower.includes('recommend') && matchCount < 2) continue;

    painPoints.push({
      post: d,
      matchCount
    });
  }

  // Sort by match count + upvotes
  painPoints.sort((a, b) => (b.matchCount * 10 + b.post.score) - (a.matchCount * 10 + a.post.score));
  
  return painPoints.slice(0, 5); // Top 5 per subreddit
}

function buildPainPointTitle(postTitle, sub) {
  // Trim to 80 chars
  let title = postTitle.trim();
  if (title.length > 80) title = title.substring(0, 77) + '...';
  return title;
}

function buildDescription(post, comments) {
  let desc = '';
  if (post.selftext && post.selftext.length > 20) {
    desc = post.selftext.substring(0, 300).trim();
  } else {
    desc = post.title;
  }
  // Add top comment context if available
  if (comments && comments[1] && comments[1].data && comments[1].data.children) {
    const topComment = comments[1].data.children.find(c => c.data && c.data.body && c.data.body.length > 20);
    if (topComment) {
      desc += ` Top community response: "${topComment.data.body.substring(0, 200).trim()}"`;
    }
  }
  return desc.substring(0, 500);
}

function getCategory(sub) {
  const map = {
    'AnalogCommunity': 'Photography',
    'streetphotography': 'Photography',
    'photocritique': 'Photography',
    'MechanicalKeyboards': 'Mechanical Keyboards'
  };
  return map[sub] || 'Photography';
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  let posts = [];
  let usedFallback = false;

  // Try browser first
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

    // Try to extract posts from page
    const pageContent = await page.content();
    
    // Check if we got meaningful content
    if (pageContent.includes('reddit') && pageContent.length > 5000) {
      console.log(`Browser loaded r/${sub}, page length: ${pageContent.length}`);
    }
  } catch (err) {
    console.log(`Browser navigation issue for r/${sub}: ${err.message}`);
  }

  // Use JSON API (more reliable for parsing)
  try {
    console.log(`Fetching r/${sub} JSON...`);
    const data = await fetchRedditJSON(sub);
    if (data && data.data && data.data.children) {
      posts = data.data.children;
      console.log(`Got ${posts.length} posts via JSON API`);
      usedFallback = true;
    }
  } catch (err) {
    console.log(`JSON API failed for r/${sub}: ${err.message}`);
  }

  if (posts.length === 0) {
    console.log(`No posts found for r/${sub}`);
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned: 0,
      painPointsFound: 0,
      status: 'error'
    });
    return 0;
  }

  // Analyze pain points
  const candidates = analyzePainPoints(posts, sub);
  console.log(`Found ${candidates.length} pain point candidates in r/${sub}`);

  let submitted = 0;
  for (const candidate of candidates) {
    const p = candidate.post;
    
    // Fetch comments for top candidates
    let comments = null;
    if (p.num_comments > 5) {
      try {
        await sleep(2000);
        comments = await fetchPostComments(sub, p.id);
      } catch (e) {
        console.log(`Could not fetch comments for ${p.id}`);
      }
    }

    const title = buildPainPointTitle(p.title, sub);
    const description = buildDescription(p, comments);
    const category = getCategory(sub);
    const redditUrl = `https://reddit.com/r/${sub}/comments/${p.id}/`;

    console.log(`Submitting: "${title}"`);

    try {
      // Create pain point
      const ppRes = await apiPost('/api/pain-points', {
        title,
        description,
        category,
        subreddit: `r/${sub}`,
        discoveredBy: AGENT_ID
      });

      console.log(`Pain point created:`, JSON.stringify(ppRes).substring(0, 200));

      if (ppRes && ppRes.id) {
        // Link source post
        await apiPost('/api/pain-points/posts', {
          painPointId: ppRes.id,
          redditPostId: p.id,
          redditUrl,
          postTitle: p.title,
          postBody: (p.selftext || '').substring(0, 2000),
          upvotes: p.score,
          commentCount: p.num_comments,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID
        });
        submitted++;
      }
    } catch (err) {
      console.log(`Error submitting pain point: ${err.message}`);
    }

    await sleep(1000);
  }

  // Log scan results
  const logRes = await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${sub}`,
    postsScanned: posts.length,
    painPointsFound: submitted,
    status: 'completed'
  });
  console.log(`Scan log for r/${sub}:`, JSON.stringify(logRes).substring(0, 200));

  return submitted;
}

async function main() {
  console.log('Connecting to AdsPower CDP...');
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected!');
  } catch (err) {
    console.error('CDP connection failed:', err.message);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const pages = context.pages();
  
  // Close extra tabs
  for (let i = 1; i < pages.length; i++) {
    try { await pages[i].close(); } catch {}
  }
  
  const page = pages[0] || await context.newPage();
  
  let totalSubmitted = 0;
  const results = [];

  for (const sub of SUBREDDITS) {
    try {
      const count = await scanSubreddit(page, sub);
      totalSubmitted += count;
      results.push({ sub, count, status: 'ok' });
    } catch (err) {
      console.error(`Error scanning r/${sub}:`, err.message);
      results.push({ sub, count: 0, status: 'error', error: err.message });
    }
    
    // Pace between subreddits
    await sleep(3000);
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${SUBREDDITS.length}`);
  console.log(`Total pain points submitted: ${totalSubmitted}`);
  for (const r of results) {
    console.log(`  r/${r.sub}: ${r.count} pain points (${r.status})`);
  }

  // Don't close browser — admin handles that
  await browser.close(); // Just disconnect, not stop
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
