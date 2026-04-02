const { chromium } = require('playwright');

const CDP_URL = process.env.CDP_URL || 'ws://127.0.0.1:64456/devtools/browser/d30e8ce7-8029-42ba-ada1-aae3bd6fd7da';
const AGENT_ID = 'priya-k';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const SUBREDDITS = [
  { sub: 'Meditation', category: 'Mental Health' },
  { sub: 'Anxiety', category: 'Mental Health' },
  { sub: 'therapists', category: 'Therapy' },
  { sub: 'Journaling', category: 'Journaling' },
];

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
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function submitPainPoint(data) {
  return await apiPost('/api/pain-points', data);
}

async function linkPost(data) {
  return await apiPost('/api/pain-points/posts', data);
}

async function logScan(data) {
  return await apiPost('/api/pain-points/scan-logs', data);
}

function isPainPoint(title, body) {
  const combined = (title + ' ' + (body || '')).toLowerCase();
  const includePatterns = [
    /is there (an app|a tool|a way|something)/,
    /does anyone (know|use|have)/,
    /struggling with/,
    /can'?t find/,
    /hard to (track|find|manage|organize|keep)/,
    /wish there was/,
    /looking for (an app|a tool|a way|something)/,
    /how do you (track|manage|organize|keep|deal with)/,
    /anyone else (struggle|have trouble|find it hard)/,
    /no (app|tool|way) to/,
    /recommend(ation)? for/,
    /help me (find|track|manage|organize)/,
    /best (app|tool|way|method) for/,
    /what (app|tool|do you use) for/,
    /overwhelmed by/,
    /too (expensive|complex|complicated)/,
    /manual(ly)? (track|do|enter)/,
    /spreadsheet for/,
    /nothing (works|helps)/,
    /frustrated (with|by)/,
  ];
  const excludePatterns = [
    /\bmeme\b/, /\bhumor\b/, /\bfunny\b/, /\bjoke\b/,
    /i (love|hate) my/, /relationship/, /breakup/, /divorce/,
  ];
  for (const pat of excludePatterns) {
    if (pat.test(combined)) return false;
  }
  for (const pat of includePatterns) {
    if (pat.test(combined)) return true;
  }
  return false;
}

async function scanSubreddit(page, sub, category) {
  console.log(`\n=== Scanning r/${sub} ===`);
  const painPoints = [];
  let postsScanned = 0;

  try {
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await sleep(3000);

    // Check actual page title and URL to detect blocks
    const pageTitle = await page.title();
    const pageUrl = page.url();
    console.log(`  Page title: ${pageTitle}`);
    console.log(`  Page URL: ${pageUrl}`);

    // Check for hard blocks (not false positives from script content)
    const visibleText = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || '');
    console.log(`  Page text preview: ${visibleText.slice(0, 200)}`);

    // Only skip if we see a genuine block
    if (pageUrl.includes('reddit.com/login') || pageTitle.toLowerCase().includes('page not found')) {
      console.log(`  Blocked/not found on r/${sub}, skipping`);
      return { postsScanned: 0, painPointsFound: 0, error: 'Login wall or 404' };
    }

    // Get post links - try multiple selectors for different Reddit layouts
    let postLinks = [];
    
    // Try new shreddit layout first
    postLinks = await page.$$eval(
      'shreddit-post',
      posts => posts.map(p => ({
        href: p.getAttribute('permalink') ? 'https://www.reddit.com' + p.getAttribute('permalink') : '',
        title: p.getAttribute('post-title') || p.querySelector('a[slot="full-post-link"]')?.textContent?.trim() || '',
        score: parseInt(p.getAttribute('score') || '0'),
        commentCount: parseInt(p.getAttribute('comment-count') || '0'),
        redditPostId: p.getAttribute('id') || '',
      })).filter(p => p.href)
    ).catch(() => []);

    console.log(`  shreddit-post elements found: ${postLinks.length}`);

    // Fallback: try anchor tags with /comments/ in href
    if (postLinks.length === 0) {
      const rawLinks = await page.$$eval(
        'a[href*="/comments/"]',
        links => links.map(a => ({
          href: a.href.split('?')[0],
          title: a.textContent?.trim() || '',
        }))
      ).catch(() => []);

      // Deduplicate
      const seen = new Set();
      for (const l of rawLinks) {
        if (!seen.has(l.href) && l.href.includes('/comments/')) {
          seen.add(l.href);
          postLinks.push(l);
        }
      }
      console.log(`  Fallback: ${postLinks.length} post links found`);
    }

    console.log(`Found ${postLinks.length} posts on r/${sub}`);

    // Visit top posts (up to 15)
    const toVisit = postLinks.slice(0, 15);
    
    for (const post of toVisit) {
      try {
        await sleep(2500);
        const url = post.href.startsWith('http') ? post.href : `https://www.reddit.com${post.href}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await sleep(2000);

        // Extract post details
        const postData = await page.evaluate((fallbackTitle) => {
          // Try to get title from shreddit-post or h1
          const shredditPost = document.querySelector('shreddit-post');
          const title = shredditPost?.getAttribute('post-title') 
            || document.querySelector('h1[slot="title"]')?.textContent?.trim()
            || document.querySelector('h1')?.textContent?.trim()
            || fallbackTitle
            || document.title;

          // Try to get body text
          const bodySelectors = [
            '[slot="text-body"]',
            '[data-testid="post-content"] .RichTextJSON-root',
            '.selftext .md',
            'div[id^="t3_"] .usertext-body',
          ];
          let body = '';
          for (const sel of bodySelectors) {
            const el = document.querySelector(sel);
            if (el?.textContent?.trim()) { body = el.textContent.trim(); break; }
          }

          // Score
          const scoreAttr = shredditPost?.getAttribute('score');
          const score = scoreAttr ? parseInt(scoreAttr) : 0;

          // Comment count
          const commentAttr = shredditPost?.getAttribute('comment-count');
          const commentCount = commentAttr ? parseInt(commentAttr) : 
            document.querySelectorAll('shreddit-comment, [data-testid="comment"]').length;

          // Reddit post ID from URL
          const match = window.location.pathname.match(/\/comments\/([a-z0-9]+)\//i);
          const redditPostId = match ? match[1] : '';

          return { 
            title: title?.slice(0, 200) || '', 
            body: body.slice(0, 2000), 
            score, 
            commentCount, 
            redditPostId, 
            url: window.location.href 
          };
        }, post.title || '');

        postsScanned++;
        console.log(`  Post [${postsScanned}]: "${postData.title.slice(0, 60)}" | score=${postData.score} comments=${postData.commentCount}`);

        // Check if this is a pain point
        if (isPainPoint(postData.title, postData.body) && postData.score >= 5) {
          console.log(`  ✓ Pain point detected!`);
          
          // Create pain point
          const ppResult = await submitPainPoint({
            title: postData.title.slice(0, 80),
            description: `From r/${sub}: ${(postData.body || postData.title).slice(0, 300).trim()}. Found in community discussion with ${postData.score} upvotes and ${postData.commentCount} comments.`,
            category,
            subreddit: `r/${sub}`,
            discoveredBy: AGENT_ID,
          });

          console.log(`  API result:`, JSON.stringify(ppResult).slice(0, 150));

          const painPointId = ppResult?.id || ppResult?.data?.id || ppResult?.painPoint?.id;
          
          if (painPointId) {
            const linkResult = await linkPost({
              painPointId,
              redditPostId: postData.redditPostId,
              redditUrl: postData.url,
              postTitle: postData.title.slice(0, 300),
              postBody: postData.body.slice(0, 2000),
              upvotes: postData.score,
              commentCount: postData.commentCount,
              subreddit: `r/${sub}`,
              discoveredBy: AGENT_ID,
            });
            console.log(`  Link result:`, JSON.stringify(linkResult).slice(0, 100));
          }

          painPoints.push({ title: postData.title, url: postData.url });
        }

      } catch (err) {
        console.log(`  Error visiting post: ${err.message}`);
      }
    }

  } catch (err) {
    console.log(`Error scanning r/${sub}: ${err.message}`);
    return { postsScanned, painPointsFound: painPoints.length, error: err.message };
  }

  // Log scan results
  const logResult = await logScan({
    agentId: AGENT_ID,
    subreddit: `r/${sub}`,
    postsScanned,
    painPointsFound: painPoints.length,
    status: 'completed',
  });
  console.log(`  Scan log: ${JSON.stringify(logResult).slice(0, 100)}`);

  console.log(`  Done: ${postsScanned} posts scanned, ${painPoints.length} pain points found`);
  return { postsScanned, painPointsFound: painPoints.length };
}

async function main() {
  console.log(`Priya-K scan starting — agent: ${AGENT_ID}`);
  console.log(`Connecting to CDP: ${CDP_URL}`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected to browser');
  } catch (err) {
    console.error('Failed to connect to CDP:', err.message);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  if (!context) {
    console.error('No browser context found');
    process.exit(1);
  }

  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  // Close extra tabs
  for (let i = 1; i < pages.length; i++) {
    await pages[i].close().catch(() => {});
  }

  const results = {
    subredditsScanned: 0,
    totalPostsAnalyzed: 0,
    totalPainPointsFound: 0,
    errors: [],
    details: [],
  };

  for (const { sub, category } of SUBREDDITS) {
    const r = await scanSubreddit(page, sub, category);
    results.subredditsScanned++;
    results.totalPostsAnalyzed += r.postsScanned || 0;
    results.totalPainPointsFound += r.painPointsFound || 0;
    if (r.error) results.errors.push(`r/${sub}: ${r.error}`);
    results.details.push({ sub, ...r });
    
    // Pause between subreddits
    await sleep(4000);
  }

  // Don't close the browser — admin handles that

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${results.subredditsScanned}`);
  console.log(`Total posts analyzed: ${results.totalPostsAnalyzed}`);
  console.log(`Pain points found: ${results.totalPainPointsFound}`);
  if (results.errors.length) console.log(`Errors: ${results.errors.join(', ')}`);
  console.log('Details:', JSON.stringify(results.details, null, 2));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
