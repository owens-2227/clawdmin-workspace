const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:57873/devtools/browser/379ce349-2d9e-4520-b579-89b0553fbb4d';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const AGENT_ID = 'ty-m';
const SUBREDDITS = ['bikecommuting', 'gravelcycling', 'bikewrench', 'fuckcars'];

async function apiPost(path, data) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(data)
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  
  let posts = [];
  
  try {
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);
    
    // Scroll to load posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);
    
    // Take a snapshot to see what's on the page
    const content = await page.content();
    const title = await page.title();
    console.log(`Page title: ${title}`);
    
    // Try to extract posts from the page using various selectors
    posts = await page.evaluate(() => {
      const results = [];
      
      // Try shreddit-post elements (new Reddit)
      const shredditPosts = document.querySelectorAll('shreddit-post');
      if (shredditPosts.length > 0) {
        shredditPosts.forEach(post => {
          const title = post.getAttribute('post-title') || post.querySelector('[slot="title"]')?.textContent?.trim() || '';
          const score = parseInt(post.getAttribute('score') || '0');
          const commentCount = parseInt(post.getAttribute('comment-count') || '0');
          const permalink = post.getAttribute('permalink') || '';
          const postId = post.getAttribute('id') || permalink.split('/')[6] || '';
          const isStickied = post.getAttribute('is-stickied') === 'true';
          
          if (title && !isStickied && score >= 5) {
            results.push({ title, score, commentCount, permalink, postId, body: '' });
          }
        });
        return results;
      }
      
      // Try old Reddit style elements
      const oldPosts = document.querySelectorAll('.thing.link:not(.stickied)');
      if (oldPosts.length > 0) {
        oldPosts.forEach(post => {
          const title = post.querySelector('a.title')?.textContent?.trim() || '';
          const score = parseInt(post.querySelector('.score.unvoted')?.getAttribute('title') || '0');
          const commentCount = parseInt(post.querySelector('.comments')?.textContent?.match(/\d+/)?.[0] || '0');
          const permalink = post.querySelector('a.comments')?.href || '';
          const postId = post.getAttribute('data-fullname')?.replace('t3_', '') || '';
          
          if (title && score >= 5) {
            results.push({ title, score, commentCount, permalink, postId, body: '' });
          }
        });
        return results;
      }
      
      return results;
    });
    
    console.log(`Found ${posts.length} posts via page scraping`);
    
    // Fallback: use JSON API if page scraping failed
    if (posts.length < 3) {
      console.log('Falling back to JSON API...');
      const jsonUrl = `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`;
      await page.goto(jsonUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(2000);
      
      const jsonText = await page.evaluate(() => document.body.innerText);
      try {
        const data = JSON.parse(jsonText);
        posts = (data.data?.children || [])
          .filter(c => !c.data.stickied && c.data.score >= 5)
          .map(c => ({
            title: c.data.title,
            score: c.data.score,
            commentCount: c.data.num_comments,
            permalink: `https://reddit.com${c.data.permalink}`,
            postId: c.data.id,
            body: c.data.selftext || ''
          }));
        console.log(`JSON API returned ${posts.length} posts`);
      } catch(e) {
        console.log('JSON parse failed:', e.message);
      }
    }
  } catch(e) {
    console.log(`Error loading r/${sub}: ${e.message}`);
  }
  
  // For top posts with 10+ comments, fetch body/comments
  const interestingPosts = posts.filter(p => p.commentCount >= 10).slice(0, 8);
  for (const post of interestingPosts) {
    if (post.body) continue; // already have body from JSON
    try {
      // Use JSON API to get post body and comments
      const jsonUrl = `https://www.reddit.com/r/${sub}/comments/${post.postId}.json?limit=10&raw_json=1`;
      await page.goto(jsonUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(2000);
      const jsonText = await page.evaluate(() => document.body.innerText);
      const data = JSON.parse(jsonText);
      post.body = data[0]?.data?.children?.[0]?.data?.selftext || '';
      const topComments = (data[1]?.data?.children || [])
        .slice(0, 8)
        .map(c => c.data?.body || '')
        .filter(Boolean)
        .join('\n---\n');
      post.comments = topComments;
    } catch(e) {
      // ignore
    }
    await sleep(2000);
  }
  
  return posts;
}

function analyzePainPoints(posts, sub) {
  const painPoints = [];
  
  const painKeywords = [
    'frustrat', 'annoying', 'hate', 'problem', 'issue', 'struggle', 'difficult', 'hard to',
    'wish there was', 'wish i could', 'need a way', 'is there an app', 'tool for', 
    'any app', 'any tool', 'any software', 'any way to', 'manually', 'tedious', 
    'complicated', 'expensive', 'too much', 'cant find', "can't find", 'looking for',
    'recommendation', 'best way to', 'how do you', 'help with', 'advice', 'tips for',
    'overwhelmed', 'confused', 'lost', 'no idea', "doesn't work", 'broken', 'fails',
    'keeps happening', 'recurring', 'always have to', 'every time', 'pain point',
    'what do you use', 'tracking', 'organize', 'manage', 'plan', 'schedule'
  ];
  
  for (const post of posts) {
    const fullText = (post.title + ' ' + post.body + ' ' + (post.comments || '')).toLowerCase();
    const matchCount = painKeywords.filter(k => fullText.includes(k)).length;
    
    if (matchCount >= 1 || post.commentCount >= 15) {
      painPoints.push({ post, matchCount });
    }
  }
  
  // Sort by relevance
  painPoints.sort((a, b) => b.matchCount - a.matchCount);
  return painPoints.slice(0, 5); // top 5 per subreddit
}

async function main() {
  let browser;
  const summary = { subreddits: [], totalPosts: 0, totalPainPoints: 0, errors: [] };
  
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected to AdsPower browser');
    
    const context = browser.contexts()[0];
    const pages = context.pages();
    
    // Close extra tabs
    for (let i = 1; i < pages.length; i++) {
      try { await pages[i].close(); } catch {}
    }
    const page = pages[0] || await context.newPage();
    
    for (const sub of SUBREDDITS) {
      const subResult = { sub, postsScanned: 0, painPointsFound: 0, error: null };
      
      try {
        const posts = await scanSubreddit(page, sub);
        subResult.postsScanned = posts.length;
        summary.totalPosts += posts.length;
        
        const painPoints = analyzePainPoints(posts, sub);
        console.log(`\nAnalyzed r/${sub}: ${posts.length} posts, ${painPoints.length} pain points`);
        
        // Submit pain points
        for (const { post } of painPoints) {
          try {
            // Build description
            let desc = post.body ? post.body.slice(0, 400).trim() : post.title;
            if (!desc || desc === '[removed]' || desc === '[deleted]') desc = post.title;
            
            const ppData = {
              title: post.title.slice(0, 80),
              description: desc.slice(0, 500) + (desc.length > 500 ? '...' : '') + ` (r/${sub}, ${post.commentCount} comments)`,
              category: 'Cycling',
              subreddit: `r/${sub}`,
              discoveredBy: AGENT_ID
            };
            
            console.log(`Submitting: ${ppData.title.slice(0, 60)}...`);
            const ppRes = await apiPost('/api/pain-points', ppData);
            const ppId = ppRes.painPoint?.id || ppRes.id || ppRes.data?.id;
            
            if (ppId) {
              // Link source post
              await apiPost('/api/pain-points/posts', {
                painPointId: ppId,
                redditPostId: post.postId,
                redditUrl: post.permalink,
                postTitle: post.title,
                postBody: (post.body || '').slice(0, 2000),
                upvotes: post.score,
                commentCount: post.commentCount,
                subreddit: `r/${sub}`,
                discoveredBy: AGENT_ID
              });
              subResult.painPointsFound++;
              summary.totalPainPoints++;
            }
          } catch(e) {
            console.log(`Failed to submit pain point: ${e.message}`);
          }
          await sleep(500);
        }
      } catch(e) {
        subResult.error = e.message;
        summary.errors.push(`r/${sub}: ${e.message}`);
        console.log(`Error scanning r/${sub}: ${e.message}`);
      }
      
      // Log scan results
      try {
        await apiPost('/api/pain-points/scan-logs', {
          agentId: AGENT_ID,
          subreddit: `r/${sub}`,
          postsScanned: subResult.postsScanned,
          painPointsFound: subResult.painPointsFound,
          status: subResult.error ? 'error' : 'completed'
        });
      } catch(e) {
        console.log(`Failed to log scan: ${e.message}`);
      }
      
      summary.subreddits.push(subResult);
      await sleep(3000); // pause between subreddits
    }
    
  } catch(e) {
    console.error('Fatal error:', e.message);
    summary.errors.push(`Fatal: ${e.message}`);
  }
  
  // Print summary
  console.log('\n========== SCAN COMPLETE ==========');
  console.log(`Subreddits scanned: ${summary.subreddits.length}`);
  console.log(`Total posts analyzed: ${summary.totalPosts}`);
  console.log(`Total pain points submitted: ${summary.totalPainPoints}`);
  console.log('\nPer subreddit:');
  for (const s of summary.subreddits) {
    console.log(`  r/${s.sub}: ${s.postsScanned} posts, ${s.painPointsFound} pain points${s.error ? ` [ERROR: ${s.error}]` : ''}`);
  }
  if (summary.errors.length > 0) {
    console.log('\nErrors:', summary.errors.join('\n'));
  }
  
  // Output JSON for easy parsing
  console.log('\nSUMMARY_JSON:' + JSON.stringify(summary));
}

main().catch(e => {
  console.error('Unhandled error:', e);
  process.exit(1);
});
