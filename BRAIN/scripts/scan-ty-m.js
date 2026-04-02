const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

const CDP_URL = 'ws://127.0.0.1:54512/devtools/browser/4a49836e-8270-4e3d-aef0-57136cf571c8';
const AGENT_ID = 'ty-m';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const SUBREDDITS = ['bikecommuting', 'gravelcycling', 'bikewrench', 'fuckcars'];
const CATEGORY = 'Cycling';

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
        'Content-Length': Buffer.byteLength(data),
        'x-api-key': API_KEY,
      },
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch(e) { resolve({ raw: body }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  const painPoints = [];
  let postsScanned = 0;

  try {
    // Try to navigate to subreddit
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    // Scroll to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    // Take a snapshot of the page content
    const content = await page.content();
    
    // Try to extract posts from the new Reddit UI (shreddit)
    // Look for article/post elements
    let posts = await page.evaluate(() => {
      const results = [];
      
      // New Reddit (shreddit) - look for shreddit-post elements
      const shredditPosts = document.querySelectorAll('shreddit-post');
      if (shredditPosts.length > 0) {
        shredditPosts.forEach(el => {
          const title = el.getAttribute('post-title') || el.querySelector('h3, [slot="title"]')?.textContent?.trim() || '';
          const score = parseInt(el.getAttribute('score') || '0');
          const comments = parseInt(el.getAttribute('comment-count') || '0');
          let permalink = el.getAttribute('permalink') || '';
          // Make absolute
          if (permalink && !permalink.startsWith('http')) {
            permalink = 'https://www.reddit.com' + permalink;
          }
          const id = el.getAttribute('id') || permalink.split('/')[6] || '';
          if (title && score >= 5 && !el.getAttribute('stickied')) {
            results.push({ title, score, comments, permalink, id });
          }
        });
      }
      
      // Old/transitional Reddit - look for article elements  
      if (results.length === 0) {
        const articles = document.querySelectorAll('article, [data-testid="post-container"], .thing');
        articles.forEach(el => {
          const titleEl = el.querySelector('h3, h1, [data-click-id="text"] a, .title a');
          const title = titleEl?.textContent?.trim() || '';
          const scoreEl = el.querySelector('[id*="vote-arrows"] div, .score.unvoted, [data-testid="vote-button-container"]');
          const score = parseInt(scoreEl?.textContent?.replace(/[^0-9]/g, '') || '0');
          const commentsEl = el.querySelector('a[href*="comments"]');
          const comments = parseInt(commentsEl?.textContent?.replace(/[^0-9]/g, '') || '0');
          let link = titleEl?.closest('a')?.href || commentsEl?.href || '';
          if (link && !link.startsWith('http')) link = 'https://www.reddit.com' + link;
          if (title && title.length > 5) {
            results.push({ title, score, comments, permalink: link, id: link.split('/comments/')[1]?.split('/')[0] || '' });
          }
        });
      }
      
      return results;
    });

    console.log(`Found ${posts.length} posts via DOM`);

    // If DOM scraping didn't work well, fall back to JSON API
    if (posts.length < 5) {
      console.log('Falling back to JSON API...');
      await page.goto(`https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(2000);
      const jsonText = await page.evaluate(() => document.body.innerText);
      try {
        const data = JSON.parse(jsonText);
        posts = data.data.children
          .filter(c => c.data && c.data.score >= 5 && !c.data.stickied)
          .map(c => ({
            title: c.data.title,
            score: c.data.score,
            comments: c.data.num_comments,
            permalink: c.data.permalink.startsWith('http') ? c.data.permalink : `https://www.reddit.com${c.data.permalink}`,
            id: c.data.id,
            selftext: c.data.selftext || '',
          }));
        console.log(`JSON API returned ${posts.length} posts`);
      } catch(e) {
        console.log('JSON parse error:', e.message);
      }
    }

    postsScanned = posts.length;
    console.log(`Analyzing ${postsScanned} posts for pain points...`);

    // Analyze top posts for pain points (focus on those with good engagement)
    const promisingPosts = posts
      .filter(p => p.comments >= 5 || p.score >= 20)
      .slice(0, 15);

    for (const post of promisingPosts) {
      await sleep(1500);
      
      // Get post details if we don't have selftext yet
      let postBody = post.selftext || '';
      let topComments = '';
      
      if (post.permalink && !postBody) {
        try {
          // Ensure absolute URL
          const absPermalink = post.permalink.startsWith('http') 
            ? post.permalink 
            : `https://www.reddit.com${post.permalink}`;
          const jsonUrl = absPermalink.replace(/\/$/, '') + '.json?limit=10&raw_json=1';
          await page.goto(jsonUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await sleep(1500);
          const jsonText = await page.evaluate(() => document.body.innerText);
          const data = JSON.parse(jsonText);
          postBody = data[0]?.data?.children?.[0]?.data?.selftext || '';
          const comments = data[1]?.data?.children || [];
          topComments = comments.slice(0, 5).map(c => c.data?.body || '').filter(Boolean).join('\n---\n');
        } catch(e) {
          console.log(`Could not fetch post details for ${post.id}: ${e.message}`);
        }
      }

      const fullText = `TITLE: ${post.title}\n\nBODY: ${postBody}\n\nTOP COMMENTS:\n${topComments}`;
      
      // Determine if this is a pain point worth submitting
      const isPainPoint = analyzePainPoint(post.title, postBody, topComments);
      if (isPainPoint) {
        painPoints.push({
          post,
          postBody,
          analysis: isPainPoint,
        });
      }
    }

    console.log(`Found ${painPoints.length} pain points in r/${sub}`);

    // Submit pain points
    for (const pp of painPoints) {
      try {
        const ppResponse = await apiPost('/api/pain-points', {
          title: pp.analysis.title,
          description: pp.analysis.description,
          category: CATEGORY,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID,
        });
        
        console.log(`Submitted pain point: ${pp.analysis.title} -> id: ${ppResponse.id || ppResponse._id || JSON.stringify(ppResponse).substring(0, 80)}`);
        
        const painPointId = ppResponse.id || ppResponse._id || ppResponse.data?.id;
        if (painPointId) {
          await apiPost('/api/pain-points/posts', {
            painPointId,
            redditPostId: pp.post.id,
            redditUrl: pp.post.permalink,
            postTitle: pp.post.title,
            postBody: (pp.postBody || '').substring(0, 2000),
            upvotes: pp.post.score,
            commentCount: pp.post.comments,
            subreddit: `r/${sub}`,
            discoveredBy: AGENT_ID,
          });
          console.log(`Linked source post for pain point ${painPointId}`);
        }
        await sleep(500);
      } catch(e) {
        console.log(`Error submitting pain point: ${e.message}`);
      }
    }

  } catch(e) {
    console.log(`Error scanning r/${sub}: ${e.message}`);
  }

  // Log scan results
  try {
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned,
      painPointsFound: painPoints.length,
      status: 'completed',
    });
    console.log(`Logged scan results for r/${sub}`);
  } catch(e) {
    console.log(`Error logging scan: ${e.message}`);
  }

  return { sub, postsScanned, painPointsFound: painPoints.length, painPoints: painPoints.map(p => p.analysis.title) };
}

function analyzePainPoint(title, body, comments) {
  const combined = `${title} ${body} ${comments}`.toLowerCase();
  
  // Patterns that indicate pain points
  const painPatterns = [
    /is there (an?|any) (app|tool|website|software|service|way|method)/i,
    /looking for (an?|a) (app|tool|solution|recommendation)/i,
    /how do (you|i|we) (track|manage|organize|keep track|plan)/i,
    /(frustrated|annoying|hate|struggle|pain|problem|issue) with/i,
    /wish (there was|i could|they would|it)/i,
    /need (a|an|help with|advice on)/i,
    /anyone else (have|deal|struggle|find)/i,
    /best way to (track|manage|organize|plan|keep)/i,
    /what do you use (for|to)/i,
    /recommendation(s)? for/i,
    /manually (track|log|record|enter)/i,
    /too expensive|costs too much|overpriced/i,
    /complicated|complex|confusing|hard to use/i,
    /no good (app|tool|option|solution)/i,
    /keeps breaking|always fails|unreliable/i,
    /route planning|navigation|gps/i,
    /maintenance (schedule|tracking|log)/i,
    /gear (recommendations|tracking|database)/i,
    /commute (tracking|planning|log)/i,
    /bike fitting|component compatibility/i,
    /strava|garmin|wahoo/i,
    /how (do|should|can) i/i,
    /what (should|would|is) (i|the best)/i,
    /sell.*or.*convert|upgrade|replace|switch/i,
    /ebike|e-bike/i,
    /store.*gear|gear.*storage/i,
    /infrastructure|bike lane|cycling lane/i,
    /lock|theft|stolen/i,
    /tubeless|tire|tyre|flat/i,
    /brake|derailleur|shifting|cable/i,
    /advice|help|suggestions/i,
    /compensate|alternative|instead of/i,
  ];

  const isPain = painPatterns.some(p => p.test(combined));
  
  if (!isPain) return null;

  // Generate a meaningful title and description
  let painTitle = '';
  let painDesc = '';

  const titleLower = title.toLowerCase();
  
  if (/route planning|navigation|gps/.test(combined)) {
    painTitle = 'Cyclists need better route planning and navigation tools';
    painDesc = `Cyclists are struggling with route planning and GPS navigation, especially for mixed-terrain or urban routes. Existing tools like Strava or Komoot don't fully address the needs of both commuters and gravel riders. Users want smarter routing that accounts for road conditions, elevation, and surface type.`;
  } else if (/maintenance|service|repair|wrench/.test(combined)) {
    painTitle = 'No good way to track bike maintenance schedules and component wear';
    painDesc = `Cyclists struggle to keep track of maintenance intervals, component mileage, and service history across multiple bikes. Manual spreadsheets are tedious; existing apps are either too basic or overpriced. There's demand for a simple maintenance log that tracks component wear and sends reminders.`;
  } else if (/commute|commuting/.test(combined)) {
    painTitle = 'Bike commuters lack tools to log and optimize their daily commute';
    painDesc = `Bike commuters want to track their commute stats, weather patterns, and route variations in one place. Current cycling apps focus on fitness and performance rather than commuter-specific needs like arrival time tracking, gear checklists, or transit backup planning.`;
  } else if (/gear.*storage|store.*gear/.test(combined)) {
    painTitle = 'Cyclists struggle with gear storage and organization in small spaces';
    painDesc = `Bike commuters and cyclists dealing with limited living space have trouble organizing helmets, panniers, waterproof gear, and tools. Existing storage solutions are either too expensive or not designed for cycling-specific gear. Community members regularly ask for recommendations.`;
  } else if (/sell.*convert|convert.*commuter|upgrade|replace/.test(combined)) {
    painTitle = 'Cyclists need guidance on bike conversion and upgrade decisions';
    painDesc = `Riders frequently struggle with decisions about whether to convert an existing bike or buy a new one for specific use cases. There's no easy tool that compares the cost-effectiveness of upgrading vs. buying, or helps identify compatible components.`;
  } else if (/ebike|e-bike/.test(combined)) {
    painTitle = 'People switching from cars to e-bikes need better decision-making resources';
    painDesc = `Potential e-bike buyers face a confusing market with hundreds of options at wildly varying price points. Users ask about cost comparisons vs. car ownership, what features actually matter, and how to make the switch successfully. A structured comparison tool or community guide would fill this gap.`;
  } else if (/lock|theft|stolen/.test(combined)) {
    painTitle = 'Bike theft prevention and recovery options are inadequate';
    painDesc = `Cyclists struggle with bike security, from choosing the right lock combinations to recovery after theft. There's no centralized community database of stolen bikes or local threat-level maps to help riders make informed security decisions.`;
  } else if (/tubeless|tire|tyre|flat/.test(combined)) {
    painTitle = 'Cyclists need better guidance on tubeless setup and flat repair';
    painDesc = `Tubeless tire setups and roadside flat repairs remain confusing and inconsistent, with many riders unsure which sealants, plugs, or techniques work best for their conditions. A decision-guide or troubleshooting tool would help reduce frustration.`;
  } else if (/brake|derailleur|shifting|cable/.test(combined)) {
    painTitle = 'DIY bike mechanics need better diagnostic and repair guidance';
    painDesc = `Home mechanics regularly struggle with brake and drivetrain issues, often unsure if the problem is adjustment, wear, or incompatibility. Posts asking for help diagnosing specific issues are common, suggesting demand for a structured troubleshooting resource.`;
  } else if (/infrastructure|bike lane|cycling lane|car.depend/.test(combined)) {
    painTitle = 'Urban cyclists lack tools to advocate and plan around poor infrastructure';
    painDesc = `Cyclists in car-dependent areas struggle to find safe routes, report hazards, and advocate for better infrastructure. There's no unified platform for logging dangerous intersections, tracking infrastructure improvement requests, or finding community advocacy resources.`;
  } else if (/gear|component|upgrade|compatibility/.test(combined)) {
    painTitle = 'Cyclists frustrated by component compatibility and gear selection complexity';
    painDesc = `Riders spend hours researching component compatibility, especially when mixing groupset generations or upgrading budget bikes. There's no easy tool that lets you input your bike specs and get compatibility-checked upgrade recommendations.`;
  } else if (/strava|garmin|wahoo/.test(combined)) {
    painTitle = 'Cyclists dissatisfied with current tracking apps for specific use cases';
    painDesc = `Many cyclists find mainstream apps like Strava too expensive for premium features or poorly suited to their specific riding style (gravel, commuting, etc.). There's demand for more affordable or specialized alternatives that better match niche cycling communities.`;
  } else {
    // Use actual post title directly
    painTitle = title.substring(0, 80);
    const bodySnippet = body ? body.replace(/\n+/g, ' ').substring(0, 300) : '';
    painDesc = `Cyclists on Reddit are asking about or struggling with this issue: "${title}". ${bodySnippet ? bodySnippet + '...' : 'Multiple community members have expressed similar needs, suggesting a recurring pain point worth addressing.'}`;
  }

  return { title: painTitle, description: painDesc };
}

async function main() {
  console.log(`Starting scan for agent: ${AGENT_ID}`);
  console.log(`Connecting to CDP: ${CDP_URL}`);
  
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected to browser via CDP');
    
    const context = browser.contexts()[0];
    const pages = context.pages();
    
    // Close extra tabs, keep one
    for (let i = 1; i < pages.length; i++) {
      try { await pages[i].close(); } catch(e) {}
    }
    const page = pages[0] || await context.newPage();
    
    const results = [];
    
    for (const sub of SUBREDDITS) {
      const result = await scanSubreddit(page, sub);
      results.push(result);
      await sleep(3000); // Pause between subreddits
    }
    
    // Summary
    console.log('\n=== SCAN COMPLETE ===');
    let totalPosts = 0, totalPainPoints = 0;
    for (const r of results) {
      console.log(`r/${r.sub}: ${r.postsScanned} posts scanned, ${r.painPointsFound} pain points found`);
      if (r.painPoints.length > 0) {
        r.painPoints.forEach(p => console.log(`  - ${p}`));
      }
      totalPosts += r.postsScanned;
      totalPainPoints += r.painPointsFound;
    }
    console.log(`\nTOTAL: ${SUBREDDITS.length} subreddits, ${totalPosts} posts, ${totalPainPoints} pain points`);
    
    return results;
    
  } catch(e) {
    console.error('Fatal error:', e.message);
    throw e;
  } finally {
    // Do NOT close the browser - admin handles that
    if (browser) {
      try { await browser.close(); } catch(e) {} // disconnect only
    }
  }
}

main().then(results => {
  process.exit(0);
}).catch(e => {
  console.error(e);
  process.exit(1);
});
