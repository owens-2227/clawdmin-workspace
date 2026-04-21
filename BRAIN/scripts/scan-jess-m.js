const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

const CDP_URL = 'ws://127.0.0.1:65505/devtools/browser/de6a057b-ca63-4c27-be9b-dc8d8161cc60';
const AGENT_ID = 'jess-m';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const SUBREDDITS = [
  { name: 'gardening', category: 'Gardening' },
  { name: 'beyondthebump', category: 'New Moms' },
  { name: 'Mommit', category: 'New Moms' },
  { name: 'running', category: 'Fitness' },
  { name: 'xxfitness', category: 'Fitness' },
  { name: 'ADHD', category: 'ADHD & Neurodivergent' },
  { name: 'languagelearning', category: 'Language Learning' },
  { name: 'remotework', category: 'Remote Work' },
  { name: 'productivity', category: 'Productivity' },
  { name: 'Meditation', category: 'Mental Health' },
  { name: 'Anxiety', category: 'Mental Health' },
];

function apiPost(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function fetchSubredditJSON(sub) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.reddit.com',
      path: `/r/${sub}/hot.json?limit=25&raw_json=1`,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function isPainPoint(post) {
  const title = (post.title || '').toLowerCase();
  const body = (post.selftext || '').toLowerCase();
  const text = title + ' ' + body;

  // Exclude
  if (post.stickied) return false;
  if ((post.score || 0) < 5) return false;
  if (!post.is_self && !post.selftext) {
    // image/link post with no body — skip unless title is very telling
    const hasPainIndicator = /\b(frustrat|annoy|hate|struggle|problem|issue|help|tool|app|automat|track|organiz|wish|hard to|difficult|can't|cannot)\b/.test(title);
    if (!hasPainIndicator) return false;
  }

  // Include indicators
  const painIndicators = [
    /is there (an? )?(app|tool|way|plugin|software|service)/,
    /how do (you|i|we) (keep track|manage|handle|deal with|organize|automat)/,
    /frustrat|annoying|annoys me|drives me crazy/,
    /struggling with|can't seem to|having trouble/,
    /wish (there was|i could|someone would)/,
    /does anyone else|anyone know of/,
    /looking for (a |an )?(tool|app|way|method|system)/,
    /best (app|tool|way|method) for/,
    /tired of (manually|doing|tracking)/,
    /what do you use (to|for)/,
    /help (me |with )?/,
    /problem with|issue with/,
    /overwhelm|burnout|exhausted/,
    /track(ing)? (my |all |the )/,
    /keep (forgetting|losing track)/,
    /automat(e|ing)/,
    /reminders? for/,
    /spreadsheet for|excel for/,
    /expensive|too pricey|cost too much/,
    /complicated|too complex|confusing/,
  ];

  return painIndicators.some(r => r.test(text));
}

function extractPainPointTitle(post) {
  let title = post.title.trim();
  if (title.length > 80) title = title.substring(0, 77) + '...';
  return title;
}

function extractDescription(post) {
  const body = (post.selftext || '').trim().substring(0, 500);
  const desc = body
    ? `${post.title.trim()}. ${body.substring(0, 300)}`.trim()
    : post.title.trim();
  
  // Make it a cleaner 2-3 sentence description
  let description = desc.substring(0, 400);
  if (description.length === 400) description += '...';
  return description;
}

async function scanWithBrowser(page, sub) {
  const posts = [];
  try {
    console.log(`  Navigating to r/${sub}...`);
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    // Scroll to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    // Try to extract post data from page
    const pageContent = await page.content();
    
    // Check for login wall or captcha
    if (pageContent.includes('Log in') && pageContent.includes('Sign up') && !pageContent.includes('shreddit-post')) {
      console.log(`  Login wall detected for r/${sub}, trying JSON fallback...`);
      return null; // signal to use fallback
    }

    console.log(`  Page loaded for r/${sub}, length: ${pageContent.length}`);
    return pageContent;
  } catch (e) {
    console.log(`  Browser error for r/${sub}: ${e.message}`);
    return null;
  }
}

async function main() {
  console.log('Starting Reddit pain point scan...');
  console.log(`Agent: ${AGENT_ID}`);
  console.log(`Subreddits: ${SUBREDDITS.map(s => s.name).join(', ')}`);
  console.log('');

  let browser;
  try {
    console.log('Connecting to AdsPower browser via CDP...');
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected!');
  } catch (e) {
    console.error('Failed to connect to browser:', e.message);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const pages = context.pages();
  
  // Close extra tabs, keep one
  for (let i = 1; i < pages.length; i++) {
    try { await pages[i].close(); } catch {}
  }
  const page = pages[0] || await context.newPage();

  const allPainPoints = [];

  for (const { name: sub, category } of SUBREDDITS) {
    console.log(`\n=== Scanning r/${sub} (${category}) ===`);
    
    let postsData = [];
    let usedFallback = false;

    // Try browser first, fallback to JSON API
    try {
      const pageContent = await scanWithBrowser(page, sub);
      
      if (!pageContent) {
        // Use JSON fallback
        usedFallback = true;
        console.log(`  Using JSON API fallback for r/${sub}...`);
        const json = await fetchSubredditJSON(sub);
        if (json && json.data && json.data.children) {
          postsData = json.data.children.map(c => c.data).filter(p => !p.stickied);
          console.log(`  Got ${postsData.length} posts via JSON API`);
        }
      } else {
        // Try JSON API anyway for structured data (more reliable parsing)
        console.log(`  Getting structured data via JSON API...`);
        await sleep(2000);
        const json = await fetchSubredditJSON(sub);
        if (json && json.data && json.data.children) {
          postsData = json.data.children.map(c => c.data).filter(p => !p.stickied);
          console.log(`  Got ${postsData.length} posts via JSON API`);
        }
      }
    } catch (e) {
      console.log(`  Error fetching r/${sub}: ${e.message}`);
      // Try JSON fallback
      try {
        usedFallback = true;
        console.log(`  Retrying with JSON API...`);
        await sleep(3000);
        const json = await fetchSubredditJSON(sub);
        if (json && json.data && json.data.children) {
          postsData = json.data.children.map(c => c.data).filter(p => !p.stickied);
          console.log(`  Got ${postsData.length} posts`);
        }
      } catch (e2) {
        console.log(`  JSON API also failed: ${e2.message}`);
      }
    }

    if (postsData.length === 0) {
      console.log(`  No posts found for r/${sub}, logging error`);
      try {
        await apiPost('/api/pain-points/scan-logs', {
          agentId: AGENT_ID,
          subreddit: `r/${sub}`,
          postsScanned: 0,
          painPointsFound: 0,
          status: 'error',
        });
      } catch (e) {
        console.log(`  Log error: ${e.message}`);
      }
      continue;
    }

    // Analyze posts for pain points
    const painPosts = postsData.filter(isPainPoint);
    console.log(`  Analyzed ${postsData.length} posts, found ${painPosts.length} potential pain points`);

    let submittedCount = 0;
    for (const post of painPosts.slice(0, 5)) { // max 5 per subreddit
      try {
        const title = extractPainPointTitle(post);
        const description = extractDescription(post);
        const redditUrl = `https://reddit.com${post.permalink}`;
        
        console.log(`  Pain point: "${title}"`);

        // Create pain point
        const ppResult = await apiPost('/api/pain-points', {
          title,
          description,
          category,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID,
        });

        if (ppResult && ppResult.id) {
          // Link source post
          await apiPost('/api/pain-points/posts', {
            painPointId: ppResult.id,
            redditPostId: post.id,
            redditUrl,
            postTitle: post.title,
            postBody: (post.selftext || '').substring(0, 2000),
            upvotes: post.score || 0,
            commentCount: post.num_comments || 0,
            subreddit: `r/${sub}`,
            discoveredBy: AGENT_ID,
          });
          
          allPainPoints.push({ title, subreddit: sub, category });
          submittedCount++;
          console.log(`    ✓ Submitted (id: ${ppResult.id})`);
        } else {
          console.log(`    ✗ Submission failed:`, JSON.stringify(ppResult).substring(0, 200));
        }

        await sleep(500);
      } catch (e) {
        console.log(`    Error submitting pain point: ${e.message}`);
      }
    }

    // Log scan results
    try {
      await apiPost('/api/pain-points/scan-logs', {
        agentId: AGENT_ID,
        subreddit: `r/${sub}`,
        postsScanned: postsData.length,
        painPointsFound: submittedCount,
        status: 'completed',
      });
      console.log(`  Logged scan for r/${sub}: ${postsData.length} posts, ${submittedCount} pain points`);
    } catch (e) {
      console.log(`  Log error: ${e.message}`);
    }

    // Natural pacing between subreddits
    await sleep(3000);
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Total subreddits scanned: ${SUBREDDITS.length}`);
  console.log(`Total pain points discovered: ${allPainPoints.length}`);
  console.log('\nPain points found:');
  for (const pp of allPainPoints) {
    console.log(`  [${pp.category}] r/${pp.subreddit}: ${pp.title}`);
  }

  // Don't close browser — admin agent handles that
  await browser.close(); // just disconnect, not stop
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
