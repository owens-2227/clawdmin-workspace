const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

const CDP_URL = 'ws://127.0.0.1:53336/devtools/browser/3bdfbc83-09d7-4252-b47a-96519f0e6c70';
const AGENT_ID = 'scanner-02';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const SUBREDDITS = [
  { name: 'nocode', category: 'No-Code & Builders' },
  { name: 'Nootropics', category: 'Biohacking' },
  { name: 'Biohackers', category: 'Biohacking' },
  { name: 'SideProject', category: 'No-Code & Builders' },
  { name: 'personalfinance', category: 'Personal Finance' },
  { name: 'cooking', category: 'Cooking' },
  { name: 'solotravel', category: 'Solo Travel' },
  { name: 'frugal', category: 'Personal Finance' },
  { name: 'therapists', category: 'Therapy' },
  { name: 'Journaling', category: 'Journaling' },
];

function apiPost(path, data) {
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
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => raw += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch(e) { resolve({ raw }); }
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
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => raw += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch(e) { reject(new Error('JSON parse failed: ' + raw.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function scanSubreddit(page, sub, category) {
  console.log(`\n=== Scanning r/${sub} ===`);
  
  let posts = [];
  
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
    
    // Try to extract posts from the page
    const pageContent = await page.content();
    
    // Check if we hit a login wall or error
    if (pageContent.includes('Log In') && pageContent.includes('Sign Up') && !pageContent.includes('shreddit-post')) {
      console.log(`r/${sub}: Login wall detected, falling back to JSON API`);
      throw new Error('Login wall');
    }
    
    // Extract posts using shreddit-post elements
    posts = await page.evaluate(() => {
      const postEls = document.querySelectorAll('shreddit-post');
      const results = [];
      postEls.forEach(el => {
        const title = el.getAttribute('post-title') || el.querySelector('h2, h3')?.textContent?.trim() || '';
        const score = parseInt(el.getAttribute('score') || '0', 10);
        const commentCount = parseInt(el.getAttribute('comment-count') || '0', 10);
        const permalink = el.getAttribute('permalink') || '';
        const postId = el.getAttribute('id') || permalink.split('/')[6] || '';
        const bodyText = el.querySelector('div[slot="text-body"]')?.textContent?.trim() || '';
        
        if (title && score >= 5) {
          results.push({ title, score, commentCount, permalink, postId, bodyText });
        }
      });
      return results;
    });
    
    console.log(`r/${sub}: Found ${posts.length} posts via browser`);
  } catch (err) {
    console.log(`r/${sub}: Browser approach failed (${err.message}), using JSON API fallback`);
  }
  
  // Fallback to JSON API if browser didn't work well
  if (posts.length < 5) {
    try {
      const data = await fetchRedditJSON(sub);
      if (data && data.data && data.data.children) {
        posts = data.data.children
          .filter(p => !p.data.stickied && p.data.score >= 5)
          .map(p => ({
            title: p.data.title,
            score: p.data.score,
            commentCount: p.data.num_comments,
            permalink: `https://reddit.com${p.data.permalink}`,
            postId: p.data.id,
            bodyText: p.data.selftext || '',
          }));
        console.log(`r/${sub}: Found ${posts.length} posts via JSON API`);
      }
    } catch (err) {
      console.log(`r/${sub}: JSON API also failed: ${err.message}`);
    }
  }
  
  // Analyze posts for pain points
  const painPoints = [];
  
  for (const post of posts) {
    const text = (post.title + ' ' + post.bodyText).toLowerCase();
    
    // Pain point indicators
    const hasPainIndicator = 
      text.includes('frustrated') || text.includes('frustrating') ||
      text.includes('struggling') || text.includes('struggle') ||
      text.includes('can\'t find') || text.includes('can\'t figure') ||
      text.includes('is there an app') || text.includes('is there a tool') ||
      text.includes('any app') || text.includes('any tool') ||
      text.includes('any software') || text.includes('app for') ||
      text.includes('tool for') || text.includes('how do i') ||
      text.includes('how to') || text.includes('best way to') ||
      text.includes('manually') || text.includes('tedious') ||
      text.includes('wish there was') || text.includes('wish i could') ||
      text.includes('need help') || text.includes('help me') ||
      text.includes('problem with') || text.includes('issue with') ||
      text.includes('annoying') || text.includes('pain point') ||
      text.includes('workflow') || text.includes('automate') ||
      text.includes('track') || text.includes('organize') ||
      text.includes('overwhelmed') || text.includes('confusing') ||
      text.includes('expensive') || text.includes('too complex') ||
      text.includes('alternative to') || text.includes('replace') ||
      (post.commentCount >= 10 && post.score >= 20);
    
    if (hasPainIndicator && post.title.length > 20) {
      painPoints.push(post);
    }
  }
  
  console.log(`r/${sub}: Identified ${painPoints.length} potential pain points`);
  
  // Submit pain points
  let submitted = 0;
  for (const post of painPoints.slice(0, 5)) { // Cap at 5 per subreddit
    try {
      // Derive a clean title and description
      const ppTitle = post.title.slice(0, 80);
      const ppDesc = post.bodyText 
        ? `${post.bodyText.slice(0, 200)}... (${post.commentCount} comments, score: ${post.score})`
        : `Post with ${post.commentCount} comments and score ${post.score}. Discusses pain points related to ${sub}.`;
      
      const ppResult = await apiPost('/api/pain-points', {
        title: ppTitle,
        description: ppDesc,
        category: category,
        subreddit: `r/${sub}`,
        discoveredBy: AGENT_ID,
      });
      
      console.log(`  Created pain point: ${ppTitle.slice(0, 50)}... => id=${ppResult.id || ppResult._id || 'unknown'}`);
      
      const ppId = ppResult.id || ppResult._id || ppResult.data?.id;
      if (ppId) {
        await apiPost('/api/pain-points/posts', {
          painPointId: ppId,
          redditPostId: post.postId,
          redditUrl: post.permalink,
          postTitle: post.title,
          postBody: post.bodyText?.slice(0, 2000) || '',
          upvotes: post.score,
          commentCount: post.commentCount,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID,
        });
      }
      
      submitted++;
    } catch (err) {
      console.log(`  Error submitting pain point: ${err.message}`);
    }
    await sleep(500);
  }
  
  // Log scan results
  try {
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned: posts.length,
      painPointsFound: submitted,
      status: 'completed',
    });
    console.log(`r/${sub}: Logged scan (${posts.length} posts scanned, ${submitted} pain points submitted)`);
  } catch (err) {
    console.log(`r/${sub}: Failed to log scan: ${err.message}`);
  }
  
  return { sub, postsScanned: posts.length, painPointsFound: submitted };
}

async function main() {
  console.log(`Scanner ${AGENT_ID} starting...`);
  console.log(`CDP URL: ${CDP_URL}`);
  console.log(`Subreddits: ${SUBREDDITS.map(s => s.name).join(', ')}`);
  
  let browser;
  let page;
  
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected to browser via CDP');
    
    const context = browser.contexts()[0];
    const pages = context.pages();
    
    // Close extra tabs
    for (let i = 1; i < pages.length; i++) await pages[i].close();
    page = pages[0] || await context.newPage();
    
    console.log('Browser ready');
  } catch (err) {
    console.error('Failed to connect to browser:', err.message);
    console.log('Will use JSON API fallback for all subreddits');
    page = null;
  }
  
  const results = [];
  
  for (const { name, category } of SUBREDDITS) {
    try {
      const result = await scanSubreddit(page, name, category);
      results.push(result);
    } catch (err) {
      console.log(`r/${name}: Fatal error: ${err.message}`);
      results.push({ sub: name, postsScanned: 0, painPointsFound: 0, error: err.message });
      
      // Log error
      try {
        await apiPost('/api/pain-points/scan-logs', {
          agentId: AGENT_ID,
          subreddit: `r/${name}`,
          postsScanned: 0,
          painPointsFound: 0,
          status: 'error',
        });
      } catch {}
    }
    await sleep(2000); // Pace between subreddits
  }
  
  // Summary
  console.log('\n=== SCAN SUMMARY ===');
  let totalPosts = 0, totalPainPoints = 0;
  for (const r of results) {
    console.log(`r/${r.sub}: ${r.postsScanned} posts, ${r.painPointsFound} pain points${r.error ? ` [ERROR: ${r.error}]` : ''}`);
    totalPosts += r.postsScanned || 0;
    totalPainPoints += r.painPointsFound || 0;
  }
  console.log(`\nTOTAL: ${results.length} subreddits, ${totalPosts} posts scanned, ${totalPainPoints} pain points submitted`);
  
  if (browser) {
    try { await browser.close(); } catch {}
  }
  
  return results;
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
