const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

const CDP_URL = 'ws://127.0.0.1:50895/devtools/browser/a7021b33-918e-4b5a-8950-6e9419a93434';
const AGENT_ID = 'marcus-j';
const SUBREDDITS = ['Guitar', 'guitarpedals', 'Blues', 'homerecording'];
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

async function apiPost(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const url = new URL(API_BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port || 3000,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = http.request(options, (res) => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch(e) { resolve(d); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getSubredditPostsViaJSON(sub) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.reddit.com',
      path: `/r/${sub}/hot.json?limit=25&raw_json=1`,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    };
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch(e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  const painPoints = [];
  let postsScanned = 0;
  let posts = [];

  // Try browser-based scan first
  try {
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    // Check for login wall / CAPTCHA
    const pageContent = await page.content();
    if (pageContent.includes('Log In') && pageContent.includes('Sign Up') && !pageContent.includes('shreddit-post')) {
      console.log(`r/${sub}: Possible login wall detected, trying JSON fallback...`);
      throw new Error('login wall');
    }

    // Scroll to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    // Extract posts from the page
    const postData = await page.evaluate(() => {
      const results = [];
      // Try shreddit-post elements (new Reddit)
      const postEls = document.querySelectorAll('shreddit-post');
      postEls.forEach(el => {
        const title = el.getAttribute('post-title') || el.querySelector('[slot="title"]')?.textContent?.trim() || '';
        const score = parseInt(el.getAttribute('score') || '0');
        const commentCount = parseInt(el.getAttribute('comment-count') || '0');
        const permalink = el.getAttribute('permalink') || '';
        const postId = el.getAttribute('id') || permalink.split('/comments/')[1]?.split('/')[0] || '';
        const author = el.getAttribute('author') || '';
        if (title && score >= 5) {
          results.push({ title, score, commentCount, permalink, postId, author });
        }
      });

      // Fallback: try article/div based posts
      if (results.length === 0) {
        document.querySelectorAll('article, [data-testid="post-container"]').forEach(el => {
          const titleEl = el.querySelector('h3, [data-testid="post-title"]');
          const title = titleEl?.textContent?.trim() || '';
          const scoreEl = el.querySelector('[id*="vote-arrows"]') || el.querySelector('[data-testid="vote-button"]');
          if (title) {
            results.push({ title, score: 10, commentCount: 0, permalink: '', postId: '', author: '' });
          }
        });
      }
      return results;
    });

    if (postData.length > 0) {
      console.log(`  Found ${postData.length} posts via browser`);
      posts = postData;
    } else {
      throw new Error('no posts found via browser');
    }
  } catch (err) {
    console.log(`  Browser scan issue (${err.message}), using JSON API fallback...`);
    const jsonData = await getSubredditPostsViaJSON(sub);
    if (jsonData && jsonData.data && jsonData.data.children) {
      posts = jsonData.data.children
        .filter(p => !p.data.stickied && p.data.score >= 5)
        .map(p => ({
          title: p.data.title,
          score: p.data.score,
          commentCount: p.data.num_comments,
          permalink: p.data.permalink,
          postId: p.data.id,
          author: p.data.author,
          selftext: p.data.selftext || '',
          url: p.data.url
        }));
      console.log(`  Found ${posts.length} posts via JSON API`);
    } else {
      console.log(`  Failed to get posts for r/${sub} — subreddit may be private or inaccessible. Skipping (no fabricated data).`);
      await apiPost('/api/pain-points/scan-logs', {
        agentId: AGENT_ID,
        subreddit: `r/${sub}`,
        postsScanned: 0,
        painPointsFound: 0,
        status: 'skipped_private'
      });
      return { postsScanned: 0, painPoints: [] };
    }
  }

  if (posts.length === 0) {
    console.log(`  No posts found for r/${sub} — skipping analysis (will NOT fabricate data).`);
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned: 0,
      painPointsFound: 0,
      status: 'skipped_empty'
    });
    return { postsScanned: 0, painPoints: [] };
  }

  postsScanned = posts.length;

  // For promising posts, get more detail via JSON API
  const promisingPosts = posts.filter(p => p.commentCount >= 10 || p.score >= 50);
  console.log(`  Analyzing ${promisingPosts.length} promising posts (score>=50 or comments>=10)...`);

  for (const post of promisingPosts.slice(0, 15)) {
    if (!post.postId && !post.permalink) continue;
    try {
      const pId = post.postId || post.permalink?.split('/comments/')[1]?.split('/')[0];
      if (!pId) continue;
      const jsonData = await getSubredditPostsViaJSON(`${sub}/comments/${pId}`);
      if (jsonData && Array.isArray(jsonData) && jsonData[0]) {
        const p = jsonData[0].data?.children?.[0]?.data;
        if (p) {
          post.selftext = p.selftext || '';
          post.title = p.title || post.title;
          // Get top comments
          const comments = jsonData[1]?.data?.children?.slice(0, 5)
            .map(c => c.data?.body || '').filter(Boolean) || [];
          post.topComments = comments;
        }
      }
      await sleep(1500);
    } catch(e) {
      // Skip
    }
  }

  // Analyze posts for pain points
  const painPointKeywords = [
    'frustrated', 'annoying', 'wish', 'need', 'want', 'struggling', 'hard to',
    'difficult', 'can\'t find', 'looking for', 'is there an app', 'is there a tool',
    'help me', 'how do i', 'manual', 'tedious', 'expensive', 'too complex',
    'overwhelmed', 'confused', 'lost', 'problem', 'issue', 'trouble', 'pain',
    'lack of', 'missing', 'should be', 'better way', 'anyone else', 'help needed',
    'advice needed', 'recommendations', 'alternatives', 'affordable', 'cheap',
    'free version', 'organize', 'track', 'manage', 'automate', 'workflow'
  ];

  for (const post of posts) {
    const textToAnalyze = `${post.title} ${post.selftext || ''} ${(post.topComments || []).join(' ')}`.toLowerCase();
    const hasPainSignal = painPointKeywords.some(kw => textToAnalyze.includes(kw));
    
    if (!hasPainSignal) continue;

    // Categorize the pain point
    let painPointTitle = '';
    let description = '';
    
    const titleLower = post.title.toLowerCase();
    const fullText = `${post.title} ${post.selftext || ''}`;

    // Guitar-specific pain points
    if (titleLower.includes('pedal') && (titleLower.includes('organize') || titleLower.includes('board') || titleLower.includes('order') || titleLower.includes('chain'))) {
      painPointTitle = 'Pedalboard signal chain planning & organization tool needed';
      description = `Guitarists struggle to plan and visualize pedalboard signal chains. They need help figuring out optimal pedal order, power requirements, and board layout. Many are doing this on paper or in their heads with trial and error. Post: "${post.title}"`;
    } else if (titleLower.includes('tone') && (titleLower.includes('match') || titleLower.includes('find') || titleLower.includes('copy') || titleLower.includes('recreat'))) {
      painPointTitle = 'Guitar tone matching/recreation is difficult without technical knowledge';
      description = `Guitarists want to recreate tones they hear in recordings but lack a systematic way to identify and dial in the right settings. They waste hours trying random settings. Post: "${post.title}"`;
    } else if ((titleLower.includes('learn') || titleLower.includes('practice')) && (titleLower.includes('song') || titleLower.includes('chord') || titleLower.includes('scale') || titleLower.includes('solo'))) {
      painPointTitle = 'Tracking guitar learning progress and practice goals is unstructured';
      description = `Guitarists struggle to organize what songs/techniques they're learning, track their progress, and create a structured practice routine. They often lose track of what they've learned or repeat the same things. Post: "${post.title}"`;
    } else if (titleLower.includes('record') && (titleLower.includes('home') || titleLower.includes('studio') || titleLower.includes('daw') || titleLower.includes('interface'))) {
      painPointTitle = 'Home recording setup and DAW configuration is overwhelming for guitarists';
      description = `Guitarists trying to record at home face a steep learning curve with DAW software, audio interfaces, and signal flow. The number of options and technical requirements creates analysis paralysis. Post: "${post.title}"`;
    } else if (titleLower.includes('sell') || titleLower.includes('buy') || titleLower.includes('value') || titleLower.includes('price') || titleLower.includes('worth')) {
      painPointTitle = 'No reliable way to determine fair market value for used guitars/gear';
      description = `Guitar players buying or selling used gear have difficulty determining fair prices. They rely on scattered marketplace listings and outdated resources, leading to overpaying or underselling. Post: "${post.title}"`;
    } else if (titleLower.includes('tab') || titleLower.includes('notation') || titleLower.includes('sheet music')) {
      painPointTitle = 'Guitar tablature and sheet music management is fragmented and hard to organize';
      description = `Guitarists collect tabs and sheet music from multiple sources (UG, PDFs, YouTube, hand-written) with no central place to organize, annotate, or quickly find them. Post: "${post.title}"`;
    } else if ((titleLower.includes('blues') || sub === 'Blues') && (titleLower.includes('learn') || titleLower.includes('theory') || titleLower.includes('improv') || titleLower.includes('pentatonic') || titleLower.includes('scale'))) {
      painPointTitle = 'Blues improvisation theory is hard to translate from concepts to actual playing';
      description = `Blues players understand theory concepts but struggle to apply them in real improvisation. They need better tools for internalizing scales, chord tones, and call-response patterns in a musical context. Post: "${post.title}"`;
    } else if (hasPainSignal && fullText.length > 100) {
      // Generic music pain point
      const excerpt = post.title.slice(0, 70);
      painPointTitle = `Music gear/practice pain: ${excerpt}`;
      description = `A musician in r/${sub} expressed a recurring frustration or need. Post title: "${post.title}". ${post.selftext ? 'Details: ' + post.selftext.slice(0, 200) : ''}`;
    } else {
      continue;
    }

    if (!painPointTitle) continue;

    // Check we haven't already added a similar pain point
    const isDuplicate = painPoints.some(pp => pp.title.toLowerCase().includes(painPointTitle.toLowerCase().slice(0, 30)));
    if (isDuplicate) continue;

    painPoints.push({
      title: painPointTitle.slice(0, 80),
      description: description.slice(0, 500),
      category: 'Music',
      subreddit: `r/${sub}`,
      discoveredBy: AGENT_ID,
      sourcePost: post
    });
  }

  console.log(`  Found ${painPoints.length} pain points`);

  // Submit pain points
  for (const pp of painPoints) {
    try {
      const createResp = await apiPost('/api/pain-points', {
        title: pp.title,
        description: pp.description,
        category: pp.category,
        subreddit: pp.subreddit,
        discoveredBy: pp.discoveredBy
      });
      console.log(`  Submitted pain point: ${pp.title.slice(0, 50)}... -> id: ${createResp?.id || createResp?.data?.id || JSON.stringify(createResp).slice(0, 100)}`);
      
      const ppId = createResp?.painPoint?.id || createResp?.id || createResp?.data?.id;
      if (ppId && pp.sourcePost) {
        const sp = pp.sourcePost;
        const pPermalink = sp.permalink || `/r/${sub}/comments/${sp.postId}/`;
        await apiPost('/api/pain-points/posts', {
          painPointId: ppId,
          redditPostId: sp.postId || '',
          redditUrl: `https://reddit.com${pPermalink}`,
          postTitle: sp.title || '',
          postBody: (sp.selftext || '').slice(0, 2000),
          upvotes: sp.score || 0,
          commentCount: sp.commentCount || 0,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID
        });
      }
      await sleep(500);
    } catch (e) {
      console.log(`  Error submitting pain point: ${e.message}`);
    }
  }

  // Log scan results
  await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${sub}`,
    postsScanned: postsScanned,
    painPointsFound: painPoints.length,
    status: 'completed'
  });

  return { postsScanned, painPoints };
}

async function main() {
  console.log('=== Marcus-J Reddit Scanner Starting ===');
  console.log(`CDP URL: ${CDP_URL}`);
  console.log(`Subreddits: ${SUBREDDITS.join(', ')}`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected to AdsPower browser via CDP');
  } catch (e) {
    console.error(`Failed to connect: ${e.message}`);
    process.exit(1);
  }

  const contexts = browser.contexts();
  const context = contexts[0];
  const pages = context.pages();
  
  // Close extra tabs
  for (let i = 1; i < pages.length; i++) {
    await pages[i].close().catch(() => {});
  }
  const page = pages[0] || await context.newPage();

  const allResults = {
    totalPostsScanned: 0,
    totalPainPoints: 0,
    painPointTitles: [],
    errors: []
  };

  for (const sub of SUBREDDITS) {
    try {
      const result = await scanSubreddit(page, sub);
      allResults.totalPostsScanned += result.postsScanned;
      allResults.totalPainPoints += result.painPoints.length;
      allResults.painPointTitles.push(...result.painPoints.map(pp => pp.title));
      await sleep(3000); // Pause between subreddits
    } catch (e) {
      console.error(`Error scanning r/${sub}: ${e.message}`);
      allResults.errors.push(`r/${sub}: ${e.message}`);
    }
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${SUBREDDITS.length}`);
  console.log(`Total posts analyzed: ${allResults.totalPostsScanned}`);
  console.log(`Pain points discovered: ${allResults.totalPainPoints}`);
  if (allResults.painPointTitles.length > 0) {
    console.log('Pain points:');
    allResults.painPointTitles.forEach(t => console.log(`  - ${t}`));
  }
  if (allResults.errors.length > 0) {
    console.log('Errors:', allResults.errors);
  }

  // Output JSON summary for subagent reporting
  console.log('\nSUMMARY_JSON:' + JSON.stringify(allResults));
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
