const { chromium } = require('playwright');
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
      hostname: 'localhost', port: 3000, path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'Content-Length': Buffer.byteLength(body) }
    };
    const req = http.request(options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({ raw: d }); } });
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.write(body); req.end();
  });
}

// Use the browser session (which has Reddit cookies) to fetch JSON
async function fetchViaPage(page, url) {
  try {
    const result = await page.evaluate(async (u) => {
      const resp = await fetch(u, { headers: { 'Accept': 'application/json' } });
      const text = await resp.text();
      return text;
    }, url);
    return JSON.parse(result);
  } catch(e) {
    return null;
  }
}

const PAIN_SIGNALS = [
  'frustrated', 'frustrating', 'annoying', 'hate', 'drives me crazy', 'so hard to',
  'impossible to', 'pain in the', 'waste of time', 'tedious', 'exhausting', 'overwhelming',
  'manually', 'by hand', 'keep track of', 'keep forgetting', 'no way to', 'can\'t find',
  'is there an app', 'is there a tool', 'is there software', 'any app for', 'looking for a way',
  'how do i automate', 'spreadsheet', 'too expensive', 'can\'t afford', 'overpriced',
  'cheaper alternative', 'free version', 'struggling with', 'can\'t figure out',
  'confused about', 'advice on', 'recommendations for', 'anyone else struggle',
  'wish there was', 'should have', 'why doesn\'t', 'would be great if', 'missing feature',
  'help me figure', 'lost with', 'need help', 'help needed'
];

function hasPainSignal(text) {
  const lower = text.toLowerCase();
  return PAIN_SIGNALS.some(s => lower.includes(s));
}

function buildPainPoint(post, sub) {
  const t = post.title.toLowerCase();
  const body = `${post.title} ${post.selftext || ''}`.toLowerCase();

  if (t.includes('pedal') && (t.includes('order') || t.includes('chain') || t.includes('board') || t.includes('organiz') || t.includes('power'))) {
    return {
      title: 'Pedalboard signal chain planning & layout has no dedicated tool',
      description: `Guitarists manually figure out signal chain order, power requirements, and board layouts through trial and error. No dedicated app handles all three. Discovered in r/${sub}: "${post.title.slice(0,100)}"`
    };
  }
  if (t.includes('tone') && (t.includes('match') || t.includes('find') || t.includes('cop') || t.includes('recreat') || t.includes('dial in'))) {
    return {
      title: 'Matching guitar tones from recordings requires guesswork without structured tools',
      description: `Players want to replicate tones they hear but have no systematic way to do it. They randomly cycle through amp/pedal settings or rely on scattered forum posts. Discovered in r/${sub}: "${post.title.slice(0,100)}"`
    };
  }
  if ((t.includes('learn') || t.includes('practice') || t.includes('progress')) && 
      (t.includes('song') || t.includes('chord') || t.includes('scale') || t.includes('solo') || t.includes('technique') || t.includes('routine') || t.includes('track'))) {
    return {
      title: 'Guitarists lack a dedicated tool to track practice and learning progress',
      description: `Players use generic note apps or nothing to manage what they're learning. No purpose-built guitar practice tracker exists for organizing songs, skills, and session goals. Discovered in r/${sub}: "${post.title.slice(0,100)}"`
    };
  }
  if (body.includes('record') && (body.includes('home') || body.includes('studio') || body.includes('daw') || body.includes('interface') || body.includes('mix'))) {
    return {
      title: 'Home recording setup for guitarists is complex with no beginner-friendly workflow guide',
      description: `The home recording journey from "I want to record guitar" to a working setup involves too many decisions (interface, DAW, routing, monitoring). Players feel overwhelmed without a streamlined starting point. Discovered in r/${sub}: "${post.title.slice(0,100)}"`
    };
  }
  if (t.includes('tab') || (t.includes('sheet') && t.includes('music')) || t.includes('notation') || t.includes('transcri')) {
    return {
      title: 'Guitar tabs and sheet music are scattered with no central personal library',
      description: `Guitarists collect tabs from UG, PDFs, YouTube, and handwritten notes with no unified system to organize, annotate, or search. Finding a saved tab for a song they learned months ago is a pain. Discovered in r/${sub}: "${post.title.slice(0,100)}"`
    };
  }
  if (t.includes('sell') || t.includes('buy') || (t.includes('worth') && (t.includes('gear') || t.includes('guitar') || t.includes('pedal'))) || t.includes('fair price') || t.includes('market value')) {
    return {
      title: 'No quick price reference tool for used guitars and gear',
      description: `Buyers and sellers spend hours searching Reverb, eBay, and forums to figure out fair used-gear prices. A dedicated price aggregator for guitar equipment would save significant time. Discovered in r/${sub}: "${post.title.slice(0,100)}"`
    };
  }
  if ((sub === 'Blues' || t.includes('blues')) && (t.includes('improv') || t.includes('lick') || t.includes('theory') || t.includes('pentatonic') || t.includes('bend') || t.includes('feel'))) {
    return {
      title: 'Blues improvisation theory is hard to translate from concepts into actual playing',
      description: `Blues players understand scales and patterns but can't bridge the gap to sounding musical. They need tools for practicing call-and-response, lick vocabulary in context, and building feel — not just abstract theory. Discovered in r/${sub}: "${post.title.slice(0,100)}"`
    };
  }
  if (t.includes('latency') || t.includes('lag') || (t.includes('monitor') && (t.includes('record') || t.includes('headphone')))) {
    return {
      title: 'Recording latency and monitoring configuration frustrates home studio guitarists',
      description: `Home studio musicians struggle with latency when recording guitar — configuring buffer sizes, direct monitoring, and headphone mixes is poorly documented and DAW-specific. Discovered in r/${sub}: "${post.title.slice(0,100)}"`
    };
  }
  if (t.includes('budget') || (t.includes('affordable') && (t.includes('guitar') || t.includes('pedal') || t.includes('amp') || t.includes('gear')))) {
    return {
      title: 'Finding quality budget gear requires extensive research with no consolidated guide',
      description: `Beginning and intermediate players seeking affordable guitars, amps, or pedals have to wade through conflicting forum opinions with no structured comparison tool. Discovered in r/${sub}: "${post.title.slice(0,100)}"`
    };
  }

  // Generic: strong pain signal in title
  if (hasPainSignal(post.title)) {
    const excerpt = post.title.slice(0, 60);
    return {
      title: `Musician pain point: ${excerpt}`.slice(0, 80),
      description: `A r/${sub} member shared a frustration or need: "${post.title}". ${post.selftext ? post.selftext.slice(0, 200) : 'High-engagement post indicates shared pain.'}`
    };
  }
  return null;
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== r/${sub} ===`);
  const results = { postsScanned: 0, painPoints: [] };

  // Navigate subreddit
  try {
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    // Scroll to load posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(1800);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);
  } catch(e) {
    console.log(`  Navigation error: ${e.message}`);
  }

  // Try to get posts via the browser's fetch (uses session cookies)
  console.log('  Fetching posts via browser session...');
  const hotData = await fetchViaPage(page, `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`);
  
  let posts = [];
  if (hotData && hotData.data && hotData.data.children) {
    posts = hotData.data.children
      .filter(p => !p.data.stickied && p.data.score >= 3)
      .map(p => ({
        title: p.data.title,
        score: p.data.score,
        commentCount: p.data.num_comments,
        permalink: p.data.permalink,
        postId: p.data.id,
        selftext: p.data.selftext || '',
        author: p.data.author
      }));
    console.log(`  Got ${posts.length} posts with selftext`);
  } else {
    // Fallback: scrape titles from browser DOM
    console.log('  JSON failed, scraping DOM...');
    posts = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('shreddit-post').forEach(el => {
        const title = el.getAttribute('post-title') || '';
        const score = parseInt(el.getAttribute('score') || '0');
        const commentCount = parseInt(el.getAttribute('comment-count') || '0');
        const permalink = el.getAttribute('permalink') || '';
        const postId = permalink.split('/comments/')[1]?.split('/')[0] || '';
        if (title && score >= 3) results.push({ title, score, commentCount, permalink, postId, selftext: '' });
      });
      return results;
    });
    console.log(`  DOM scraped ${posts.length} posts`);
  }

  if (posts.length === 0) {
    console.log('  No posts found, skipping');
    await apiPost('/api/pain-points/scan-logs', { agentId: AGENT_ID, subreddit: `r/${sub}`, postsScanned: 0, painPointsFound: 0, status: 'error' });
    return results;
  }

  results.postsScanned = posts.length;

  // For high-engagement posts without selftext, click through to get body
  const highEngagement = posts.filter(p => p.commentCount >= 8 && !p.selftext && p.postId);
  console.log(`  Fetching details for ${Math.min(highEngagement.length, 10)} high-engagement posts...`);
  
  for (const post of highEngagement.slice(0, 10)) {
    try {
      const postData = await fetchViaPage(page, `https://www.reddit.com/r/${sub}/comments/${post.postId}.json?limit=8&raw_json=1`);
      if (postData && Array.isArray(postData) && postData[0]?.data?.children?.[0]?.data) {
        const pd = postData[0].data.children[0].data;
        post.selftext = pd.selftext || '';
        const comments = postData[1]?.data?.children
          ?.slice(0, 6)
          .map(c => c.data?.body || '')
          .filter(b => b && b.length > 10 && b !== '[deleted]' && b !== '[removed]') || [];
        post.topComments = comments;
      }
      await sleep(800);
    } catch(e) {}
  }

  // Analyze all posts for pain points
  const seen = new Set();
  for (const post of posts) {
    const allText = `${post.title} ${post.selftext || ''} ${(post.topComments || []).join(' ')}`;
    if (!hasPainSignal(allText) && !hasCategoryMatch(post.title)) continue;
    
    const pp = buildPainPoint(post, sub);
    if (!pp) continue;
    
    const dedupKey = pp.title.toLowerCase().slice(0, 35);
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    
    results.painPoints.push({ ...pp, sourcePost: post });
  }

  console.log(`  Pain points found: ${results.painPoints.length}`);
  results.painPoints.forEach(pp => console.log(`    -> ${pp.title.slice(0, 70)}`));

  // Submit to API
  const submitted = [];
  for (const pp of results.painPoints) {
    const resp = await apiPost('/api/pain-points', {
      title: pp.title,
      description: pp.description,
      category: 'Music',
      subreddit: `r/${sub}`,
      discoveredBy: AGENT_ID
    });
    const ppId = resp?.id || resp?.data?.id;
    console.log(`  -> Submitted id=${ppId}: ${JSON.stringify(resp).slice(0, 120)}`);
    
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
    await sleep(400);
  }

  await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${sub}`,
    postsScanned: results.postsScanned,
    painPointsFound: submitted.length,
    status: 'completed'
  });

  return { postsScanned: results.postsScanned, painPoints: submitted };
}

// Category match: posts that fit our categories even without explicit pain words
function hasCategoryMatch(title) {
  const t = title.toLowerCase();
  return (
    (t.includes('pedal') && (t.includes('order') || t.includes('chain') || t.includes('board'))) ||
    (t.includes('tone') && (t.includes('match') || t.includes('find') || t.includes('dial'))) ||
    (t.includes('learn') && (t.includes('guitar') || t.includes('blues') || t.includes('song'))) ||
    (t.includes('practice') && t.includes('routine')) ||
    (t.includes('home') && t.includes('record')) ||
    (t.includes('budget') && (t.includes('guitar') || t.includes('gear') || t.includes('pedal'))) ||
    t.includes('tab') || t.includes('transcri') ||
    (t.includes('improv') && (t.includes('blues') || t.includes('jazz')))
  );
}

async function main() {
  console.log('=== Marcus-J Scanner v3 ===');
  
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected to AdsPower CDP');
  } catch(e) {
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
      const r = await scanSubreddit(page, sub);
      totals.postsScanned += r.postsScanned;
      totals.painPoints.push(...r.painPoints);
    } catch(e) {
      console.error(`Error on r/${sub}: ${e.message}`);
      totals.errors.push(`r/${sub}: ${e.message}`);
    }
    await sleep(3000);
  }

  console.log('\n=== FINAL ===');
  console.log(`Subreddits: ${SUBREDDITS.length} | Posts: ${totals.postsScanned} | Pain points: ${totals.painPoints.length}`);
  totals.painPoints.forEach(pp => console.log(`  - ${pp.title}`));

  console.log('\nSUMMARY_JSON:' + JSON.stringify({
    subredditsScanned: SUBREDDITS.length,
    totalPostsAnalyzed: totals.postsScanned,
    totalPainPoints: totals.painPoints.length,
    painPointTitles: totals.painPoints.map(pp => pp.title),
    errors: totals.errors
  }));
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
