const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

const CDP_URL = 'ws://127.0.0.1:49361/devtools/browser/0534151b-60cd-4354-a17c-5eb832fbe780';
const AGENT_ID = 'marcus-j';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const SUBREDDITS = [
  'Guitar', 'guitarpedals', 'Blues', 'homerecording',
  'AnalogCommunity', 'streetphotography', 'MechanicalKeyboards',
  'photocritique', 'TMJ', 'yinyoga'
];

const CATEGORY_MAP = {
  'Guitar': 'Music',
  'guitarpedals': 'Music',
  'Blues': 'Music',
  'homerecording': 'Music',
  'AnalogCommunity': 'Photography',
  'streetphotography': 'Photography',
  'MechanicalKeyboards': 'Mechanical Keyboards',
  'photocritique': 'Photography',
  'TMJ': 'TMJ & Chronic Pain',
  'yinyoga': 'Yoga'
};

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
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { resolve(data); }
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
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(new Error('Parse error: ' + data.substring(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isPainPoint(post) {
  if (!post.selftext && !post.title) return false;
  if (post.score < 5) return false;
  if (post.stickied) return false;
  
  const text = (post.title + ' ' + (post.selftext || '')).toLowerCase();
  
  // Pain point indicators
  const painIndicators = [
    'struggling', 'frustrated', 'annoying', 'problem', 'issue', 'help',
    'how do i', 'how do you', 'anyone else', 'is there a', 'looking for',
    'can\'t figure', 'stuck', 'difficult', 'hard to', 'wish there was',
    'need advice', 'best way to', 'alternative to', 'too expensive',
    'recommend', 'advice', 'should i', 'worth it', 'confused',
    'newbie', 'beginner', 'starting out', 'learning', 'pain',
    'app for', 'tool for', 'software for', 'workflow', 'organize',
    'track', 'manage', 'automate', 'template', 'system'
  ];
  
  // Exclusions
  const excludePatterns = [
    'check out my', 'just finished', 'oc]', '[oc]', 'look what i made',
    'appreciation post', 'this is amazing', 'love my', 'beautiful'
  ];
  
  const hasExclusion = excludePatterns.some(p => text.includes(p));
  if (hasExclusion && post.is_gallery) return false;
  
  const hasPain = painIndicators.some(indicator => text.includes(indicator));
  return hasPain && (post.selftext || post.title.includes('?'));
}

function extractPainPointDetails(post, sub) {
  const title = post.title.substring(0, 80);
  const body = post.selftext ? post.selftext.substring(0, 500) : '';
  
  let description = `Reddit user in r/${sub} asks: "${post.title}"`;
  if (body) {
    description += ` ${body.substring(0, 200).replace(/\n/g, ' ')}`;
  }
  description = description.substring(0, 400);
  
  return {
    title: title,
    description: description,
    category: CATEGORY_MAP[sub] || 'Music',
    subreddit: `r/${sub}`,
    discoveredBy: AGENT_ID
  };
}

async function scanSubredditWithBrowser(page, sub) {
  console.log(`\n📡 Scanning r/${sub} via browser...`);
  const posts = [];
  
  try {
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000 
    });
    await sleep(3000);
    
    // Check for login wall or error
    const url = page.url();
    console.log(`  Page URL: ${url}`);
    
    // Scroll to load more posts
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(1500);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);
    
    // Try to extract posts from page
    const pageContent = await page.content();
    
    // Check if we're on the right page
    if (pageContent.includes('reddit') && !pageContent.includes('blocked')) {
      // Try shreddit post elements
      const postData = await page.evaluate(() => {
        const posts = [];
        
        // Try new Reddit (shreddit) selectors
        const articleEls = document.querySelectorAll('article, [data-testid="post-container"], shreddit-post');
        articleEls.forEach(el => {
          const titleEl = el.querySelector('h1, h2, h3, [slot="title"], a[href*="/comments/"]');
          const title = titleEl ? titleEl.textContent.trim() : '';
          if (!title) return;
          
          const linkEl = el.querySelector('a[href*="/comments/"]');
          const href = linkEl ? linkEl.href : '';
          const match = href.match(/\/comments\/([a-z0-9]+)\//i);
          const postId = match ? match[1] : '';
          
          const scoreEl = el.querySelector('[aria-label*="upvote"], .score, [id*="vote-arrows"]');
          
          posts.push({
            title: title.substring(0, 200),
            url: href,
            postId: postId,
            score: 0, // can't easily get score
            hasText: el.textContent.length > 300
          });
        });
        
        return posts;
      });
      
      console.log(`  Found ${postData.length} posts via DOM`);
      if (postData.length > 0) {
        return { posts: postData, method: 'browser' };
      }
    }
    
    console.log(`  Browser DOM extraction yielded nothing, falling back to JSON API`);
    return null;
    
  } catch (err) {
    console.log(`  Browser error: ${err.message}, falling back to JSON API`);
    return null;
  }
}

async function scanSubreddit(page, sub) {
  const category = CATEGORY_MAP[sub] || 'Music';
  const painPoints = [];
  let postsScanned = 0;
  
  try {
    // Try JSON API first (more reliable)
    console.log(`\n🔍 Scanning r/${sub} via JSON API...`);
    let jsonData;
    
    try {
      jsonData = await fetchRedditJSON(sub);
    } catch (err) {
      console.log(`  JSON API failed: ${err.message}`);
      jsonData = null;
    }
    
    let posts = [];
    
    if (jsonData && jsonData.data && jsonData.data.children) {
      posts = jsonData.data.children.map(c => c.data);
      console.log(`  Got ${posts.length} posts from JSON API`);
    } else {
      // Try browser
      const browserResult = await scanSubredditWithBrowser(page, sub);
      if (browserResult) {
        console.log(`  Got ${browserResult.posts.length} posts from browser`);
        // For browser results, create minimal post objects
        for (const p of browserResult.posts) {
          posts.push({
            title: p.title,
            selftext: '',
            score: 10,
            num_comments: 0,
            stickied: false,
            id: p.postId || '',
            permalink: p.url,
            url: p.url
          });
        }
      }
    }
    
    postsScanned = posts.length;
    
    // Analyze posts for pain points
    for (const post of posts) {
      if (isPainPoint(post)) {
        const details = extractPainPointDetails(post, sub);
        
        console.log(`  💡 Pain point: ${post.title.substring(0, 60)}...`);
        
        // Submit pain point
        try {
          const ppResponse = await apiPost('/api/pain-points', details);
          console.log(`     Submitted PP, id: ${ppResponse.id || ppResponse._id || JSON.stringify(ppResponse).substring(0,50)}`);
          
          const ppId = ppResponse.id || ppResponse._id;
          
          if (ppId) {
            // Link source post
            const permalink = post.permalink 
              ? `https://reddit.com${post.permalink}`
              : `https://reddit.com/r/${sub}/comments/${post.id}/`;
              
            await apiPost('/api/pain-points/posts', {
              painPointId: ppId,
              redditPostId: post.id || '',
              redditUrl: permalink,
              postTitle: post.title,
              postBody: (post.selftext || '').substring(0, 2000),
              upvotes: post.score || 0,
              commentCount: post.num_comments || 0,
              subreddit: `r/${sub}`,
              discoveredBy: AGENT_ID
            });
            console.log(`     Linked source post`);
          }
          
          painPoints.push(details.title);
          await sleep(500);
          
        } catch (err) {
          console.log(`     API error: ${err.message}`);
        }
      }
    }
    
  } catch (err) {
    console.log(`  Error scanning r/${sub}: ${err.message}`);
  }
  
  // Log scan result
  try {
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned: postsScanned,
      painPointsFound: painPoints.length,
      status: 'completed'
    });
    console.log(`  ✅ Logged scan: ${postsScanned} posts, ${painPoints.length} pain points`);
  } catch (err) {
    console.log(`  Log error: ${err.message}`);
  }
  
  await sleep(2000); // Natural pacing between subreddits
  
  return { postsScanned, painPoints };
}

async function main() {
  console.log('🎸 Marcus-J Scanner starting...');
  console.log(`CDP: ${CDP_URL}`);
  console.log(`Subreddits: ${SUBREDDITS.join(', ')}\n`);
  
  let browser, page;
  
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('✅ Connected to AdsPower browser');
    
    const context = browser.contexts()[0];
    const pages = context.pages();
    
    // Close extra tabs
    for (let i = 1; i < pages.length; i++) {
      await pages[i].close();
    }
    page = pages[0] || await context.newPage();
    console.log(`📄 Using page, current URL: ${page.url()}`);
    
  } catch (err) {
    console.error('❌ Failed to connect to browser:', err.message);
    process.exit(1);
  }
  
  const results = {
    totalPostsScanned: 0,
    totalPainPoints: 0,
    painPointTitles: [],
    subredditsScanned: 0,
    errors: []
  };
  
  for (const sub of SUBREDDITS) {
    try {
      const { postsScanned, painPoints } = await scanSubreddit(page, sub);
      results.totalPostsScanned += postsScanned;
      results.totalPainPoints += painPoints.length;
      results.painPointTitles.push(...painPoints);
      results.subredditsScanned++;
    } catch (err) {
      console.log(`❌ Failed r/${sub}: ${err.message}`);
      results.errors.push(`r/${sub}: ${err.message}`);
    }
  }
  
  console.log('\n========================================');
  console.log('📊 SCAN COMPLETE — SUMMARY');
  console.log('========================================');
  console.log(`Subreddits scanned: ${results.subredditsScanned}/${SUBREDDITS.length}`);
  console.log(`Total posts analyzed: ${results.totalPostsScanned}`);
  console.log(`Pain points found: ${results.totalPainPoints}`);
  if (results.painPointTitles.length > 0) {
    console.log('\nPain points discovered:');
    results.painPointTitles.forEach((t, i) => console.log(`  ${i+1}. ${t}`));
  }
  if (results.errors.length > 0) {
    console.log('\nErrors:');
    results.errors.forEach(e => console.log(`  - ${e}`));
  }
  
  // Don't close browser — admin agent handles that
  console.log('\n✅ Done. Browser left open for admin agent.');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
