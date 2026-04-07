const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

const CDP_URL = 'ws://127.0.0.1:57974/devtools/browser/e34900d6-75a5-47d9-893a-4ffadcfa9f31';
const AGENT_ID = 'priya-k';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const SUBREDDITS = ['Meditation', 'Anxiety', 'therapists', 'Journaling'];

const CATEGORY_MAP = {
  'Meditation': 'Mental Health',
  'Anxiety': 'Mental Health',
  'therapists': 'Therapy',
  'Journaling': 'Journaling',
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function apiPost(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const url = new URL(API_BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch(e) {
          resolve({ raw: data });
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
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    };
    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch(e) {
          resolve(null);
        }
      });
    }).on('error', reject);
  });
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  const category = CATEGORY_MAP[sub] || 'Mental Health';
  let posts = [];
  let painPoints = [];

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

    // Extract posts from new Reddit UI (shreddit)
    const content = await page.content();
    
    // Try to extract post data from page
    const postData = await page.evaluate(() => {
      const results = [];
      
      // Try shreddit-post elements
      const shredditPosts = document.querySelectorAll('shreddit-post');
      shredditPosts.forEach(el => {
        const title = el.getAttribute('post-title') || el.querySelector('[slot="title"]')?.textContent?.trim();
        const score = parseInt(el.getAttribute('score') || '0');
        const commentCount = parseInt(el.getAttribute('comment-count') || '0');
        const permalink = el.getAttribute('permalink') || '';
        const postId = el.getAttribute('id') || permalink.split('/')[4] || '';
        const bodyText = el.querySelector('[slot="text-body"]')?.textContent?.trim() || '';
        
        if (title) {
          results.push({ title, score, commentCount, permalink, postId, bodyText });
        }
      });
      
      // Fallback: try article/post link elements
      if (results.length === 0) {
        const articles = document.querySelectorAll('article, [data-testid="post-container"]');
        articles.forEach(el => {
          const titleEl = el.querySelector('h1, h2, h3, [data-click-id="text"] a');
          const title = titleEl?.textContent?.trim();
          const link = el.querySelector('a[href*="/comments/"]');
          const permalink = link?.getAttribute('href') || '';
          
          if (title && permalink) {
            results.push({ title, score: 0, commentCount: 0, permalink, postId: permalink.split('/')[4] || '', bodyText: '' });
          }
        });
      }
      
      return results;
    });
    
    console.log(`Browser found ${postData.length} posts`);
    posts = postData;
  } catch(e) {
    console.log(`Browser scan failed: ${e.message}, falling back to JSON API`);
  }

  // If browser didn't get enough posts, use JSON API fallback
  if (posts.length < 5) {
    console.log(`Falling back to JSON API for r/${sub}`);
    try {
      const json = await fetchRedditJSON(sub);
      if (json && json.data && json.data.children) {
        posts = json.data.children
          .filter(c => !c.data.stickied && c.data.score >= 5)
          .map(c => ({
            title: c.data.title,
            score: c.data.score,
            commentCount: c.data.num_comments,
            permalink: c.data.permalink,
            postId: c.data.id,
            bodyText: c.data.selftext || '',
          }));
        console.log(`JSON API found ${posts.length} posts`);
      }
    } catch(e) {
      console.log(`JSON API fallback also failed: ${e.message}`);
    }
  }

  // Filter and analyze posts for pain points
  const interesting = posts.filter(p => 
    p.score >= 5 && 
    p.commentCount >= 3 &&
    p.title &&
    !p.title.toLowerCase().includes('weekly') &&
    !p.title.toLowerCase().includes('daily') &&
    !p.title.toLowerCase().includes('megathread')
  );

  console.log(`Analyzing ${interesting.length} posts for pain points...`);

  // For promising posts, try to get more details via browser
  const painPointPosts = [];
  
  for (const post of interesting.slice(0, 20)) {
    const title = post.title.toLowerCase();
    const body = post.bodyText.toLowerCase();
    
    // Check if this looks like an actionable pain point
    const isPainPoint = (
      title.includes('app') || title.includes('tool') || title.includes('track') ||
      title.includes('how do') || title.includes('how can') || title.includes('anyone else') ||
      title.includes('struggle') || title.includes('problem') || title.includes('hard') ||
      title.includes('difficult') || title.includes('help') || title.includes('looking for') ||
      title.includes('recommend') || title.includes('advice') || title.includes('tips') ||
      title.includes('frustrat') || title.includes('overwhelm') || title.includes('anxiety') ||
      title.includes('habit') || title.includes('routine') || title.includes('consistenc') ||
      title.includes('motivat') || title.includes('stuck') || title.includes('can\'t') ||
      title.includes('cannot') || title.includes('manage') || title.includes('organiz') ||
      title.includes('remind') || title.includes('journal') || title.includes('meditat') ||
      body.includes('app') || body.includes('tool') || body.includes('track') ||
      body.includes('struggle') || body.includes('hard') || body.includes('difficult') ||
      body.includes('frustrat') || body.includes('overwhelm')
    );
    
    if (isPainPoint) {
      // Try to get more details by visiting the post
      let fullBody = post.bodyText;
      try {
        const postUrl = `https://www.reddit.com${post.permalink}`;
        await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await sleep(2000);
        
        const details = await page.evaluate(() => {
          // Get post body
          const bodyEl = document.querySelector('[data-testid="post-rtjson-content"], shreddit-post [slot="text-body"], .RichTextJSON-root');
          const body = bodyEl?.textContent?.trim() || '';
          
          // Get top comments
          const comments = [];
          const commentEls = document.querySelectorAll('[data-testid="comment"], shreddit-comment');
          commentEls.forEach((el, i) => {
            if (i < 5) {
              const text = el.querySelector('[data-testid="comment-top-meta"] + *, .RichTextJSON-root, [slot="comment"]')?.textContent?.trim();
              if (text) comments.push(text.substring(0, 200));
            }
          });
          
          return { body, comments };
        });
        
        if (details.body) fullBody = details.body;
        console.log(`  Read post: "${post.title.substring(0, 60)}..." (body: ${fullBody.length} chars)`);
        await sleep(2500);
      } catch(e) {
        console.log(`  Couldn't read post details: ${e.message}`);
      }
      
      painPointPosts.push({ ...post, fullBody });
    }
  }

  // Now build pain point submissions from the analyzed posts
  // Group similar themes
  const themes = {
    'app_tracking': [],
    'consistency_habit': [],
    'overwhelm_anxiety': [],
    'tool_recommendation': [],
    'other': [],
  };
  
  for (const post of painPointPosts) {
    const t = post.title.toLowerCase();
    if (t.includes('app') || t.includes('tool') || t.includes('track')) {
      themes.app_tracking.push(post);
    } else if (t.includes('habit') || t.includes('routine') || t.includes('consist') || t.includes('motivat')) {
      themes.consistency_habit.push(post);
    } else if (t.includes('overwhelm') || t.includes('anxiet') || t.includes('stress') || t.includes('panic')) {
      themes.overwhelm_anxiety.push(post);
    } else if (t.includes('recommend') || t.includes('advice') || t.includes('tips') || t.includes('suggest')) {
      themes.tool_recommendation.push(post);
    } else {
      themes.other.push(post);
    }
  }

  // Submit individual pain points for the best posts
  let painPointsFound = 0;
  
  for (const post of painPointPosts.slice(0, 8)) {
    // Generate a pain point title and description from the post
    let ppTitle = post.title.substring(0, 80);
    let ppDescription = '';
    
    const bodyPreview = (post.fullBody || post.bodyText || '').substring(0, 300);
    
    if (bodyPreview) {
      ppDescription = `${ppTitle}. ${bodyPreview.substring(0, 200)}`;
    } else {
      ppDescription = `Users in r/${sub} report: ${ppTitle}. This represents a recurring challenge around ${category.toLowerCase()} that lacks adequate tooling or support.`;
    }
    ppDescription = ppDescription.substring(0, 500);
    
    try {
      const ppResult = await apiPost('/api/pain-points', {
        title: ppTitle,
        description: ppDescription,
        category: category,
        subreddit: `r/${sub}`,
        discoveredBy: AGENT_ID,
      });
      
      console.log(`  Submitted pain point: "${ppTitle.substring(0, 50)}..." -> id: ${ppResult.id || JSON.stringify(ppResult).substring(0, 50)}`);
      
      if (ppResult.id) {
        // Link source post
        const redditPostId = post.postId || post.permalink?.split('/')[4] || 'unknown';
        const redditUrl = `https://reddit.com${post.permalink}`;
        
        await apiPost('/api/pain-points/posts', {
          painPointId: ppResult.id,
          redditPostId: redditPostId,
          redditUrl: redditUrl,
          postTitle: post.title,
          postBody: (post.fullBody || post.bodyText || '').substring(0, 2000),
          upvotes: post.score || 0,
          commentCount: post.commentCount || 0,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID,
        });
        console.log(`  Linked source post for pain point ${ppResult.id}`);
      }
      
      painPointsFound++;
      await sleep(500);
    } catch(e) {
      console.log(`  Failed to submit pain point: ${e.message}`);
    }
  }

  // Log scan result
  try {
    const logResult = await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned: posts.length,
      painPointsFound: painPointsFound,
      status: 'completed',
    });
    console.log(`Logged scan for r/${sub}: ${posts.length} posts, ${painPointsFound} pain points. Log id: ${logResult.id || JSON.stringify(logResult).substring(0, 30)}`);
  } catch(e) {
    console.log(`Failed to log scan: ${e.message}`);
  }

  return { sub, postsScanned: posts.length, painPointsFound, posts: painPointPosts.map(p => p.title) };
}

async function main() {
  console.log(`Starting scan as ${AGENT_ID} via CDP: ${CDP_URL}`);
  
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected to browser via CDP');
  } catch(e) {
    console.error(`Failed to connect via CDP: ${e.message}`);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  if (!context) {
    console.error('No browser context found');
    process.exit(1);
  }

  // Clean up extra tabs
  const pages = context.pages();
  for (let i = 1; i < pages.length; i++) {
    await pages[i].close();
  }
  const page = pages[0] || await context.newPage();
  console.log(`Using page. Total pages was: ${pages.length}`);

  const results = [];
  for (const sub of SUBREDDITS) {
    try {
      const result = await scanSubreddit(page, sub);
      results.push(result);
    } catch(e) {
      console.error(`Error scanning r/${sub}: ${e.message}`);
      results.push({ sub, postsScanned: 0, painPointsFound: 0, error: e.message });
      // Log failure
      try {
        await apiPost('/api/pain-points/scan-logs', {
          agentId: AGENT_ID,
          subreddit: `r/${sub}`,
          postsScanned: 0,
          painPointsFound: 0,
          status: 'error',
        });
      } catch(e2) {}
    }
    // Brief pause between subreddits
    await sleep(3000);
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log(JSON.stringify(results, null, 2));
  
  // DO NOT close the browser - admin agent handles that
  // Just disconnect
  await browser.close(); // This disconnects without closing the browser
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
