const { chromium } = require('playwright');
const http = require('http');

const CDP_URL = 'ws://127.0.0.1:50704/devtools/browser/62e800a8-053a-4f51-92a0-25264aef20da';
const AGENT_ID = 'ty-m';
const SUBREDDITS = ['bikecommuting', 'gravelcycling', 'bikewrench', 'fuckcars'];
const CATEGORY = 'Cycling';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

function apiPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(API_BASE + path);
    const options = {
      hostname: url.hostname,
      port: parseInt(url.port) || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = http.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => responseBody += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(responseBody)); } catch(e) { resolve(responseBody); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('API timeout')); });
    req.write(data);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isPainPointTitle(title) {
  if (!title) return false;
  const lower = title.toLowerCase();
  const signals = [
    'frustrated', 'frustrat', 'annoying', 'annoy', 'wish', 'is there an app', 'is there a tool',
    'how do you', 'help with', 'struggling', 'problem', 'issue', 'tired of', 'hate',
    'need help', 'why is it', 'can\'t find', 'looking for', 'anyone know',
    'best way to', 'how to track', 'how to manage', 'keeps breaking', 'broken',
    'expensive', 'overpriced', 'complicated', 'confusing', 'difficult',
    'anyone else', 'rant', 'venting', 'maintenance', 'planning', 'tracking',
    'stolen', 'theft', 'lock', 'compatible', 'compatibility', 'shifting', 'derailleur',
    'tubeless', 'flat tire', 'puncture', 'close pass', 'dooring', 'dangerous',
    'advice', 'question', 'help me', 'tips', 'recommendation',
  ];
  return signals.some(s => lower.includes(s));
}

function isPainPointText(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return lower.includes('frustrat') || lower.includes('annoying') || lower.includes('wish there was') ||
    lower.includes('is there an app') || lower.includes('is there a tool') || lower.includes('struggling') ||
    lower.includes('problem') || lower.includes('can\'t find') || lower.includes('need help');
}

function derivePainPoint(post, sub) {
  const { title = '', selftext = '', score = 0, commentCount = 0, postId, permalink } = post;
  const combined = (title + ' ' + selftext).toLowerCase();

  let painTitle = null;
  let description = null;

  if (combined.match(/route.*(plan|find|navigat|discover)/)) {
    painTitle = 'Cyclists struggle to find/plan safe, practical bike routes';
    description = `Cyclists in r/${sub} regularly discuss difficulty finding safe, low-traffic routes. Existing mapping tools don't always prioritize cyclist safety, road surface quality, or cycling-specific infrastructure. Commuters and gravel riders both need better route discovery tools tailored to their needs.`;
  } else if (combined.match(/mainten|service|schedul|lubricat/) && combined.match(/track|log|remind|schedul|forget/)) {
    painTitle = 'No good way to track and schedule bike maintenance';
    description = `Cyclists in r/${sub} mention forgetting when they last serviced components (chains, cables, brakes). There's no widely-used app that tracks mileage per component and alerts riders when service is due. Most people rely on memory or spreadsheets, leading to skipped maintenance.`;
  } else if (combined.match(/theft|stolen|lock|secure/)) {
    painTitle = 'Bike theft is pervasive and existing prevention tools are inadequate';
    description = `r/${sub} frequently has posts about bike theft, lock recommendations, and recovery frustration. Cyclists want better real-time theft tracking, community alert networks, and smarter lock pairing guidance—not just generic "use a better lock" advice.`;
  } else if (combined.match(/compat|fit.*component|component.*fit|work with.*derailleur|cassette.*work/)) {
    painTitle = 'Component compatibility is confusing and hard to verify before buying';
    description = `Cyclists in r/${sub} struggle to know if components (derailleurs, cassettes, brakes) are compatible with their bike. Online resources are fragmented and outdated. A centralized compatibility checker would save time and money for home mechanics and upgraders.`;
  } else if (combined.match(/tubeless|sealant/) && combined.match(/confus|hard|frustrat|help|advice/)) {
    painTitle = 'Tubeless setup and flat repair is confusing and inconsistent';
    description = `Cyclists in r/${sub} repeatedly ask about tubeless conversion, sealant choices, and mid-ride failure recovery. The process varies across rim/tire brands with no authoritative unified guide, leaving many riders confused or reverting to tubes.`;
  } else if (combined.match(/shift|derailleur|index|cable.tension|adjust/) && combined.match(/problem|issue|frustrat|wrong|off|help/)) {
    painTitle = 'Bike shifting adjustment is hard to self-diagnose without expert guidance';
    description = `In r/${sub}, posts frequently describe shifting quality issues, derailleur alignment problems, and cable tension guesswork. While professional help exists, many cyclists want better self-service diagnostic tools and step-by-step troubleshooting resources.`;
  } else if (combined.match(/close pass|doorin|danger|car.*(hit|nearly|almost)|unsafe|driver/)) {
    painTitle = 'Cyclists face dangerous road interactions and lack tools to report/document them';
    description = `r/${sub} discussions frequently cover close calls, dooring incidents, and dangerous driver behavior. Cyclists want easy ways to document near-misses and report them—both for personal records and systemic advocacy—but current tools are fragmented or require too much effort mid-ride.`;
  } else if (combined.match(/infrastructure|bike.lane|cycling.path|advocate|report.*city|city.*report/)) {
    painTitle = 'Cyclists struggle to effectively advocate for better infrastructure';
    description = `In r/${sub}, cyclists discuss poor infrastructure—missing bike lanes, dangerous intersections, maintenance gaps. They want better tools to aggregate complaints, communicate with city officials, and track advocacy progress beyond individual social media posts.`;
  } else if (combined.match(/app.*wish|wish.*app|better app|no app|app for|tool for|software for/)) {
    painTitle = `Cyclists in r/${sub} want better cycling-specific apps for their use case`;
    description = `Posts in r/${sub} highlight gaps in available cycling apps. Users want tools that better handle ${sub === 'bikecommuting' ? 'commute logistics, weather integration, and route reliability tracking' : sub === 'gravelcycling' ? 'gravel route discovery, surface quality ratings, and remote event planning' : sub === 'bikewrench' ? 'repair guides, torque specs, and part compatibility lookups' : 'infrastructure gap reporting, near-miss logging, and advocacy coordination'}.`;
  } else if (combined.match(/cargo|haul|panniers|load|carry/) && combined.match(/advice|recommend|help|best/)) {
    painTitle = 'Bike commuters struggle with cargo/load decisions for practical everyday use';
    description = `Bike commuters in r/${sub} frequently ask how to carry groceries, work gear, or large loads. Product recommendations are scattered across forums and vary by bike type. A structured decision tool for commuter cargo solutions would fill a real gap.`;
  } else if (isPainPointTitle(title)) {
    painTitle = title.length <= 80 ? title : title.substring(0, 77) + '...';
    description = `From r/${sub}: Cyclists discuss "${title.substring(0, 100)}". (Upvotes: ${score}, Comments: ${commentCount}). This represents a recurring challenge in the cycling/bike commuting community that may represent a buildable product opportunity.`;
  }

  if (!painTitle) return null;

  return {
    title: painTitle,
    description,
    category: CATEGORY,
    subreddit: `r/${sub}`,
    discoveredBy: AGENT_ID,
    redditPostId: postId || 'unknown',
    redditUrl: permalink ? `https://reddit.com${permalink}` : null,
    postTitle: title,
    postBody: (selftext || '').substring(0, 2000),
    upvotes: score || 0,
    commentCount: commentCount || 0,
  };
}

async function scanSubredditViaJSON(page, sub) {
  console.log(`\n=== Scanning r/${sub} via JSON API ===`);
  
  try {
    await page.goto(`https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await sleep(2000);

    const jsonText = await page.evaluate(() => document.body.innerText);
    
    let jsonData;
    try {
      jsonData = JSON.parse(jsonText);
    } catch(e) {
      console.log(`Failed to parse JSON for r/${sub}: ${e.message}`);
      console.log('Raw text preview:', jsonText.substring(0, 200));
      return { painPoints: [], postsScanned: 0, error: 'JSON parse failed' };
    }

    if (!jsonData?.data?.children) {
      console.log(`No data.children in response for r/${sub}`);
      // Check if it's an error response
      if (jsonData?.error) {
        return { painPoints: [], postsScanned: 0, error: `Reddit error: ${jsonData.error}` };
      }
      return { painPoints: [], postsScanned: 0, error: 'No post data in response' };
    }

    const allPosts = jsonData.data.children.map(c => ({
      title: c.data.title,
      score: c.data.score,
      commentCount: c.data.num_comments,
      permalink: c.data.permalink,
      postId: c.data.id,
      selftext: c.data.selftext,
      stickied: c.data.stickied,
      url: c.data.url,
    }));

    const posts = allPosts.filter(p => !p.stickied && p.score >= 3);
    console.log(`Total: ${allPosts.length} posts, ${posts.length} after filtering (score >= 3, not stickied)`);

    const painPointsMap = new Map(); // deduplicate by title
    let drillCount = 0;

    for (const post of posts) {
      // For high-engagement posts with potential pain points, drill in for more context
      if (drillCount < 6 && post.commentCount >= 10 && isPainPointTitle(post.title) && post.permalink) {
        drillCount++;
        try {
          await sleep(2000);
          await page.goto(`https://www.reddit.com${post.permalink}.json?limit=10&raw_json=1`, {
            waitUntil: 'domcontentloaded',
            timeout: 20000,
          });
          await sleep(1500);
          const postJson = await page.evaluate(() => document.body.innerText);
          const postData = JSON.parse(postJson);
          
          // Enrich with selftext from post detail
          if (postData?.[0]?.data?.children?.[0]?.data) {
            const detail = postData[0].data.children[0].data;
            post.selftext = detail.selftext || post.selftext;
            
            // Get top comments for context
            const topComments = postData?.[1]?.data?.children?.slice(0, 8)
              ?.map(c => c.data?.body || '')
              ?.filter(b => b && b.length > 20)
              ?.join(' ') || '';
            post.selftext = (post.selftext || '') + ' ' + topComments;
          }
        } catch(e) {
          console.log(`Error drilling into "${post.title}": ${e.message}`);
        }
      }

      const pp = derivePainPoint(post, sub);
      if (pp && !painPointsMap.has(pp.title)) {
        painPointsMap.set(pp.title, pp);
      }
    }

    const painPoints = Array.from(painPointsMap.values());
    console.log(`r/${sub}: ${posts.length} posts analyzed, ${painPoints.length} pain points found`);
    return { painPoints, postsScanned: posts.length };

  } catch(e) {
    console.log(`Error scanning r/${sub}: ${e.message}`);
    return { painPoints: [], postsScanned: 0, error: e.message };
  }
}

async function submitPainPoint(pp) {
  try {
    const created = await apiPost('/api/pain-points', {
      title: pp.title,
      description: pp.description,
      category: pp.category,
      subreddit: pp.subreddit,
      discoveredBy: pp.discoveredBy,
    });
    console.log(`  ✓ Created: "${pp.title.substring(0, 60)}..." → ${JSON.stringify(created).substring(0, 80)}`);

    const id = created.id || created._id || created.painPointId;
    if (id && pp.redditUrl) {
      await apiPost('/api/pain-points/posts', {
        painPointId: id,
        redditPostId: pp.redditPostId || 'unknown',
        redditUrl: pp.redditUrl,
        postTitle: pp.postTitle,
        postBody: pp.postBody || '',
        upvotes: pp.upvotes,
        commentCount: pp.commentCount,
        subreddit: pp.subreddit,
        discoveredBy: pp.discoveredBy,
      });
      console.log(`  ✓ Linked source post for ${id}`);
    }
    return id;
  } catch(e) {
    console.log(`  ✗ Error submitting "${pp.title}": ${e.message}`);
    return null;
  }
}

async function logScanResult(sub, postsScanned, painPointsFound, status = 'completed', error = null) {
  try {
    const body = { agentId: AGENT_ID, subreddit: `r/${sub}`, postsScanned, painPointsFound, status };
    if (error) body.error = error;
    const result = await apiPost('/api/pain-points/scan-logs', body);
    console.log(`Logged r/${sub}: ${JSON.stringify(result).substring(0, 100)}`);
  } catch(e) {
    console.log(`Error logging r/${sub}: ${e.message}`);
  }
}

async function main() {
  console.log(`Starting scan — agent: ${AGENT_ID}`);
  console.log(`Subreddits: ${SUBREDDITS.join(', ')}`);

  let browser;
  const summary = {
    subredditsScanned: 0,
    totalPostsAnalyzed: 0,
    allPainPoints: [],
    errors: [],
  };

  try {
    console.log(`Connecting to CDP: ${CDP_URL}`);
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected');

    const context = browser.contexts()[0];
    if (!context) throw new Error('No browser context found');

    const pages = context.pages();
    console.log(`${pages.length} open page(s)`);
    for (let i = 1; i < pages.length; i++) await pages[i].close();
    const page = pages[0] || await context.newPage();

    for (const sub of SUBREDDITS) {
      const result = await scanSubredditViaJSON(page, sub);

      summary.subredditsScanned++;
      summary.totalPostsAnalyzed += result.postsScanned || 0;

      if (result.error && result.postsScanned === 0) {
        summary.errors.push(`r/${sub}: ${result.error}`);
        await logScanResult(sub, 0, 0, 'error', result.error);
        continue;
      }

      // Deduplicate against global list
      const newPainPoints = result.painPoints.filter(pp =>
        !summary.allPainPoints.find(e => e.title === pp.title)
      );

      console.log(`Submitting ${newPainPoints.length} new pain points for r/${sub}...`);
      for (const pp of newPainPoints) {
        await submitPainPoint(pp);
        summary.allPainPoints.push(pp);
        await sleep(300);
      }

      await logScanResult(sub, result.postsScanned || 0, newPainPoints.length, 'completed');

      if (SUBREDDITS.indexOf(sub) < SUBREDDITS.length - 1) {
        console.log('Pausing 4s before next subreddit...');
        await sleep(4000);
      }
    }

  } catch(e) {
    console.error(`Fatal: ${e.message}`);
    summary.errors.push(`Fatal: ${e.message}`);
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${summary.subredditsScanned}`);
  console.log(`Total posts analyzed: ${summary.totalPostsAnalyzed}`);
  console.log(`Pain points discovered: ${summary.allPainPoints.length}`);
  if (summary.allPainPoints.length > 0) {
    console.log('Pain points:');
    summary.allPainPoints.forEach((pp, i) => console.log(`  ${i + 1}. [${pp.subreddit}] ${pp.title}`));
  }
  if (summary.errors.length > 0) {
    console.log('Errors:', summary.errors);
  }

  process.exit(0);
}

main().catch(e => {
  console.error('Unhandled:', e);
  process.exit(1);
});
