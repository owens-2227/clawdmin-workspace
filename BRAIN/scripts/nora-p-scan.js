const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:57591/devtools/browser/d4cdd73d-2ef9-4f3c-83e1-af781840ecc3';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const AGENT_ID = 'nora-p';
const SUBREDDITS = ['houseplants', 'proplifting', 'plantclinic', 'IndoorGarden'];
const CATEGORY = 'Plant Parents';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function submitPainPoint(pp) {
  console.log(`  [submit] Pain point: ${pp.title}`);
  const created = await apiPost('/api/pain-points', {
    title: pp.title,
    description: pp.description,
    category: CATEGORY,
    subreddit: `r/${pp.subreddit}`,
    discoveredBy: AGENT_ID
  });
  console.log(`  [submit] Created ID: ${created.id || JSON.stringify(created)}`);

  if (created.id && pp.redditPostId) {
    const linked = await apiPost('/api/pain-points/posts', {
      painPointId: created.id,
      redditPostId: pp.redditPostId,
      redditUrl: pp.redditUrl,
      postTitle: pp.postTitle,
      postBody: (pp.postBody || '').substring(0, 2000),
      upvotes: pp.upvotes || 0,
      commentCount: pp.commentCount || 0,
      subreddit: `r/${pp.subreddit}`,
      discoveredBy: AGENT_ID
    });
    console.log(`  [submit] Linked post: ${JSON.stringify(linked).substring(0, 100)}`);
  }
  return created;
}

async function logScan(subreddit, postsScanned, painPointsFound, status = 'completed') {
  const r = await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned,
    painPointsFound,
    status
  });
  console.log(`  [log] Scan log for r/${subreddit}: ${JSON.stringify(r).substring(0, 100)}`);
}

async function fetchRedditJson(subreddit) {
  const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=25&raw_json=1`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.log(`  [json-api] fetch error: ${e.message}`);
    return null;
  }
}

async function scanSubredditWithPage(page, subreddit) {
  console.log(`\n=== Scanning r/${subreddit} ===`);
  const posts = [];

  try {
    await page.goto(`https://www.reddit.com/r/${subreddit}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    // Scroll to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    // Try to extract posts from the page
    const pageContent = await page.content();

    // Check for CAPTCHA or login wall
    if (pageContent.includes('verify you are a human') || pageContent.includes('log in or sign up')) {
      console.log(`  [warn] Possible CAPTCHA or login wall detected for r/${subreddit}`);
    }

    // Try to get post data via JSON API as a reliable fallback
    const jsonData = await fetchRedditJson(subreddit);
    if (jsonData && jsonData.data && jsonData.data.children) {
      console.log(`  [json-api] Got ${jsonData.data.children.length} posts`);
      for (const child of jsonData.data.children) {
        const d = child.data;
        if (d.stickied) continue;
        if ((d.score || 0) < 5) continue;
        posts.push({
          id: d.id,
          title: d.title,
          body: d.selftext || '',
          score: d.score,
          numComments: d.num_comments,
          url: `https://reddit.com${d.permalink}`,
          subreddit
        });
      }
    }
  } catch (e) {
    console.log(`  [error] Browser navigation failed: ${e.message}`);
    // Fallback to JSON API
    const jsonData = await fetchRedditJson(subreddit);
    if (jsonData && jsonData.data && jsonData.data.children) {
      for (const child of jsonData.data.children) {
        const d = child.data;
        if (d.stickied || (d.score || 0) < 5) continue;
        posts.push({
          id: d.id, title: d.title, body: d.selftext || '',
          score: d.score, numComments: d.num_comments,
          url: `https://reddit.com${d.permalink}`, subreddit
        });
      }
    }
  }

  console.log(`  [scan] ${posts.length} posts loaded for r/${subreddit}`);
  return posts;
}

// Open high-value posts to get body + comments
async function enrichPost(page, post) {
  if (post.numComments < 10 && post.body.length > 100) return post; // already have content
  if (post.numComments < 5) return post;

  try {
    // Use JSON API for comments (faster and more reliable)
    const url = `https://www.reddit.com/r/${post.subreddit}/comments/${post.id}.json?limit=10&raw_json=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });
    if (!res.ok) return post;
    const data = await res.json();

    if (data && data[0] && data[0].data.children[0]) {
      const postData = data[0].data.children[0].data;
      post.body = postData.selftext || post.body;
    }

    // Get top comments
    if (data && data[1] && data[1].data.children) {
      const comments = data[1].data.children
        .filter(c => c.kind === 't1')
        .slice(0, 5)
        .map(c => c.data.body || '')
        .join('\n---\n');
      post.topComments = comments;
    }

    await sleep(1500); // natural pacing
  } catch (e) {
    // ignore
  }
  return post;
}

function analyzePainPoints(posts, subreddit) {
  const painPoints = [];

  // Keywords indicating pain points
  const painKeywords = [
    'help', 'issue', 'problem', 'dying', 'dead', 'yellow', 'brown', 'drooping',
    'dropping', 'wilting', 'overwater', 'underwater', 'root rot', 'pests', 'bugs',
    'gnats', 'mites', 'scale', 'how do i', 'how to', 'what is wrong', 'what\'s wrong',
    'why is', 'struggling', 'failed', 'can\'t figure', 'frustrated', 'any app',
    'any tool', 'track', 'organize', 'schedule', 'remind', 'forget', 'watering schedule',
    'propagation failed', 'prop fail', 'not rooting', 'won\'t root', 'soil mix',
    'confused', 'beginner', 'new to', 'advice', 'tips', 'best way', 'identify',
    'what plant', 'unknown plant', 'mystery plant'
  ];

  const toolKeywords = [
    'app', 'tool', 'tracker', 'remind', 'schedule', 'organize', 'track', 'log',
    'automate', 'spreadsheet', 'database', 'system'
  ];

  for (const post of posts) {
    const fullText = (post.title + ' ' + post.body + ' ' + (post.topComments || '')).toLowerCase();

    const hasPainIndicator = painKeywords.some(kw => fullText.includes(kw));
    const hasToolIndicator = toolKeywords.some(kw => fullText.includes(kw));

    if (!hasPainIndicator && !hasToolIndicator) continue;

    // Score the post
    let score = 0;
    if (post.score >= 50) score += 3;
    else if (post.score >= 20) score += 2;
    else if (post.score >= 10) score += 1;

    if (post.numComments >= 20) score += 3;
    else if (post.numComments >= 10) score += 2;
    else if (post.numComments >= 5) score += 1;

    if (hasToolIndicator) score += 2;

    // Only take meaningful ones
    if (score < 2) continue;

    // Categorize and create pain point
    let title = '';
    let description = '';

    const titleLower = post.title.toLowerCase();
    const bodyLower = post.body.toLowerCase();

    if (toolKeywords.some(kw => titleLower.includes(kw) || bodyLower.includes(kw))) {
      // Tool/app request
      title = `Plant care app/tool request: ${post.title.substring(0, 60)}`;
      description = `A plant parent is looking for a tool or app to help with ${post.title.toLowerCase().replace(/[?!]/g, '')}. ` +
        `This suggests a gap in available plant care tools. Post had ${post.score} upvotes and ${post.numComments} comments.`;
    } else if (['dying', 'dead', 'yellow', 'brown', 'drooping', 'wilting', 'root rot'].some(kw => fullText.includes(kw))) {
      // Plant health issue
      title = `Plant health diagnosis challenge: ${post.title.substring(0, 60)}`;
      description = `Plant owners struggle to diagnose and treat plant health issues like yellowing, wilting, or root rot. ` +
        `Post: "${post.title.substring(0, 100)}". This represents a recurring need for better diagnostic guidance. ` +
        `${post.score} upvotes, ${post.numComments} comments.`;
    } else if (['watering', 'overwater', 'underwater', 'schedule', 'remind', 'forget'].some(kw => fullText.includes(kw))) {
      // Watering challenge
      title = `Watering schedule management: ${post.title.substring(0, 55)}`;
      description = `Plant owners frequently struggle with knowing when and how much to water their plants. ` +
        `Post: "${post.title.substring(0, 100)}". This is a common pain point that could be addressed with better tracking tools. ` +
        `${post.score} upvotes, ${post.numComments} comments.`;
    } else if (['propagat', 'prop ', 'cutting', 'rooting', 'not rooting', 'won\'t root'].some(kw => fullText.includes(kw))) {
      // Propagation challenge
      title = `Propagation difficulty: ${post.title.substring(0, 62)}`;
      description = `Plant enthusiasts struggle with successful propagation techniques. ` +
        `Post: "${post.title.substring(0, 100)}". Community seeks better guidance for propagating specific plants. ` +
        `${post.score} upvotes, ${post.numComments} comments.`;
    } else if (['identify', 'what plant', 'unknown', 'mystery', 'what is this'].some(kw => fullText.includes(kw))) {
      // Plant identification
      title = `Plant identification need: ${post.title.substring(0, 60)}`;
      description = `Plant owners frequently need help identifying unknown plants or verifying plant species. ` +
        `Post: "${post.title.substring(0, 100)}". This represents demand for better plant ID tools. ` +
        `${post.score} upvotes, ${post.numComments} comments.`;
    } else if (['pests', 'bugs', 'gnats', 'mites', 'scale', 'thrips', 'aphid'].some(kw => fullText.includes(kw))) {
      // Pest issues
      title = `Plant pest management struggle: ${post.title.substring(0, 57)}`;
      description = `Plant owners deal with persistent pest problems and need better identification and treatment guidance. ` +
        `Post: "${post.title.substring(0, 100)}". Pest issues are a major source of plant loss. ` +
        `${post.score} upvotes, ${post.numComments} comments.`;
    } else {
      // General pain point
      title = `Plant care challenge: ${post.title.substring(0, 63)}`;
      description = `Plant parents face recurring care challenges. Post: "${post.title.substring(0, 100)}". ` +
        `This represents a common need in the plant community for better guidance or tools. ` +
        `${post.score} upvotes, ${post.numComments} comments.`;
    }

    // Ensure title max 80 chars
    title = title.substring(0, 80);

    painPoints.push({
      title,
      description,
      subreddit,
      redditPostId: post.id,
      redditUrl: post.url,
      postTitle: post.title,
      postBody: post.body,
      upvotes: post.score,
      commentCount: post.numComments,
      score // internal scoring
    });
  }

  // Sort by score, take top 5 per subreddit max
  painPoints.sort((a, b) => b.score - a.score);
  return painPoints.slice(0, 5);
}

async function main() {
  console.log('Nora-P scan starting...');
  console.log(`CDP URL: ${CDP_URL}`);
  console.log(`Subreddits: ${SUBREDDITS.join(', ')}`);

  let browser;
  let page;

  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('[browser] Connected to AdsPower CDP');

    const context = browser.contexts()[0];
    const pages = context.pages();
    console.log(`[browser] Found ${pages.length} open pages`);

    // Close extra tabs
    for (let i = 1; i < pages.length; i++) await pages[i].close();
    page = pages[0] || await context.newPage();

  } catch (e) {
    console.log(`[error] CDP connection failed: ${e.message}`);
    console.log('Falling back to JSON API only...');
    page = null;
  }

  const allResults = [];

  for (const subreddit of SUBREDDITS) {
    let posts = [];
    let painPoints = [];

    try {
      if (page) {
        posts = await scanSubredditWithPage(page, subreddit);
      } else {
        // JSON API fallback
        console.log(`\n=== Scanning r/${subreddit} (JSON API fallback) ===`);
        const jsonData = await fetchRedditJson(subreddit);
        if (jsonData && jsonData.data && jsonData.data.children) {
          for (const child of jsonData.data.children) {
            const d = child.data;
            if (d.stickied || (d.score || 0) < 5) continue;
            posts.push({
              id: d.id, title: d.title, body: d.selftext || '',
              score: d.score, numComments: d.num_comments,
              url: `https://reddit.com${d.permalink}`, subreddit
            });
          }
        }
        console.log(`  [json-api] Got ${posts.length} posts`);
      }

      // Enrich top posts (by comment count)
      const topPosts = [...posts].sort((a, b) => b.numComments - a.numComments).slice(0, 10);
      console.log(`  [enrich] Enriching top ${topPosts.length} posts...`);
      for (const post of topPosts) {
        await enrichPost(page, post);
        await sleep(1500);
      }

      // Analyze for pain points
      painPoints = analyzePainPoints(posts, subreddit);
      console.log(`  [analyze] Found ${painPoints.length} pain points`);

      // Submit pain points
      for (const pp of painPoints) {
        await submitPainPoint(pp);
        await sleep(500);
      }

    } catch (e) {
      console.log(`  [error] Failed to scan r/${subreddit}: ${e.message}`);
    }

    // Log scan results
    await logScan(subreddit, posts.length, painPoints.length);

    allResults.push({
      subreddit,
      postsScanned: posts.length,
      painPointsFound: painPoints.length,
      painPoints: painPoints.map(pp => pp.title)
    });

    // Pause between subreddits
    await sleep(3000);
  }

  // Summary
  console.log('\n=== SCAN COMPLETE ===');
  let totalPosts = 0, totalPain = 0;
  for (const r of allResults) {
    console.log(`r/${r.subreddit}: ${r.postsScanned} posts, ${r.painPointsFound} pain points`);
    r.painPoints.forEach(pp => console.log(`  - ${pp}`));
    totalPosts += r.postsScanned;
    totalPain += r.painPointsFound;
  }
  console.log(`\nTotal: ${SUBREDDITS.length} subreddits, ${totalPosts} posts, ${totalPain} pain points`);

  if (browser) {
    // Disconnect but don't close (admin closes the profile)
    await browser.close().catch(() => {});
  }
}

main().catch(e => {
  console.error('[fatal]', e.message);
  process.exit(1);
});
