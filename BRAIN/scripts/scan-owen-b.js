const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:57259/devtools/browser/5b716fe0-2056-4ada-af08-31ddb3b239c2';
const AGENT_ID = 'owen-b';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const SUBREDDITS = ['ADHD', 'languagelearning', 'remotework', 'productivity'];

const CATEGORY_MAP = {
  'ADHD': 'ADHD & Neurodivergent',
  'languagelearning': 'Language Learning',
  'remotework': 'Remote Work',
  'productivity': 'Productivity',
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
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function fetchRedditJSON(sub) {
  const url = `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
  });
  const json = await res.json();
  return json;
}

async function scanSubredditViaPage(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  const url = `https://www.reddit.com/r/${sub}/hot/`;
  
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    // Scroll to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }

    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    // Get page content
    const content = await page.content();
    console.log(`Page loaded, content length: ${content.length}`);
    
    // Try to extract post data from the page
    const posts = await page.evaluate(() => {
      const results = [];
      
      // Try shreddit-post elements (new Reddit)
      const shredditPosts = document.querySelectorAll('shreddit-post');
      if (shredditPosts.length > 0) {
        shredditPosts.forEach(post => {
          const title = post.getAttribute('post-title') || post.querySelector('h3, [slot="title"]')?.textContent?.trim();
          const score = parseInt(post.getAttribute('score') || '0');
          const commentCount = parseInt(post.getAttribute('comment-count') || '0');
          const permalink = post.getAttribute('permalink') || '';
          const postId = post.getAttribute('id') || permalink.split('/')[4] || '';
          const bodyText = post.querySelector('[slot="text-body"]')?.textContent?.trim() || '';
          
          if (title) {
            results.push({ title, score, commentCount, permalink, postId, bodyText });
          }
        });
        return results;
      }
      
      // Try old-style post elements
      const oldPosts = document.querySelectorAll('.Post, [data-testid="post-container"]');
      oldPosts.forEach(post => {
        const titleEl = post.querySelector('h3, [data-click-id="text"]');
        const title = titleEl?.textContent?.trim();
        if (title) {
          results.push({ title, score: 0, commentCount: 0, permalink: '', postId: '', bodyText: '' });
        }
      });
      
      return results;
    });

    console.log(`Found ${posts.length} posts via page scraping`);
    return { posts, method: 'page' };
  } catch (err) {
    console.error(`Page navigation failed for r/${sub}: ${err.message}`);
    return { posts: [], method: 'failed' };
  }
}

async function scanSubredditViaJSON(sub) {
  console.log(`Trying JSON fallback for r/${sub}...`);
  try {
    const json = await fetchRedditJSON(sub);
    if (!json.data || !json.data.children) {
      console.log(`No data in JSON response for r/${sub}`);
      return [];
    }
    
    const posts = json.data.children
      .filter(c => !c.data.stickied && c.data.score >= 5)
      .map(c => ({
        title: c.data.title,
        score: c.data.score,
        commentCount: c.data.num_comments,
        permalink: c.data.permalink,
        postId: c.data.id,
        bodyText: c.data.selftext || '',
        url: `https://reddit.com${c.data.permalink}`,
      }));
    
    console.log(`JSON fallback: found ${posts.length} posts for r/${sub}`);
    return posts;
  } catch (err) {
    console.error(`JSON fallback failed for r/${sub}: ${err.message}`);
    return [];
  }
}

function analyzePainPoints(posts, sub) {
  const painPoints = [];
  
  const painKeywords = [
    'frustrated', 'frustrating', 'struggle', 'struggling', 'hard to', 'difficult',
    'is there an app', 'is there a tool', 'is there a way', 'how do you', 'how do i',
    'anyone else', 'does anyone', 'wish there was', 'wish i could',
    'can\'t find', 'cant find', 'looking for', 'need help', 'need a',
    'problem with', 'issue with', 'hate that', 'annoying', 'pain point',
    'manual', 'manually', 'track', 'tracking', 'organize', 'organized',
    'expensive', 'too complex', 'complicated', 'overwhelmed', 'overwhelm',
    'forget', 'forgetting', 'procrastinat', 'distract', 'focus',
    'remind', 'reminder', 'habit', 'routine', 'productivity hack',
    'language app', 'learning app', 'study', 'studying', 'practice',
    'remote work', 'work from home', 'wfh', 'meeting', 'zoom fatigue',
  ];
  
  const excludeKeywords = [
    'meme', 'joke', 'funny', 'lol', 'lmao', 'celebration', 'achievement',
    'rant about relationship', 'vent about ex', 'breakup',
  ];
  
  for (const post of posts) {
    const titleLower = post.title.toLowerCase();
    const bodyLower = (post.bodyText || '').toLowerCase();
    const combined = `${titleLower} ${bodyLower}`;
    
    // Skip exclusions
    if (excludeKeywords.some(kw => combined.includes(kw))) continue;
    
    // Skip low engagement
    if (post.score < 5 && post.commentCount < 3) continue;
    
    // Check for pain indicators
    const matchedKeywords = painKeywords.filter(kw => combined.includes(kw));
    if (matchedKeywords.length === 0) continue;
    
    // Must have some text body or substantial title
    if (post.title.length < 20 && (!post.bodyText || post.bodyText.length < 50)) continue;
    
    painPoints.push({
      post,
      matchedKeywords,
      score: matchedKeywords.length + (post.commentCount > 20 ? 2 : 0) + (post.score > 100 ? 1 : 0),
    });
  }
  
  // Sort by score, take top pain points
  painPoints.sort((a, b) => b.score - a.score);
  return painPoints.slice(0, 5); // Max 5 per subreddit
}

function generateTitle(post, sub) {
  // Create a clean, actionable title
  const title = post.title;
  if (title.length <= 80) return title;
  return title.substring(0, 77) + '...';
}

function generateDescription(post, sub, keywords) {
  const category = CATEGORY_MAP[sub] || sub;
  const bodySnippet = post.bodyText ? post.bodyText.substring(0, 200).trim() : '';
  
  let desc = `In r/${sub}, users report: "${post.title.substring(0, 100)}"`;
  if (bodySnippet) {
    desc += ` ${bodySnippet}`;
  }
  desc += ` This ${category} pain point has ${post.score} upvotes and ${post.commentCount} comments, indicating strong community resonance.`;
  
  // Trim to reasonable length
  if (desc.length > 500) desc = desc.substring(0, 497) + '...';
  return desc;
}

async function submitPainPoint(post, sub) {
  const category = CATEGORY_MAP[sub] || sub;
  const title = generateTitle(post, sub);
  const description = generateDescription(post, sub, []);
  const redditUrl = post.url || `https://reddit.com${post.permalink}`;
  
  console.log(`  Submitting: "${title}"`);
  
  // Create pain point
  const ppRes = await apiPost('/api/pain-points', {
    title,
    description,
    category,
    subreddit: `r/${sub}`,
    discoveredBy: AGENT_ID,
  });
  
  console.log(`  Pain point created:`, JSON.stringify(ppRes).substring(0, 200));
  
  const painPointId = ppRes.id || ppRes.data?.id;
  if (!painPointId) {
    console.log(`  Warning: No ID returned for pain point, skipping post link`);
    return ppRes;
  }
  
  // Link source post
  const postRes = await apiPost('/api/pain-points/posts', {
    painPointId,
    redditPostId: post.postId || post.id || '',
    redditUrl,
    postTitle: post.title,
    postBody: (post.bodyText || '').substring(0, 2000),
    upvotes: post.score || 0,
    commentCount: post.commentCount || 0,
    subreddit: `r/${sub}`,
    discoveredBy: AGENT_ID,
  });
  
  console.log(`  Post linked:`, JSON.stringify(postRes).substring(0, 100));
  return ppRes;
}

async function logScan(sub, postsScanned, painPointsFound, status) {
  const res = await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${sub}`,
    postsScanned,
    painPointsFound,
    status,
  });
  console.log(`  Scan log submitted for r/${sub}:`, JSON.stringify(res).substring(0, 100));
}

async function main() {
  console.log('Starting Reddit pain point scan...');
  console.log(`Agent: ${AGENT_ID}`);
  console.log(`Subreddits: ${SUBREDDITS.join(', ')}`);
  console.log(`CDP: ${CDP_URL}`);
  
  let browser;
  let page;
  const results = {
    subredditsScanned: 0,
    totalPostsAnalyzed: 0,
    painPointsFound: [],
    errors: [],
  };
  
  // Connect to browser
  try {
    console.log('\nConnecting to AdsPower browser via CDP...');
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected!');
    
    const context = browser.contexts()[0];
    if (!context) {
      throw new Error('No browser context available');
    }
    
    const pages = context.pages();
    console.log(`Found ${pages.length} existing pages`);
    
    // Close extra tabs
    for (let i = 1; i < pages.length; i++) {
      await pages[i].close();
    }
    page = pages[0] || await context.newPage();
    
  } catch (err) {
    console.error(`Failed to connect to browser: ${err.message}`);
    results.errors.push(`Browser connection failed: ${err.message}`);
    // We'll try JSON API fallback for all subreddits
  }
  
  // Scan each subreddit
  for (const sub of SUBREDDITS) {
    let posts = [];
    let method = 'none';
    
    try {
      // Try browser first
      if (page) {
        const pageResult = await scanSubredditViaPage(page, sub);
        if (pageResult.posts.length > 0) {
          posts = pageResult.posts;
          method = 'page';
        }
      }
      
      // Fallback to JSON API if page didn't work well
      if (posts.length < 5) {
        console.log(`Got ${posts.length} posts via page, trying JSON fallback...`);
        const jsonPosts = await scanSubredditViaJSON(sub);
        if (jsonPosts.length > posts.length) {
          posts = jsonPosts;
          method = 'json';
        }
      }
      
      console.log(`r/${sub}: ${posts.length} posts via ${method}`);
      
      // Analyze for pain points
      const painPointCandidates = analyzePainPoints(posts, sub);
      console.log(`r/${sub}: ${painPointCandidates.length} pain points identified`);
      
      let submitted = 0;
      for (const candidate of painPointCandidates) {
        try {
          await submitPainPoint(candidate.post, sub);
          results.painPointsFound.push(`[r/${sub}] ${candidate.post.title.substring(0, 60)}`);
          submitted++;
          await sleep(1000); // Rate limit courtesy
        } catch (err) {
          console.error(`  Failed to submit pain point: ${err.message}`);
          results.errors.push(`Submit failed for r/${sub}: ${err.message}`);
        }
      }
      
      // Log scan results
      await logScan(sub, posts.length, submitted, 'completed');
      results.subredditsScanned++;
      results.totalPostsAnalyzed += posts.length;
      
    } catch (err) {
      console.error(`Error scanning r/${sub}: ${err.message}`);
      results.errors.push(`r/${sub}: ${err.message}`);
      try {
        await logScan(sub, 0, 0, 'error');
      } catch {}
    }
    
    // Pace between subreddits
    if (SUBREDDITS.indexOf(sub) < SUBREDDITS.length - 1) {
      console.log(`\nWaiting 3 seconds before next subreddit...`);
      await sleep(3000);
    }
  }
  
  // Final summary
  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${results.subredditsScanned}/${SUBREDDITS.length}`);
  console.log(`Total posts analyzed: ${results.totalPostsAnalyzed}`);
  console.log(`Pain points submitted: ${results.painPointsFound.length}`);
  if (results.painPointsFound.length > 0) {
    console.log('\nPain points found:');
    results.painPointsFound.forEach((pp, i) => console.log(`  ${i+1}. ${pp}`));
  }
  if (results.errors.length > 0) {
    console.log('\nErrors:');
    results.errors.forEach(e => console.log(`  - ${e}`));
  }
  
  // Don't close browser - admin agent handles that
  if (browser) {
    await browser.close().catch(() => {}); // disconnect only
  }
  
  return results;
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
