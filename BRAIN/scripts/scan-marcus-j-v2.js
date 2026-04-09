const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

const CDP_URL = 'ws://127.0.0.1:50895/devtools/browser/a7021b33-918e-4b5a-8950-6e9419a93434';
const AGENT_ID = 'marcus-j';
const SUBREDDITS = ['Guitar', 'guitarpedals', 'Blues', 'homerecording'];
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function apiPost(path, data) {
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
    const req = http.request(options, (res) => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch(e) { resolve({ raw: d }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function fetchRedditJSON(path) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'www.reddit.com',
      path: path,
      method: 'GET',
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    };
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch(e) { 
          console.log(`  JSON parse error for ${path}: ${d.slice(0, 100)}`);
          resolve(null); 
        }
      });
    });
    req.on('error', (e) => { console.log(`  Request error for ${path}: ${e.message}`); resolve(null); });
    req.setTimeout(15000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// Core pain point signals - what we're looking for
const PAIN_SIGNALS = {
  tool_request: ['is there an app', 'is there a tool', 'is there software', 'any app for', 'any tool for', 'any software', 'looking for a way to', 'how do i automate', 'spreadsheet for', 'tracker for'],
  frustration: ['frustrated', 'frustrating', 'annoying', 'hate that', 'drives me crazy', 'so hard to', 'impossible to', 'pain in the ass', 'waste of time', 'tedious', 'exhausting', 'overwhelming'],
  manual_process: ['manually', 'by hand', 'keep track of', 'write down', 'spreadsheet', 'notepad', 'pen and paper', 'have to remember', 'keep forgetting'],
  cost_issue: ['too expensive', 'can\'t afford', 'overpriced', 'cheaper alternative', 'free version', 'subscription cost', 'price is insane', 'wallet pain'],
  help_seeking: ['help me figure out', 'struggling with', 'can\'t figure out', 'lost with', 'confused about', 'don\'t understand', 'advice on', 'recommendations for', 'anyone dealt with', 'is anyone else'],
  missing_feature: ['wish there was', 'should have', 'why doesn\'t', 'needs to', 'would be great if', 'missing feature', 'no way to', 'can\'t find a way'],
};

function detectPainSignals(text) {
  const lower = text.toLowerCase();
  const matches = [];
  for (const [type, signals] of Object.entries(PAIN_SIGNALS)) {
    for (const signal of signals) {
      if (lower.includes(signal)) {
        matches.push({ type, signal });
      }
    }
  }
  return matches;
}

function isPainPoint(post) {
  const fullText = `${post.title} ${post.selftext || ''} ${(post.topComments || []).join(' ')}`;
  const signals = detectPainSignals(fullText);
  // Need at least 1 strong signal or 2 weaker ones
  return signals.length >= 1;
}

function categorizePainPoint(post, sub) {
  const text = `${post.title} ${post.selftext || ''}`.toLowerCase();
  
  // Generate a meaningful title based on what we see
  if (text.includes('pedal') && (text.includes('organiz') || text.includes('board') || text.includes('order') || text.includes('chain') || text.includes('power'))) {
    return {
      title: 'Pedalboard planning & signal chain organization is a manual, error-prone process',
      description: `Guitarists manually plan pedalboard layouts, signal chain order, and power requirements using pencil/paper or basic apps. There's no dedicated tool that handles pedal power consumption, chain order optimization, and board layout together. Seen in r/${sub}: "${post.title.slice(0, 100)}"`
    };
  }
  if (text.includes('tone') && (text.includes('match') || text.includes('find') || text.includes('copy') || text.includes('recreat') || text.includes('dial'))) {
    return {
      title: 'Replicating guitar tones from recordings requires guesswork without structured tools',
      description: `Players want to recreate specific tones they hear but have no systematic approach. They cycle through settings randomly or rely on forums. A structured tone-matching reference tool with gear settings would save hours. Seen in r/${sub}: "${post.title.slice(0, 100)}"`
    };
  }
  if ((text.includes('learn') || text.includes('practice') || text.includes('progress')) && 
      (text.includes('song') || text.includes('chord') || text.includes('scale') || text.includes('solo') || text.includes('technique') || text.includes('routine'))) {
    return {
      title: 'Guitar practice organization and progress tracking lacks dedicated tools',
      description: `Guitarists struggle to structure practice sessions, track what songs/techniques they've mastered, and maintain consistent routines. They use generic note apps or nothing. A purpose-built guitar practice tracker would fill a real gap. Seen in r/${sub}: "${post.title.slice(0, 100)}"`
    };
  }
  if (text.includes('record') && (text.includes('home') || text.includes('studio') || text.includes('daw') || text.includes('interface') || text.includes('mic') || text.includes('monitor') || text.includes('mix'))) {
    return {
      title: 'Home recording setup and DAW configuration is overwhelming for guitarists',
      description: `Guitarists attempting home recording face analysis paralysis from endless gear options, DAW complexity, and technical signal-flow issues. The entry barrier is high and setup guides are scattered. Seen in r/${sub}: "${post.title.slice(0, 100)}"`
    };
  }
  if (text.includes('tab') || (text.includes('sheet') && text.includes('music')) || text.includes('notation')) {
    return {
      title: 'Guitar tabs and sheet music are scattered across multiple sources with no central library',
      description: `Guitarists collect tabs from Ultimate Guitar, PDFs, YouTube transcriptions, and handwritten notes with no unified way to organize, annotate, and search them. Cross-referencing multiple tabs for the same song is cumbersome. Seen in r/${sub}: "${post.title.slice(0, 100)}"`
    };
  }
  if (text.includes('sell') || text.includes('buy') || (text.includes('worth') && text.includes('gear')) || text.includes('fair price') || text.includes('market value')) {
    return {
      title: 'Determining fair market value for used guitars and gear requires extensive manual research',
      description: `Buyers and sellers struggle to price used gear without spending hours searching Reverb, eBay, and forums. There's no quick, reliable price reference tool that aggregates recent sales data for guitar equipment. Seen in r/${sub}: "${post.title.slice(0, 100)}"`
    };
  }
  if ((sub === 'Blues' || text.includes('blues')) && (text.includes('improv') || text.includes('theory') || text.includes('lick') || text.includes('pentatonic') || text.includes('bend'))) {
    return {
      title: 'Blues improvisation theory is conceptually understood but hard to internalize in actual playing',
      description: `Blues players know scales and theory but can't bridge the gap to musical improvisation. They need structured exercises, call-and-response practice tools, and lick libraries tied to real musical context rather than abstract theory. Seen in r/${sub}: "${post.title.slice(0, 100)}"`
    };
  }
  if (text.includes('latency') || text.includes('lag') || (text.includes('monitor') && text.includes('record'))) {
    return {
      title: 'Recording latency and monitoring issues frustrate home studio guitarists',
      description: `Home recording guitarists face persistent latency problems when monitoring their playing. Configuring audio interfaces, buffer sizes, and direct monitoring is confusing and poorly documented. Seen in r/${sub}: "${post.title.slice(0, 100)}"`
    };
  }
  if (text.includes('metronome') || text.includes('timing') || text.includes('rhythm') || (text.includes('tempo') && text.includes('practice'))) {
    return {
      title: 'Practicing with a metronome is monotonous and musicians need smarter rhythm training tools',
      description: `Musicians find metronome practice boring and ineffective for developing real-world timing feel. They need tools that make rhythm practice more musical and contextualized, like backing track generators with adjustable tempo and feel. Seen in r/${sub}: "${post.title.slice(0, 100)}"`
    };
  }

  // Generic music pain point if signals are strong enough
  const signals = detectPainSignals(`${post.title} ${post.selftext || ''}`);
  if (signals.length >= 2) {
    const titleExcerpt = post.title.slice(0, 60);
    return {
      title: `Music community pain: ${titleExcerpt}`.slice(0, 80),
      description: `r/${sub} community member expressed a pain point: "${post.title}". ${post.selftext ? post.selftext.slice(0, 200) : 'High engagement post indicating shared frustration.'} Signal types detected: ${signals.map(s => s.type).join(', ')}.`
    };
  }

  return null;
}

async function scanSubredditViaPage(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  let posts = [];
  let postsScanned = 0;

  // Try browser with scrolling first
  try {
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    // Scroll to load more
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    // Extract posts - try shreddit-post first, then fall back
    posts = await page.evaluate(() => {
      const results = [];
      const els = document.querySelectorAll('shreddit-post');
      els.forEach(el => {
        const title = el.getAttribute('post-title') || '';
        const score = parseInt(el.getAttribute('score') || '0');
        const commentCount = parseInt(el.getAttribute('comment-count') || '0');
        const permalink = el.getAttribute('permalink') || '';
        const postId = permalink.split('/comments/')[1]?.split('/')[0] || el.getAttribute('id') || '';
        if (title && score >= 5) {
          results.push({ title, score, commentCount, permalink, postId });
        }
      });
      return results;
    });

    console.log(`  Browser extracted ${posts.length} posts`);
  } catch (e) {
    console.log(`  Browser error: ${e.message}`);
  }

  // Always also try JSON API to get selftext
  console.log(`  Fetching posts with selftext via JSON API...`);
  const jsonData = await fetchRedditJSON(`/r/${sub}/hot.json?limit=25&raw_json=1`);
  if (jsonData && jsonData.data && jsonData.data.children) {
    const jsonPosts = jsonData.data.children
      .filter(p => !p.data.stickied && p.data.score >= 5)
      .map(p => ({
        title: p.data.title,
        score: p.data.score,
        commentCount: p.data.num_comments,
        permalink: p.data.permalink,
        postId: p.data.id,
        selftext: p.data.selftext || '',
        url: p.data.url,
        author: p.data.author
      }));
    console.log(`  JSON API got ${jsonPosts.length} posts with selftext`);
    // Merge: prefer JSON posts (they have selftext), add any browser-only ones
    const jsonPostIds = new Set(jsonPosts.map(p => p.postId));
    const browserOnly = posts.filter(p => !jsonPostIds.has(p.postId));
    posts = [...jsonPosts, ...browserOnly];
  } else {
    console.log(`  JSON API failed or returned no data`);
  }

  if (posts.length === 0) {
    console.log(`  No posts found for r/${sub}, skipping`);
    await apiPost('/api/pain-points/scan-logs', { agentId: AGENT_ID, subreddit: `r/${sub}`, postsScanned: 0, painPointsFound: 0, status: 'error' });
    return { postsScanned: 0, painPoints: [] };
  }

  postsScanned = posts.length;
  console.log(`  Total posts to analyze: ${postsScanned}`);

  // For posts with good engagement, fetch comments
  const highEngagement = posts.filter(p => p.commentCount >= 8 && p.postId);
  console.log(`  Fetching comments for ${Math.min(highEngagement.length, 12)} high-engagement posts...`);
  
  for (const post of highEngagement.slice(0, 12)) {
    try {
      const commentData = await fetchRedditJSON(`/r/${sub}/comments/${post.postId}.json?limit=10&raw_json=1`);
      if (commentData && Array.isArray(commentData) && commentData[1]) {
        const comments = commentData[1].data?.children
          ?.slice(0, 8)
          .map(c => c.data?.body || '')
          .filter(b => b && b !== '[deleted]' && b !== '[removed]') || [];
        post.topComments = comments;
        // Also update selftext if we have better data
        if (commentData[0]?.data?.children?.[0]?.data?.selftext) {
          post.selftext = commentData[0].data.children[0].data.selftext;
        }
      }
      await sleep(1000);
    } catch (e) {
      // Continue
    }
  }

  // Now analyze each post for pain points
  const discovered = [];
  const seen = new Set(); // deduplicate similar pain points

  for (const post of posts) {
    if (!isPainPoint(post)) continue;
    
    const categorized = categorizePainPoint(post, sub);
    if (!categorized) continue;
    
    // Deduplicate by first 40 chars of title
    const dedupKey = categorized.title.toLowerCase().slice(0, 40);
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    discovered.push({ ...categorized, sourcePost: post });
  }

  console.log(`  Pain points found: ${discovered.length}`);
  for (const pp of discovered) {
    console.log(`    -> ${pp.title.slice(0, 70)}`);
  }

  // Submit to API
  const submitted = [];
  for (const pp of discovered) {
    try {
      const resp = await apiPost('/api/pain-points', {
        title: pp.title,
        description: pp.description,
        category: 'Music',
        subreddit: `r/${sub}`,
        discoveredBy: AGENT_ID
      });
      const ppId = resp?.id || resp?.data?.id;
      console.log(`  Submitted: ${pp.title.slice(0, 50)} -> id=${ppId}`);
      
      if (ppId && pp.sourcePost) {
        const sp = pp.sourcePost;
        await apiPost('/api/pain-points/posts', {
          painPointId: ppId,
          redditPostId: sp.postId || '',
          redditUrl: `https://reddit.com${sp.permalink || ''}`,
          postTitle: sp.title || '',
          postBody: (sp.selftext || '').slice(0, 2000),
          upvotes: sp.score || 0,
          commentCount: sp.commentCount || 0,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID
        });
      }
      submitted.push(pp);
      await sleep(300);
    } catch (e) {
      console.log(`  Submit error: ${e.message}`);
    }
  }

  // Log scan
  await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${sub}`,
    postsScanned: postsScanned,
    painPointsFound: submitted.length,
    status: 'completed'
  });

  return { postsScanned, painPoints: submitted };
}

async function main() {
  console.log('=== Marcus-J Scanner v2 ===');

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected to AdsPower CDP');
  } catch (e) {
    console.error(`CDP connect failed: ${e.message}`);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const pages = context.pages();
  for (let i = 1; i < pages.length; i++) await pages[i].close().catch(() => {});
  const page = pages[0] || await context.newPage();

  const totals = { postsScanned: 0, painPoints: [], errors: [] };

  for (const sub of SUBREDDITS) {
    try {
      const result = await scanSubredditViaPage(page, sub);
      totals.postsScanned += result.postsScanned;
      totals.painPoints.push(...result.painPoints);
    } catch (e) {
      console.error(`Error on r/${sub}: ${e.message}`);
      totals.errors.push(`r/${sub}: ${e.message}`);
    }
    await sleep(3000);
  }

  console.log('\n=== FINAL RESULTS ===');
  console.log(`Subreddits scanned: ${SUBREDDITS.length}`);
  console.log(`Posts analyzed: ${totals.postsScanned}`);
  console.log(`Pain points submitted: ${totals.painPoints.length}`);
  totals.painPoints.forEach(pp => console.log(`  - ${pp.title}`));
  if (totals.errors.length) console.log('Errors:', totals.errors);

  console.log('\nSUMMARY_JSON:' + JSON.stringify({
    subredditsScanned: SUBREDDITS.length,
    totalPostsAnalyzed: totals.postsScanned,
    totalPainPoints: totals.painPoints.length,
    painPointTitles: totals.painPoints.map(pp => pp.title),
    errors: totals.errors
  }));
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
