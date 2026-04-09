const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:50498/devtools/browser/9abeec99-0f02-4d55-ae84-6ed98aeb483f';
const AGENT_ID = 'raj-s';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const SUBREDDITS = ['AnalogCommunity', 'streetphotography', 'MechanicalKeyboards', 'photocritique'];

const CATEGORY_MAP = {
  AnalogCommunity: 'Photography',
  streetphotography: 'Photography',
  photocritique: 'Photography',
  MechanicalKeyboards: 'Mechanical Keyboards',
};

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function submitPainPoint(pp) {
  const result = await apiPost('/api/pain-points', {
    title: pp.title.substring(0, 80),
    description: pp.description,
    category: pp.category,
    subreddit: pp.subreddit,
    discoveredBy: AGENT_ID,
  });
  console.log('Pain point created:', JSON.stringify(result));
  const id = result?.painPoint?.id || result?.id || result?.data?.id;
  if (id && pp.sourcePost) {
    const postResult = await apiPost('/api/pain-points/posts', {
      painPointId: id,
      redditPostId: pp.sourcePost.id,
      redditUrl: pp.sourcePost.url,
      postTitle: pp.sourcePost.title,
      postBody: (pp.sourcePost.body || '').substring(0, 2000),
      upvotes: pp.sourcePost.upvotes,
      commentCount: pp.sourcePost.commentCount,
      subreddit: pp.subreddit,
      discoveredBy: AGENT_ID,
    });
    console.log('Post linked:', JSON.stringify(postResult));
  }
  return id;
}

async function logScan(subreddit, postsScanned, painPointsFound, status) {
  const result = await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned,
    painPointsFound,
    status,
  });
  console.log(`Scan log for ${subreddit}:`, JSON.stringify(result));
}

async function fetchSubredditJSON(subreddit) {
  try {
    const res = await fetch(`https://www.reddit.com/r/${subreddit}/hot.json?limit=25&raw_json=1`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });
    const data = await res.json();
    return data?.data?.children?.map(c => c.data) || [];
  } catch(e) {
    console.error(`JSON fallback failed for ${subreddit}:`, e.message);
    return [];
  }
}

async function scanSubredditWithBrowser(page, subreddit) {
  console.log(`\n=== Scanning r/${subreddit} ===`);
  
  try {
    await page.goto(`https://www.reddit.com/r/${subreddit}/hot/`, { 
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

    // Try to get post data from the page
    const posts = await page.evaluate(() => {
      const results = [];
      // shreddit posts
      const postElements = document.querySelectorAll('shreddit-post, [data-testid="post-container"]');
      postElements.forEach(el => {
        const titleEl = el.querySelector('a[slot="title"], h3, [data-click-id="body"] h3');
        const title = titleEl?.textContent?.trim();
        if (!title) return;
        
        const scoreEl = el.querySelector('[slot="vote-icons"] faceplate-number, [id*="vote-arrows"] .score, shreddit-post');
        const href = titleEl?.href || el.querySelector('a[data-click-id="body"]')?.href;
        
        // Try to get score from attribute
        const score = parseInt(el.getAttribute('score') || el.getAttribute('ups') || '0');
        const commentCount = parseInt(el.getAttribute('comment-count') || '0');
        const postId = el.getAttribute('id') || el.getAttribute('name') || '';
        
        results.push({
          title,
          url: href || '',
          upvotes: score,
          commentCount,
          id: postId,
          selftext: '',
        });
      });
      return results;
    });

    console.log(`Browser scraped ${posts.length} posts from r/${subreddit}`);
    
    // If we got good data from browser, use it; otherwise fall back to JSON
    if (posts.length >= 5) {
      return posts;
    }
  } catch(e) {
    console.log(`Browser scrape error for ${subreddit}: ${e.message}`);
  }

  // Fallback to JSON API
  console.log(`Falling back to JSON API for r/${subreddit}`);
  return await fetchSubredditJSON(subreddit);
}

function analyzePainPoints(posts, subreddit) {
  const painPoints = [];
  const category = CATEGORY_MAP[subreddit] || 'Photography';

  const painKeywords = [
    'how do i', 'struggling', 'frustrated', 'annoyed', 'wish there was', 'is there an app',
    'is there a tool', 'need help', 'can\'t figure out', 'anyone else have', 'problem with',
    'issue with', 'hard to', 'difficult to', 'too expensive', 'too complex', 'workflow',
    'manual process', 'takes forever', 'tedious', 'automate', 'track', 'organize',
    'best way to', 'help me', 'anyone know', 'advice', 'recommend', 'alternatives to',
    'hate that', 'annoying', 'pain point', 'fix', 'broken', 'doesn\'t work', 'fails',
    'scanning', 'digitize', 'develop', 'scan', 'storage', 'catalog', 'organize film',
    'keycap', 'switch', 'firmware', 'qmk', 'via', 'programming', 'lubing', 'stabilizer',
    'critique', 'feedback', 'improve', 'composition',
  ];

  for (const post of posts) {
    if (!post.title) continue;
    if (post.upvotes < 5 && post.score < 5) continue;
    
    const titleLower = post.title.toLowerCase();
    const bodyLower = (post.selftext || post.body || '').toLowerCase();
    const combined = titleLower + ' ' + bodyLower;
    
    const matchedKeywords = painKeywords.filter(kw => combined.includes(kw));
    if (matchedKeywords.length === 0) continue;

    // Skip memes/celebrations/humor
    const skipKeywords = ['oc:', '[oc]', 'finally got', 'just got', 'picked up', 'check out my', 'my first', 'rate my'];
    if (skipKeywords.some(kw => titleLower.includes(kw))) continue;

    // Build a description
    let description = '';
    if (subreddit === 'AnalogCommunity' || subreddit === 'photocritique' || subreddit === 'streetphotography') {
      description = `Photographer in r/${subreddit} is experiencing: "${post.title}". `;
    } else if (subreddit === 'MechanicalKeyboards') {
      description = `Mechanical keyboard enthusiast in r/${subreddit} is experiencing: "${post.title}". `;
    }
    description += `This post has ${post.upvotes || post.score || 0} upvotes and ${post.commentCount || post.num_comments || 0} comments, suggesting broad community interest.`;

    const postId = post.id || post.name?.replace('t3_', '') || '';
    const postUrl = post.url || post.permalink 
      ? `https://reddit.com${post.permalink || ''}` 
      : `https://reddit.com/r/${subreddit}`;

    painPoints.push({
      title: post.title.substring(0, 80),
      description: description.substring(0, 500),
      category,
      subreddit: `r/${subreddit}`,
      sourcePost: {
        id: postId,
        url: post.url || postUrl,
        title: post.title,
        body: post.selftext || post.body || '',
        upvotes: post.upvotes || post.score || 0,
        commentCount: post.commentCount || post.num_comments || 0,
      }
    });
  }

  return painPoints;
}

async function main() {
  console.log('Connecting to AdsPower CDP...');
  const browser = await chromium.connectOverCDP(CDP_URL);
  console.log('Connected!');

  const context = browser.contexts()[0];
  const pages = context.pages();
  
  // Close extra tabs, keep one
  for (let i = 1; i < pages.length; i++) {
    try { await pages[i].close(); } catch(e) {}
  }
  const page = pages[0] || await context.newPage();

  const allResults = {
    subredditsScanned: 0,
    totalPostsAnalyzed: 0,
    painPointsFound: [],
    errors: [],
  };

  for (const subreddit of SUBREDDITS) {
    try {
      const posts = await scanSubredditWithBrowser(page, subreddit);
      console.log(`Got ${posts.length} posts from r/${subreddit}`);
      
      const painPoints = analyzePainPoints(posts, subreddit);
      console.log(`Found ${painPoints.length} pain points in r/${subreddit}`);

      let submitted = 0;
      for (const pp of painPoints.slice(0, 5)) { // max 5 per subreddit
        try {
          await submitPainPoint(pp);
          submitted++;
          allResults.painPointsFound.push(pp.title);
          await sleep(500);
        } catch(e) {
          console.error('Failed to submit pain point:', e.message);
        }
      }

      await logScan(subreddit, posts.length, submitted, 'completed');
      allResults.subredditsScanned++;
      allResults.totalPostsAnalyzed += posts.length;

      // Pause between subreddits
      await sleep(3000);
    } catch(e) {
      console.error(`Error scanning r/${subreddit}:`, e.message);
      allResults.errors.push(`${subreddit}: ${e.message}`);
      await logScan(subreddit, 0, 0, 'error');
    }
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log('Subreddits scanned:', allResults.subredditsScanned);
  console.log('Total posts analyzed:', allResults.totalPostsAnalyzed);
  console.log('Pain points found:', allResults.painPointsFound.length);
  allResults.painPointsFound.forEach(t => console.log(' -', t));
  if (allResults.errors.length > 0) {
    console.log('Errors:', allResults.errors);
  }

  // Don't close browser - admin handles that
  await browser.close(); // disconnect only, not actual close
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
