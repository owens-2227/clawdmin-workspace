const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:53749/devtools/browser/433700f7-19ca-4897-be36-a1d4367d06fc';
const AGENT_ID = 'jess-m';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const SUBREDDITS = [
  { name: 'gardening', category: 'Gardening' },
  { name: 'beyondthebump', category: 'New Moms' },
  { name: 'Mommit', category: 'New Moms' },
  { name: 'running', category: 'Fitness' },
  { name: 'xxfitness', category: 'Fitness' },
  { name: 'ADHD', category: 'ADHD & Neurodivergent' },
  { name: 'languagelearning', category: 'Language Learning' },
  { name: 'remotework', category: 'Remote Work' },
  { name: 'productivity', category: 'Productivity' },
  { name: 'Meditation', category: 'Mental Health' },
  { name: 'Anxiety', category: 'Mental Health' },
];

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function apiPost(path, data) {
  const fetch = (await import('node-fetch')).default;
  try {
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
  } catch (err) {
    console.error(`API error for ${path}:`, err.message);
    return null;
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
  console.log(`  → Pain point created:`, result?.id || JSON.stringify(result));
  return result?.id;
}

async function submitPost(painPointId, postData) {
  const result = await apiPost('/api/pain-points/posts', {
    painPointId,
    redditPostId: postData.redditPostId,
    redditUrl: postData.redditUrl,
    postTitle: postData.postTitle,
    postBody: postData.postBody?.substring(0, 2000) || '',
    upvotes: postData.upvotes || 0,
    commentCount: postData.commentCount || 0,
    subreddit: postData.subreddit,
    discoveredBy: AGENT_ID,
  });
  console.log(`  → Post linked:`, result?.id || JSON.stringify(result));
}

async function logScanResult(subreddit, postsScanned, painPointsFound, status = 'completed') {
  const result = await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned,
    painPointsFound,
    status,
  });
  console.log(`  → Scan log:`, result?.id || JSON.stringify(result));
}

// Use Reddit JSON API as primary approach (faster, more reliable than browser scrolling)
async function fetchSubredditPosts(page, subreddit) {
  const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=25&raw_json=1`;
  
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2000);
    
    const content = await page.evaluate(() => document.body.innerText);
    const data = JSON.parse(content);
    
    if (data?.data?.children) {
      return data.data.children.map(c => c.data).filter(p => !p.stickied && p.score >= 5);
    }
  } catch (err) {
    console.error(`  JSON API failed for r/${subreddit}:`, err.message);
  }
  
  // Fallback: try browser navigation with scrolling
  try {
    await page.goto(`https://www.reddit.com/r/${subreddit}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);
    
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    
    // Try to extract posts from the page
    const posts = await page.evaluate(() => {
      const articles = document.querySelectorAll('article, [data-testid="post-container"], shreddit-post');
      return Array.from(articles).slice(0, 25).map(el => ({
        title: el.querySelector('h1, h2, h3, [slot="title"]')?.innerText || el.getAttribute('post-title') || '',
        score: parseInt(el.getAttribute('score') || '0'),
        num_comments: parseInt(el.getAttribute('comment-count') || '0'),
        id: el.getAttribute('id') || el.getAttribute('thingid') || '',
        permalink: el.getAttribute('permalink') || '',
        selftext: '',
        is_self: true,
      })).filter(p => p.title && p.score >= 5);
    });
    
    return posts;
  } catch (err) {
    console.error(`  Browser fallback also failed for r/${subreddit}:`, err.message);
    return [];
  }
}

// Analyze posts and identify pain points
function analyzePosts(posts, subreddit, category) {
  const painPoints = [];
  
  const painKeywords = [
    'struggling', 'frustrated', 'annoying', 'wish there was', 'is there an app',
    'is there a tool', 'manually', 'keeps dying', 'keeps failing', 'no way to',
    'how do you deal', 'anyone else hate', 'why is it so hard', 'impossible to',
    'need help with', 'cant figure out', "can't figure out", 'problem with',
    'issue with', 'overwhelmed', 'exhausted', 'burnout', 'losing track',
    'forget to', 'no solution', 'better way', 'automate', 'time consuming',
    'expensive', 'too complex', 'confusing', 'hate when', 'tips for',
    'how to manage', 'always forgetting', 'help me', 'advice needed',
    'driving me crazy', 'nightmare', 'pain point', 'broken', 'doesnt work',
  ];
  
  for (const post of posts) {
    const titleLower = post.title?.toLowerCase() || '';
    const bodyLower = post.selftext?.toLowerCase() || '';
    const combined = titleLower + ' ' + bodyLower;
    
    // Skip non-text posts with very little body
    if (!post.is_self && !post.selftext) {
      // Still check title for pain keywords
      const hasPainKeyword = painKeywords.some(kw => titleLower.includes(kw));
      if (!hasPainKeyword) continue;
    }
    
    const matchedKeywords = painKeywords.filter(kw => combined.includes(kw));
    if (matchedKeywords.length === 0) continue;
    
    // Skip pure emotional venting / memes / celebrations
    const excludeKeywords = ['congratulations', 'finally did it', 'proud', 'achieved', 'meme', 'lol', 'haha'];
    const isExcluded = excludeKeywords.some(kw => combined.includes(kw)) && matchedKeywords.length < 2;
    if (isExcluded) continue;
    
    // Build a concise description
    const bodyPreview = post.selftext ? post.selftext.substring(0, 300) : '';
    const description = buildDescription(post.title, bodyPreview, subreddit);
    
    if (description) {
      painPoints.push({
        title: post.title.substring(0, 80),
        description,
        category,
        subreddit: `r/${subreddit}`,
        post: {
          redditPostId: post.id || post.name,
          redditUrl: post.permalink ? `https://reddit.com${post.permalink}` : `https://reddit.com/r/${subreddit}`,
          postTitle: post.title,
          postBody: post.selftext || '',
          upvotes: post.score || 0,
          commentCount: post.num_comments || 0,
          subreddit: `r/${subreddit}`,
        }
      });
    }
  }
  
  // Return top 5 most relevant pain points (by upvotes + comment count)
  return painPoints
    .sort((a, b) => (b.post.upvotes + b.post.commentCount) - (a.post.upvotes + a.post.commentCount))
    .slice(0, 5);
}

function buildDescription(title, body, subreddit) {
  // Create a 2-3 sentence description
  const titleClean = title.replace(/\?$/, '').trim();
  
  if (body && body.length > 50) {
    const bodyTrunc = body.substring(0, 200).replace(/\n/g, ' ').trim();
    return `Users in r/${subreddit} report: "${titleClean}". ${bodyTrunc}...`.substring(0, 400);
  } else {
    return `A recurring pain point in r/${subreddit}: "${titleClean}". Community members are seeking better solutions or tools to address this challenge.`;
  }
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub.name} ===`);
  
  try {
    const posts = await fetchSubredditPosts(page, sub.name);
    console.log(`  Found ${posts.length} posts`);
    
    if (posts.length === 0) {
      await logScanResult(sub.name, 0, 0, 'error');
      return { postsScanned: 0, painPointsFound: 0 };
    }
    
    const painPoints = analyzePosts(posts, sub.name, sub.category);
    console.log(`  Identified ${painPoints.length} pain points`);
    
    let submitted = 0;
    for (const pp of painPoints) {
      console.log(`  Submitting: "${pp.title}"`);
      const id = await submitPainPoint(pp);
      if (id) {
        await submitPost(id, pp.post);
        submitted++;
      }
      await sleep(500);
    }
    
    await logScanResult(sub.name, posts.length, submitted);
    return { postsScanned: posts.length, painPointsFound: submitted };
    
  } catch (err) {
    console.error(`  Error scanning r/${sub.name}:`, err.message);
    await logScanResult(sub.name, 0, 0, 'error');
    return { postsScanned: 0, painPointsFound: 0, error: err.message };
  }
}

async function main() {
  console.log(`Starting scan — Agent: ${AGENT_ID}`);
  console.log(`Subreddits: ${SUBREDDITS.map(s => s.name).join(', ')}`);
  console.log(`CDP: ${CDP_URL}\n`);
  
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected to AdsPower browser via CDP');
    
    const context = browser.contexts()[0];
    const pages = context.pages();
    
    // Close extra tabs, keep one
    for (let i = 1; i < pages.length; i++) {
      try { await pages[i].close(); } catch {}
    }
    const page = pages[0] || await context.newPage();
    
    const results = {
      totalPostsScanned: 0,
      totalPainPoints: 0,
      subreddits: [],
      errors: [],
    };
    
    for (const sub of SUBREDDITS) {
      const result = await scanSubreddit(page, sub);
      results.totalPostsScanned += result.postsScanned || 0;
      results.totalPainPoints += result.painPointsFound || 0;
      results.subreddits.push({ name: sub.name, ...result });
      if (result.error) results.errors.push(`r/${sub.name}: ${result.error}`);
      
      // Pacing between subreddits
      await sleep(3000);
    }
    
    console.log('\n=== SCAN COMPLETE ===');
    console.log(`Subreddits scanned: ${SUBREDDITS.length}`);
    console.log(`Total posts analyzed: ${results.totalPostsScanned}`);
    console.log(`Pain points discovered: ${results.totalPainPoints}`);
    if (results.errors.length > 0) {
      console.log(`Errors: ${results.errors.join(', ')}`);
    }
    
    // Write results to file for the parent agent
    const fs = require('fs');
    fs.writeFileSync('/tmp/jess-scan-results.json', JSON.stringify(results, null, 2));
    console.log('\nResults saved to /tmp/jess-scan-results.json');
    
  } catch (err) {
    console.error('Fatal error:', err.message);
    process.exit(1);
  } finally {
    // Do NOT close browser — admin agent handles that
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}

main().catch(console.error);
