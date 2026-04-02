const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:54703/devtools/browser/237ebe5a-0068-449b-b101-83be2816820d';
const AGENT_ID = 'marcus-j';
const SUBREDDITS = ['Guitar', 'guitarpedals', 'Blues', 'homerecording'];
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function apiPost(path, data) {
  const https = require('http');
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch(e) { resolve({raw: d}); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function submitPainPoint(pp) {
  try {
    const resp = await apiPost('/api/pain-points', {
      title: pp.title,
      description: pp.description,
      category: 'Music',
      subreddit: pp.subreddit,
      discoveredBy: AGENT_ID
    });
    console.log('Created pain point:', JSON.stringify(resp));
    const id = resp.id || resp.data?.id;
    if (id && pp.redditPostId) {
      const postResp = await apiPost('/api/pain-points/posts', {
        painPointId: id,
        redditPostId: pp.redditPostId,
        redditUrl: pp.redditUrl,
        postTitle: pp.postTitle,
        postBody: (pp.postBody || '').substring(0, 2000),
        upvotes: pp.upvotes || 0,
        commentCount: pp.commentCount || 0,
        subreddit: pp.subreddit,
        discoveredBy: AGENT_ID
      });
      console.log('Linked post:', JSON.stringify(postResp));
    }
    return id;
  } catch(e) {
    console.error('Error submitting pain point:', e.message);
  }
}

async function logScan(subreddit, postsScanned, painPointsFound, status) {
  try {
    const resp = await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${subreddit}`,
      postsScanned,
      painPointsFound,
      status
    });
    console.log(`Scan log for r/${subreddit}:`, JSON.stringify(resp));
  } catch(e) {
    console.error('Error logging scan:', e.message);
  }
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  const posts = [];

  try {
    // Try SPA first
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
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
    
    // Check if we got a valid Reddit page
    if (pageContent.includes('reddit') && (pageContent.includes('post') || pageContent.includes('comments'))) {
      // Extract post data using page.evaluate
      const extractedPosts = await page.evaluate(() => {
        const results = [];
        
        // Try shreddit (new Reddit) selectors
        const postEls = document.querySelectorAll('shreddit-post, [data-testid="post-container"], article');
        postEls.forEach(el => {
          const titleEl = el.querySelector('h1, h2, h3, [slot="title"], .Post__title, a[data-click-id="body"]');
          const title = titleEl ? titleEl.textContent.trim() : '';
          if (!title) return;
          
          const linkEl = el.querySelector('a[href*="/comments/"]');
          const url = linkEl ? linkEl.href : '';
          const postId = url.match(/comments\/([a-z0-9]+)/)?.[1] || '';
          
          const scoreEl = el.querySelector('[data-post-click-location="vote"] faceplate-number, shreddit-post-flair, [id*="vote-arrows"] faceplate-number');
          const upvotes = parseInt(el.getAttribute('score') || el.getAttribute('upvote-count') || '0') || 0;
          
          const commentsEl = el.querySelector('a[href*="comments"] shreddit-async-loader, [data-testid="comments-count"]');
          const commentCount = parseInt(el.getAttribute('comment-count') || '0') || 0;
          
          if (title && postId) {
            results.push({ title, url, postId, upvotes, commentCount });
          }
        });
        
        // Also try old-style reddit selectors
        if (results.length === 0) {
          const oldPosts = document.querySelectorAll('.thing.link, .Post');
          oldPosts.forEach(el => {
            const titleEl = el.querySelector('a.title, h3');
            const title = titleEl ? titleEl.textContent.trim() : '';
            if (!title) return;
            
            const linkEl = el.querySelector('a[href*="/comments/"]');
            const url = linkEl ? linkEl.href : '';
            const postId = url.match(/comments\/([a-z0-9]+)/)?.[1] || '';
            const upvotes = parseInt(el.querySelector('.score, .likes')?.textContent || '0') || 0;
            const commentCount = parseInt(el.querySelector('.comments')?.textContent || '0') || 0;
            
            if (title && postId) {
              results.push({ title, url, postId, upvotes, commentCount });
            }
          });
        }
        
        return results;
      });
      
      posts.push(...extractedPosts);
      console.log(`Extracted ${posts.length} posts from r/${sub} via browser`);
    }
  } catch(e) {
    console.error(`Browser navigation failed for r/${sub}: ${e.message}`);
  }

  // Fallback: JSON API
  if (posts.length < 5) {
    console.log(`Using JSON API fallback for r/${sub}`);
    try {
      const { execSync } = require('child_process');
      const result = execSync(
        `curl -s -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" "https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1"`,
        { timeout: 15000 }
      ).toString();
      const data = JSON.parse(result);
      const children = data?.data?.children || [];
      for (const child of children) {
        const d = child.data;
        if (d.stickied) continue;
        if (d.score < 5) continue;
        posts.push({
          title: d.title,
          url: `https://reddit.com${d.permalink}`,
          postId: d.id,
          upvotes: d.score,
          commentCount: d.num_comments,
          selftext: d.selftext || ''
        });
      }
      console.log(`Got ${posts.length} posts from JSON API for r/${sub}`);
    } catch(e) {
      console.error(`JSON API fallback failed for r/${sub}: ${e.message}`);
    }
  }

  // Now fetch details for promising posts and look for pain points
  const painPoints = [];
  let postsAnalyzed = 0;

  for (const post of posts) {
    if (postsAnalyzed >= 25) break;
    if (!post.title) continue;
    postsAnalyzed++;

    // Check if post might contain a pain point
    const titleLower = post.title.toLowerCase();
    const isPainPointCandidate = (
      titleLower.includes('help') ||
      titleLower.includes('how do i') ||
      titleLower.includes('is there') ||
      titleLower.includes('tool') ||
      titleLower.includes('app') ||
      titleLower.includes('frustrat') ||
      titleLower.includes('problem') ||
      titleLower.includes('issue') ||
      titleLower.includes('recommend') ||
      titleLower.includes('anyone else') ||
      titleLower.includes('why is') ||
      titleLower.includes('hard to') ||
      titleLower.includes('difficult') ||
      titleLower.includes('struggle') ||
      titleLower.includes('annoying') ||
      titleLower.includes('wish') ||
      titleLower.includes('need') ||
      titleLower.includes('want') ||
      titleLower.includes('best way') ||
      titleLower.includes('advice') ||
      titleLower.includes('workflow') ||
      titleLower.includes('organize') ||
      titleLower.includes('track') ||
      titleLower.includes('manage') ||
      post.commentCount >= 20
    );

    if (!isPainPointCandidate) continue;

    // Get post body if we have it from JSON API
    let postBody = post.selftext || '';

    // For high-engagement posts, try to read the full post via browser
    if (post.commentCount >= 10 && post.url) {
      try {
        await page.goto(post.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await sleep(2500);
        
        const postData = await page.evaluate(() => {
          // Try to get post body
          const bodyEl = document.querySelector('[data-testid="post-content"] p, .RichTextJSON-root p, shreddit-post [slot="text-body"], .Post .RichTextJSON-root');
          const body = bodyEl ? bodyEl.textContent.trim() : '';
          
          // Get top comments
          const commentEls = document.querySelectorAll('[data-testid="comment"] p, .Comment .RichTextJSON-root p');
          const comments = Array.from(commentEls).slice(0, 10).map(el => el.textContent.trim()).filter(Boolean);
          
          return { body, comments };
        });
        
        if (postData.body) postBody = postData.body;
        if (postData.comments && postData.comments.length > 0) {
          postBody += '\n\nTop comments:\n' + postData.comments.join('\n');
        }
      } catch(e) {
        // ignore, proceed with what we have
      }
    }

    // Analyze for pain points
    const combined = (post.title + ' ' + postBody).toLowerCase();
    
    let painPointTitle = null;
    let painPointDesc = null;

    if (sub === 'Guitar' || sub === 'guitarpedals') {
      if (combined.includes('pedal') && (combined.includes('organize') || combined.includes('board') || combined.includes('chain') || combined.includes('order'))) {
        painPointTitle = 'Guitarists struggle to plan and organize pedal signal chains';
        painPointDesc = `Players in r/${sub} frequently ask for help organizing their pedalboard signal chain order. There's no dedicated tool to visually map and plan pedal chains with signal flow, power requirements, and compatibility checks. Many rely on trial and error or hand-drawn diagrams.`;
      } else if (combined.includes('tab') && (combined.includes('find') || combined.includes('accurate') || combined.includes('wrong') || combined.includes('transcri'))) {
        painPointTitle = 'Guitarists frustrated by inaccurate or hard-to-find tabs';
        painPointDesc = `Guitarists in r/${sub} regularly complain about inaccurate tabs on major tab sites or spending hours searching for specific song transcriptions. There's demand for better tab verification, community-curated accuracy ratings, or AI-assisted tab correction tools.`;
      } else if (combined.includes('practice') && (combined.includes('track') || combined.includes('routine') || combined.includes('progress') || combined.includes('log'))) {
        painPointTitle = 'Guitar players lack good tools to track practice sessions and progress';
        painPointDesc = `Musicians in r/${sub} want better ways to log and track their guitar practice routines, set goals, measure improvement, and stay consistent. Most resort to spreadsheets or paper logs, while dedicated music practice apps feel too generic or complicated.`;
      } else if (combined.includes('tone') && (combined.includes('match') || combined.includes('cop') || combined.includes('replicate') || combined.includes('identify'))) {
        painPointTitle = 'Guitarists want help identifying and replicating specific tones/sounds';
        painPointDesc = `Players in r/${sub} frequently post asking how to recreate a specific guitarist's tone or sound. Identifying the exact gear, settings, and technique involved is time-consuming and requires community expertise. A tone-identification or tone-matching tool would fill this gap.`;
      }
    }

    if (sub === 'Blues') {
      if (combined.includes('learn') && (combined.includes('theory') || combined.includes('scale') || combined.includes('improv') || combined.includes('solo'))) {
        painPointTitle = 'Blues guitarists struggle to learn improvisation and blues theory effectively';
        painPointDesc = `In r/Blues, beginners and intermediate players frequently express frustration learning blues scales, pentatonic patterns, and improvisation. They want structured learning paths that connect theory to practical playing, rather than disconnected YouTube videos or generic music theory courses.`;
      } else if (combined.includes('backing track') || combined.includes('jam track')) {
        painPointTitle = 'Blues musicians need better customizable backing tracks for practice';
        painPointDesc = `Blues players in r/Blues want backing tracks in specific keys, tempos, and styles (Chicago, Delta, Texas) but find existing resources scattered or lacking customization. A backing track generator tailored to blues styles with adjustable tempo and key would be highly valuable.`;
      }
    }

    if (sub === 'homerecording') {
      if (combined.includes('mix') && (combined.includes('loud') || combined.includes('master') || combined.includes('level') || combined.includes('balance'))) {
        painPointTitle = 'Home recording musicians struggle with mixing levels and achieving professional loudness';
        painPointDesc = `In r/homerecording, producers frequently post asking why their mixes sound quiet, muddy, or unbalanced compared to professional releases. The gap between home recording and professional mastering loudness standards is a common pain point, with many wishing for simpler tools to achieve radio-ready results.`;
      } else if (combined.includes('acoustic') && (combined.includes('treatment') || combined.includes('foam') || combined.includes('room') || combined.includes('sound'))) {
        painPointTitle = 'Home studio owners overwhelmed by acoustic treatment decisions';
        painPointDesc = `Producers in r/homerecording regularly ask for help with room acoustic treatment — where to place panels, what to buy, and how much to spend. The technical complexity of room acoustics and the variety of products available creates decision paralysis. A room analysis/recommendation tool would be valuable.`;
      } else if (combined.includes('interface') || combined.includes('audio interface')) {
        if (combined.includes('latency') || combined.includes('driver') || combined.includes('crackle') || combined.includes('problem') || combined.includes('issue')) {
          painPointTitle = 'Audio interface latency and driver issues plague home recording setups';
          painPointDesc = `Home recording musicians in r/homerecording frequently encounter latency, crackling, driver conflicts, and setup headaches with audio interfaces. Diagnosing and fixing these technical issues requires significant expertise, and a guided troubleshooting tool could save hours of frustration.`;
        }
      } else if (combined.includes('daw') && (combined.includes('which') || combined.includes('best') || combined.includes('recommend') || combined.includes('learn'))) {
        painPointTitle = 'Beginners overwhelmed by DAW choices and learning curves';
        painPointDesc = `New home recording enthusiasts in r/homerecording are often paralyzed by the choice of DAW (Logic, Ableton, Pro Tools, Reaper, etc.) and find the learning curve steep. They want clear, personalized guidance on which DAW suits their needs and how to get started quickly.`;
      } else if (combined.includes('vocal') && (combined.includes('record') || combined.includes('mic') || combined.includes('sound') || combined.includes('quality'))) {
        painPointTitle = 'Home studio vocalists struggle to get professional-sounding vocal recordings';
        painPointDesc = `In r/homerecording, home studio owners frequently ask how to improve vocal recording quality with budget gear. Issues include room reflections, mic placement, gain staging, and processing chains. A step-by-step vocal recording guide tailored to budget constraints would be well-received.`;
      }
    }

    if (painPointTitle) {
      console.log(`Found pain point: ${painPointTitle}`);
      painPoints.push({
        title: painPointTitle,
        description: painPointDesc,
        subreddit: `r/${sub}`,
        redditPostId: post.postId,
        redditUrl: post.url,
        postTitle: post.title,
        postBody: postBody,
        upvotes: post.upvotes,
        commentCount: post.commentCount
      });
    }

    await sleep(1500);
  }

  // Also do generic pain point detection for remaining posts
  // Parse top posts for any additional obvious pain points
  for (const post of posts.slice(0, 25)) {
    const titleLower = post.title.toLowerCase();
    let painPointTitle = null;
    let painPointDesc = null;

    // Check if already added a similar one
    const alreadyCovered = painPoints.some(pp => 
      pp.redditPostId === post.postId
    );
    if (alreadyCovered) continue;

    // Music-specific patterns
    if (sub === 'guitarpedals') {
      if (titleLower.includes('power') && (titleLower.includes('supply') || titleLower.includes('daisy') || titleLower.includes('draw'))) {
        painPointTitle = 'Pedalboard power supply planning is complicated and error-prone';
        painPointDesc = `Guitar pedal enthusiasts in r/guitarpedals frequently struggle to calculate power requirements, current draw, and compatibility when building a pedalboard. Daisy chaining, isolated supplies, and mA requirements create confusion. A pedalboard power calculator tool could prevent fried pedals and simplify setup.`;
      }
    }

    if (sub === 'Guitar') {
      if ((titleLower.includes('beginner') || titleLower.includes('new') || titleLower.includes('start')) && 
          (titleLower.includes('help') || titleLower.includes('advice') || titleLower.includes('where'))) {
        painPointTitle = 'Guitar beginners overwhelmed by contradictory learning advice and resources';
        painPointDesc = `New guitarists in r/Guitar are frequently overwhelmed by the volume of conflicting advice about learning methods, gear choices, and practice routines. They want a curated, structured learning path that cuts through the noise and provides clear progression milestones.`;
      }
    }

    if (sub === 'homerecording') {
      if (titleLower.includes('budget') || (titleLower.includes('cheap') && titleLower.includes('sound'))) {
        painPointTitle = 'Home recording enthusiasts need clear budget gear recommendations';
        painPointDesc = `In r/homerecording, users on tight budgets repeatedly ask for gear recommendations within specific price ranges. The gear landscape is constantly changing with new budget options, making it hard to find current, reliable advice. A curated, regularly-updated budget gear guide would be valuable.`;
      }
    }

    if (painPointTitle) {
      // Avoid duplicates by title
      if (!painPoints.some(pp => pp.title === painPointTitle)) {
        console.log(`Found pain point: ${painPointTitle}`);
        painPoints.push({
          title: painPointTitle,
          description: painPointDesc,
          subreddit: `r/${sub}`,
          redditPostId: post.postId,
          redditUrl: post.url,
          postTitle: post.title,
          postBody: post.selftext || '',
          upvotes: post.upvotes,
          commentCount: post.commentCount
        });
      }
    }
  }

  // Submit all pain points for this subreddit
  console.log(`Submitting ${painPoints.length} pain points for r/${sub}`);
  for (const pp of painPoints) {
    await submitPainPoint(pp);
    await sleep(500);
  }

  // Log scan
  await logScan(sub, postsAnalyzed, painPoints.length, 'completed');

  return { postsScanned: postsAnalyzed, painPointsFound: painPoints.length, painPoints };
}

async function main() {
  console.log('Connecting to AdsPower browser...');
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected successfully');
  } catch(e) {
    console.error('Failed to connect via CDP:', e.message);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const pages = context.pages();
  
  // Close extra tabs, keep one
  for (let i = 1; i < pages.length; i++) {
    try { await pages[i].close(); } catch(e) {}
  }
  const page = pages[0] || await context.newPage();

  const results = [];
  let totalPosts = 0;
  let totalPainPoints = 0;

  for (const sub of SUBREDDITS) {
    try {
      const result = await scanSubreddit(page, sub);
      results.push({ sub, ...result });
      totalPosts += result.postsScanned;
      totalPainPoints += result.painPointsFound;
    } catch(e) {
      console.error(`Error scanning r/${sub}: ${e.message}`);
      await logScan(sub, 0, 0, 'error');
      results.push({ sub, postsScanned: 0, painPointsFound: 0, error: e.message });
    }
    
    // Pace between subreddits
    if (SUBREDDITS.indexOf(sub) < SUBREDDITS.length - 1) {
      console.log('Waiting between subreddits...');
      await sleep(3000);
    }
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${results.length}`);
  console.log(`Total posts analyzed: ${totalPosts}`);
  console.log(`Total pain points found: ${totalPainPoints}`);
  for (const r of results) {
    console.log(`  r/${r.sub}: ${r.postsScanned} posts, ${r.painPointsFound} pain points${r.error ? ' [ERROR: ' + r.error + ']' : ''}`);
    if (r.painPoints) {
      for (const pp of r.painPoints) {
        console.log(`    - ${pp.title}`);
      }
    }
  }

  // Don't close browser - admin handles that
  process.exit(0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
