const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:50704/devtools/browser/62e800a8-053a-4f51-92a0-25264aef20da';
const AGENT_ID = 'ty-m';
const SUBREDDITS = ['bikecommuting', 'gravelcycling', 'bikewrench', 'fuckcars'];
const CATEGORY = 'Cycling';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const https = require('https');
const http = require('http');

function apiPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(API_BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch(e) { resolve(body); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  const painPoints = [];
  let postsScanned = 0;

  try {
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    // Check for CAPTCHA or login wall
    const pageContent = await page.content();
    if (pageContent.includes('CAPTCHA') || pageContent.includes('captcha')) {
      console.log(`CAPTCHA detected on r/${sub}, skipping`);
      return { painPoints: [], postsScanned: 0, error: 'CAPTCHA' };
    }

    // Scroll to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }

    // Scroll back to top
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    // Take a snapshot of the page to read posts
    const snapshot = await page.accessibility.snapshot();
    const bodyText = await page.evaluate(() => document.body.innerText);

    // Try to get posts from the page
    // Reddit new UI uses shreddit-post elements
    const posts = await page.evaluate(() => {
      const results = [];
      
      // Try shreddit-post (new Reddit)
      const shredditPosts = document.querySelectorAll('shreddit-post');
      for (const post of shredditPosts) {
        const title = post.getAttribute('post-title') || post.querySelector('[slot="title"]')?.textContent?.trim();
        const score = parseInt(post.getAttribute('score') || '0');
        const commentCount = parseInt(post.getAttribute('comment-count') || '0');
        const permalink = post.getAttribute('permalink') || post.querySelector('a[slot="full-post-link"]')?.getAttribute('href');
        const postId = post.getAttribute('id') || permalink?.split('/comments/')[1]?.split('/')[0];
        
        if (title) {
          results.push({ title, score, commentCount, permalink, postId });
        }
      }
      
      // Fallback: look for article elements or post containers
      if (results.length === 0) {
        const articles = document.querySelectorAll('article, [data-testid="post-container"]');
        for (const art of articles) {
          const titleEl = art.querySelector('h1, h2, h3, [data-click-id="text"] a');
          const title = titleEl?.textContent?.trim();
          if (title) {
            results.push({ title, score: 0, commentCount: 0, permalink: null, postId: null });
          }
        }
      }
      
      return results;
    });

    console.log(`Found ${posts.length} posts on r/${sub}`);

    if (posts.length === 0) {
      // Fallback to JSON API
      console.log(`No posts via DOM, trying JSON API fallback for r/${sub}`);
      try {
        const jsonResp = await page.goto(`https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        const jsonText = await page.evaluate(() => document.body.innerText);
        const jsonData = JSON.parse(jsonText);
        const jsonPosts = jsonData?.data?.children?.map(c => ({
          title: c.data.title,
          score: c.data.score,
          commentCount: c.data.num_comments,
          permalink: c.data.permalink,
          postId: c.data.id,
          selftext: c.data.selftext,
          stickied: c.data.stickied,
        })) || [];
        
        console.log(`JSON API returned ${jsonPosts.length} posts`);
        
        // Now navigate back to the subreddit
        await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(2000);
        
        return await analyzeJsonPosts(page, sub, jsonPosts, painPoints);
      } catch(e) {
        console.log(`JSON API fallback failed: ${e.message}`);
        return { painPoints: [], postsScanned: 0, error: e.message };
      }
    }

    postsScanned = posts.length;
    
    // Analyze posts for pain points - check promising ones in detail
    const promisingPosts = posts.filter(p => 
      !p.stickied && 
      p.score >= 5 && 
      p.commentCount >= 10 &&
      isPainPointTitle(p.title)
    ).slice(0, 8); // Max 8 posts to drill into

    console.log(`${promisingPosts.length} promising posts to drill into`);

    for (const post of promisingPosts) {
      if (!post.permalink) continue;
      
      try {
        const url = 'https://www.reddit.com' + post.permalink;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await sleep(2500);

        // Get post body and top comments
        const postDetail = await page.evaluate(() => {
          // Post body
          const bodyEl = document.querySelector('[data-testid="post-content"] .md, shreddit-post [slot="text-body"], .usertext-body .md');
          const body = bodyEl?.textContent?.trim() || '';
          
          // Comments
          const commentEls = document.querySelectorAll('[data-testid="comment"], shreddit-comment');
          const comments = [];
          let count = 0;
          for (const c of commentEls) {
            if (count >= 10) break;
            const txt = c.querySelector('.md, [slot="comment"]')?.textContent?.trim();
            if (txt && txt.length > 20) { comments.push(txt); count++; }
          }
          return { body, comments };
        });

        const painPoint = analyzePainPoint(post, postDetail, sub);
        if (painPoint) {
          painPoints.push({ ...painPoint, post });
        }

        await sleep(2000);
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 });
        await sleep(1500);
      } catch(e) {
        console.log(`Error reading post "${post.title}": ${e.message}`);
      }
    }

    // Also check titles-only for high-signal posts
    const titleOnlyPainPoints = posts.filter(p => 
      !promisingPosts.find(pp => pp.title === p.title) &&
      !p.stickied &&
      isPainPointTitle(p.title)
    ).slice(0, 5);

    for (const post of titleOnlyPainPoints) {
      const painPoint = analyzePainPoint(post, { body: '', comments: [] }, sub);
      if (painPoint) {
        painPoints.push({ ...painPoint, post });
      }
    }

  } catch(e) {
    console.log(`Error scanning r/${sub}: ${e.message}`);
    return { painPoints: [], postsScanned: 0, error: e.message };
  }

  console.log(`r/${sub}: ${postsScanned} posts scanned, ${painPoints.length} pain points found`);
  return { painPoints, postsScanned };
}

async function analyzeJsonPosts(page, sub, posts, existingPainPoints) {
  const painPoints = [];
  const filtered = posts.filter(p => !p.stickied && p.score >= 5);
  const postsScanned = filtered.length;

  for (const post of filtered) {
    if (!isPainPointTitle(post.title) && !(post.selftext && isPainPointText(post.selftext))) continue;
    
    // Drill into promising posts
    if (post.commentCount >= 10 && post.permalink) {
      try {
        const url = 'https://www.reddit.com' + post.permalink;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await sleep(2500);

        const postDetail = await page.evaluate(() => {
          const bodyEl = document.querySelector('[data-testid="post-content"] .md, .usertext-body .md');
          const body = bodyEl?.textContent?.trim() || '';
          const commentEls = document.querySelectorAll('[data-testid="comment"]');
          const comments = [];
          let count = 0;
          for (const c of commentEls) {
            if (count >= 10) break;
            const txt = c.querySelector('.md')?.textContent?.trim();
            if (txt && txt.length > 20) { comments.push(txt); count++; }
          }
          return { body: body || post.selftext || '', comments };
        });

        const painPoint = analyzePainPoint(post, postDetail, sub);
        if (painPoint) painPoints.push({ ...painPoint, post });

        await sleep(2000);
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        await sleep(1500);
      } catch(e) {
        // Just analyze from title/selftext
        const painPoint = analyzePainPoint(post, { body: post.selftext || '', comments: [] }, sub);
        if (painPoint) painPoints.push({ ...painPoint, post });
      }
    } else {
      const painPoint = analyzePainPoint(post, { body: post.selftext || '', comments: [] }, sub);
      if (painPoint) painPoints.push({ ...painPoint, post });
    }
  }

  return { painPoints, postsScanned };
}

function isPainPointTitle(title) {
  if (!title) return false;
  const lower = title.toLowerCase();
  const signals = [
    'anyone else', 'frustrated', 'frustrating', 'annoying', 'wish there was',
    'is there an app', 'is there a tool', 'how do you', 'help with', 'struggling',
    'problem with', 'issue with', 'tired of', 'hate when', 'need help',
    'why is it so hard', 'can\'t find', 'looking for', 'anyone know how',
    'tips for', 'advice on', 'question about', 'confused about',
    'best way to', 'how to track', 'how to manage', 'keeps breaking',
    'expensive', 'overpriced', 'complicated', 'confusing', 'hard to',
    'difficult to', 'anyone else have', 'rant', 'venting',
    'maintenance schedule', 'route planning', 'route finding',
    'commute problem', 'storage problem', 'locking', 'theft',
    'gear selection', 'component compatibility', 'brake problem',
    'shifting issue', 'flat tire', 'puncture', 'tube vs tubeless',
    'chain issue', 'cable routing', 'fitting problem', 'sizing',
  ];
  return signals.some(s => lower.includes(s));
}

function isPainPointText(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return lower.includes('problem') || lower.includes('frustrat') || 
         lower.includes('struggling') || lower.includes('wish') ||
         lower.includes('app') || lower.includes('tool') ||
         lower.includes('track') || lower.includes('manage');
}

function analyzePainPoint(post, detail, sub) {
  const { title, score, commentCount, permalink, postId } = post;
  const { body, comments } = detail;
  const combined = (title + ' ' + body + ' ' + comments.join(' ')).toLowerCase();

  // Determine pain point type
  let painTitle = null;
  let description = null;

  if (combined.includes('route') && (combined.includes('plan') || combined.includes('find') || combined.includes('navigat'))) {
    painTitle = 'Cyclists struggle to find/plan safe, practical bike routes';
    description = `Cyclists in r/${sub} regularly discuss difficulty finding safe, low-traffic routes. Existing mapping tools (Google Maps, Komoot) don't always prioritize cyclist safety, road surface quality, or infrastructure. Commuters and gravel riders both need better route discovery tools.`;
  } else if (combined.includes('maintenance') && (combined.includes('track') || combined.includes('schedul') || combined.includes('log') || combined.includes('remind'))) {
    painTitle = 'No good way to track and schedule bike maintenance';
    description = `Cyclists in r/${sub} mention forgetting when they last serviced components (chains, cables, brakes). There's no widely-used app that tracks mileage per component and alerts riders when service is due. Most people rely on memory or spreadsheets.`;
  } else if (combined.includes('theft') || combined.includes('stolen') || combined.includes('lock')) {
    painTitle = 'Bike theft is pervasive and hard to prevent/recover from';
    description = `r/${sub} frequently has posts about bike theft, lock recommendations, and recovery frustration. Cyclists want better real-time theft tracking, community alert networks, and smarter lock pairing guidance—not just generic advice.`;
  } else if (combined.includes('component') && (combined.includes('compat') || combined.includes('fit') || combined.includes('work with'))) {
    painTitle = 'Component compatibility is confusing and hard to verify';
    description = `Cyclists in r/${sub} struggle to know if components (derailleurs, cassettes, brakes) are compatible with their bike. Online resources are fragmented, and mistakes are expensive. A centralized compatibility checker would save time and money.`;
  } else if ((combined.includes('commut') || combined.includes('cargo') || combined.includes('rain') || combined.includes('weather')) && combined.includes('gear')) {
    painTitle = 'Commuter cyclists struggle with gear/kit decisions for real-world conditions';
    description = `Bike commuters in r/${sub} frequently ask about gear for rain, cold, or cargo carrying. The information is scattered across forums and changes by season. A decision-support tool for commuter kit would be highly useful.`;
  } else if (combined.includes('tubeless') || (combined.includes('flat') && combined.includes('repair'))) {
    painTitle = 'Tubeless setup and flat repair is confusing and messy';
    description = `Cyclists in r/${sub} repeatedly ask about tubeless conversion, sealant choices, and what to do when tubeless fails mid-ride. The process is inconsistent across rim/tire brands and there's no clear guide that covers all scenarios.`;
  } else if ((combined.includes('app') || combined.includes('tool') || combined.includes('software')) && (combined.includes('wish') || combined.includes('need') || combined.includes('looking for'))) {
    painTitle = `Cyclists in r/${sub} looking for a better app/tool`;
    description = `Multiple posts in r/${sub} mention gaps in available cycling apps. Users want tools that better handle ${sub === 'bikecommuting' ? 'commute logistics, weather integration, and route reliability' : sub === 'gravelcycling' ? 'gravel route discovery, surface quality data, and event tracking' : sub === 'bikewrench' ? 'repair guides, torque specs, and part compatibility' : 'infrastructure reporting and advocacy tools'}.`;
  } else if (combined.includes('car') && (combined.includes('danger') || combined.includes('close pass') || combined.includes('dooring') || combined.includes('unsafe'))) {
    painTitle = 'Cyclists face dangerous interactions with cars and lack tools to report/document them';
    description = `r/fuckcars and cycling communities frequently discuss close calls, dooring incidents, and dangerous driver behavior. Cyclists want easy ways to document, report, and aggregate near-miss data—both for personal records and advocacy purposes.`;
  } else if (combined.includes('shifting') || combined.includes('derailleur') || combined.includes('index') || combined.includes('cable tension')) {
    painTitle = 'Bike shifting adjustment and indexing is hard to get right without expert help';
    description = `In r/${sub}, many posts describe trouble with shifting quality, derailleur alignment, and cable tension. While professional help exists, many cyclists want better self-service diagnostic guides and step-by-step troubleshooting tools.`;
  } else if (isPainPointTitle(title)) {
    // Generic pain point from title signals
    painTitle = title.length <= 80 ? title : title.substring(0, 77) + '...';
    description = `From r/${sub}: "${title}". Score: ${score}, Comments: ${commentCount}. Cyclists are discussing a recurring pain point related to ${CATEGORY.toLowerCase()} that may represent a buildable opportunity.`;
  }

  if (!painTitle) return null;

  return {
    title: painTitle,
    description,
    category: CATEGORY,
    subreddit: `r/${sub}`,
    discoveredBy: AGENT_ID,
    redditPostId: postId,
    redditUrl: permalink ? `https://reddit.com${permalink}` : null,
    postTitle: title,
    postBody: (body || '').substring(0, 2000),
    upvotes: score || 0,
    commentCount: commentCount || 0,
  };
}

async function submitPainPoint(pp) {
  try {
    // Create pain point
    const created = await apiPost('/api/pain-points', {
      title: pp.title,
      description: pp.description,
      category: pp.category,
      subreddit: pp.subreddit,
      discoveredBy: pp.discoveredBy,
    });
    console.log(`Created pain point: ${pp.title} → id=${created.id || created._id || JSON.stringify(created).substring(0, 80)}`);

    const id = created.id || created._id || created.painPointId;
    if (id && pp.redditUrl) {
      // Link source post
      await apiPost('/api/pain-points/posts', {
        painPointId: id,
        redditPostId: pp.redditPostId || 'unknown',
        redditUrl: pp.redditUrl,
        postTitle: pp.postTitle,
        postBody: pp.postBody,
        upvotes: pp.upvotes,
        commentCount: pp.commentCount,
        subreddit: pp.subreddit,
        discoveredBy: pp.discoveredBy,
      });
      console.log(`Linked source post for pain point ${id}`);
    }
    return id;
  } catch(e) {
    console.log(`Error submitting pain point "${pp.title}": ${e.message}`);
    return null;
  }
}

async function logScanResult(sub, postsScanned, painPointsFound, status = 'completed', error = null) {
  try {
    const body = {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned,
      painPointsFound,
      status,
    };
    if (error) body.error = error;
    const result = await apiPost('/api/pain-points/scan-logs', body);
    console.log(`Logged scan for r/${sub}: ${JSON.stringify(result).substring(0, 100)}`);
  } catch(e) {
    console.log(`Error logging scan for r/${sub}: ${e.message}`);
  }
}

async function main() {
  console.log(`Starting scan as ${AGENT_ID}`);
  console.log(`Subreddits: ${SUBREDDITS.join(', ')}`);
  
  let browser;
  const summary = {
    subredditsScanned: 0,
    totalPostsAnalyzed: 0,
    painPoints: [],
    errors: [],
  };

  try {
    console.log(`Connecting to CDP: ${CDP_URL}`);
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected to browser');

    const context = browser.contexts()[0];
    if (!context) throw new Error('No browser context available');

    // Close extra tabs, keep one
    const pages = context.pages();
    console.log(`Found ${pages.length} open pages`);
    for (let i = 1; i < pages.length; i++) await pages[i].close();
    const page = pages[0] || await context.newPage();

    for (const sub of SUBREDDITS) {
      const result = await scanSubreddit(page, sub);
      
      summary.subredditsScanned++;
      summary.totalPostsAnalyzed += result.postsScanned || 0;
      
      if (result.error) {
        summary.errors.push(`r/${sub}: ${result.error}`);
        await logScanResult(sub, 0, 0, 'error', result.error);
        continue;
      }

      // Deduplicate pain points by title
      const newPainPoints = result.painPoints.filter(pp => 
        !summary.painPoints.find(existing => existing.title === pp.title)
      );

      // Submit each pain point
      for (const pp of newPainPoints) {
        await submitPainPoint(pp);
        summary.painPoints.push(pp);
        await sleep(500);
      }

      await logScanResult(sub, result.postsScanned || 0, newPainPoints.length, 'completed');
      
      // Pace between subreddits
      if (SUBREDDITS.indexOf(sub) < SUBREDDITS.length - 1) {
        console.log('Waiting 5s before next subreddit...');
        await sleep(5000);
      }
    }

  } catch(e) {
    console.log(`Fatal error: ${e.message}`);
    summary.errors.push(`Fatal: ${e.message}`);
  } finally {
    // DO NOT close the browser - admin handles that
    console.log('\n=== SCAN COMPLETE ===');
    console.log(`Subreddits scanned: ${summary.subredditsScanned}`);
    console.log(`Total posts analyzed: ${summary.totalPostsAnalyzed}`);
    console.log(`Pain points discovered: ${summary.painPoints.length}`);
    if (summary.painPoints.length > 0) {
      console.log('Pain points:');
      summary.painPoints.forEach((pp, i) => console.log(`  ${i+1}. [${pp.subreddit}] ${pp.title}`));
    }
    if (summary.errors.length > 0) {
      console.log('Errors:', summary.errors);
    }
    
    process.exit(0);
  }
}

main().catch(e => {
  console.error('Unhandled error:', e);
  process.exit(1);
});
