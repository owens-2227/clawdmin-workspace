const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

const CDP_URL = 'ws://127.0.0.1:49736/devtools/browser/e417dfa8-3b13-431f-b4db-b8dfac4799d2';
const AGENT_ID = 'elise-c';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const SUBREDDITS = ['cats', 'rawpetfood', 'ThriftStoreHauls', 'felinediabetes', 'EatCheapAndHealthy', 'lawncare'];

const CATEGORY_MAP = {
  cats: 'Cats & Pets',
  rawpetfood: 'Cats & Pets',
  felinediabetes: 'Cats & Pets',
  ThriftStoreHauls: 'Thrifting',
  EatCheapAndHealthy: 'Cooking',
  lawncare: 'Gardening',
};

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
        'Content-Length': Buffer.byteLength(body),
      },
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

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  const category = CATEGORY_MAP[sub] || 'General';
  const painPoints = [];
  let postsScanned = 0;

  try {
    // Try browser first
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    // Scroll to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    // Try to get post data from page
    const posts = await page.evaluate(() => {
      const results = [];
      
      // Try shreddit-post elements (new Reddit)
      const shredditPosts = document.querySelectorAll('shreddit-post');
      shredditPosts.forEach(post => {
        const title = post.getAttribute('post-title') || post.querySelector('h2, h3')?.textContent?.trim();
        const score = parseInt(post.getAttribute('score') || post.getAttribute('upvotes') || '0');
        const comments = parseInt(post.getAttribute('comment-count') || '0');
        const permalink = post.getAttribute('permalink') || post.getAttribute('content-href');
        const id = post.getAttribute('id') || post.getAttribute('post-id') || (permalink ? permalink.split('/')[4] : null);
        
        if (title) {
          results.push({ title, score, comments, permalink, id });
        }
      });
      
      // Fallback: try article elements
      if (results.length === 0) {
        const articles = document.querySelectorAll('article, [data-testid="post-container"], div[data-fullname]');
        articles.forEach(article => {
          const titleEl = article.querySelector('h1, h2, h3, [data-click-id="text"] a, a[data-click-id="body"]');
          const title = titleEl?.textContent?.trim();
          const scoreEl = article.querySelector('[id*="vote-arrows"] + *, [class*="score"]');
          const score = parseInt(scoreEl?.textContent?.replace(/[^0-9]/g, '') || '0');
          if (title && title.length > 10) {
            results.push({ title, score, comments: 0, permalink: null, id: null });
          }
        });
      }
      
      return results;
    });

    console.log(`  Browser returned ${posts.length} posts`);

    // If browser gave few results, use JSON API fallback
    let allPosts = posts;
    if (posts.length < 5) {
      console.log('  Few posts from browser, trying JSON API fallback...');
      const jsonData = await page.evaluate(async (sub) => {
        const response = await fetch(`https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
        });
        const data = await response.json();
        return data;
      }, sub);
      
      if (jsonData && jsonData.data && jsonData.data.children) {
        allPosts = jsonData.data.children.map(c => ({
          title: c.data.title,
          score: c.data.score,
          comments: c.data.num_comments,
          permalink: c.data.permalink,
          id: c.data.id,
          selftext: c.data.selftext,
          stickied: c.data.stickied,
        }));
        console.log(`  JSON API returned ${allPosts.length} posts`);
      }
    }

    // Filter and process posts
    const validPosts = allPosts.filter(p => 
      p.title && 
      p.score >= 5 && 
      !p.stickied &&
      p.title.length > 10
    );

    postsScanned = validPosts.length;
    console.log(`  Valid posts to analyze: ${postsScanned}`);

    // Analyze posts for pain points
    const PAIN_KEYWORDS = [
      'help', 'frustrated', 'struggling', 'can\'t find', 'looking for', 'is there an app',
      'is there a tool', 'manually', 'wish there was', 'need a way', 'how do you', 'problem with',
      'annoying', 'difficult', 'confusing', 'expensive', 'complicated', 'overwhelmed', 'lost',
      'tracking', 'organize', 'manage', 'keep track', 'reminder', 'schedule', 'budget',
      'how to', 'advice', 'tips', 'recommendation', 'suggest', 'best way', 'easier way',
      'pain point', 'issue', 'challenge', 'hard to', 'impossible to', 'no good', 'better way'
    ];

    for (const post of validPosts) {
      const titleLower = post.title.toLowerCase();
      const bodyLower = (post.selftext || '').toLowerCase();
      const fullText = titleLower + ' ' + bodyLower;
      
      const hasPainKeyword = PAIN_KEYWORDS.some(kw => fullText.includes(kw));
      const hasQuestionMark = post.title.includes('?');
      const hasHighComments = post.comments >= 10;
      
      if ((hasPainKeyword && (hasHighComments || post.score >= 20)) || 
          (hasQuestionMark && hasHighComments && post.score >= 10)) {
        
        // For high-comment posts, try to read the full post
        let postBody = post.selftext || '';
        let topComments = '';
        
        if (post.comments >= 15 && post.permalink) {
          try {
            const postData = await page.evaluate(async (permalink) => {
              const url = `https://www.reddit.com${permalink}.json?limit=10&raw_json=1`;
              const resp = await fetch(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
              });
              const data = await resp.json();
              return data;
            }, post.permalink);
            
            if (postData && postData[0] && postData[0].data && postData[0].data.children[0]) {
              postBody = postData[0].data.children[0].data.selftext || postBody;
            }
            if (postData && postData[1] && postData[1].data && postData[1].data.children) {
              topComments = postData[1].data.children
                .slice(0, 5)
                .map(c => c.data?.body || '')
                .filter(b => b)
                .join('\n---\n')
                .substring(0, 1000);
            }
            await sleep(1500);
          } catch(e) {
            console.log(`  Could not fetch full post: ${e.message}`);
          }
        }
        
        // Compose pain point description
        const desc = composePainPointDescription(post, sub, postBody, topComments);
        if (desc) {
          painPoints.push({ post, desc, postBody });
        }
      }
    }

    console.log(`  Found ${painPoints.length} pain points`);

    // Submit pain points
    for (const pp of painPoints) {
      try {
        const title = pp.desc.title.substring(0, 80);
        const ppResponse = await apiPost('/api/pain-points', {
          title,
          description: pp.desc.description,
          category,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID,
        });
        
        console.log(`  Submitted: "${title}" -> id: ${ppResponse.id || ppResponse._id || JSON.stringify(ppResponse).substring(0, 50)}`);
        
        const ppId = ppResponse.id || ppResponse._id || ppResponse.painPointId;
        if (ppId && pp.post.permalink) {
          const postId = pp.post.id || (pp.post.permalink ? pp.post.permalink.split('/')[4] : null);
          await apiPost('/api/pain-points/posts', {
            painPointId: ppId,
            redditPostId: postId || '',
            redditUrl: `https://reddit.com${pp.post.permalink}`,
            postTitle: pp.post.title,
            postBody: (pp.postBody || '').substring(0, 2000),
            upvotes: pp.post.score,
            commentCount: pp.post.comments,
            subreddit: `r/${sub}`,
            discoveredBy: AGENT_ID,
          });
        }
        
        await sleep(500);
      } catch(e) {
        console.log(`  Error submitting pain point: ${e.message}`);
      }
    }

  } catch(e) {
    console.log(`  Error scanning r/${sub}: ${e.message}`);
  }

  // Log scan result
  try {
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned,
      painPointsFound: painPoints.length,
      status: 'completed',
    });
    console.log(`  Logged scan result for r/${sub}`);
  } catch(e) {
    console.log(`  Failed to log scan: ${e.message}`);
  }

  return { sub, postsScanned, painPointsFound: painPoints.length };
}

function composePainPointDescription(post, sub, body, comments) {
  const title = post.title;
  const text = (body || '').trim();
  
  // Skip pure image/video posts with no text
  if (!text && post.comments < 5) return null;
  
  // Build description
  let description = '';
  
  if (text && text.length > 50) {
    description = text.substring(0, 300);
    if (description.length === 300) description += '...';
  } else {
    description = `Post titled "${title}" in r/${sub} with ${post.comments} comments and ${post.score} upvotes. `;
    if (comments) {
      description += 'Community discussion suggests this is a common pain point.';
    }
  }
  
  // Generate a cleaner title
  let ppTitle = title;
  if (ppTitle.length > 80) ppTitle = ppTitle.substring(0, 77) + '...';
  
  return {
    title: ppTitle,
    description: description.substring(0, 500),
  };
}

async function main() {
  console.log('Connecting to AdsPower browser...');
  let browser;
  
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected!');
  } catch(e) {
    console.error('Failed to connect:', e.message);
    process.exit(1);
  }
  
  const context = browser.contexts()[0];
  const pages = context.pages();
  
  // Close extra tabs, keep one
  for (let i = 1; i < pages.length; i++) {
    try { await pages[i].close(); } catch(e) {}
  }
  const page = pages[0] || await context.newPage();
  
  const results = [];
  
  for (const sub of SUBREDDITS) {
    const result = await scanSubreddit(page, sub);
    results.push(result);
    await sleep(3000); // pause between subreddits
  }
  
  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${results.length}`);
  let totalPosts = 0, totalPainPoints = 0;
  for (const r of results) {
    console.log(`  r/${r.sub}: ${r.postsScanned} posts, ${r.painPointsFound} pain points`);
    totalPosts += r.postsScanned;
    totalPainPoints += r.painPointsFound;
  }
  console.log(`Total posts: ${totalPosts}`);
  console.log(`Total pain points: ${totalPainPoints}`);
  
  // Don't close the browser — admin handles that
  process.exit(0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
