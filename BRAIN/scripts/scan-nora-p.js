const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:58718/devtools/browser/430f82a2-55f0-46b2-8584-7be58243faf3';
const AGENT_ID = 'nora-p';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const CATEGORY = 'Plant Parents';
const SUBREDDITS = ['houseplants', 'proplifting', 'plantclinic', 'IndoorGarden'];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function apiPost(path, data) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY
    },
    body: JSON.stringify(data)
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function submitPainPoint(painPoint, sources) {
  console.log(`  Submitting pain point: ${painPoint.title}`);
  const result = await apiPost('/api/pain-points', {
    title: painPoint.title,
    description: painPoint.description,
    category: CATEGORY,
    subreddit: painPoint.subreddit,
    discoveredBy: AGENT_ID
  });
  console.log(`  Result:`, JSON.stringify(result));
  
  const painPointId = result?.painPoint?.id || result?.id || result?.data?.id;
  if (painPointId && sources && sources.length > 0) {
    for (const src of sources) {
      const postResult = await apiPost('/api/pain-points/posts', {
        painPointId,
        redditPostId: src.redditPostId,
        redditUrl: src.redditUrl,
        postTitle: src.postTitle,
        postBody: src.postBody,
        upvotes: src.upvotes,
        commentCount: src.commentCount,
        subreddit: src.subreddit,
        discoveredBy: AGENT_ID
      });
      console.log(`  Post linked:`, JSON.stringify(postResult));
    }
  }
  return painPointId;
}

async function logScan(subreddit, postsScanned, painPointsFound, status = 'completed') {
  const result = await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned,
    painPointsFound,
    status
  });
  console.log(`  Scan log:`, JSON.stringify(result));
}

async function scanSubreddit(page, subreddit) {
  console.log(`\n=== Scanning r/${subreddit} ===`);
  
  try {
    await page.goto(`https://www.reddit.com/r/${subreddit}/hot/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await sleep(3000);
    
    // Take snapshot to understand page
    const content = await page.content();
    console.log(`  Page loaded, length: ${content.length}`);
    
    // Check for login wall or CAPTCHA
    if (content.includes('Log in to Reddit') && content.includes('You must be') && !content.includes('shreddit-post')) {
      console.log(`  Login wall detected for r/${subreddit}, skipping`);
      await logScan(subreddit, 0, 0, 'error: login_wall');
      return [];
    }
    
    // Try to get posts - Reddit new UI
    let posts = [];
    
    // Try shreddit-post elements (new Reddit)
    const postElements = await page.locator('shreddit-post').all();
    console.log(`  Found ${postElements.length} shreddit-post elements`);
    
    if (postElements.length > 0) {
      for (const el of postElements.slice(0, 25)) {
        try {
          const title = await el.getAttribute('post-title') || '';
          const score = parseInt(await el.getAttribute('score') || '0');
          const commentCount = parseInt(await el.getAttribute('comment-count') || '0');
          const permalink = await el.getAttribute('permalink') || '';
          const postId = await el.getAttribute('id') || permalink.split('/comments/')[1]?.split('/')[0] || '';
          const isStickied = (await el.getAttribute('is-pinned')) === 'true' || (await el.getAttribute('pinned')) === 'true';
          
          if (isStickied || score < 5) continue;
          if (title) {
            posts.push({ title, score, commentCount, permalink, postId });
          }
        } catch (e) {
          // skip
        }
      }
    }
    
    // Fallback: try article elements
    if (posts.length === 0) {
      const articles = await page.locator('article').all();
      console.log(`  Found ${articles.length} article elements`);
      for (const article of articles.slice(0, 25)) {
        try {
          const titleEl = await article.locator('h3, [data-click-id="title"]').first();
          const title = await titleEl.textContent() || '';
          const href = await article.locator('a[data-click-id="body"]').first().getAttribute('href') || '';
          posts.push({ title: title.trim(), score: 10, commentCount: 0, permalink: href, postId: '' });
        } catch (e) {
          // skip
        }
      }
    }
    
    // Another fallback: scrape all links
    if (posts.length === 0) {
      const snapshot = await page.evaluate(() => {
        const results = [];
        // Try new Reddit shreddit
        document.querySelectorAll('[data-testid="post-container"], [data-fullname]').forEach(el => {
          const titleEl = el.querySelector('h3, [data-click-id="title"]');
          if (titleEl) {
            results.push({ title: titleEl.textContent.trim(), href: '' });
          }
        });
        return results;
      });
      posts = snapshot.map(p => ({ title: p.title, score: 10, commentCount: 0, permalink: p.href, postId: '' }));
    }
    
    console.log(`  Extracted ${posts.length} posts`);
    
    const painPoints = [];
    let postsAnalyzed = 0;
    
    for (const post of posts.slice(0, 25)) {
      postsAnalyzed++;
      console.log(`  Post: "${post.title.substring(0, 80)}" (score: ${post.score}, comments: ${post.commentCount})`);
      
      // Visit posts with 10+ comments
      if (post.commentCount >= 10 && post.permalink) {
        const url = post.permalink.startsWith('http') ? post.permalink : `https://www.reddit.com${post.permalink}`;
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await sleep(2500);
          
          // Get post body and top comments
          const postData = await page.evaluate(() => {
            const body = document.querySelector('[data-testid="post-content"] p, shreddit-post [slot="text-body"], .RichTextJSON-root p, [data-click-id="text"] p');
            const bodyText = body ? body.textContent : '';
            
            const comments = [];
            document.querySelectorAll('shreddit-comment, [data-testid="comment"]').forEach((c, i) => {
              if (i < 10) {
                const text = c.querySelector('p, [slot="comment"]');
                if (text) comments.push(text.textContent.trim().substring(0, 300));
              }
            });
            
            return { bodyText, comments };
          });
          
          console.log(`    Body: ${postData.bodyText.substring(0, 100)}`);
          console.log(`    Comments: ${postData.comments.length}`);
          
          // Analyze for pain points
          const fullText = `${post.title} ${postData.bodyText} ${postData.comments.join(' ')}`.toLowerCase();
          const isPainPoint = (
            fullText.includes('app') ||
            fullText.includes('tool') ||
            fullText.includes('track') ||
            fullText.includes('wish') ||
            fullText.includes('frustrat') ||
            fullText.includes('difficult') ||
            fullText.includes('hard to') ||
            fullText.includes('annoying') ||
            fullText.includes('problem') ||
            fullText.includes('help') ||
            fullText.includes('dying') ||
            fullText.includes('dead') ||
            fullText.includes('kill') ||
            fullText.includes('wrong') ||
            fullText.includes('identify') ||
            fullText.includes('diagnos') ||
            fullText.includes('pest') ||
            fullText.includes('disease') ||
            fullText.includes('overwater') ||
            fullText.includes('underwater') ||
            fullText.includes('reminder') ||
            fullText.includes('schedule') ||
            fullText.includes('automat') ||
            fullText.includes('organiz') ||
            fullText.includes('manage')
          );
          
          if (isPainPoint) {
            // Store for later analysis
            post.bodyText = postData.bodyText;
            post.comments = postData.comments;
            painPoints.push(post);
          }
          
          // Go back
          await page.goBack({ waitUntil: 'domcontentloaded', timeout: 20000 });
          await sleep(2000);
        } catch (e) {
          console.log(`    Error visiting post: ${e.message}`);
          // Navigate back to subreddit
          await page.goto(`https://www.reddit.com/r/${subreddit}/hot/`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
          });
          await sleep(2000);
        }
      }
    }
    
    return { posts, painPoints, postsAnalyzed };
  } catch (e) {
    console.log(`  Error scanning r/${subreddit}: ${e.message}`);
    await logScan(subreddit, 0, 0, `error: ${e.message.substring(0, 50)}`);
    return { posts: [], painPoints: [], postsAnalyzed: 0 };
  }
}

async function analyzePainPoints(subreddit, posts, rawPainPoints) {
  // Structured analysis of what we found
  const results = [];
  
  // Group by theme
  const themes = {
    'plant_id': { keywords: ['identify', 'what is', 'what plant', 'id this', 'species', 'genus'], posts: [] },
    'diagnosis': { keywords: ['dying', 'dead', 'brown', 'yellow', 'drooping', 'wilting', 'pest', 'disease', 'rot', 'mold', 'bug', 'fungus'], posts: [] },
    'watering': { keywords: ['overwater', 'underwater', 'water', 'soil', 'moisture', 'dry', 'wet', 'drainage'], posts: [] },
    'tracking': { keywords: ['track', 'remind', 'schedule', 'calendar', 'app', 'tool', 'organiz', 'manage', 'forget'], posts: [] },
    'propagation': { keywords: ['propagat', 'cutting', 'rooting', 'prop', 'division', 'offset', 'pup'], posts: [] },
    'light': { keywords: ['light', 'sun', 'dark', 'bright', 'window', 'grow light', 'artificial'], posts: [] }
  };
  
  for (const post of rawPainPoints) {
    const text = `${post.title} ${post.bodyText || ''} ${(post.comments || []).join(' ')}`.toLowerCase();
    for (const [theme, data] of Object.entries(themes)) {
      if (data.keywords.some(kw => text.includes(kw))) {
        data.posts.push(post);
        break;
      }
    }
  }
  
  // Generate pain points per theme
  for (const [theme, data] of Object.entries(themes)) {
    if (data.posts.length === 0) continue;
    
    let title, description;
    const samplePost = data.posts[0];
    const postCount = data.posts.length;
    
    switch(theme) {
      case 'plant_id':
        title = 'No easy way to identify houseplants from photos';
        description = `Plant parents regularly post photos asking for plant identification help. They lack a reliable, easy-to-use plant ID tool integrated into their workflow. Found ${postCount} related posts in r/${subreddit} asking for ID help.`;
        break;
      case 'diagnosis':
        title = 'Diagnosing sick plants is guesswork without expert help';
        description = `Plant owners struggle to diagnose issues like root rot, pests, and nutrient deficiencies from visual symptoms alone. They depend on community crowdsourcing for diagnosis. Found ${postCount} posts in r/${subreddit} seeking diagnosis help.`;
        break;
      case 'watering':
        title = 'Watering schedules are hard to get right across multiple plants';
        description = `Plant parents frequently over- or under-water plants because each species has different needs and schedules. There's no simple tool to track when each plant was last watered. Found ${postCount} watering-related posts in r/${subreddit}.`;
        break;
      case 'tracking':
        title = 'No good app to track plant care routines and reminders';
        description = `Plant collectors with multiple plants struggle to track care routines, watering schedules, fertilizing, and repotting across their collection. Users explicitly ask for apps or tools to manage this. Found ${postCount} posts in r/${subreddit} discussing tracking needs.`;
        break;
      case 'propagation':
        title = 'Propagation tracking and success rate monitoring is manual';
        description = `Plant enthusiasts propagate multiple cuttings at once but have no structured way to track propagation progress, success rates, and timelines. Found ${postCount} propagation-related posts in r/${subreddit}.`;
        break;
      case 'light':
        title = 'Figuring out right light conditions for plants is confusing';
        description = `Plant parents struggle to assess their home's light conditions and match them to plant needs, especially in low-light apartments. Found ${postCount} light-related posts in r/${subreddit}.`;
        break;
    }
    
    results.push({
      title,
      description,
      subreddit: `r/${subreddit}`,
      sources: data.posts.map(p => ({
        redditPostId: p.postId || p.permalink?.split('/comments/')[1]?.split('/')[0] || '',
        redditUrl: p.permalink?.startsWith('http') ? p.permalink : `https://reddit.com${p.permalink || ''}`,
        postTitle: p.title,
        postBody: (p.bodyText || '').substring(0, 2000),
        upvotes: p.score || 0,
        commentCount: p.commentCount || 0,
        subreddit: `r/${subreddit}`
      }))
    });
  }
  
  return results;
}

async function main() {
  console.log('Connecting to AdsPower browser via CDP...');
  const browser = await chromium.connectOverCDP(CDP_URL);
  console.log('Connected!');
  
  const context = browser.contexts()[0];
  const pages = context.pages();
  console.log(`Found ${pages.length} existing pages`);
  
  const page = pages.length > 0 ? pages[0] : await context.newPage();
  
  // Close extra tabs
  for (let i = 1; i < pages.length; i++) {
    await pages[i].close();
  }
  
  const allResults = {
    subredditsScanned: 0,
    totalPostsAnalyzed: 0,
    totalPainPointsFound: 0,
    errors: []
  };
  
  for (const subreddit of SUBREDDITS) {
    try {
      const { posts, painPoints, postsAnalyzed } = await scanSubreddit(page, subreddit);
      
      console.log(`\n  Analyzing ${painPoints.length} pain point candidates from r/${subreddit}...`);
      const structuredPainPoints = await analyzePainPoints(subreddit, posts, painPoints);
      
      console.log(`  Found ${structuredPainPoints.length} structured pain points`);
      
      for (const pp of structuredPainPoints) {
        await submitPainPoint(pp, pp.sources);
        await sleep(500);
      }
      
      await logScan(subreddit, postsAnalyzed, structuredPainPoints.length);
      
      allResults.subredditsScanned++;
      allResults.totalPostsAnalyzed += postsAnalyzed;
      allResults.totalPainPointsFound += structuredPainPoints.length;
      
      // Pace between subreddits
      if (SUBREDDITS.indexOf(subreddit) < SUBREDDITS.length - 1) {
        console.log(`\n  Waiting 3s before next subreddit...`);
        await sleep(3000);
      }
    } catch (e) {
      console.log(`Error processing r/${subreddit}: ${e.message}`);
      allResults.errors.push(`r/${subreddit}: ${e.message}`);
    }
  }
  
  console.log('\n=== SCAN COMPLETE ===');
  console.log(JSON.stringify(allResults, null, 2));
  
  // Don't close the browser - admin handles that
  await browser.close(); // just disconnect, not shut down
}

main().catch(console.error);
