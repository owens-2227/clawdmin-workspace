const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:61786/devtools/browser/a7512840-8b27-4c62-8194-62db63e423a1';
const AGENT_ID = 'marcus-j';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const SUBREDDITS = ['Guitar', 'guitarpedals', 'Blues', 'homerecording'];

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function submitPainPoint(pp) {
  console.log(`  → Submitting: "${pp.title.slice(0, 70)}..."`);
  const result = await apiPost('/api/pain-points', {
    title: pp.title.slice(0, 80),
    description: pp.description,
    category: 'Music',
    subreddit: pp.subreddit,
    discoveredBy: AGENT_ID
  });
  const id = result?.id || result?.data?.id;
  console.log(`    Created id: ${id}`);
  if (id && pp.post) {
    await apiPost('/api/pain-points/posts', {
      painPointId: id,
      redditPostId: pp.post.id || '',
      redditUrl: pp.post.url || '',
      postTitle: pp.post.title || '',
      postBody: (pp.post.body || '').slice(0, 2000),
      upvotes: pp.post.upvotes || 0,
      commentCount: pp.post.commentCount || 0,
      subreddit: pp.subreddit,
      discoveredBy: AGENT_ID
    });
  }
  return id;
}

async function logScan(subreddit, postsScanned, painPointsFound, status = 'completed') {
  const result = await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned,
    painPointsFound,
    status
  });
  console.log(`  Logged: ${JSON.stringify(result?.log?.id || result)}`);
}

async function scrapeSubredditViaBrowser(page, subreddit) {
  console.log(`\n  Navigating to r/${subreddit}...`);
  
  try {
    await page.goto(`https://www.reddit.com/r/${subreddit}/hot/`, {
      waitUntil: 'networkidle',
      timeout: 45000
    });
  } catch (e) {
    console.log(`  networkidle timeout, continuing anyway...`);
  }
  await page.waitForTimeout(3000);

  // Check if we're on a login/error page
  const pageTitle = await page.title();
  console.log(`  Page title: ${pageTitle}`);

  // Scroll to load more posts
  console.log(`  Scrolling to load posts...`);
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
    await page.waitForTimeout(2000);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);

  // Extract post data via page evaluate
  const posts = await page.evaluate(() => {
    const results = [];
    
    // Method 1: shreddit-post custom elements
    const shredditPosts = document.querySelectorAll('shreddit-post');
    for (const el of shredditPosts) {
      const title = el.getAttribute('post-title') || el.querySelector('[slot="title"]')?.textContent?.trim() || '';
      const score = parseInt(el.getAttribute('score') || '0');
      const commentCount = parseInt(el.getAttribute('comment-count') || '0');
      const permalink = el.getAttribute('permalink') || '';
      const postId = el.getAttribute('id') || el.id || permalink.split('/comments/')[1]?.split('/')[0] || '';
      const contentHref = el.getAttribute('content-href') || '';
      
      // Try to get post body text
      const bodyEl = el.querySelector('[data-testid="post-content"], .post-content, p');
      const body = bodyEl?.textContent?.trim() || '';
      
      if (title) {
        results.push({ title, score, commentCount, permalink, postId, body, contentHref });
      }
    }
    
    // Method 2: article elements (old UI fallback)
    if (results.length === 0) {
      const articles = document.querySelectorAll('article, [data-testid="post-container"]');
      for (const el of articles) {
        const titleEl = el.querySelector('h3, h1, [data-testid="post-title"]');
        const title = titleEl?.textContent?.trim() || '';
        const scoreEl = el.querySelector('[data-testid="vote-count"]');
        const score = parseInt(scoreEl?.textContent?.replace(/[^0-9\-]/g, '') || '0');
        const linkEl = el.querySelector('a[href*="/comments/"]');
        const permalink = linkEl?.getAttribute('href') || '';
        if (title) results.push({ title, score, commentCount: 0, permalink, postId: '', body: '' });
      }
    }
    
    return results;
  });

  console.log(`  Extracted ${posts.length} posts from browser`);
  return posts;
}

async function fetchPostDetails(page, permalink) {
  try {
    const url = `https://www.reddit.com${permalink}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);
    
    const details = await page.evaluate(() => {
      // Get post body
      const bodyEl = document.querySelector('[data-testid="post-content"] div, .RichTextJSON-root, shreddit-post [slot="text-body"]');
      const body = bodyEl?.textContent?.trim() || '';
      
      // Get top comments
      const commentEls = document.querySelectorAll('[data-testid="comment"], shreddit-comment');
      const comments = [];
      for (const el of Array.from(commentEls).slice(0, 5)) {
        const text = el.querySelector('[data-testid="comment-body"], p')?.textContent?.trim() || '';
        if (text) comments.push(text.slice(0, 300));
      }
      
      return { body, comments };
    });
    return details;
  } catch (e) {
    return { body: '', comments: [] };
  }
}

function isPainPoint(post) {
  const title = post.title || '';
  const body = post.body || '';
  const combined = (title + ' ' + body).toLowerCase();

  // Strong pain point signals - broader matching
  const strongSignals = [
    /\b(is there|does anyone know of|looking for|need|want)\s+(an?\s+)?(app|tool|plugin|software|website|service|platform|way|solution|method)\b/i,
    /\bwish (there was|i could|we had|someone would|they would|it had)\b/i,
    /\bhow (do you|do i|can i|can you|should i)\s+(manage|track|organize|record|find|keep|deal|handle|practice|improve)\b/i,
    /\bstruggl(e|ing|ed)\b/i,
    /\bfrustrat(ed|ing)\b/i,
    /\bcan't (figure out|afford|find|get|justify|improve|progress)\b/i,
    /\btoo (expensive|complex|complicated|hard|difficult|overwhelming)\b/i,
    /\b(never|can't|unable to|still can't)\s+(play|learn|improve|progress|get|afford)\b/i,
    /\bwasted (time|money|hours|years)\b/i,
    /\bno (good|decent|free|affordable|easy)\s+(way|tool|app|option|solution|software)\b/i,
    /\bannoying|pain (in the|point)\b/i,
    /\b(hard|difficult|confusing|overwhelming|daunting) (to|for)\b/i,
    /\bstuck\b/i,
    /\bnever (seems to|will|going to) (click|work|improve|get better)\b/i,
    /\bafter (years|months|decades)\b/i,
    /\bcome to terms\b/i,
    /\bwhat (do you|should i) use\b/i,
    /\bworth it\b/i,
    /\b(help me choose|which is better|vs\b|versus)\b/i,
    /\bdo i need\b/i,
    /\bbest (way|approach|method|app|tool|software) (to|for)\b/i,
    /\bkeep (failing|forgetting|losing|struggling)\b/i,
    /\bcan't seem to\b/i,
    /\b(overwhelming|intimidating|confusing)\b/i,
  ];

  // Exclusion patterns
  const exclusions = [
    /^\s*(ngd|npd|nbd)\b/i, // new gear/pedal/bass day - pure celebration
    /^(check out|look at|here's my|my new|just got|just bought|just picked up)/i,
  ];

  if (exclusions.some(e => e.test(title))) return false;
  if ((post.score || 0) < 5) return false;

  const matched = strongSignals.filter(s => s.test(combined));
  return matched.length > 0;
}

function buildPainPointFromPost(post, subreddit) {
  const title = post.title || '';
  const body = (post.body || '').slice(0, 200).trim();
  
  // Craft a concise description
  const desc = body ? 
    `Guitarists in r/${subreddit} discussing: ${body.slice(0, 200)}` :
    `Recurring discussion in r/${subreddit} about: ${title}`;

  return {
    title: title.slice(0, 80),
    description: desc.slice(0, 500),
    subreddit: `r/${subreddit}`,
    post: {
      id: post.postId || post.id || '',
      url: post.permalink ? `https://reddit.com${post.permalink}` : '',
      title: title,
      body: post.body || '',
      upvotes: post.score || 0,
      commentCount: post.commentCount || 0
    }
  };
}

async function main() {
  console.log('=== marcus-j scanner v2 starting ===');
  
  let browser, page;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected to AdsPower CDP');
    const context = browser.contexts()[0];
    const pages = context.pages();
    for (let i = 1; i < pages.length; i++) await pages[i].close();
    page = pages[0] || await context.newPage();
    console.log('Page ready');
  } catch (e) {
    console.error('CDP connect failed:', e.message);
    process.exit(1);
  }

  let totalPostsAnalyzed = 0;
  let totalPainPoints = 0;
  const allPainPointTitles = [];

  for (const subreddit of SUBREDDITS) {
    console.log(`\n========== r/${subreddit} ==========`);
    let postsScanned = 0;
    let painPointsFound = 0;

    try {
      const posts = await scrapeSubredditViaBrowser(page, subreddit);
      postsScanned = posts.length;
      totalPostsAnalyzed += postsScanned;

      // Analyze for pain points
      const candidatePosts = posts.filter(p => isPainPoint(p));
      console.log(`  ${candidatePosts.length} pain point candidates out of ${posts.length} posts`);

      // For top candidates with many comments, fetch post details
      const topCandidates = candidatePosts
        .sort((a, b) => (b.commentCount || 0) - (a.commentCount || 0))
        .slice(0, 5);

      for (const post of topCandidates) {
        if (post.permalink && !post.body) {
          console.log(`  Fetching details for: ${post.title.slice(0, 60)}...`);
          const details = await fetchPostDetails(page, post.permalink);
          post.body = details.body;
          post.comments = details.comments;
          await page.waitForTimeout(2000);
        }

        const pp = buildPainPointFromPost(post, subreddit);
        await submitPainPoint(pp);
        painPointsFound++;
        totalPainPoints++;
        allPainPointTitles.push(pp.title);
        await new Promise(r => setTimeout(r, 500));
      }

      // If fewer than 3 were found, also check remaining candidates
      if (candidatePosts.length > 5) {
        for (const post of candidatePosts.slice(5, 8)) {
          const pp = buildPainPointFromPost(post, subreddit);
          await submitPainPoint(pp);
          painPointsFound++;
          totalPainPoints++;
          allPainPointTitles.push(pp.title);
          await new Promise(r => setTimeout(r, 500));
        }
      }

    } catch (err) {
      console.error(`  Error scanning r/${subreddit}:`, err.message);
      await logScan(subreddit, postsScanned, painPointsFound, 'error');
      continue;
    }

    await logScan(subreddit, postsScanned, painPointsFound, 'completed');
    console.log(`  ✓ r/${subreddit}: ${postsScanned} posts, ${painPointsFound} pain points`);

    // Pacing
    if (SUBREDDITS.indexOf(subreddit) < SUBREDDITS.length - 1) {
      console.log('  Waiting 4s...');
      await new Promise(r => setTimeout(r, 4000));
    }
  }

  console.log('\n========== FINAL SUMMARY ==========');
  console.log(`Subreddits: ${SUBREDDITS.length}`);
  console.log(`Total posts analyzed: ${totalPostsAnalyzed}`);
  console.log(`Pain points submitted: ${totalPainPoints}`);
  if (allPainPointTitles.length > 0) {
    console.log('\nPain points:');
    allPainPointTitles.forEach((t, i) => console.log(`  ${i+1}. ${t}`));
  }

  // Do NOT close browser - admin handles it
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
