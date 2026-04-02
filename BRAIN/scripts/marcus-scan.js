const { chromium } = require('/Users/owen/.openclaw/workspace/BRAIN/scripts/node_modules/playwright');

const CDP_URL = 'ws://127.0.0.1:64418/devtools/browser/29d67c91-3ced-4adf-a758-15043c9ba797';
const AGENT_ID = 'marcus-j';
const CATEGORY = 'Music';
const SUBREDDITS = ['Guitar', 'guitarpedals', 'Blues', 'homerecording'];
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function apiPost(path, data) {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(data)
  });
  return resp.json();
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  
  try {
    // Use Reddit JSON API via the browser (so it goes through the proxy)
    const jsonUrl = `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`;
    await page.goto(jsonUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2000);
    
    let redditData;
    try {
      const rawText = await page.evaluate(() => document.body.innerText);
      redditData = JSON.parse(rawText);
    } catch(e) {
      console.log(`JSON parse failed for r/${sub}, trying HTML approach...`);
      // Fall back to regular page
      await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(3000);
      const content = await page.content();
      console.log(`Page length: ${content.length}, URL: ${page.url()}`);
      await apiPost('/api/pain-points/scan-logs', { agentId: AGENT_ID, subreddit: `r/${sub}`, postsScanned: 0, painPointsFound: 0, status: 'error' });
      return { postsScanned: 0, painPointsFound: 0, error: 'JSON parse failed' };
    }

    const posts = redditData?.data?.children || [];
    const validPosts = posts
      .filter(p => p.kind === 't3' && !p.data.stickied && p.data.score >= 1)
      .map(p => ({
        postId: p.data.id,
        title: p.data.title,
        score: p.data.score,
        commentCount: p.data.num_comments,
        permalink: p.data.permalink,
        selftext: p.data.selftext || '',
        url: p.data.url,
        author: p.data.author,
        created: p.data.created_utc
      }));
    
    console.log(`Found ${validPosts.length} valid posts`);

    const postsWithComments = [];
    
    for (const post of validPosts) {
      console.log(`  [${post.score}pts/${post.commentCount}cmts] ${post.title.substring(0, 70)}`);
      
      // For posts with enough engagement, read comments
      if (post.commentCount >= 10 || post.score >= 30) {
        try {
          const commentsUrl = `https://www.reddit.com${post.permalink}.json?limit=10&sort=top&raw_json=1`;
          await page.goto(commentsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await sleep(2000);
          
          const rawText = await page.evaluate(() => document.body.innerText);
          const data = JSON.parse(rawText);
          const commentData = data?.[1]?.data?.children || [];
          const comments = commentData
            .filter(c => c.kind === 't1' && c.data.body && c.data.score > 1)
            .slice(0, 8)
            .map(c => c.data.body);
          
          postsWithComments.push({ ...post, comments });
        } catch(e) {
          postsWithComments.push({ ...post, comments: [] });
        }
      } else {
        postsWithComments.push({ ...post, comments: [] });
      }
    }

    // Analyze for pain points
    console.log(`\nAnalyzing ${postsWithComments.length} posts for pain points...`);
    const painPoints = analyzePainPoints(postsWithComments, sub);
    console.log(`Found ${painPoints.length} pain points`);

    // Submit pain points
    let submitted = 0;
    for (const pp of painPoints) {
      try {
        const created = await apiPost('/api/pain-points', {
          title: pp.title,
          description: pp.description,
          category: CATEGORY,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID
        });
        console.log(`  Submitted: "${pp.title.substring(0, 50)}..." -> id: ${created?.id || created?.painPoint?.id || '?'}`);
        
        const ppId = created?.id || created?.painPoint?.id || created?.data?.id;
        if (ppId && pp.post) {
          await apiPost('/api/pain-points/posts', {
            painPointId: ppId,
            redditPostId: pp.post.postId,
            redditUrl: `https://reddit.com${pp.post.permalink}`,
            postTitle: pp.post.title,
            postBody: (pp.post.selftext || '').substring(0, 2000),
            upvotes: pp.post.score,
            commentCount: pp.post.commentCount,
            subreddit: `r/${sub}`,
            discoveredBy: AGENT_ID
          });
        }
        submitted++;
        await sleep(300);
      } catch(e) {
        console.log(`  Error submitting: ${e.message}`);
      }
    }

    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned: postsWithComments.length,
      painPointsFound: submitted,
      status: 'completed'
    });

    return { postsScanned: postsWithComments.length, painPointsFound: submitted };

  } catch(e) {
    console.log(`Error scanning r/${sub}: ${e.message}`);
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned: 0,
      painPointsFound: 0,
      status: 'error'
    }).catch(() => {});
    return { postsScanned: 0, painPointsFound: 0, error: e.message };
  }
}

function analyzePainPoints(posts, sub) {
  const painPoints = [];

  const indicators = [
    'frustrated', 'annoying', 'annoyed', 'wish there was', 'is there an app',
    'is there a tool', 'is there a way', 'any app', 'any software',
    'anyone know of', 'how do you', 'struggling with', "can't find", 'hard to',
    'difficult to', 'problem with', 'issue with', 'too expensive', 'complicated',
    'too complex', 'manually', 'keeps track', 'track my', 'organize', 'workflow',
    'best app', 'best software', 'recommend', 'better way', 'pain point',
    'help me figure', 'no good solution', 'hate that', 'drives me crazy',
    'overwhelmed', 'confusing', 'confus', 'need a way', 'looking for a',
    'looking for software', 'looking for app', 'what do you use', 'how does everyone',
    'does anyone have a system', 'spent hours', 'wasted time', 'can\'t figure out',
    'anyone else struggle'
  ];

  const excludePatterns = [
    'daily thread', 'weekly thread', 'megathread', '[weekly]', '[daily]',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
  ];

  for (const post of posts) {
    const titleLower = post.title.toLowerCase();
    const bodyLower = (post.selftext || '').toLowerCase();
    const commentsText = (post.comments || []).join(' ').toLowerCase();
    const combined = `${titleLower} ${bodyLower} ${commentsText}`;

    // Skip excluded patterns
    if (excludePatterns.some(p => titleLower.includes(p))) continue;
    if (post.score < 2) continue;

    // Check for pain point indicators
    const matchedIndicator = indicators.find(i => combined.includes(i));
    
    // Also check: high-engagement questions (ends with ?, many comments)
    const isQuestion = titleLower.endsWith('?') && (post.commentCount > 20 || post.score > 50);
    
    if (!matchedIndicator && !isQuestion) continue;

    // Skip pure memes/celebrations/photos
    if (!post.selftext && post.commentCount < 5 && post.score < 50) continue;
    if (bodyLower.includes('[removed]') || bodyLower.includes('[deleted]')) continue;

    const pp = buildPainPoint(post, sub, matchedIndicator);
    if (pp) painPoints.push(pp);
  }

  // Deduplicate similar pain points
  const seen = new Set();
  const deduped = painPoints.filter(pp => {
    const key = pp.title.toLowerCase().substring(0, 40);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return deduped.slice(0, 8);
}

function buildPainPoint(post, sub, indicator) {
  let title = post.title.trim();
  if (title.length > 80) title = title.substring(0, 77) + '...';

  let description = '';
  const body = post.selftext?.trim() || '';
  
  if (body.length > 50) {
    // Clean up and use body
    const cleanBody = body.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
    description = cleanBody.substring(0, 400);
    if (body.length > 400) description += '...';
  } else if (post.comments?.length > 0) {
    description = `Post: "${post.title}". `;
    const relevantComment = post.comments.find(c => c.length > 30) || post.comments[0];
    if (relevantComment) {
      description += `Community discussion: "${relevantComment.substring(0, 300)}"`;
    }
  }
  
  if (description.length < 30) {
    description = `Users in r/${sub} are discussing this issue with ${post.commentCount} comments and ${post.score} upvotes: "${post.title}". This represents a recurring frustration in the music/guitar community.`;
  }

  return {
    title,
    description: description.substring(0, 500),
    post
  };
}

async function main() {
  console.log('Connecting to AdsPower browser via CDP...');
  
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected!');

    const context = browser.contexts()[0];
    const pages = context.pages();
    
    let page;
    if (pages.length > 0) {
      page = pages[0];
      for (let i = 1; i < pages.length; i++) {
        await pages[i].close().catch(() => {});
      }
    } else {
      page = await context.newPage();
    }
    page.setDefaultTimeout(30000);

    const totals = { subredditsScanned: 0, totalPosts: 0, totalPainPoints: 0, errors: [] };

    for (let i = 0; i < SUBREDDITS.length; i++) {
      const sub = SUBREDDITS[i];
      const result = await scanSubreddit(page, sub);
      totals.subredditsScanned++;
      totals.totalPosts += result.postsScanned || 0;
      totals.totalPainPoints += result.painPointsFound || 0;
      if (result.error) totals.errors.push(`r/${sub}: ${result.error}`);

      if (i < SUBREDDITS.length - 1) {
        console.log(`\nPausing 5s before next subreddit...`);
        await sleep(5000);
      }
    }

    console.log('\n=== SCAN COMPLETE ===');
    console.log(`Subreddits scanned: ${totals.subredditsScanned}`);
    console.log(`Total posts analyzed: ${totals.totalPosts}`);
    console.log(`Total pain points submitted: ${totals.totalPainPoints}`);
    if (totals.errors.length > 0) console.log(`Errors: ${totals.errors.join(', ')}`);

    process.exit(0);
  } catch(e) {
    console.error('Fatal error:', e.message);
    process.exit(1);
  }
}

main();
