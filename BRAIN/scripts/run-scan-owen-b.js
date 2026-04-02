const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:49707/devtools/browser/cb2ef1b1-f96c-401e-9136-136ff58b384e';
const AGENT_ID = 'owen-b';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const SUBREDDITS = ['ADHD', 'languagelearning', 'remotework', 'productivity'];

const CATEGORY_MAP = {
  'ADHD': 'ADHD & Neurodivergent',
  'languagelearning': 'Language Learning',
  'remotework': 'Remote Work',
  'productivity': 'Productivity',
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

async function fetchRedditJSON(sub) {
  const url = `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
  });
  return res.json();
}

async function scanSubredditViaBrowser(page, sub) {
  console.log(`\n=== Scanning r/${sub} via browser ===`);
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

    // Try to extract posts from the page
    const rawPosts = await page.evaluate(() => {
      const results = [];
      
      // New Reddit (shreddit) selectors
      const postElements = document.querySelectorAll('shreddit-post, [data-testid="post-container"], article');
      
      postElements.forEach(el => {
        try {
          // shreddit-post attributes
          const title = el.getAttribute('post-title') || el.querySelector('h1, h2, h3, [slot="title"], a[data-click-id="body"]')?.textContent?.trim();
          const score = parseInt(el.getAttribute('score') || el.querySelector('[id*="vote-arrows"] faceplate-number')?.getAttribute('number') || '0');
          const commentCount = parseInt(el.getAttribute('comment-count') || '0');
          const permalink = el.getAttribute('permalink') || el.querySelector('a[data-click-id="body"]')?.getAttribute('href');
          const postId = el.getAttribute('id') || el.getAttribute('thingid') || '';
          
          if (title && title.length > 5) {
            results.push({ title, score, commentCount, permalink, postId });
          }
        } catch (e) {}
      });
      
      return results;
    });

    console.log(`Found ${rawPosts.length} posts via browser DOM`);
    
    if (rawPosts.length < 3) {
      console.log('Browser extraction sparse, falling back to JSON API...');
      return null; // Signal fallback needed
    }
    
    for (const p of rawPosts) {
      posts.push({
        title: p.title,
        score: p.score || 0,
        commentCount: p.commentCount || 0,
        url: p.permalink ? `https://reddit.com${p.permalink}` : '',
        id: p.postId || p.permalink?.split('/')[6] || '',
        body: '',
      });
    }
    
    // For promising posts, click in to get body + comments
    const promising = posts.filter(p => p.commentCount >= 10 && p.score >= 5).slice(0, 5);
    for (const post of promising) {
      if (!post.url) continue;
      try {
        await sleep(2000);
        await page.goto(post.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await sleep(2000);
        
        const body = await page.evaluate(() => {
          const el = document.querySelector('[data-testid="post-content"] .md, shreddit-post [slot="text-body"], .post-rtjson-content, [data-click-id="text"]');
          return el?.textContent?.trim().slice(0, 2000) || '';
        });
        post.body = body;
        
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 });
        await sleep(2000);
      } catch (e) {
        console.log(`Failed to get body for post: ${post.title?.slice(0, 50)}: ${e.message}`);
      }
    }
    
    return posts;
  } catch (e) {
    console.log(`Browser scan error for r/${sub}: ${e.message}`);
    return null;
  }
}

async function scanSubredditViaJSON(sub) {
  console.log(`Scanning r/${sub} via JSON API fallback...`);
  try {
    const data = await fetchRedditJSON(sub);
    const children = data?.data?.children || [];
    
    return children
      .filter(c => !c.data.stickied && c.data.score >= 5)
      .map(c => ({
        title: c.data.title,
        score: c.data.score,
        commentCount: c.data.num_comments,
        url: `https://reddit.com${c.data.permalink}`,
        id: c.data.id,
        body: (c.data.selftext || '').slice(0, 2000),
      }));
  } catch (e) {
    console.log(`JSON API error for r/${sub}: ${e.message}`);
    return [];
  }
}

function analyzePainPoints(posts, sub) {
  const painKeywords = [
    'how do i', 'is there an app', 'is there a tool', 'any tool', 'any app',
    'frustrated', 'annoying', 'struggling', 'can\'t find', 'can\'t figure',
    'wish there was', 'need help', 'overwhelmed', 'impossible', 'hard to',
    'too expensive', 'too complex', 'too complicated', 'manually', 'no way to',
    'doesn\'t exist', 'looking for', 'recommendation', 'alternative to',
    'hate that', 'problem with', 'issue with', 'anyone else', 'terrible at',
    'track', 'organize', 'automate', 'remind', 'manage',
  ];
  
  const painPoints = [];
  
  for (const post of posts) {
    const text = (post.title + ' ' + post.body).toLowerCase();
    const matchCount = painKeywords.filter(kw => text.includes(kw)).length;
    
    if (matchCount >= 1) {
      painPoints.push({
        post,
        score: matchCount,
      });
    }
  }
  
  // Sort by keyword match + upvotes
  painPoints.sort((a, b) => (b.score * 10 + b.post.score) - (a.score * 10 + a.post.score));
  
  return painPoints.slice(0, 6); // max 6 per subreddit
}

function buildPainPointDescription(post, sub) {
  const title = post.title.slice(0, 80);
  const body = post.body?.slice(0, 200) || '';
  
  let description = `Users in r/${sub} are experiencing: "${title}".`;
  if (body && body.length > 20) {
    description += ` Context: ${body.slice(0, 150).replace(/\n/g, ' ')}...`;
  }
  description += ` Post has ${post.score} upvotes and ${post.commentCount} comments indicating community resonance.`;
  
  return description.slice(0, 500);
}

async function submitPainPoint(post, sub) {
  const category = CATEGORY_MAP[sub] || 'Productivity';
  const title = post.title.slice(0, 80);
  
  console.log(`  Submitting: "${title.slice(0, 60)}..."`);
  
  const ppRes = await apiPost('/api/pain-points', {
    title,
    description: buildPainPointDescription(post, sub),
    category,
    subreddit: `r/${sub}`,
    discoveredBy: AGENT_ID,
  });
  
  console.log(`  Pain point created:`, ppRes?.id || ppRes?.raw?.slice(0, 100));
  
  if (ppRes?.id) {
    const sourceRes = await apiPost('/api/pain-points/posts', {
      painPointId: ppRes.id,
      redditPostId: post.id,
      redditUrl: post.url,
      postTitle: post.title,
      postBody: post.body || '',
      upvotes: post.score,
      commentCount: post.commentCount,
      subreddit: `r/${sub}`,
      discoveredBy: AGENT_ID,
    });
    console.log(`  Source linked:`, sourceRes?.id || sourceRes?.raw?.slice(0, 60));
  }
  
  return ppRes;
}

async function logScan(sub, postsScanned, painPointsFound, status = 'completed') {
  await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${sub}`,
    postsScanned,
    painPointsFound,
    status,
  });
  console.log(`Logged scan for r/${sub}: ${postsScanned} posts, ${painPointsFound} pain points`);
}

async function main() {
  console.log('Connecting to AdsPower browser via CDP...');
  let browser;
  
  try {
    browser = await chromium.connectOverCDP(CDP_URL, { timeout: 15000 });
    console.log('Connected!');
  } catch (e) {
    console.error('Failed to connect via CDP:', e.message);
    process.exit(1);
  }
  
  const context = browser.contexts()[0];
  const pages = context.pages();
  
  // Close extra tabs
  for (let i = 1; i < pages.length; i++) {
    try { await pages[i].close(); } catch {}
  }
  
  const page = pages[0] || await context.newPage();
  
  const summary = {
    subredditsScanned: 0,
    totalPostsAnalyzed: 0,
    painPointsDiscovered: [],
    errors: [],
  };
  
  for (const sub of SUBREDDITS) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`Processing r/${sub}`);
    console.log('='.repeat(50));
    
    let posts = [];
    
    // Try browser first
    const browserPosts = await scanSubredditViaBrowser(page, sub);
    
    if (browserPosts && browserPosts.length >= 3) {
      posts = browserPosts;
    } else {
      // Fallback to JSON API
      posts = await scanSubredditViaJSON(sub);
    }
    
    console.log(`Total posts collected: ${posts.length}`);
    
    if (posts.length === 0) {
      summary.errors.push(`r/${sub}: No posts retrieved`);
      await logScan(sub, 0, 0, 'error');
      continue;
    }
    
    // Analyze for pain points
    const painPointCandidates = analyzePainPoints(posts, sub);
    console.log(`Pain point candidates: ${painPointCandidates.length}`);
    
    let painPointsCreated = 0;
    for (const { post } of painPointCandidates) {
      try {
        const res = await submitPainPoint(post, sub);
        if (res?.id) {
          painPointsCreated++;
          summary.painPointsDiscovered.push(`[r/${sub}] ${post.title.slice(0, 60)}`);
        }
        await sleep(500);
      } catch (e) {
        console.log(`Error submitting pain point: ${e.message}`);
      }
    }
    
    summary.subredditsScanned++;
    summary.totalPostsAnalyzed += posts.length;
    
    await logScan(sub, posts.length, painPointsCreated);
    
    // Pause between subreddits
    if (SUBREDDITS.indexOf(sub) < SUBREDDITS.length - 1) {
      console.log('Pausing 3s before next subreddit...');
      await sleep(3000);
    }
  }
  
  // Don't close the browser — admin handles that
  await browser.close(); // just disconnect, not close the actual profile
  
  console.log('\n' + '='.repeat(50));
  console.log('SCAN COMPLETE — SUMMARY');
  console.log('='.repeat(50));
  console.log(`Subreddits scanned: ${summary.subredditsScanned}`);
  console.log(`Total posts analyzed: ${summary.totalPostsAnalyzed}`);
  console.log(`Pain points discovered: ${summary.painPointsDiscovered.length}`);
  summary.painPointsDiscovered.forEach(p => console.log(`  - ${p}`));
  if (summary.errors.length > 0) {
    console.log(`Errors: ${summary.errors.length}`);
    summary.errors.forEach(e => console.log(`  ! ${e}`));
  }
  
  return summary;
}

main().catch(console.error);
