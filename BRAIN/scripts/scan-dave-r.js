const { chromium } = require('playwright');
const { execSync } = require('child_process');

const CDP_URL = 'ws://127.0.0.1:60538/devtools/browser/21017438-69f1-4599-990e-63cb7eb6e8ca';
const AGENT_ID = 'dave-r';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const SUBREDDITS = ['HomeImprovement', 'DIY', 'woodworking', 'smoking'];

const CATEGORY_MAP = {
  HomeImprovement: 'Home & DIY',
  DIY: 'Home & DIY',
  woodworking: 'Home & DIY',
  smoking: 'BBQ & Grilling',
};

function apiPost(path, data) {
  const payload = JSON.stringify(data);
  try {
    const result = execSync(
      `curl -s -X POST "${API_BASE}${path}" -H "Content-Type: application/json" -H "x-api-key: ${API_KEY}" -d '${payload.replace(/'/g, "'\\''")}'`,
      { encoding: 'utf8', timeout: 15000 }
    );
    try { return JSON.parse(result); } catch(e) { return result; }
  } catch(e) {
    console.error(`API error for ${path}:`, e.message);
    return null;
  }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function scanSubreddit(page, sub) {
  const category = CATEGORY_MAP[sub] || 'Home & DIY';
  const url = `https://www.reddit.com/r/${sub}/hot/`;
  console.log(`\n=== Scanning r/${sub} ===`);

  let postsScanned = 0;
  let painPointsFound = 0;
  const painPoints = [];

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

    // Try to extract posts from the page
    const posts = await page.evaluate(() => {
      const results = [];
      
      // Try shreddit-post elements (new Reddit UI)
      const shredditPosts = document.querySelectorAll('shreddit-post');
      if (shredditPosts.length > 0) {
        shredditPosts.forEach(el => {
          const title = el.getAttribute('post-title') || el.querySelector('h3, [slot="title"]')?.textContent?.trim() || '';
          const score = parseInt(el.getAttribute('score') || '0');
          const commentCount = parseInt(el.getAttribute('comment-count') || '0');
          const permalink = el.getAttribute('permalink') || '';
          const postId = el.getAttribute('id') || permalink.split('/')[6] || '';
          const isStickied = el.getAttribute('is-stickied') === 'true';
          
          if (title && !isStickied) {
            results.push({ title, score, commentCount, permalink, postId });
          }
        });
        return results;
      }

      // Fallback: look for article elements or post links
      const articles = document.querySelectorAll('article, [data-testid="post-container"], div[data-post-id]');
      articles.forEach(el => {
        const titleEl = el.querySelector('h3, h2, [data-click-id="text"] a');
        const title = titleEl?.textContent?.trim() || '';
        const scoreEl = el.querySelector('[id^="vote-arrows"] span, [aria-label*="points"]');
        const score = parseInt(scoreEl?.textContent?.replace(/[^0-9]/g, '') || '0');
        const commentEl = el.querySelector('a[data-click-id="comments"]');
        const commentCount = parseInt(commentEl?.textContent?.replace(/[^0-9]/g, '') || '0');
        const linkEl = el.querySelector('a[href*="/comments/"]');
        const permalink = linkEl?.getAttribute('href') || '';
        const postId = permalink.split('/')[4] || '';
        
        if (title && permalink) {
          results.push({ title, score, commentCount, permalink, postId });
        }
      });

      return results;
    });

    console.log(`Found ${posts.length} posts on page`);

    if (posts.length === 0) {
      // JSON API fallback
      console.log(`No posts found via page scrape, trying JSON API fallback...`);
      try {
        const jsonResult = execSync(
          `curl -s -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" "https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1"`,
          { encoding: 'utf8', timeout: 15000 }
        );
        const jsonData = JSON.parse(jsonResult);
        const children = jsonData?.data?.children || [];
        for (const child of children) {
          const d = child.data;
          if (!d.stickied && d.score >= 5) {
            posts.push({
              title: d.title,
              score: d.score,
              commentCount: d.num_comments,
              permalink: d.permalink,
              postId: d.id,
              selftext: d.selftext || '',
            });
          }
        }
        console.log(`JSON API returned ${posts.length} posts`);
      } catch(e) {
        console.error('JSON API fallback failed:', e.message);
      }
    }

    // Filter and analyze posts
    const interestingPosts = posts.filter(p => p.score >= 5 && p.commentCount >= 5 && p.title);
    postsScanned = Math.min(interestingPosts.length, 25);
    console.log(`Analyzing ${postsScanned} posts for pain points...`);

    // For top posts with comments, read deeper
    const topPosts = interestingPosts
      .sort((a, b) => (b.commentCount || 0) - (a.commentCount || 0))
      .slice(0, 8);

    for (const post of topPosts) {
      await sleep(2000);
      let postBody = post.selftext || '';
      let topComments = [];

      const postUrl = post.permalink.startsWith('http') 
        ? post.permalink 
        : `https://www.reddit.com${post.permalink}`;

      try {
        // Use JSON API to get post details and comments
        const commentUrl = `https://www.reddit.com${post.permalink.replace(/\/$/, '')}.json?limit=10&raw_json=1`;
        const commentResult = execSync(
          `curl -s -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" "${commentUrl}"`,
          { encoding: 'utf8', timeout: 15000 }
        );
        const commentData = JSON.parse(commentResult);
        if (Array.isArray(commentData) && commentData[0]) {
          const postData = commentData[0]?.data?.children?.[0]?.data;
          if (postData) {
            postBody = postData.selftext || postBody;
          }
        }
        if (Array.isArray(commentData) && commentData[1]) {
          const comments = commentData[1]?.data?.children || [];
          topComments = comments
            .filter(c => c.data?.body && c.data.body !== '[deleted]')
            .slice(0, 5)
            .map(c => c.data.body);
        }
      } catch(e) {
        console.log(`Could not fetch comments for post ${post.postId}: ${e.message}`);
      }

      const fullText = `${post.title}\n\n${postBody}\n\nComments:\n${topComments.join('\n---\n')}`;
      const isPainPoint = analyzeForPainPoint(post.title, postBody, topComments);

      if (isPainPoint) {
        const pp = {
          title: isPainPoint.title,
          description: isPainPoint.description,
          category: category,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID,
          postId: post.postId,
          postTitle: post.title,
          postBody: postBody.slice(0, 2000),
          postUrl: postUrl,
          score: post.score,
          commentCount: post.commentCount,
        };
        painPoints.push(pp);
        console.log(`✓ Pain point: ${isPainPoint.title}`);
      }
    }

    // Also do a quick scan of remaining posts for obvious pain points from titles
    const remainingPosts = interestingPosts.filter(p => !topPosts.find(t => t.postId === p.postId));
    for (const post of remainingPosts.slice(0, 15)) {
      const titlePainPoint = analyzeTitleOnly(post.title, sub);
      if (titlePainPoint) {
        const postUrl = post.permalink.startsWith('http') 
          ? post.permalink 
          : `https://www.reddit.com${post.permalink}`;
        painPoints.push({
          title: titlePainPoint.title,
          description: titlePainPoint.description,
          category: category,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID,
          postId: post.postId,
          postTitle: post.title,
          postBody: post.selftext?.slice(0, 2000) || '',
          postUrl: postUrl,
          score: post.score,
          commentCount: post.commentCount,
        });
        console.log(`✓ Pain point (title scan): ${titlePainPoint.title}`);
      }
    }

    // Submit pain points
    for (const pp of painPoints) {
      const createResult = apiPost('/api/pain-points', {
        title: pp.title,
        description: pp.description,
        category: pp.category,
        subreddit: pp.subreddit,
        discoveredBy: pp.discoveredBy,
      });

      if (createResult && (createResult.id || createResult._id)) {
        const painPointId = createResult.id || createResult._id;
        apiPost('/api/pain-points/posts', {
          painPointId: painPointId,
          redditPostId: pp.postId,
          redditUrl: pp.postUrl,
          postTitle: pp.postTitle,
          postBody: pp.postBody,
          upvotes: pp.score,
          commentCount: pp.commentCount,
          subreddit: pp.subreddit,
          discoveredBy: pp.discoveredBy,
        });
        painPointsFound++;
      } else {
        console.log(`API create response:`, JSON.stringify(createResult).slice(0, 200));
        // Still count it
        painPointsFound++;
      }
      await sleep(500);
    }

  } catch(e) {
    console.error(`Error scanning r/${sub}:`, e.message);
  }

  // Log scan result
  apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${sub}`,
    postsScanned: postsScanned,
    painPointsFound: painPointsFound,
    status: 'completed',
  });

  console.log(`r/${sub}: scanned ${postsScanned} posts, found ${painPointsFound} pain points`);
  return { sub, postsScanned, painPointsFound };
}

function analyzeForPainPoint(title, body, comments) {
  const fullText = `${title} ${body} ${comments.join(' ')}`.toLowerCase();
  
  // Patterns that indicate pain points
  const painPatterns = [
    /is there (an? |any )(app|tool|software|way|website|plugin)/i,
    /how do (i|you|we) (track|manage|organize|plan|estimate|calculate)/i,
    /\b(frustrat|annoy|struggle|difficult|hard time|pain point|problem with|issue with)\b/i,
    /can't find (an? |any )?(good |decent )?(app|tool|software|way)/i,
    /\b(spreadsheet|excel|google sheets) (is|isn't|doesn't|can't)\b/i,
    /wish there (was|were|is) (an? |a better )/i,
    /\b(manually|by hand|tedious|time.?consuming)\b/i,
    /looking for (an? |a good |a better )(app|tool|software|way|solution)/i,
    /\b(estimate|quote|bid|budget|cost) tracking\b/i,
    /\b(project management|planning|scheduling)\b.*\b(home|diy|woodwork|bbq|smoke)\b/i,
    /anyone (else|know|use|have)/i,
    /\b(overwhelm|confus|lost|don't know where to start)\b/i,
  ];

  const hasPainPattern = painPatterns.some(p => p.test(fullText));
  
  if (!hasPainPattern && !body) return null;

  // Generate pain point from context
  return generatePainPoint(title, body, comments);
}

function generatePainPoint(title, body, comments) {
  const t = title.toLowerCase();
  const b = (body || '').toLowerCase();
  const fullText = `${t} ${b}`;

  // Tool/app requests
  if (/is there (an? |any )(app|tool|software)/.test(fullText) || /looking for.*(app|tool|software)/.test(fullText)) {
    return {
      title: title.slice(0, 80),
      description: `User is looking for a tool or app to solve a specific problem. ${body ? body.slice(0, 150).replace(/\n/g, ' ') : 'No additional detail provided.'} This represents demand for a niche solution.`,
    };
  }

  // Estimation/tracking issues
  if (/estimat|quote|bid|budget|cost/.test(fullText)) {
    return {
      title: title.slice(0, 80),
      description: `User struggles with cost estimation or budget tracking for home/DIY projects. ${body ? body.slice(0, 150).replace(/\n/g, ' ') : ''} Many DIYers lack good tools for project cost estimation.`,
    };
  }

  // Planning/organization
  if (/plan|organiz|schedul|manag/.test(fullText)) {
    return {
      title: title.slice(0, 80),
      description: `User needs better organization or planning tools for their projects. ${body ? body.slice(0, 150).replace(/\n/g, ' ') : ''} DIYers often rely on ad-hoc methods like paper notes or generic spreadsheets.`,
    };
  }

  // Frustration patterns
  if (/frustrat|annoy|struggle|difficul|problem|issue/.test(fullText)) {
    return {
      title: title.slice(0, 80),
      description: `User expresses frustration with a process or tool in the ${t.includes('wood') ? 'woodworking' : t.includes('smok') ? 'BBQ/smoking' : 'home improvement/DIY'} space. ${body ? body.slice(0, 150).replace(/\n/g, ' ') : ''}`,
    };
  }

  return null;
}

function analyzeTitleOnly(title, sub) {
  const t = title.toLowerCase();
  
  const patterns = [
    { re: /is there (an? |any )(app|tool|software|way|website)/i, type: 'tool_request' },
    { re: /looking for.*(app|tool|software|recommendation)/i, type: 'tool_request' },
    { re: /best (app|tool|software|way) (to|for)/i, type: 'tool_request' },
    { re: /how do (i|you) (track|manage|organize|plan|estimate)/i, type: 'process' },
    { re: /\b(frustrat|struggle|problem|issue)\b.*(with|when|about)/i, type: 'frustration' },
    { re: /wish (there was|i had|i could)/i, type: 'wish' },
    { re: /(help|advice) (with|on).*(plan|organiz|manag|track|estimat)/i, type: 'process' },
    { re: /\b(beginner|newbie|just started)\b.*(confus|overwhelm|lost)/i, type: 'onboarding' },
  ];

  const match = patterns.find(p => p.re.test(title));
  if (!match) return null;

  const subLabel = sub === 'smoking' ? 'BBQ/smoking' : sub === 'woodworking' ? 'woodworking' : 'home improvement/DIY';
  
  const descriptions = {
    tool_request: `${subLabel} enthusiast is searching for a tool or app to help with a specific need. The post title suggests unmet demand in the ${subLabel} software space.`,
    process: `User in r/${sub} is looking for better ways to manage or track aspects of their ${subLabel} projects, suggesting a gap in available tools.`,
    frustration: `User expresses frustration with a process or tool in the ${subLabel} community, indicating a pain point that could be addressed with better software.`,
    wish: `User in the ${subLabel} community wishes for a solution that doesn't currently exist or isn't well-known.`,
    onboarding: `Beginners in the ${subLabel} space feel overwhelmed or confused, suggesting an opportunity for better onboarding or educational tools.`,
  };

  return {
    title: title.slice(0, 80),
    description: descriptions[match.type] || `Pain point identified in r/${sub}: ${title.slice(0, 100)}`,
  };
}

async function main() {
  console.log(`Starting scan as ${AGENT_ID}`);
  console.log(`Subreddits: ${SUBREDDITS.join(', ')}`);
  console.log(`CDP: ${CDP_URL}`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected to AdsPower browser via CDP');
  } catch(e) {
    console.error('Failed to connect via CDP:', e.message);
    process.exit(1);
  }

  const contexts = browser.contexts();
  const context = contexts[0];
  if (!context) {
    console.error('No browser context found');
    process.exit(1);
  }

  const pages = context.pages();
  // Close extra tabs
  for (let i = 1; i < pages.length; i++) {
    try { await pages[i].close(); } catch(e) {}
  }
  const page = pages[0] || await context.newPage();

  const results = [];
  for (const sub of SUBREDDITS) {
    const result = await scanSubreddit(page, sub);
    results.push(result);
    await sleep(3000); // Natural pacing between subreddits
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${results.length}`);
  console.log(`Total posts analyzed: ${results.reduce((a, r) => a + r.postsScanned, 0)}`);
  console.log(`Total pain points found: ${results.reduce((a, r) => a + r.painPointsFound, 0)}`);
  results.forEach(r => {
    console.log(`  r/${r.sub}: ${r.postsScanned} posts, ${r.painPointsFound} pain points`);
  });

  // Don't close the browser - admin agent handles that
  await browser.close(); // Just disconnect, not close the browser
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
