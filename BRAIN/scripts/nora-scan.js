/**
 * Nora-P Reddit Scanner — Plant Parents subreddits
 * Subreddits: houseplants, proplifting, plantclinic, IndoorGarden
 * Agent: nora-p
 */

const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:60712/devtools/browser/b16af6ee-2186-414a-8084-baaf9f619d63';
const AGENT_ID = 'nora-p';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
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

async function submitPainPoint(painPoint) {
  console.log(`  → Submitting pain point: ${painPoint.title}`);
  const result = await apiPost('/api/pain-points', {
    title: painPoint.title,
    description: painPoint.description,
    category: CATEGORY,
    subreddit: painPoint.subreddit,
    discoveredBy: AGENT_ID,
  });
  console.log(`    Created pain point ID: ${result.id || JSON.stringify(result)}`);
  return result;
}

async function submitSource(painPointId, post) {
  const result = await apiPost('/api/pain-points/posts', {
    painPointId,
    redditPostId: post.redditPostId,
    redditUrl: post.redditUrl,
    postTitle: post.postTitle,
    postBody: (post.postBody || '').substring(0, 2000),
    upvotes: post.upvotes,
    commentCount: post.commentCount,
    subreddit: post.subreddit,
    discoveredBy: AGENT_ID,
  });
  console.log(`    Linked source post: ${result.id || JSON.stringify(result)}`);
  return result;
}

async function logScan(subreddit, postsScanned, painPointsFound, status = 'completed') {
  const result = await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned,
    painPointsFound,
    status,
  });
  console.log(`  → Scan log submitted: ${JSON.stringify(result)}`);
}

async function fetchSubredditJSON(sub) {
  // Fallback: use Reddit JSON API
  const url = `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });
    const data = await res.json();
    return data?.data?.children?.map(c => c.data) || [];
  } catch (e) {
    console.error(`  JSON API fallback failed for ${sub}: ${e.message}`);
    return [];
  }
}

function analyzePainPoints(posts, subreddit) {
  const painPoints = [];

  // Keywords that suggest pain points / actionable problems
  const painKeywords = [
    'help', 'how do i', 'how to', 'struggling', 'problem', 'issue', 'dying', 'dead', 'killing',
    'can\'t figure', 'confused', 'not sure', 'advice', 'overwatered', 'underwatered',
    'yellowing', 'dropping', 'pests', 'bugs', 'mold', 'rot', 'root rot', 'propagat',
    'tool', 'app', 'track', 'organize', 'identify', 'disease', 'diagnose', 'treatment',
    'repot', 'soil', 'fertilizer', 'humidity', 'light', 'watering schedule',
    'is there an app', 'any recommendations', 'best way to', 'anyone else',
    'frustrated', 'fail', 'failed', 'keep dying', 'keeps dying', 'nothing works',
    'expensive', 'cheap', 'free', 'subscription', 'manage', 'management'
  ];

  const excludeKeywords = [
    'check out my', 'look at my', 'sharing', 'update on', 'happy', 'proud',
    'beautiful', 'pretty', 'gorgeous', 'love my', 'finally', 'thriving', 'progress'
  ];

  for (const post of posts) {
    if (post.stickied || post.pinned) continue;
    if (post.score < 5) continue;

    const titleLower = (post.title || '').toLowerCase();
    const bodyLower = (post.selftext || '').toLowerCase();
    const combined = titleLower + ' ' + bodyLower;

    // Skip if looks like celebration/sharing
    const isExcluded = excludeKeywords.some(kw => combined.includes(kw));
    if (isExcluded && !painKeywords.some(kw => combined.includes(kw))) continue;

    const hasPainKeyword = painKeywords.some(kw => combined.includes(kw));
    if (!hasPainKeyword) continue;

    // Determine what kind of pain point
    let painTitle = null;
    let painDescription = null;

    if (/app|tool|track|organiz|schedule|remind/i.test(combined)) {
      painTitle = `Plant care tracking/scheduling tool needed in r/${subreddit}`;
      painDescription = `Users in r/${subreddit} are looking for tools to track watering schedules, fertilization, and plant care routines. Existing apps are often too complex or require paid subscriptions. Post: "${post.title.substring(0, 100)}"`;
    } else if (/identify|diagnos|what is|what's wrong|disease|pest|bug/i.test(combined)) {
      painTitle = `Plant diagnosis & pest ID frustration in r/${subreddit}`;
      painDescription = `Plant owners in r/${subreddit} struggle to identify diseases, pests, or diagnose why their plants are declining. They rely on community posts rather than having reliable identification tools. Post: "${post.title.substring(0, 100)}"`;
    } else if (/propagat/i.test(combined)) {
      painTitle = `Propagation success tracking needed in r/${subreddit}`;
      painDescription = `Plant hobbyists in r/${subreddit} want better ways to track propagation attempts, success rates, and timing. Currently done manually with no structured system. Post: "${post.title.substring(0, 100)}"`;
    } else if (/overwater|underwater|root rot|dropp|yellow|dying|dead/i.test(combined)) {
      painTitle = `Watering guidance gap causing plant deaths in r/${subreddit}`;
      painDescription = `Users in r/${subreddit} frequently lose plants to over/under watering and root rot. They lack personalized watering guidance based on their specific environment, pot type, and plant species. Post: "${post.title.substring(0, 100)}"`;
    } else if (/humidity|light|soil|fertilizer|repot/i.test(combined)) {
      painTitle = `Plant care conditions guidance lacking in r/${subreddit}`;
      painDescription = `Plant owners in r/${subreddit} struggle to understand optimal care conditions (humidity, light, soil, fertilizer) for their specific plants and living situations. Post: "${post.title.substring(0, 100)}"`;
    } else if (/help|struggling|confused|not sure|advice/i.test(combined)) {
      painTitle = `General plant care knowledge gap in r/${subreddit}`;
      painDescription = `Users in r/${subreddit} frequently seek community help for basic plant care questions, indicating a gap in accessible, personalized plant care guidance. Post: "${post.title.substring(0, 100)}"`;
    }

    if (painTitle) {
      // Check if we already have a similar pain point (dedup by category)
      const existingSimilar = painPoints.find(p => p.title === painTitle);
      if (!existingSimilar) {
        painPoints.push({
          title: painTitle.substring(0, 80),
          description: painDescription,
          subreddit: `r/${subreddit}`,
          redditPostId: post.id,
          redditUrl: `https://reddit.com${post.permalink}`,
          postTitle: post.title,
          postBody: post.selftext || '',
          upvotes: post.score,
          commentCount: post.num_comments,
        });
      }
    }
  }

  return painPoints;
}

async function scanSubredditBrowser(page, sub) {
  console.log(`\n=== Scanning r/${sub} via browser ===`);
  const posts = [];

  try {
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await sleep(3000);

    // Scroll down to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    // Try to extract posts from the page
    const postData = await page.evaluate(() => {
      const results = [];

      // Shreddit new UI
      const shredditPosts = document.querySelectorAll('shreddit-post');
      for (const el of shredditPosts) {
        const title = el.getAttribute('post-title') || el.querySelector('h1,h2,h3,[slot="title"]')?.textContent?.trim() || '';
        const id = el.getAttribute('id') || el.getAttribute('post-id') || '';
        const permalink = el.getAttribute('permalink') || el.querySelector('a[href*="/comments/"]')?.getAttribute('href') || '';
        const score = parseInt(el.getAttribute('score') || '0', 10);
        const commentCount = parseInt(el.getAttribute('comment-count') || '0', 10);
        if (title) {
          results.push({ title, id, permalink, score, commentCount, selftext: '', stickied: false, pinned: false, num_comments: commentCount });
        }
      }

      // Fallback: old Reddit link elements
      if (results.length === 0) {
        const links = document.querySelectorAll('a[data-click-id="body"]');
        for (const a of links) {
          const title = a.textContent?.trim() || '';
          const href = a.getAttribute('href') || '';
          if (title && href.includes('/comments/')) {
            const idMatch = href.match(/\/comments\/([a-z0-9]+)\//i);
            results.push({
              title,
              id: idMatch ? idMatch[1] : '',
              permalink: href,
              score: 0,
              commentCount: 0,
              selftext: '',
              stickied: false,
              pinned: false,
              num_comments: 0,
            });
          }
        }
      }

      return results;
    });

    console.log(`  Browser extracted ${postData.length} posts`);

    if (postData.length >= 3) {
      return postData;
    }
  } catch (e) {
    console.error(`  Browser scan failed for r/${sub}: ${e.message}`);
  }

  return [];
}

async function main() {
  console.log('=== Nora-P Plant Parent Scanner Starting ===');
  console.log(`CDP: ${CDP_URL}`);
  console.log(`Subreddits: ${SUBREDDITS.join(', ')}`);

  let browser, page;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    const context = browser.contexts()[0];
    const pages = context.pages();
    for (let i = 1; i < pages.length; i++) await pages[i].close();
    page = pages[0] || await context.newPage();
    console.log('Connected to AdsPower browser via CDP');
  } catch (e) {
    console.error(`Failed to connect via CDP: ${e.message}`);
    console.log('Will use JSON API fallback for all subreddits');
  }

  const summary = {
    subredditsScanned: 0,
    totalPostsScanned: 0,
    totalPainPoints: 0,
    painPointTitles: [],
    errors: [],
  };

  for (const sub of SUBREDDITS) {
    let posts = [];
    let painPointsFound = 0;

    try {
      // Try browser first, fall back to JSON API
      if (page) {
        posts = await scanSubredditBrowser(page, sub);
        await sleep(2000);
      }

      if (posts.length < 3) {
        console.log(`  Falling back to JSON API for r/${sub}`);
        posts = await fetchSubredditJSON(sub);
        console.log(`  JSON API returned ${posts.length} posts`);
      }

      // Analyze for pain points
      const painPoints = analyzePainPoints(posts, sub);
      console.log(`  Found ${painPoints.length} pain points in r/${sub}`);

      // Submit each pain point
      for (const pp of painPoints) {
        try {
          const result = await submitPainPoint(pp);
          if (result && result.id) {
            await submitSource(result.id, pp);
            summary.painPointTitles.push(pp.title);
            painPointsFound++;
          } else {
            console.log(`  Warning: No ID returned for pain point, skipping source link`);
          }
          await sleep(1000);
        } catch (e) {
          console.error(`  Error submitting pain point: ${e.message}`);
          summary.errors.push(`r/${sub} pain point submit: ${e.message}`);
        }
      }

      // Log scan
      await logScan(sub, posts.length, painPointsFound, 'completed');
      summary.subredditsScanned++;
      summary.totalPostsScanned += posts.length;
      summary.totalPainPoints += painPointsFound;

    } catch (e) {
      console.error(`Error scanning r/${sub}: ${e.message}`);
      summary.errors.push(`r/${sub}: ${e.message}`);
      await logScan(sub, 0, 0, 'error');
    }

    // Pace between subreddits
    if (sub !== SUBREDDITS[SUBREDDITS.length - 1]) {
      console.log(`  Waiting 3s before next subreddit...`);
      await sleep(3000);
    }
  }

  console.log('\n=== Scan Complete ===');
  console.log(`Subreddits scanned: ${summary.subredditsScanned}`);
  console.log(`Total posts analyzed: ${summary.totalPostsScanned}`);
  console.log(`Pain points submitted: ${summary.totalPainPoints}`);
  if (summary.painPointTitles.length) {
    console.log('Pain points found:');
    summary.painPointTitles.forEach(t => console.log(`  - ${t}`));
  }
  if (summary.errors.length) {
    console.log('Errors:');
    summary.errors.forEach(e => console.log(`  ⚠ ${e}`));
  }

  // Note: do NOT close the browser — admin agent handles that
  process.exit(0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
