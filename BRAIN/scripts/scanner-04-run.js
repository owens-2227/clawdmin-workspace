#!/usr/bin/env node

const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:53585/devtools/browser/bb8734f7-4ca2-469e-92da-4f88b2e55a78';
const AGENT_ID = 'scanner-04';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const SUBREDDITS = [
  { name: 'Guitar', category: 'Music' },
  { name: 'guitarpedals', category: 'Music' },
  { name: 'Blues', category: 'Music' },
  { name: 'homerecording', category: 'Music' },
  { name: 'AnalogCommunity', category: 'Photography' },
  { name: 'streetphotography', category: 'Photography' },
  { name: 'MechanicalKeyboards', category: 'Mechanical Keyboards' },
  { name: 'photocritique', category: 'Photography' },
  { name: 'TMJ', category: 'TMJ & Chronic Pain' },
  { name: 'yinyoga', category: 'Yoga' },
];

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function apiPost(path, body) {
  const https = require('http');
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(API_BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'x-api-key': API_KEY,
      },
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function submitPainPoint(title, description, category, subreddit) {
  try {
    const res = await apiPost('/api/pain-points', {
      title: title.slice(0, 80),
      description,
      category,
      subreddit: `r/${subreddit}`,
      discoveredBy: AGENT_ID,
    });
    console.log(`  [API] Pain point created: ${res.status}`, JSON.stringify(res.data).slice(0, 200));
    return res.data?.id || res.data?.data?.id || null;
  } catch (e) {
    console.error(`  [API] Error creating pain point: ${e.message}`);
    return null;
  }
}

async function linkPost(painPointId, postId, postUrl, postTitle, postBody, upvotes, commentCount, subreddit) {
  try {
    const res = await apiPost('/api/pain-points/posts', {
      painPointId,
      redditPostId: postId,
      redditUrl: postUrl,
      postTitle,
      postBody: (postBody || '').slice(0, 2000),
      upvotes,
      commentCount,
      subreddit: `r/${subreddit}`,
      discoveredBy: AGENT_ID,
    });
    console.log(`  [API] Post linked: ${res.status}`);
  } catch (e) {
    console.error(`  [API] Error linking post: ${e.message}`);
  }
}

async function logScan(subreddit, postsScanned, painPointsFound, status = 'completed') {
  try {
    const res = await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${subreddit}`,
      postsScanned,
      painPointsFound,
      status,
    });
    console.log(`  [API] Scan log: ${res.status}`);
  } catch (e) {
    console.error(`  [API] Error logging scan: ${e.message}`);
  }
}

function isPainPoint(title, body = '') {
  const text = (title + ' ' + body).toLowerCase();
  const painIndicators = [
    'frustrated', 'frustrating', 'annoy', 'hate', 'wish', 'problem', 'issue',
    'struggle', 'difficult', 'hard to', 'can\'t find', 'can\'t figure',
    'is there a', 'any app', 'any tool', 'any software', 'any way to',
    'how do you', 'best way to', 'looking for', 'need help', 'manual',
    'tedious', 'time consuming', 'expensive', 'overpriced', 'too complex',
    'keeps breaking', 'doesn\'t work', 'no good solution', 'alternatives',
    'workflow', 'organize', 'track', 'automate', 'manage',
  ];
  return painIndicators.some(p => text.includes(p));
}

async function fetchSubredditJSON(subredditName) {
  const { execSync } = require('child_process');
  try {
    const result = execSync(
      `curl -s -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36" "https://www.reddit.com/r/${subredditName}/hot.json?limit=25&raw_json=1"`,
      { timeout: 30000 }
    );
    return JSON.parse(result.toString());
  } catch (e) {
    console.error(`  [JSON fallback] Error: ${e.message}`);
    return null;
  }
}

async function scanSubreddit(page, subredditName, category) {
  console.log(`\n=== Scanning r/${subredditName} (${category}) ===`);
  const painPoints = [];
  let postsScanned = 0;

  // Try browser first
  try {
    await page.goto(`https://www.reddit.com/r/${subredditName}/hot/`, { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000 
    });
    await sleep(3000);

    // Scroll to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    // Check if we got a valid page
    const title = await page.title();
    console.log(`  Page title: ${title}`);
    
    if (title.includes('blocked') || title.includes('403') || title.includes('Error')) {
      throw new Error('Page blocked or error');
    }

    // Try to extract posts from the new Reddit UI
    const posts = await page.evaluate(() => {
      const results = [];
      
      // New Reddit (shreddit) selectors
      const postElements = document.querySelectorAll('shreddit-post, article[data-testid="post-container"], [data-testid="post-container"]');
      
      postElements.forEach(el => {
        try {
          const titleEl = el.querySelector('h1, h3, [slot="title"], a[data-click-id="body"]');
          const title = titleEl?.textContent?.trim() || '';
          
          const scoreEl = el.querySelector('[data-click-id="upvote"] ~ span, faceplate-number[pretty], [id*="vote-count"]');
          const score = parseInt(scoreEl?.textContent?.replace(/[^0-9]/g, '') || '0') || 0;
          
          const commentsEl = el.querySelector('a[data-click-id="comments"], [data-testid="comments-count"]');
          const comments = commentsEl?.textContent?.trim() || '0';
          const commentCount = parseInt(comments.replace(/[^0-9]/g, '') || '0') || 0;
          
          const linkEl = el.querySelector('a[data-click-id="body"], a[href*="/comments/"]');
          const url = linkEl?.href || '';
          
          const bodyEl = el.querySelector('[data-testid="post-content"] p, .RichTextJSON-root p');
          const body = bodyEl?.textContent?.trim() || '';
          
          if (title && url) {
            results.push({ title, score, commentCount, url, body });
          }
        } catch (e) {}
      });
      
      // Also try older Reddit selectors
      if (results.length === 0) {
        document.querySelectorAll('.Post, .thing[data-type="link"]').forEach(el => {
          try {
            const titleEl = el.querySelector('h3, .title a');
            const title = titleEl?.textContent?.trim() || '';
            const scoreEl = el.querySelector('.score.unvoted, .score.likes, [class*="score"]');
            const score = parseInt(scoreEl?.textContent?.replace(/[^0-9]/g, '') || '0') || 0;
            const commentsEl = el.querySelector('a[data-click-id="comments"], .comments');
            const commentCount = parseInt(commentsEl?.textContent?.replace(/[^0-9]/g, '') || '0') || 0;
            const linkEl = el.querySelector('a[data-click-id="body"], .title a');
            const url = linkEl?.href || '';
            if (title && url) {
              results.push({ title, score, commentCount, url, body: '' });
            }
          } catch (e) {}
        });
      }
      
      return results;
    });

    console.log(`  Found ${posts.length} posts via browser`);
    
    if (posts.length >= 5) {
      postsScanned = posts.length;
      
      for (const post of posts) {
        if (!post.title || post.score < 3) continue;
        
        const postIdMatch = post.url.match(/comments\/([a-z0-9]+)\//);
        const postId = postIdMatch ? postIdMatch[1] : '';
        
        if (isPainPoint(post.title, post.body)) {
          painPoints.push({
            title: post.title,
            body: post.body,
            url: post.url,
            postId,
            score: post.score,
            commentCount: post.commentCount,
          });
        }
      }
      
      // For promising posts with good engagement, try to get more details
      const highEngagement = posts
        .filter(p => p.commentCount >= 10 && isPainPoint(p.title, p.body))
        .slice(0, 3);
      
      for (const post of highEngagement) {
        console.log(`  Reading post: "${post.title.slice(0, 60)}..."`);
        try {
          await page.goto(post.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await sleep(2500);
          
          const postDetails = await page.evaluate(() => {
            const bodyEl = document.querySelector('[data-testid="post-content"], .Post .RichTextJSON-root, shreddit-post .md');
            const body = bodyEl?.textContent?.trim() || '';
            return { body };
          });
          
          // Update the body in our pain points list
          const idx = painPoints.findIndex(p => p.url === post.url);
          if (idx >= 0) {
            painPoints[idx].body = postDetails.body || painPoints[idx].body;
          }
          
          await sleep(2000);
          await page.goto(`https://www.reddit.com/r/${subredditName}/hot/`, { 
            waitUntil: 'domcontentloaded', timeout: 20000 
          });
          await sleep(2000);
        } catch (e) {
          console.log(`  Could not read post details: ${e.message}`);
        }
      }
      
    } else {
      throw new Error('Not enough posts from browser, falling back to JSON');
    }
    
  } catch (e) {
    console.log(`  Browser approach failed (${e.message}), trying JSON API...`);
    
    const jsonData = await fetchSubredditJSON(subredditName);
    if (jsonData?.data?.children) {
      const posts = jsonData.data.children
        .map(c => c.data)
        .filter(p => !p.stickied && p.score >= 5);
      
      postsScanned = posts.length;
      console.log(`  Got ${posts.length} posts from JSON API`);
      
      for (const post of posts) {
        if (isPainPoint(post.title, post.selftext)) {
          const postIdMatch = post.url?.match(/comments\/([a-z0-9]+)\//);
          painPoints.push({
            title: post.title,
            body: post.selftext || '',
            url: `https://reddit.com${post.permalink}`,
            postId: post.id,
            score: post.score,
            commentCount: post.num_comments,
          });
        }
      }
    } else {
      console.log(`  JSON API also failed for r/${subredditName}`);
      await logScan(subredditName, 0, 0, 'error');
      return { postsScanned: 0, painPointsFound: 0 };
    }
  }

  console.log(`  Identified ${painPoints.length} potential pain points`);

  // Submit pain points
  let submitted = 0;
  for (const pp of painPoints.slice(0, 5)) { // Cap at 5 per subreddit
    const description = generateDescription(pp.title, pp.body, subredditName);
    const ppId = await submitPainPoint(pp.title, description, category, subredditName);
    
    if (ppId && pp.postId) {
      await linkPost(ppId, pp.postId, pp.url, pp.title, pp.body, pp.score, pp.commentCount, subredditName);
      submitted++;
    }
    await sleep(500);
  }

  await logScan(subredditName, postsScanned, submitted);
  return { postsScanned, painPointsFound: submitted };
}

function generateDescription(title, body, subreddit) {
  const bodyPreview = body ? body.slice(0, 200) : '';
  const context = bodyPreview ? ` Context: "${bodyPreview}"` : '';
  return `In r/${subreddit}, users experience: "${title}".${context} This represents a recurring pain point where users are seeking better solutions or tools.`.slice(0, 400);
}

async function main() {
  console.log(`[scanner-04] Starting scan at ${new Date().toISOString()}`);
  console.log(`Connecting to CDP: ${CDP_URL}`);
  
  let browser;
  const results = [];
  
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected to browser');
    
    const context = browser.contexts()[0];
    const pages = context.pages();
    
    // Close extra tabs
    for (let i = 1; i < pages.length; i++) {
      await pages[i].close().catch(() => {});
    }
    const page = pages[0] || await context.newPage();
    
    for (const { name, category } of SUBREDDITS) {
      try {
        const result = await scanSubreddit(page, name, category);
        results.push({ subreddit: name, ...result });
      } catch (e) {
        console.error(`  Error scanning r/${name}: ${e.message}`);
        await logScan(name, 0, 0, 'error');
        results.push({ subreddit: name, postsScanned: 0, painPointsFound: 0, error: e.message });
      }
      
      // Pace between subreddits
      await sleep(3000);
    }
    
  } catch (e) {
    console.error(`Fatal error: ${e.message}`);
  } finally {
    // Do NOT close the browser — admin agent handles that
  }
  
  // Summary
  console.log('\n\n=== SCAN COMPLETE ===');
  console.log(`Total subreddits: ${results.length}`);
  const totalPosts = results.reduce((s, r) => s + r.postsScanned, 0);
  const totalPainPoints = results.reduce((s, r) => s + r.painPointsFound, 0);
  console.log(`Total posts scanned: ${totalPosts}`);
  console.log(`Total pain points submitted: ${totalPainPoints}`);
  console.log('\nPer-subreddit results:');
  results.forEach(r => {
    console.log(`  r/${r.subreddit}: ${r.postsScanned} posts, ${r.painPointsFound} pain points${r.error ? ' (ERROR: ' + r.error + ')' : ''}`);
  });
  
  return results;
}

main().catch(console.error);
