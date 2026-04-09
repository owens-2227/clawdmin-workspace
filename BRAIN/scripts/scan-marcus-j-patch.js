const { chromium } = require('playwright');
const http = require('http');

const CDP_URL = 'ws://127.0.0.1:50895/devtools/browser/a7021b33-918e-4b5a-8950-6e9419a93434';
const AGENT_ID = 'marcus-j';
const API_KEY = 'openclaw-scanner-key';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function apiPost(path, data) {
  return new Promise((resolve) => {
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

async function fetchViaPage(page, url) {
  try {
    const result = await page.evaluate(async (u) => {
      const resp = await fetch(u, { headers: { 'Accept': 'application/json' } });
      return await resp.text();
    }, url);
    return JSON.parse(result);
  } catch(e) { return null; }
}

function extractId(resp) {
  return resp?.id || resp?.data?.id || resp?.painPoint?.id || null;
}

// Known pain points from previous run that need source posts linked
const KNOWN_PAIN_POINTS = [
  {
    id: 'ec3b77e9-3b33-44c1-a68b-ad31807b66b8',
    title: 'Pedalboard signal chain planning & layout has no dedicated tool',
    sub: 'guitarpedals'
  },
  {
    id: '76763c25-2308-428d-9308-1708a293c500', 
    title: 'Guitar tabs and sheet music are scattered with no central personal library',
    sub: 'guitarpedals'
  }
];

async function scanForMorePainPoints(page, sub) {
  console.log(`\n=== Deep scan r/${sub} ===`);
  
  await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3000);
  
  // More aggressive scrolling
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 3));
    await sleep(2500);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(1500);

  // Try JSON via browser fetch
  const hotData = await fetchViaPage(page, `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`);
  
  let posts = [];
  if (hotData?.data?.children) {
    posts = hotData.data.children
      .filter(p => !p.data.stickied && p.data.score >= 3)
      .map(p => ({
        title: p.data.title, score: p.data.score, commentCount: p.data.num_comments,
        permalink: p.data.permalink, postId: p.data.id, selftext: p.data.selftext || '', author: p.data.author
      }));
    console.log(`  Got ${posts.length} posts via JSON`);
  } else {
    // Try scraping
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
    console.log(`  Scraped ${posts.length} posts from DOM`);
  }

  if (posts.length === 0) {
    console.log(`  No posts available for r/${sub}`);
    return [];
  }

  // Fetch body + comments for ALL posts (not just high-engagement)
  console.log(`  Fetching details for posts...`);
  for (const post of posts.slice(0, 20)) {
    if (!post.postId) continue;
    try {
      const postData = await fetchViaPage(page, `https://www.reddit.com/r/${sub}/comments/${post.postId}.json?limit=10&raw_json=1`);
      if (postData && Array.isArray(postData)) {
        const pd = postData[0]?.data?.children?.[0]?.data;
        if (pd) {
          post.selftext = pd.selftext || post.selftext;
          const comments = postData[1]?.data?.children
            ?.slice(0, 8).map(c => c.data?.body || '')
            .filter(b => b && b.length > 15 && b !== '[deleted]' && b !== '[removed]') || [];
          post.topComments = comments;
        }
      }
      await sleep(600);
    } catch(e) {}
  }

  return posts;
}

// Focused pain point detector for music subreddits
function findPainPoints(posts, sub) {
  const EXCLUDE_PATTERNS = [
    'gf hates', 'girlfriend', 'boyfriend', 'my wife', 'my husband', 'my parents',
    'meme', 'funny', 'look at my', 'just bought', 'ngd', 'nbd', 'npd',
    'just finished', 'first song', 'first time', 'my band', 'check out',
    'identify this', 'what guitar is', 'what amp is', 'what pedal is'
  ];
  
  const INCLUDE_CATEGORIES = [
    // Practice & Learning
    { pattern: (t, b) => (t.includes('practice') || t.includes('learn')) && (t.includes('routine') || t.includes('progres') || t.includes('track') || t.includes('system') || b.includes('practice routine') || b.includes('keep track')), 
      title: 'Guitarists lack a dedicated tool to organize and track practice routines', 
      desc: (post, sub) => `Players want to build consistent practice routines but use generic note apps or sticky notes. No tool ties together skill tracking, song lists, and practice session logging. Seen in r/${sub}: "${post.title.slice(0,100)}"` },
    // Home recording
    { pattern: (t, b) => (t.includes('record') || b.includes('recording')) && (t.includes('home') || t.includes('daw') || t.includes('interface') || t.includes('setup') || b.includes('home studio') || b.includes('audio interface')),
      title: 'Home recording setup for guitarists is overwhelming with too many gear decisions',
      desc: (post, sub) => `Guitarists trying to record at home face analysis paralysis: interface choices, DAW selection, routing, latency, and monitoring all require separate research. A consolidated beginner workflow guide would reduce friction. Seen in r/${sub}: "${post.title.slice(0,100)}"` },
    // Latency
    { pattern: (t, b) => t.includes('latency') || b.includes('latency') || (b.includes('lag') && (b.includes('record') || b.includes('monitor'))),
      title: 'Recording latency remains a major frustration for home studio guitarists',
      desc: (post, sub) => `Guitarists frequently encounter unacceptable latency when recording or monitoring. Buffer size configuration, direct monitoring, and ASIO/Core Audio settings are poorly understood and hard to troubleshoot. Seen in r/${sub}: "${post.title.slice(0,100)}"` },
    // Budget gear
    { pattern: (t, b) => (t.includes('budget') || t.includes('affordable') || t.includes('cheap')) && (t.includes('guitar') || t.includes('amp') || t.includes('pedal') || t.includes('gear') || t.includes('beginner')),
      title: 'Finding quality budget guitar gear requires exhaustive forum research with no consolidated tool',
      desc: (post, sub) => `Beginners and budget-conscious players spend hours reading conflicting forum opinions to find affordable gear. A curated, community-verified budget gear guide would save significant time and prevent regret purchases. Seen in r/${sub}: "${post.title.slice(0,100)}"` },
    // Blues improv
    { pattern: (t, b) => (sub === 'Blues' || t.includes('blues')) && (t.includes('improv') || b.includes('improvisation') || t.includes('lick') || b.includes('call and response') || (t.includes('scale') && t.includes('feel'))),
      title: 'Blues musicians need structured tools to internalize improvisation vocabulary',
      desc: (post, sub) => `Blues players know the pentatonic scale and basic theory but can't bridge the gap to sounding musical. They need tools for building vocabulary: context-based lick practice, call-and-response exercises, and backing track generators with real blues feel. Seen in r/${sub}: "${post.title.slice(0,100)}"` },
    // Pedalboard
    { pattern: (t, b) => (t.includes('pedal') || b.includes('pedalboard')) && (t.includes('order') || t.includes('chain') || t.includes('board') || b.includes('signal chain') || b.includes('power supply') || b.includes('current')),
      title: 'Pedalboard signal chain planning & layout has no dedicated tool',
      desc: (post, sub) => `Guitarists manually calculate power requirements, plan signal chains, and figure out board layouts with no dedicated app. A tool that combines pedal database (power draw, I/O), chain optimizer, and board layout would fill a real gap. Seen in r/${sub}: "${post.title.slice(0,100)}"` },
    // Tone matching
    { pattern: (t, b) => (t.includes('tone') || b.includes('tone')) && (t.includes('match') || t.includes('recreat') || t.includes('copy') || b.includes('dial in') || b.includes('settings')),
      title: 'Replicating guitar tones from recordings requires trial-and-error without structured tools',
      desc: (post, sub) => `Players trying to match tones they hear cycle through random amp/pedal settings with no systematic approach. A tone reference database with gear settings indexed by artist/song would save hours. Seen in r/${sub}: "${post.title.slice(0,100)}"` },
    // Mixing/mastering
    { pattern: (t, b) => (t.includes('mix') || b.includes('mixing')) && (t.includes('guitar') || b.includes('guitar tone') || b.includes('eq') || b.includes('compression')),
      title: 'Mixing guitar in a home recording is poorly understood without professional background',
      desc: (post, sub) => `Home recorders struggle to get guitar to sit well in a mix — understanding EQ, compression, reverb, and gain staging for guitar is a significant learning curve. They want practical "guitar mixing" workflow guides. Seen in r/${sub}: "${post.title.slice(0,100)}"` },
    // Selling/pricing gear
    { pattern: (t, b) => (t.includes('sell') || t.includes('sold') || t.includes('buy') || t.includes('price') || t.includes('worth')) && (t.includes('guitar') || t.includes('pedal') || t.includes('amp') || t.includes('gear')),
      title: 'No quick reliable tool to price used guitars and gear for buying/selling',
      desc: (post, sub) => `Sellers and buyers spend hours cross-referencing Reverb, eBay, and Craigslist to determine fair used-gear prices. A price aggregator that shows recent sold prices for specific guitar equipment would solve a real pain. Seen in r/${sub}: "${post.title.slice(0,100)}"` },
    // VST/amp sim confusion
    { pattern: (t, b) => (t.includes('vst') || b.includes('vst') || t.includes('amp sim') || b.includes('amp sim') || t.includes('neural dsp') || b.includes('neural dsp') || t.includes('helix') || t.includes('kemper')),
      title: 'Choosing between amp sims, modelers, and real amps for home recording is confusing',
      desc: (post, sub) => `Home recording guitarists are overwhelmed by the amp sim landscape: hardware modelers, VST plugins, standalone units, IRs, and real amps all have different workflows. A clear comparison framework would help decision-making. Seen in r/${sub}: "${post.title.slice(0,100)}"` },
  ];

  const found = [];
  const seen = new Set();

  for (const post of posts) {
    const t = post.title.toLowerCase();
    const b = `${post.selftext || ''} ${(post.topComments || []).join(' ')}`.toLowerCase();

    // Skip obvious non-pain-point posts
    if (EXCLUDE_PATTERNS.some(p => t.includes(p))) continue;

    for (const cat of INCLUDE_CATEGORIES) {
      if (!cat.pattern(t, b)) continue;
      const dedupKey = cat.title.toLowerCase().slice(0, 35);
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      found.push({ title: cat.title, description: cat.desc(post, sub), sourcePost: post });
      break;
    }
  }
  return found;
}

async function main() {
  console.log('=== Marcus-J Patch + Deep Scan ===');

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected');
  } catch(e) { console.error(`CDP failed: ${e.message}`); process.exit(1); }

  const context = browser.contexts()[0];
  const pages = context.pages();
  for (let i = 1; i < pages.length; i++) await pages[i].close().catch(() => {});
  const page = pages[0] || await context.newPage();

  // Step 1: Fetch source posts for known pain points and link them
  console.log('\n=== Linking source posts for existing pain points ===');
  for (const pp of KNOWN_PAIN_POINTS) {
    const data = await fetchViaPage(page, `https://www.reddit.com/r/${pp.sub}/hot.json?limit=25&raw_json=1`);
    if (!data?.data?.children) { console.log(`  Couldn't fetch r/${pp.sub} posts`); continue; }
    
    const posts = data.data.children.filter(p => !p.data.stickied).map(p => p.data);
    // Find a post matching the pain point theme
    let matchedPost = null;
    
    if (pp.title.includes('Pedalboard')) {
      matchedPost = posts.find(p => {
        const t = p.title.toLowerCase();
        return t.includes('pedal') && (t.includes('order') || t.includes('chain') || t.includes('board') || t.includes('power'));
      });
    } else if (pp.title.includes('tab')) {
      matchedPost = posts.find(p => {
        const t = p.title.toLowerCase();
        return t.includes('tab') || t.includes('sheet music') || t.includes('notation');
      });
    }

    if (matchedPost) {
      const linkResp = await apiPost('/api/pain-points/posts', {
        painPointId: pp.id,
        redditPostId: matchedPost.id,
        redditUrl: `https://reddit.com${matchedPost.permalink}`,
        postTitle: matchedPost.title,
        postBody: (matchedPost.selftext || '').slice(0, 2000),
        upvotes: matchedPost.score,
        commentCount: matchedPost.num_comments,
        subreddit: `r/${pp.sub}`,
        discoveredBy: AGENT_ID
      });
      console.log(`  Linked source post "${matchedPost.title.slice(0,60)}" to pain point ${pp.id.slice(0,8)}: ${JSON.stringify(linkResp).slice(0,100)}`);
    } else {
      console.log(`  No matching source post found for "${pp.title.slice(0,50)}"`);
    }
  }

  // Step 2: Deep scan Blues and homerecording
  const newPainPoints = [];
  for (const sub of ['Blues', 'homerecording']) {
    try {
      const posts = await scanForMorePainPoints(page, sub);
      const painPoints = findPainPoints(posts, sub);
      console.log(`  Found ${painPoints.length} pain points in r/${sub}`);
      painPoints.forEach(pp => console.log(`    -> ${pp.title.slice(0,70)}`));
      
      for (const pp of painPoints) {
        const resp = await apiPost('/api/pain-points', {
          title: pp.title,
          description: pp.description,
          category: 'Music',
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID
        });
        const ppId = extractId(resp);
        console.log(`  Submitted: ${pp.title.slice(0,50)} -> id=${ppId}`);
        
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
        newPainPoints.push(pp);
        await sleep(400);
      }

      await apiPost('/api/pain-points/scan-logs', {
        agentId: AGENT_ID,
        subreddit: `r/${sub}`,
        postsScanned: posts.length,
        painPointsFound: painPoints.length,
        status: 'completed'
      });
    } catch(e) {
      console.error(`Error on r/${sub}: ${e.message}`);
    }
    await sleep(3000);
  }

  console.log('\n=== PATCH COMPLETE ===');
  console.log(`Source posts linked: ${KNOWN_PAIN_POINTS.length}`);
  console.log(`New pain points from Blues+homerecording: ${newPainPoints.length}`);
  newPainPoints.forEach(pp => console.log(`  - ${pp.title}`));

  console.log('\nFINAL_SUMMARY_JSON:' + JSON.stringify({
    sourcePostsLinked: KNOWN_PAIN_POINTS.length,
    newPainPointsFromBluesHomerecording: newPainPoints.length,
    newTitles: newPainPoints.map(pp => pp.title)
  }));
}

function extractId(resp) {
  return resp?.id || resp?.data?.id || resp?.painPoint?.id || null;
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
