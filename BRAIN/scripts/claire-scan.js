const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:64318/devtools/browser/ca09af2e-3eb2-40d1-82d4-c7c0163d1e9f';
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

async function submitPainPoint(data) {
  const res = await fetch(`${API_BASE}/api/pain-points`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`Failed to create pain point: ${res.status} ${text}`);
    return null;
  }
  const json = await res.json();
  return json.id || json.data?.id || null;
}

async function linkPost(data) {
  const res = await fetch(`${API_BASE}/api/pain-points/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`Failed to link post: ${res.status} ${text}`);
  }
}

async function logScan(data) {
  const res = await fetch(`${API_BASE}/api/pain-points/scan-logs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`Failed to log scan: ${res.status} ${text}`);
  } else {
    console.log(`Scan log submitted for r/${data.subreddit}`);
  }
}

async function fetchViaJson(sub) {
  console.log(`Fetching r/${sub} via JSON API fallback...`);
  const url = `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
  });
  if (!res.ok) return [];
  const json = await res.json();
  return (json.data?.children || []).map(c => c.data).filter(p => !p.stickied && p.score >= 5);
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  const category = CATEGORY_MAP[sub] || 'General';
  let posts = [];
  let usedFallback = false;

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
    const pageContent = await page.content();
    
    // Check for login wall or CAPTCHA
    if (pageContent.includes('CAPTCHA') || pageContent.includes('are you a human')) {
      console.log(`CAPTCHA detected on r/${sub}, using JSON fallback`);
      posts = await fetchViaJson(sub);
      usedFallback = true;
    } else {
      // Extract posts using shreddit selectors
      posts = await page.evaluate(() => {
        const results = [];
        // Try shreddit-post elements first
        const shredditPosts = document.querySelectorAll('shreddit-post');
        shredditPosts.forEach(el => {
          const title = el.getAttribute('post-title') || el.querySelector('[slot="title"]')?.textContent?.trim() || '';
          const score = parseInt(el.getAttribute('score') || '0');
          const comments = parseInt(el.getAttribute('comment-count') || '0');
          const permalink = el.getAttribute('permalink') || '';
          const id = el.getAttribute('id') || '';
          if (title && score >= 5 && !el.getAttribute('stickied')) {
            results.push({ title, score, comments, permalink, id: id.replace('t3_', '') });
          }
        });
        
        // Fallback: try article elements
        if (results.length === 0) {
          const articles = document.querySelectorAll('article[data-testid="post-container"], div[data-testid="post-container"]');
          articles.forEach(el => {
            const titleEl = el.querySelector('h3, [data-click-id="text"] h3');
            const title = titleEl?.textContent?.trim() || '';
            const scoreEl = el.querySelector('[id*="vote-arrows-"] button, div[data-click-id="upvote"]');
            const score = 5; // default
            const linkEl = el.querySelector('a[data-click-id="body"]');
            const href = linkEl?.getAttribute('href') || '';
            const idMatch = href.match(/comments\/([a-z0-9]+)/);
            if (title && idMatch) {
              results.push({ title, score, comments: 0, permalink: href, id: idMatch[1] });
            }
          });
        }
        
        return results;
      });
      
      if (posts.length === 0) {
        console.log(`No posts found via browser on r/${sub}, trying JSON fallback`);
        posts = await fetchViaJson(sub);
        usedFallback = true;
      }
    }
  } catch (err) {
    console.error(`Browser error on r/${sub}: ${err.message}, using JSON fallback`);
    posts = await fetchViaJson(sub);
    usedFallback = true;
  }

  console.log(`Found ${posts.length} posts on r/${sub} (fallback: ${usedFallback})`);

  // Now analyze posts for pain points
  const painPoints = [];

  // For browser-based posts, try to get more detail on promising ones
  for (const post of posts.slice(0, 20)) {
    const title = post.title || post.post_title || '';
    const score = post.score || post.ups || 0;
    const commentCount = post.comments || post.num_comments || 0;
    const permalink = post.permalink || post.url || '';
    const postId = post.id || (permalink.match(/comments\/([a-z0-9]+)/)?.[1]) || '';
    const selftext = post.selftext || post.body || '';
    
    console.log(`  Post: "${title.substring(0, 60)}" | score:${score} | comments:${commentCount}`);
    
    // Analyze for pain points
    const titleLower = title.toLowerCase();
    const bodyLower = (selftext || '').toLowerCase();
    const combined = titleLower + ' ' + bodyLower;
    
    // Pain point indicators
    const painIndicators = [
      'cant sleep', "can't sleep", 'unable to sleep', 'help with sleep',
      'tried everything', 'nothing works', 'desperate', 'exhausted',
      'app for', 'tool for', 'track', 'tracking', 'log', 'logging',
      'frustrated', 'frustrating', 'struggle', 'struggling',
      'how do you', 'how to', 'need help', 'advice', 'recommend',
      'pain', 'ache', 'hurt', 'discomfort', 'flare',
      'expensive', 'afford', 'insurance', 'coverage',
      'consistent', 'consistency', 'habit', 'routine',
      'overwhelmed', 'complicated', 'confusing', 'difficult',
      'spreadsheet', 'manually', 'keep track',
    ];
    
    const isPainPoint = painIndicators.some(p => combined.includes(p));
    
    // Exclude venting/memes
    const excludeIndicators = ['meme', 'funny', 'lol', 'haha', 'celebration', 'finally got'];
    const isExcluded = excludeIndicators.some(p => combined.includes(p)) && score < 20;
    
    if (isPainPoint && !isExcluded && score >= 5) {
      // For high-comment posts, get more detail if using browser
      let fullBody = selftext || '';
      if (!usedFallback && commentCount >= 10 && postId) {
        try {
          await sleep(2000);
          await page.goto(`https://www.reddit.com${permalink}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await sleep(2000);
          const bodyText = await page.evaluate(() => {
            const bodyEl = document.querySelector('[data-testid="post-container"] [data-click-id="text"] p, shreddit-post [slot="text-body"]');
            return bodyEl?.textContent?.trim() || '';
          });
          if (bodyText) fullBody = bodyText;
          await page.goBack({ waitUntil: 'domcontentloaded', timeout: 20000 });
          await sleep(2000);
        } catch (e) {
          // ignore detail fetch errors
        }
      }
      
      painPoints.push({
        title,
        score,
        commentCount,
        permalink,
        postId,
        selftext: (fullBody || selftext || '').substring(0, 2000),
        sub,
        category,
      });
    }
  }

  console.log(`  Pain points identified: ${painPoints.length}`);

  // Submit pain points
  let submitted = 0;
  for (const pp of painPoints) {
    // Build a clean description
    const desc = pp.selftext
      ? `${pp.title}. ${pp.selftext.substring(0, 300)}`
      : pp.title;
    
    const ppData = {
      title: pp.title.substring(0, 80),
      description: desc.substring(0, 500),
      category: pp.category,
      subreddit: `r/${pp.sub}`,
      discoveredBy: AGENT_ID,
    };
    
    const id = await submitPainPoint(ppData);
    console.log(`  Submitted pain point: "${pp.title.substring(0, 50)}" -> id: ${id}`);
    
    if (id && pp.postId) {
      await linkPost({
        painPointId: id,
        redditPostId: pp.postId,
        redditUrl: pp.permalink.startsWith('http') ? pp.permalink : `https://reddit.com${pp.permalink}`,
        postTitle: pp.title,
        postBody: pp.selftext || '',
        upvotes: pp.score,
        commentCount: pp.commentCount,
        subreddit: `r/${pp.sub}`,
        discoveredBy: AGENT_ID,
      });
    }
    
    submitted++;
    await sleep(500);
  }

  // Log scan
  await logScan({
    agentId: AGENT_ID,
    subreddit: `r/${sub}`,
    postsScanned: posts.length,
    painPointsFound: submitted,
    status: 'completed',
  });

  return { sub, postsScanned: posts.length, painPointsFound: submitted };
}

async function main() {
  console.log('Connecting to AdsPower browser via CDP...');
  let browser;
  
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected!');
  } catch (err) {
    console.error(`Failed to connect via CDP: ${err.message}`);
    console.log('Falling back to JSON API scanning for all subreddits...');
    // Run without browser
    const results = [];
    for (const sub of SUBREDDITS) {
      const posts = await fetchViaJson(sub);
      console.log(`r/${sub}: ${posts.length} posts via JSON fallback`);
      const category = CATEGORY_MAP[sub] || 'General';
      const painPoints = posts.filter(p => {
        const combined = (p.title + ' ' + (p.selftext || '')).toLowerCase();
        return ['help', 'track', 'app', 'tool', 'frustrat', 'struggle', 'pain', 'cant', "can't", 'how do', 'advice', 'recommend', 'expens', 'log', 'habit', 'routine', 'overwhelm'].some(kw => combined.includes(kw));
      }).slice(0, 8);
      
      let submitted = 0;
      for (const pp of painPoints) {
        const id = await submitPainPoint({
          title: pp.title.substring(0, 80),
          description: (pp.title + (pp.selftext ? '. ' + pp.selftext.substring(0, 300) : '')).substring(0, 500),
          category,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID,
        });
        if (id) {
          await linkPost({
            painPointId: id,
            redditPostId: pp.id,
            redditUrl: `https://reddit.com${pp.permalink}`,
            postTitle: pp.title,
            postBody: (pp.selftext || '').substring(0, 2000),
            upvotes: pp.score || pp.ups || 0,
            commentCount: pp.num_comments || 0,
            subreddit: `r/${sub}`,
            discoveredBy: AGENT_ID,
          });
          submitted++;
        }
        await sleep(300);
      }
      
      await logScan({ agentId: AGENT_ID, subreddit: `r/${sub}`, postsScanned: posts.length, painPointsFound: submitted, status: 'completed' });
      results.push({ sub, postsScanned: posts.length, painPointsFound: submitted });
    }
    
    console.log('\n=== SCAN COMPLETE (JSON fallback mode) ===');
    results.forEach(r => console.log(`r/${r.sub}: ${r.postsScanned} posts scanned, ${r.painPointsFound} pain points found`));
    console.log(`Total pain points: ${results.reduce((a, r) => a + r.painPointsFound, 0)}`);
    return;
  }

  const context = browser.contexts()[0];
  const pages = context.pages();
  for (let i = 1; i < pages.length; i++) await pages[i].close();
  const page = pages[0] || await context.newPage();

  const results = [];
  for (const sub of SUBREDDITS) {
    try {
      const result = await scanSubreddit(page, sub);
      results.push(result);
    } catch (err) {
      console.error(`Error scanning r/${sub}: ${err.message}`);
      results.push({ sub, postsScanned: 0, painPointsFound: 0, error: err.message });
    }
    await sleep(3000);
  }

  // Don't close the browser — admin handles that
  console.log('\n=== SCAN COMPLETE ===');
  results.forEach(r => console.log(`r/${r.sub}: ${r.postsScanned} posts scanned, ${r.painPointsFound} pain points found`));
  console.log(`Total pain points: ${results.reduce((a, r) => a + r.painPointsFound, 0)}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
