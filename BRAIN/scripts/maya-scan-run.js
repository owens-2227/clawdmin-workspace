const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

const CDP_URL = 'ws://127.0.0.1:60996/devtools/browser/0f276cb7-5d49-4ca2-b49a-a5556d359093';
const AGENT_ID = 'maya-chen';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const SUBREDDITS = ['personalfinance', 'cooking', 'solotravel', 'frugal'];

async function apiPost(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const url = new URL(API_BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port || 3000,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = http.request(options, (res) => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch(e) { resolve({raw: d}); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchRedditJSON(subreddit) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.reddit.com',
      path: `/r/${subreddit}/hot.json?limit=25&raw_json=1`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    };
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch(e) { resolve(null); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.abort(); reject(new Error('timeout')); });
    req.end();
  });
}

function categorizeSub(sub) {
  const map = {
    'personalfinance': 'Personal Finance',
    'frugal': 'Personal Finance',
    'cooking': 'Cooking',
    'solotravel': 'Solo Travel'
  };
  return map[sub.toLowerCase()] || 'General';
}

function isPainPoint(post) {
  if (!post.title) return false;
  if (post.score < 5) return false;
  if (post.stickied) return false;
  
  const text = (post.title + ' ' + (post.selftext || '')).toLowerCase();
  
  // Positive signals
  const painSignals = [
    'how do i', 'how to', 'is there an app', 'is there a tool', 'best way to',
    'frustrated', 'annoying', 'hate when', 'wish there was', 'anyone else struggle',
    'can\'t figure out', 'struggling with', 'having trouble', 'problem with',
    'manually', 'spreadsheet', 'keep track', 'organize', 'track my', 'budget',
    'overwhelmed', 'confusing', 'complicated', 'expensive', 'can\'t afford',
    'need help', 'lost', 'advice', 'tip', 'recommendation', 'suggest',
    'automate', 'easier way', 'better way', 'alternative to', 'looking for',
    'meal plan', 'grocery', 'recipe', 'ingredient', 'leftover',
    'solo travel', 'traveling alone', 'hostel', 'itinerary', 'safety',
    'save money', 'debt', 'emergency fund', 'invest', 'paycheck'
  ];
  
  // Negative signals (exclude)
  const excludeSignals = [
    'meme', 'lol', 'haha', 'cute', 'adorable', '[image]', 'photo',
    'rant', 'venting', 'just needed to say'
  ];
  
  for (const sig of excludeSignals) {
    if (text.includes(sig)) return false;
  }
  
  return painSignals.some(sig => text.includes(sig));
}

function extractPainPointTitle(post) {
  let title = post.title.trim();
  if (title.length > 80) title = title.substring(0, 77) + '...';
  return title;
}

function extractDescription(post) {
  const body = post.selftext ? post.selftext.substring(0, 500) : '';
  const combined = body ? `${post.title} — ${body}` : post.title;
  
  // Generate a 2-3 sentence description
  let desc = '';
  if (body && body.length > 50) {
    desc = `Reddit user asks: "${post.title}". `;
    desc += body.substring(0, 200).replace(/\n+/g, ' ').trim();
    if (!desc.endsWith('.')) desc += '.';
    desc += ` This appears to be a recurring pain point in r/${post.subreddit || 'reddit'} with ${post.score} upvotes and ${post.num_comments} comments.`;
  } else {
    desc = `Pain point identified: "${post.title}". `;
    desc += `This post in r/${post.subreddit || 'reddit'} received ${post.score} upvotes and ${post.num_comments} comments, suggesting it resonates with many users.`;
    if (post.url_overridden_by_dest) {
      desc += ' Related to an external resource or tool.';
    }
  }
  return desc.substring(0, 500);
}

async function scanSubredditViaJSON(subreddit, page) {
  console.log(`\n=== Scanning r/${subreddit} ===`);
  
  let posts = [];
  let usedFallback = false;
  
  // Try browser first
  try {
    console.log(`Navigating to https://www.reddit.com/r/${subreddit}/hot/`);
    await page.goto(`https://www.reddit.com/r/${subreddit}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);
    
    // Check for CAPTCHA or error
    const pageContent = await page.content();
    if (pageContent.includes('captcha') || pageContent.includes('CAPTCHA') || pageContent.length < 1000) {
      console.log('CAPTCHA or error detected, using JSON fallback');
      usedFallback = true;
    } else {
      // Scroll to load more posts
      console.log('Scrolling to load more posts...');
      for (let i = 0; i < 6; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
        await sleep(2000);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(1000);
      
      // Try to extract posts from page
      const pagePosts = await page.evaluate(() => {
        const results = [];
        // Try shreddit-post elements
        const postEls = document.querySelectorAll('shreddit-post, [data-testid="post-container"], article[data-fullname]');
        postEls.forEach(el => {
          const title = el.getAttribute('post-title') || el.querySelector('h3, h1, [slot="title"]')?.textContent?.trim() || '';
          const score = parseInt(el.getAttribute('score') || el.getAttribute('upvote-count') || '0');
          const comments = parseInt(el.getAttribute('comment-count') || '0');
          const permalink = el.getAttribute('permalink') || el.querySelector('a[data-click-id="body"]')?.getAttribute('href') || '';
          const id = el.getAttribute('id') || el.getAttribute('name') || permalink.split('/')[6] || '';
          const stickied = el.getAttribute('is-pinned') === 'true' || el.classList.contains('stickied');
          const bodyText = el.querySelector('[slot="text-body"]')?.textContent?.trim() || '';
          
          if (title) {
            results.push({ title, score, num_comments: comments, permalink, id, stickied, selftext: bodyText });
          }
        });
        return results;
      });
      
      if (pagePosts.length >= 5) {
        console.log(`Extracted ${pagePosts.length} posts from browser`);
        posts = pagePosts.map(p => ({
          ...p,
          subreddit: subreddit,
          url: p.permalink ? `https://reddit.com${p.permalink}` : ''
        }));
      } else {
        console.log(`Only got ${pagePosts.length} posts from browser, using JSON fallback`);
        usedFallback = true;
      }
    }
  } catch (err) {
    console.log(`Browser navigation error: ${err.message}, using JSON fallback`);
    usedFallback = true;
  }
  
  // Fallback to JSON API
  if (usedFallback || posts.length < 5) {
    console.log('Fetching via JSON API...');
    try {
      const json = await fetchRedditJSON(subreddit);
      if (json && json.data && json.data.children) {
        posts = json.data.children.map(c => ({
          ...c.data,
          subreddit: subreddit
        }));
        console.log(`Got ${posts.length} posts via JSON API`);
      }
    } catch (err) {
      console.log(`JSON API error: ${err.message}`);
    }
  }
  
  if (posts.length === 0) {
    console.log(`No posts found for r/${subreddit}, logging error`);
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${subreddit}`,
      postsScanned: 0,
      painPointsFound: 0,
      status: 'error'
    });
    return { painPoints: 0, postsScanned: 0 };
  }
  
  // Filter and analyze for pain points
  const validPosts = posts.filter(p => !p.stickied && p.score >= 5);
  console.log(`${validPosts.length} valid posts to analyze`);
  
  const painPosts = validPosts.filter(isPainPoint);
  console.log(`${painPosts.length} pain point candidates found`);
  
  // Submit top pain points (max 5 per subreddit to avoid spam)
  const toSubmit = painPosts.slice(0, 5);
  let submitted = 0;
  
  for (const post of toSubmit) {
    try {
      const ppData = {
        title: extractPainPointTitle(post),
        description: extractDescription(post),
        category: categorizeSub(subreddit),
        subreddit: `r/${subreddit}`,
        discoveredBy: AGENT_ID
      };
      
      console.log(`Submitting: ${ppData.title}`);
      const ppResult = await apiPost('/api/pain-points', ppData);
      
      if (ppResult && ppResult.id) {
        // Link source post
        const redditPostId = post.id || (post.permalink ? post.permalink.split('/')[6] : '');
        const redditUrl = post.url || (post.permalink ? `https://reddit.com${post.permalink}` : '');
        
        await apiPost('/api/pain-points/posts', {
          painPointId: ppResult.id,
          redditPostId: redditPostId,
          redditUrl: redditUrl,
          postTitle: post.title,
          postBody: (post.selftext || '').substring(0, 2000),
          upvotes: post.score || 0,
          commentCount: post.num_comments || 0,
          subreddit: `r/${subreddit}`,
          discoveredBy: AGENT_ID
        });
        submitted++;
        console.log(`  ✓ Submitted pain point ID: ${ppResult.id}`);
      } else {
        console.log(`  ✗ Failed to submit: ${JSON.stringify(ppResult)}`);
      }
      
      await sleep(500);
    } catch (err) {
      console.log(`  ✗ Error submitting: ${err.message}`);
    }
  }
  
  // Log scan results
  await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned: validPosts.length,
    painPointsFound: submitted,
    status: 'completed'
  });
  
  console.log(`r/${subreddit}: scanned ${validPosts.length} posts, submitted ${submitted} pain points`);
  return { painPoints: submitted, postsScanned: validPosts.length };
}

async function main() {
  console.log(`Maya Chen scanner starting — ${new Date().toISOString()}`);
  console.log(`Connecting to CDP: ${CDP_URL}`);
  
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected to AdsPower browser');
  } catch (err) {
    console.error(`Failed to connect to CDP: ${err.message}`);
    process.exit(1);
  }
  
  const context = browser.contexts()[0];
  const pages = context.pages();
  
  // Close extra tabs
  for (let i = 1; i < pages.length; i++) {
    try { await pages[i].close(); } catch(e) {}
  }
  const page = pages[0] || await context.newPage();
  
  const results = { total: { postsScanned: 0, painPoints: 0 }, bySubreddit: {} };
  
  for (const sub of SUBREDDITS) {
    const r = await scanSubredditViaJSON(sub, page);
    results.bySubreddit[sub] = r;
    results.total.postsScanned += r.postsScanned;
    results.total.painPoints += r.painPoints;
    
    // Pause between subreddits
    if (SUBREDDITS.indexOf(sub) < SUBREDDITS.length - 1) {
      console.log('Pausing 3s before next subreddit...');
      await sleep(3000);
    }
  }
  
  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits: ${SUBREDDITS.length}`);
  console.log(`Total posts scanned: ${results.total.postsScanned}`);
  console.log(`Total pain points submitted: ${results.total.painPoints}`);
  console.log('By subreddit:', JSON.stringify(results.bySubreddit, null, 2));
  
  // Don't close browser - admin handles that
  await browser.close(); // disconnect only, doesn't kill the AdsPower browser
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
