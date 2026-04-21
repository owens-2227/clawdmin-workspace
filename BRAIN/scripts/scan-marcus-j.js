const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:59838/devtools/browser/9840ec91-108c-4f19-a477-630478b266e5';
const AGENT_ID = 'marcus-j';
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

async function apiPost(path, data) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify(data),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function submitPainPoint(painPoint) {
  const result = await apiPost('/api/pain-points', {
    title: painPoint.title.substring(0, 80),
    description: painPoint.description,
    category: painPoint.category,
    subreddit: painPoint.subreddit,
    discoveredBy: AGENT_ID,
  });
  console.log(`  Created pain point: ${result.id || JSON.stringify(result)}`);
  return result.id;
}

async function submitPost(painPointId, post) {
  const result = await apiPost('/api/pain-points/posts', {
    painPointId,
    redditPostId: post.redditPostId,
    redditUrl: post.redditUrl,
    postTitle: post.postTitle,
    postBody: (post.postBody || '').substring(0, 2000),
    upvotes: post.upvotes,
    commentCount: post.commentCount,
    subreddit: post.subreddit,
    discoveredBy: AGENT_ID,
  });
  console.log(`  Linked post: ${JSON.stringify(result).substring(0, 100)}`);
}

async function logScan(subreddit, postsScanned, painPointsFound, status) {
  const result = await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned,
    painPointsFound,
    status,
  });
  console.log(`  Logged scan for r/${subreddit}: ${JSON.stringify(result).substring(0, 100)}`);
}

function isPainPoint(title, body) {
  const text = (title + ' ' + (body || '')).toLowerCase();
  const painSignals = [
    'how do i', 'is there a way', 'struggling with', 'frustrated', 'pain point',
    'wish there was', 'anyone else have trouble', 'can\'t figure out', 'hard to',
    'difficult to', 'annoying', 'problem with', 'issue with', 'help me',
    'looking for', 'recommend', 'alternative to', 'too expensive', 'too complex',
    'keeps crashing', 'doesn\'t work', 'broken', 'fix', 'workaround',
    'manually', 'tedious', 'time consuming', 'need help', 'is there an app',
    'tool for', 'plugin', 'software for', 'app that', 'way to track',
    'organize', 'manage', 'automate', 'workflow',
  ];
  return painSignals.some(signal => text.includes(signal));
}

function extractPainPointInfo(title, body, subreddit, category) {
  const text = (title + ' ' + (body || '')).toLowerCase();
  
  // Build a clear description based on the content
  let description = title;
  if (body && body.length > 10) {
    const firstPara = body.split('\n').filter(l => l.trim().length > 20)[0] || '';
    if (firstPara) description = `${title}. ${firstPara.substring(0, 200)}`;
  }

  return {
    title: title.substring(0, 80),
    description: description.substring(0, 400),
    category,
    subreddit: `r/${subreddit}`,
  };
}

async function fetchSubredditJSON(subreddit) {
  try {
    const res = await fetch(
      `https://www.reddit.com/r/${subreddit}/hot.json?limit=25&raw_json=1`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' } }
    );
    const data = await res.json();
    return data?.data?.children?.map(c => c.data) || [];
  } catch (e) {
    console.error(`  JSON API fallback failed for r/${subreddit}: ${e.message}`);
    return [];
  }
}

async function scanSubreddit(page, sub, category) {
  console.log(`\n=== Scanning r/${sub} ===`);
  let posts = [];
  
  try {
    // Try browser first
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000 
    });
    await sleep(3000);

    // Check for login wall or CAPTCHA
    const pageContent = await page.content();
    if (pageContent.includes('Log in to Reddit') || pageContent.includes('CAPTCHA') || pageContent.includes('captcha')) {
      console.log(`  Login wall or CAPTCHA detected for r/${sub}, using JSON fallback`);
      posts = await fetchSubredditJSON(sub);
    } else {
      // Scroll to load more posts
      for (let i = 0; i < 6; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
        await sleep(2000);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(1000);

      // Extract posts from page
      const extractedPosts = await page.evaluate(() => {
        const results = [];
        
        // Try shreddit-post elements (new Reddit)
        const postElements = document.querySelectorAll('shreddit-post, [data-testid="post-container"], article');
        
        postElements.forEach(el => {
          const titleEl = el.querySelector('h1, h2, h3, [slot="title"], [data-click-id="text"] h3, a[data-click-id="body"]');
          const title = titleEl?.textContent?.trim();
          if (!title || title.length < 5) return;
          
          const upvoteEl = el.querySelector('[score], faceplate-number, [data-testid="vote-count"]');
          const upvotes = parseInt(upvoteEl?.getAttribute('score') || upvoteEl?.textContent || '0') || 0;
          
          const commentEl = el.querySelector('[data-testid="comment-count"], a[href*="comments"]');
          const commentText = commentEl?.textContent || '0';
          const commentCount = parseInt(commentText.replace(/[^0-9]/g, '')) || 0;
          
          const linkEl = el.querySelector('a[href*="/comments/"]');
          const url = linkEl?.href || '';
          
          const postId = url.match(/\/comments\/([a-z0-9]+)\//)?.[1] || '';
          
          if (title && postId) {
            results.push({ title, upvotes, commentCount, url, postId });
          }
        });
        
        // If shreddit didn't work, try older selectors
        if (results.length === 0) {
          const oldPosts = document.querySelectorAll('.Post, [data-fullname]');
          oldPosts.forEach(el => {
            const titleEl = el.querySelector('h3, [data-click-id="text"] h3');
            const title = titleEl?.textContent?.trim();
            if (!title) return;
            
            const linkEl = el.querySelector('a[href*="/comments/"]');
            const url = linkEl?.href || '';
            const postId = url.match(/\/comments\/([a-z0-9]+)\//)?.[1] || '';
            
            if (title && postId) {
              results.push({ title, upvotes: 0, commentCount: 0, url, postId });
            }
          });
        }
        
        return results;
      });

      if (extractedPosts.length > 0) {
        console.log(`  Found ${extractedPosts.length} posts via browser`);
        // Convert to same format as JSON API
        posts = extractedPosts.map(p => ({
          title: p.title,
          score: p.upvotes,
          num_comments: p.commentCount,
          url: p.url,
          id: p.postId,
          selftext: '',
          stickied: false,
          subreddit: sub,
        }));
      } else {
        console.log(`  Browser extraction got 0 posts, falling back to JSON API`);
        posts = await fetchSubredditJSON(sub);
      }
    }
  } catch (e) {
    console.error(`  Browser error for r/${sub}: ${e.message}, using JSON fallback`);
    posts = await fetchSubredditJSON(sub);
  }

  if (posts.length === 0) {
    console.log(`  No posts found for r/${sub}`);
    await logScan(sub, 0, 0, 'completed');
    return { postsScanned: 0, painPointsFound: 0 };
  }

  console.log(`  Processing ${posts.length} posts...`);

  const painPoints = [];
  let postsScanned = 0;

  for (const post of posts) {
    if (post.stickied) continue;
    if ((post.score || 0) < 3) continue;
    
    const title = post.title || '';
    const body = post.selftext || '';
    postsScanned++;

    if (isPainPoint(title, body)) {
      // For high-engagement posts with potential, try to get more details
      let postBody = body;
      
      if (post.num_comments >= 10 && page && body.length < 50) {
        try {
          const postUrl = post.url || `https://www.reddit.com/r/${sub}/comments/${post.id}/`;
          await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await sleep(2500);
          
          const details = await page.evaluate(() => {
            const bodyEl = document.querySelector('[data-testid="post-rtjson-content"], .RichTextJSON-root, [slot="text-body"]');
            const body = bodyEl?.textContent?.trim() || '';
            
            const comments = [];
            const commentEls = document.querySelectorAll('[data-testid="comment"], shreddit-comment');
            commentEls.forEach((el, i) => {
              if (i >= 10) return;
              const text = el.querySelector('[data-testid="comment-rtjson-content"], p')?.textContent?.trim();
              if (text) comments.push(text.substring(0, 200));
            });
            
            return { body, comments };
          });
          
          postBody = details.body || body;
          console.log(`    Fetched post details: ${postBody.substring(0, 100)}...`);
          
          // Navigate back
          await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          await sleep(2000);
        } catch (e) {
          console.log(`    Could not fetch post details: ${e.message}`);
        }
      }

      const info = extractPainPointInfo(title, postBody, sub, category);
      const postUrl = post.url || `https://www.reddit.com/r/${sub}/comments/${post.id}/`;
      
      painPoints.push({
        ...info,
        redditPostId: post.id || '',
        redditUrl: postUrl,
        postTitle: title,
        postBody: postBody,
        upvotes: post.score || 0,
        commentCount: post.num_comments || 0,
      });
    }
    
    await sleep(500); // Small pause between processing
  }

  console.log(`  Found ${painPoints.length} pain points in r/${sub}`);

  // Submit pain points
  let submitted = 0;
  for (const pp of painPoints) {
    try {
      const id = await submitPainPoint(pp);
      if (id) {
        await submitPost(id, pp);
        submitted++;
      }
      await sleep(500);
    } catch (e) {
      console.error(`  Error submitting pain point: ${e.message}`);
    }
  }

  // Log scan results
  await logScan(sub, postsScanned, submitted, 'completed');
  
  return { postsScanned, painPointsFound: submitted };
}

async function main() {
  console.log(`Starting scan as ${AGENT_ID} at ${new Date().toISOString()}`);
  
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected to AdsPower browser via CDP');
    
    const context = browser.contexts()[0];
    const pages = context.pages();
    
    // Close extra tabs, keep one
    for (let i = 1; i < pages.length; i++) {
      await pages[i].close().catch(() => {});
    }
    const page = pages[0] || await context.newPage();
    
    console.log(`Got page, current URL: ${page.url()}`);

    const results = {
      subredditsScanned: 0,
      totalPostsAnalyzed: 0,
      painPointsDiscovered: [],
      errors: [],
    };

    for (const { name, category } of SUBREDDITS) {
      try {
        const { postsScanned, painPointsFound } = await scanSubreddit(page, name, category);
        results.subredditsScanned++;
        results.totalPostsAnalyzed += postsScanned;
        if (painPointsFound > 0) {
          results.painPointsDiscovered.push({ subreddit: name, count: painPointsFound });
        }
      } catch (e) {
        console.error(`Error scanning r/${name}: ${e.message}`);
        results.errors.push({ subreddit: name, error: e.message });
        await logScan(name, 0, 0, 'error').catch(() => {});
      }
      
      await sleep(3000); // Pause between subreddits
    }

    console.log('\n=== SCAN COMPLETE ===');
    console.log(`Subreddits scanned: ${results.subredditsScanned}`);
    console.log(`Total posts analyzed: ${results.totalPostsAnalyzed}`);
    console.log(`Pain points discovered: ${results.painPointsDiscovered.map(p => `${p.subreddit}(${p.count})`).join(', ')}`);
    if (results.errors.length > 0) {
      console.log(`Errors: ${results.errors.map(e => `${e.subreddit}: ${e.error}`).join(', ')}`);
    }

    // Don't close browser - admin handles that
    await browser.close().catch(() => {});

    return results;
  } catch (e) {
    console.error('Fatal error:', e);
    if (browser) await browser.close().catch(() => {});
    throw e;
  }
}

main().then(results => {
  process.exit(0);
}).catch(e => {
  console.error(e);
  process.exit(1);
});
