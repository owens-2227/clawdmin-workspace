/**
 * Reddit Pain Point Scanner — owen-b
 * Subreddits: ADHD, languagelearning, remotework, productivity
 * CDP URL: ws://127.0.0.1:50047/devtools/browser/3717d3d7-318e-4ba0-92aa-bb35cc99d772
 */

const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:50047/devtools/browser/3717d3d7-318e-4ba0-92aa-bb35cc99d772';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const AGENT_ID = 'owen-b';

const SUBREDDITS = [
  { name: 'ADHD', category: 'ADHD & Neurodivergent' },
  { name: 'languagelearning', category: 'Language Learning' },
  { name: 'remotework', category: 'Remote Work' },
  { name: 'productivity', category: 'Productivity' },
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

async function fetchRedditJSON(subreddit) {
  const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=25&raw_json=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.data.children.map(c => c.data);
}

async function fetchPostComments(subreddit, postId) {
  const url = `https://www.reddit.com/r/${subreddit}/comments/${postId}.json?limit=10&raw_json=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  if (!res.ok) return [];
  const json = await res.json();
  const comments = json[1]?.data?.children || [];
  return comments
    .filter(c => c.kind === 't1' && c.data.body && c.data.body !== '[deleted]')
    .slice(0, 5)
    .map(c => c.data.body);
}

function isPainPoint(post) {
  if (post.stickied || post.pinned) return false;
  if (post.score < 5) return false;
  
  const text = (post.title + ' ' + (post.selftext || '')).toLowerCase();
  
  // Exclude
  if (!post.selftext && post.post_hint === 'image') return false;
  
  // Pain point signals
  const painSignals = [
    /is there.*(app|tool|software|plugin|extension|way|method|template)/i,
    /how do (you|i|we).*(manage|track|organize|handle|deal with|stay|keep)/i,
    /struggling with/i,
    /frustrated (with|by|about)/i,
    /drives me crazy/i,
    /wish there was/i,
    /can't figure out/i,
    /need help (with|finding|organizing)/i,
    /anyone else (have|struggle|deal|find)/i,
    /what (app|tool|software|method|system) do you/i,
    /looking for (a|an|the) (app|tool|software|way|method|system)/i,
    /manually (doing|tracking|entering|managing)/i,
    /too (expensive|complex|complicated|hard)/i,
    /no (good|great|decent|free) (app|tool|solution|option)/i,
    /best way to (manage|track|organize|handle)/i,
    /biggest (challenge|problem|struggle|issue)/i,
    /overwhelmed by/i,
    /keep forgetting/i,
    /hard to (stay|keep|maintain|track|remember)/i,
  ];

  return painSignals.some(r => r.test(text));
}

function generatePainPointTitle(post) {
  // Extract core issue for a clean title
  let title = post.title;
  if (title.length > 80) title = title.substring(0, 77) + '...';
  return title;
}

function generateDescription(post, topComments) {
  let desc = '';
  const selftext = post.selftext ? post.selftext.substring(0, 300) : '';
  
  if (selftext) {
    desc = `Post: "${selftext.trim()}"`;
  } else {
    desc = `Title: "${post.title}"`;
  }
  
  if (topComments && topComments.length > 0) {
    const commentSnippet = topComments[0].substring(0, 200);
    desc += ` Top comment: "${commentSnippet.trim()}"`;
  }
  
  desc += ` Found in r/${post.subreddit} with ${post.score} upvotes and ${post.num_comments} comments.`;
  return desc.substring(0, 500);
}

async function scanSubreddit(page, sub, category) {
  console.log(`\n=== Scanning r/${sub} ===`);
  let posts = [];
  let usedFallback = false;

  // Try browser-based approach first
  try {
    console.log(`Navigating to https://www.reddit.com/r/${sub}/hot/`);
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    // Check for CAPTCHA or login wall
    const pageTitle = await page.title();
    const pageUrl = page.url();
    console.log(`Page title: ${pageTitle}, URL: ${pageUrl}`);

    if (pageTitle.includes('blocked') || pageTitle.includes('CAPTCHA') || pageUrl.includes('login')) {
      console.log('CAPTCHA or login wall detected, using JSON fallback');
      usedFallback = true;
    } else {
      // Scroll to load more posts
      console.log('Scrolling to load posts...');
      for (let i = 0; i < 6; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
        await sleep(2000);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(1000);
    }
  } catch (err) {
    console.log(`Browser navigation failed: ${err.message}, using JSON fallback`);
    usedFallback = true;
  }

  // Use JSON API (either as fallback or primary)
  try {
    console.log(`Fetching JSON for r/${sub}...`);
    posts = await fetchRedditJSON(sub);
    console.log(`Fetched ${posts.length} posts`);
  } catch (err) {
    console.log(`JSON API also failed: ${err.message}`);
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned: 0,
      painPointsFound: 0,
      status: 'failed',
    });
    return 0;
  }

  // Filter non-stickied posts with decent engagement
  const validPosts = posts.filter(p => !p.stickied && !p.pinned && p.score >= 5);
  console.log(`Valid posts: ${validPosts.length}`);

  // Identify pain points
  const painPosts = validPosts.filter(isPainPoint);
  console.log(`Pain point candidates: ${painPosts.length}`);

  let painPointsSubmitted = 0;

  for (const post of painPosts.slice(0, 8)) { // cap at 8 per sub
    try {
      console.log(`\nProcessing: "${post.title.substring(0, 60)}..."`);
      
      // Fetch top comments for context
      let topComments = [];
      if (post.num_comments >= 10) {
        try {
          await sleep(2000);
          topComments = await fetchPostComments(sub, post.id);
        } catch (e) {
          console.log(`Could not fetch comments: ${e.message}`);
        }
      }

      const painTitle = generatePainPointTitle(post);
      const description = generateDescription(post, topComments);

      // Submit pain point
      const ppResult = await apiPost('/api/pain-points', {
        title: painTitle,
        description: description,
        category: category,
        subreddit: `r/${sub}`,
        discoveredBy: AGENT_ID,
      });

      console.log(`Pain point created: ${JSON.stringify(ppResult).substring(0, 100)}`);

      const ppId = ppResult?.painPoint?.id || ppResult?.id || ppResult?.data?.id;
      if (ppId) {
        // Link source post
        const postBody = post.selftext ? post.selftext.substring(0, 2000) : '';
        const linkResult = await apiPost('/api/pain-points/posts', {
          painPointId: ppId,
          redditPostId: post.id,
          redditUrl: `https://reddit.com${post.permalink}`,
          postTitle: post.title,
          postBody: postBody,
          upvotes: post.score,
          commentCount: post.num_comments,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID,
        });
        console.log(`Post linked: ${JSON.stringify(linkResult).substring(0, 80)}`);
        painPointsSubmitted++;
      } else {
        console.log(`No ID returned from pain point creation, skipping post link`);
        painPointsSubmitted++; // still count it
      }

      await sleep(1000);
    } catch (err) {
      console.log(`Error processing post ${post.id}: ${err.message}`);
    }
  }

  // Log scan results
  await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${sub}`,
    postsScanned: validPosts.length,
    painPointsFound: painPointsSubmitted,
    status: 'completed',
  });

  console.log(`r/${sub} complete: ${validPosts.length} posts scanned, ${painPointsSubmitted} pain points submitted`);
  return painPointsSubmitted;
}

async function main() {
  console.log(`Starting owen-b scan at ${new Date().toISOString()}`);
  console.log(`CDP URL: ${CDP_URL}`);
  
  let browser;
  let page;

  try {
    console.log('Connecting to AdsPower browser via CDP...');
    browser = await chromium.connectOverCDP(CDP_URL);
    const context = browser.contexts()[0];
    const pages = context.pages();
    
    // Close extra tabs, keep one
    for (let i = 1; i < pages.length; i++) {
      try { await pages[i].close(); } catch {}
    }
    page = pages[0] || await context.newPage();
    console.log('Connected successfully');
  } catch (err) {
    console.log(`CDP connection failed: ${err.message}`);
    console.log('Will use JSON API only (no browser navigation)');
    page = null;
  }

  const results = {
    subredditsScanned: 0,
    totalPostsAnalyzed: 0,
    painPointsFound: [],
  };

  for (const { name, category } of SUBREDDITS) {
    try {
      const count = await scanSubreddit(page, name, category);
      results.subredditsScanned++;
      results.painPointsFound.push({ subreddit: name, count });
    } catch (err) {
      console.log(`Failed to scan r/${name}: ${err.message}`);
    }
    await sleep(3000); // natural pacing between subs
  }

  // Do NOT close browser — admin agent handles that

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${results.subredditsScanned}`);
  console.log(`Pain points found:`, results.painPointsFound);
  
  return results;
}

main().then(r => {
  console.log('\nFinal results:', JSON.stringify(r, null, 2));
  process.exit(0);
}).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
