const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

const CDP_URL = 'ws://127.0.0.1:64418/devtools/browser/29d67c91-3ced-4adf-a758-15043c9ba797';
const AGENT_ID = 'marcus-j';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const CATEGORY = 'Music';
const SUBREDDITS = ['Guitar', 'guitarpedals', 'Blues', 'homerecording'];

async function apiPost(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseData));
        } catch(e) {
          resolve({ raw: responseData });
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function fetchRedditJSON(sub) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.reddit.com',
      path: `/r/${sub}/hot.json?limit=25&raw_json=1`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch(e) {
          resolve(null);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchPostComments(sub, postId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.reddit.com',
      path: `/r/${sub}/comments/${postId}.json?limit=10&raw_json=1`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch(e) {
          resolve(null);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isPainPoint(post) {
  const title = (post.title || '').toLowerCase();
  const body = (post.selftext || '').toLowerCase();
  const combined = title + ' ' + body;
  
  // Skip if low engagement
  if (post.score < 5) return false;
  // Skip pinned/stickied
  if (post.stickied) return false;
  // Skip pure image posts with no text
  if (!post.is_self && !post.selftext && post.url && !post.url.includes('reddit.com')) return false;
  
  const painIndicators = [
    'struggle', 'frustrat', 'annoying', 'hate when', 'wish there was',
    'is there an app', 'is there a tool', 'anyone else deal', 'how do you manage',
    'hard to', 'difficult to', 'cant figure out', "can't figure out", 'help me',
    'looking for a way', 'need help', 'how do i', 'problem with', 'issue with',
    'too expensive', 'too complex', 'too complicated', 'doesnt work', "doesn't work",
    'workaround', 'manually', 'tedious', 'time consuming', 'no good solution',
    'better way', 'recommend', 'workflow', 'organize', 'track', 'keep track',
    'overwhelmed', 'confused', 'lost', 'stuck', 'barrier', 'obstacle',
    'cant afford', "can't afford", 'budget', 'cheap alternative',
    'software for', 'app for', 'tool for', 'plugin for',
    'recording quality', 'sound quality', 'noise', 'latency', 'latency issues',
    'tone', 'dialing in', 'signal chain', 'pedalboard', 'cable noise',
    'feedback', 'hum', 'buzz', 'ground loop', 'room acoustics', 'acoustic treatment',
    'daw', 'interface', 'preamp', 'microphone placement', 'mixing', 'mastering',
    'learn', 'practice', 'improve', 'progress', 'plateau', 'technique'
  ];
  
  const exclusions = [
    'meme', 'joke', 'lol', 'haha', 'ngd', 'new guitar day', 'new pedal day',
    'npd', 'just bought', 'check out my', 'look what i got', 'celebration',
    'appreciation post', 'rant', 'venting', 'relationship', 'interpersonal'
  ];
  
  // Check for exclusions
  for (const excl of exclusions) {
    if (combined.includes(excl)) return false;
  }
  
  // Check for pain indicators
  for (const indicator of painIndicators) {
    if (combined.includes(indicator)) return true;
  }
  
  // High comment count posts are often discussion-worthy
  if (post.num_comments >= 20 && post.score >= 50) return true;
  
  return false;
}

function buildPainPointFromPost(post, sub) {
  const title = post.title;
  const body = post.selftext || '';
  
  // Create a concise description
  let description = '';
  if (body && body.length > 10) {
    // Use first part of body text
    const cleanBody = body.replace(/\n+/g, ' ').trim();
    description = cleanBody.substring(0, 300);
    if (cleanBody.length > 300) description += '...';
  } else {
    description = `Reddit users in r/${sub} are discussing: "${title}"`;
  }
  
  // Create a clean title (max 80 chars)
  let ppTitle = title;
  if (ppTitle.length > 80) ppTitle = ppTitle.substring(0, 77) + '...';
  
  return {
    title: ppTitle,
    description: description || `Pain point discovered in r/${sub}: ${title}`,
    category: CATEGORY,
    subreddit: `r/${sub}`,
    discoveredBy: AGENT_ID
  };
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  const painPoints = [];
  let postsScanned = 0;
  
  // Try browser-based approach first
  try {
    console.log(`Navigating to r/${sub}...`);
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000 
    });
    await sleep(3000);
    
    // Scroll to load more posts
    console.log('Scrolling to load more posts...');
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);
    
    // Take a snapshot to read posts
    const content = await page.content();
    console.log(`Page content length: ${content.length}`);
    
    // Check if we got meaningful content
    if (content.includes('reddit') && content.length > 5000) {
      console.log('Browser approach seems to be working, using JSON API for structured data...');
    }
  } catch (e) {
    console.log(`Browser navigation issue: ${e.message}. Falling back to JSON API.`);
  }
  
  // Use JSON API for reliable structured data
  console.log(`Fetching r/${sub} via JSON API...`);
  await sleep(2000);
  
  let redditData = null;
  try {
    redditData = await fetchRedditJSON(sub);
  } catch (e) {
    console.log(`JSON API fetch error: ${e.message}`);
  }
  
  if (!redditData || !redditData.data || !redditData.data.children) {
    console.log(`Could not fetch r/${sub} data`);
    await logScan(sub, 0, 0, 'error');
    return [];
  }
  
  const posts = redditData.data.children.map(c => c.data);
  postsScanned = posts.length;
  console.log(`Fetched ${postsScanned} posts from r/${sub}`);
  
  // Analyze each post for pain points
  for (const post of posts) {
    if (isPainPoint(post)) {
      console.log(`  Pain point candidate: "${post.title.substring(0, 60)}..."`);
      
      // For high-engagement posts, fetch comments for more context
      let postBody = post.selftext || '';
      if (post.num_comments >= 10 && post.id) {
        try {
          await sleep(1500);
          const commentsData = await fetchPostComments(sub, post.id);
          if (commentsData && Array.isArray(commentsData) && commentsData[1]) {
            const topComments = commentsData[1].data?.children?.slice(0, 5) || [];
            const commentTexts = topComments
              .map(c => c.data?.body || '')
              .filter(b => b && b !== '[deleted]' && b !== '[removed]')
              .join(' | ');
            if (commentTexts) {
              postBody = (postBody + ' TOP COMMENTS: ' + commentTexts).substring(0, 2000);
            }
          }
        } catch (e) {
          // Comments fetch failed, use post body only
        }
      }
      
      painPoints.push({
        post,
        postBody,
        sub
      });
    }
  }
  
  console.log(`Found ${painPoints.length} pain points in r/${sub}`);
  
  // Submit each pain point
  const submittedIds = [];
  for (const pp of painPoints) {
    try {
      const ppData = buildPainPointFromPost(pp.post, sub);
      console.log(`  Submitting: "${ppData.title.substring(0, 50)}..."`);
      
      const createResp = await apiPost('/api/pain-points', ppData);
      console.log(`  Created pain point, response:`, JSON.stringify(createResp).substring(0, 200));
      
      const ppId = createResp.id || createResp.painPoint?.id || createResp._id;
      if (ppId) {
        // Link the source post
        await sleep(500);
        const postLinkData = {
          painPointId: ppId,
          redditPostId: pp.post.id,
          redditUrl: `https://reddit.com/r/${sub}/comments/${pp.post.id}/`,
          postTitle: pp.post.title,
          postBody: pp.postBody.substring(0, 2000),
          upvotes: pp.post.score,
          commentCount: pp.post.num_comments,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID
        };
        
        const linkResp = await apiPost('/api/pain-points/posts', postLinkData);
        console.log(`  Linked source post, response:`, JSON.stringify(linkResp).substring(0, 100));
        submittedIds.push(ppId);
      } else {
        console.log(`  Warning: No ID in response, cannot link source post`);
      }
      
      await sleep(500);
    } catch (e) {
      console.log(`  Error submitting pain point: ${e.message}`);
    }
  }
  
  // Log scan results
  await logScan(sub, postsScanned, painPoints.length, 'completed');
  
  return painPoints.map(pp => pp.post.title);
}

async function logScan(sub, postsScanned, painPointsFound, status) {
  try {
    const logData = {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned: postsScanned,
      painPointsFound: painPointsFound,
      status: status
    };
    const resp = await apiPost('/api/pain-points/scan-logs', logData);
    console.log(`Logged scan for r/${sub}:`, JSON.stringify(resp).substring(0, 100));
  } catch (e) {
    console.log(`Error logging scan for r/${sub}: ${e.message}`);
  }
}

async function main() {
  console.log('Marcus-J Scanner starting...');
  console.log(`CDP URL: ${CDP_URL}`);
  
  let browser;
  let page;
  
  try {
    console.log('Connecting to AdsPower browser...');
    browser = await chromium.connectOverCDP(CDP_URL);
    const context = browser.contexts()[0];
    
    // Close extra tabs, keep one
    const pages = context.pages();
    console.log(`Found ${pages.length} existing pages`);
    for (let i = 1; i < pages.length; i++) await pages[i].close();
    page = pages[0] || await context.newPage();
    
    console.log('Connected successfully!');
  } catch (e) {
    console.log(`Failed to connect to browser: ${e.message}`);
    console.log('Will try to proceed with JSON API fallback...');
    // Create a minimal page mock for JSON-only mode
    page = {
      goto: async () => {},
      evaluate: async () => {},
      waitForTimeout: async () => {},
      content: async () => '<html><body>fallback mode</body></html>'
    };
  }
  
  const results = {
    subredditsScanned: 0,
    totalPostsAnalyzed: 0,
    painPointsFound: [],
    errors: []
  };
  
  for (const sub of SUBREDDITS) {
    try {
      const ppTitles = await scanSubreddit(page, sub);
      results.subredditsScanned++;
      results.painPointsFound.push(...ppTitles.map(t => `r/${sub}: ${t}`));
      await sleep(3000); // Pause between subreddits
    } catch (e) {
      console.log(`Error scanning r/${sub}: ${e.message}`);
      results.errors.push(`r/${sub}: ${e.message}`);
      await logScan(sub, 0, 0, 'error');
    }
  }
  
  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${results.subredditsScanned}`);
  console.log(`Total pain points found: ${results.painPointsFound.length}`);
  console.log('\nPain points discovered:');
  results.painPointsFound.forEach((pp, i) => console.log(`  ${i+1}. ${pp.substring(0, 80)}`));
  if (results.errors.length > 0) {
    console.log('\nErrors:', results.errors);
  }
  
  // Don't disconnect - admin agent handles profile closure
  if (browser && browser.isConnected && typeof browser.isConnected === 'function') {
    // Just disconnect our CDP connection, don't close the browser
    await browser.close();
  }
}

main().catch(console.error);
