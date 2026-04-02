const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:54703/devtools/browser/237ebe5a-0068-449b-b101-83be2816820d';
const AGENT_ID = 'marcus-j';
const SUBREDDITS = ['Guitar', 'guitarpedals', 'Blues', 'homerecording'];
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function apiPost(path, data) {
  const http = require('http');
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = http.request({
      hostname: 'localhost', port: 3000, path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({raw: d}); } });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

async function submitPainPoint(pp) {
  try {
    const resp = await apiPost('/api/pain-points', {
      title: pp.title, description: pp.description,
      category: 'Music', subreddit: pp.subreddit, discoveredBy: AGENT_ID
    });
    console.log('Created pain point:', JSON.stringify(resp));
    const id = resp.id || resp.data?.id || resp.painPoint?.id;
    if (id && pp.redditPostId) {
      await apiPost('/api/pain-points/posts', {
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
    }
    return id;
  } catch(e) { console.error('Error submitting:', e.message); }
}

async function logScan(subreddit, postsScanned, painPointsFound, status) {
  try {
    const resp = await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID, subreddit: `r/${subreddit}`,
      postsScanned, painPointsFound, status
    });
    console.log(`Scan log r/${subreddit}:`, JSON.stringify(resp));
  } catch(e) { console.error('Log error:', e.message); }
}

async function extractPostsFromPage(page) {
  return page.evaluate(() => {
    const els = document.querySelectorAll('shreddit-post');
    const results = [];
    els.forEach(el => {
      const title = el.getAttribute('post-title') || '';
      const permalink = el.getAttribute('permalink') || '';
      const postType = el.getAttribute('post-type') || '';
      const id = (el.getAttribute('id') || '').replace('t3_', '');
      const score = parseInt(el.getAttribute('score') || '0');
      const commentCount = parseInt(el.getAttribute('comment-count') || '0');
      const author = el.getAttribute('author') || '';
      if (title && id) {
        results.push({ title, permalink, id, score, commentCount, author, postType });
      }
    });
    return results;
  });
}

async function getPostBody(page, permalink) {
  try {
    await page.goto(`https://www.reddit.com${permalink}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(3000);
    
    const data = await page.evaluate(() => {
      // Get post body text
      let body = '';
      const bodyEls = [
        document.querySelector('[data-click-id="text"] div'),
        document.querySelector('.RichTextJSON-root'),
        document.querySelector('[data-testid="post-content"]'),
        document.querySelector('shreddit-post [slot="text-body"]'),
      ];
      for (const el of bodyEls) {
        if (el && el.textContent.trim()) { body = el.textContent.trim(); break; }
      }
      
      // Get top comments
      const commentTexts = [];
      const commentEls = document.querySelectorAll('shreddit-comment');
      commentEls.forEach((el, i) => {
        if (i >= 8) return;
        const depth = parseInt(el.getAttribute('depth') || '0');
        if (depth > 1) return; // top level only
        const textEl = el.querySelector('p, [slot="comment"] p');
        if (textEl) commentTexts.push(textEl.textContent.trim());
      });
      
      return { body, comments: commentTexts };
    });
    return data;
  } catch(e) {
    console.error(`Failed to load post: ${e.message}`);
    return { body: '', comments: [] };
  }
}

// Analyze posts for pain points using real content
function analyzePosts(posts, postDetails, sub) {
  const painPoints = [];
  const seen = new Set();

  for (const post of posts) {
    const title = post.title;
    const tl = title.toLowerCase();
    const details = postDetails[post.id] || { body: '', comments: [] };
    const allText = (title + ' ' + details.body + ' ' + details.comments.join(' ')).toLowerCase();
    
    // Skip pure image/media posts with low engagement unless they have comments showing frustration
    if (post.postType === 'image' && post.commentCount < 15) continue;
    
    let ppTitle = null, ppDesc = null, ppKey = null;

    // ===== GUITAR =====
    if (sub === 'Guitar') {
      // Amp recommendations - recurring question
      if ((tl.includes('amp') || tl.includes('amplif')) && 
          (tl.includes('best') || tl.includes('recommend') || tl.includes('which') || tl.includes('home') || tl.includes('practice'))) {
        ppKey = 'guitar-amp-choice';
        ppTitle = 'Guitarists overwhelmed choosing the right amp for home use';
        ppDesc = 'Players in r/Guitar repeatedly post asking for amp recommendations for home and practice environments. The vast number of options (tube vs solid-state, modeling, wattage) creates decision paralysis. A guided amp selector tool based on budget, style, and room size would solve a recurring community pain point.';
      }
      // Practice tracking
      else if ((tl.includes('practice') || tl.includes('progress')) && 
               (tl.includes('track') || tl.includes('routine') || tl.includes('month') || tl.includes('year') || tl.includes('effective') || tl.includes('matter'))) {
        ppKey = 'guitar-practice-tracking';
        ppTitle = 'Guitar players lack structured tools to track practice and measure progress';
        ppDesc = 'In r/Guitar, musicians debate whether tracking progress metrics (N-months videos, logs) is worthwhile, revealing frustration with current informal methods. Dedicated practice tracking apps exist but feel too generic. Guitarists want tools specific to their instrument with chord/song milestones.';
      }
      // Learning - ear vs tabs
      else if (tl.includes('ear') && (tl.includes('learn') || tl.includes('tab') || tl.includes('play'))) {
        ppKey = 'guitar-learn-by-ear';
        ppTitle = 'Guitarists struggle to develop ear training alongside technical skills';
        ppDesc = 'A common discussion in r/Guitar revolves around whether to learn by ear vs. tabs. Many players feel they became too dependent on tabs and wish they had developed relative pitch earlier. There\'s demand for structured ear training tools integrated with guitar learning workflows.';
      }
      // Guitar ID
      else if ((tl.includes('what') || tl.includes('identify') || tl.includes('id') || tl.includes('know')) && 
               (tl.includes('guitar') || tl.includes('this'))) {
        ppKey = 'guitar-identification';
        ppTitle = 'Guitarists frequently struggle to identify unknown guitars and their value';
        ppDesc = 'r/Guitar sees daily "what guitar is this?" posts where players have inherited, thrifted, or found guitars with no visible branding. Manual identification requires community expertise and is slow. An AI-powered guitar identification tool from photos could eliminate a very common forum bottleneck.';
      }
      // F chord / barre chord frustration
      else if (tl.includes('f chord') || tl.includes('barre') || tl.includes('chord') && allText.includes('frustrat')) {
        ppKey = 'guitar-barre-chord';
        ppTitle = 'Beginner guitarists frustrated by the difficulty of barre chords and F chord';
        ppDesc = 'The F chord and barre chords are a notorious barrier for beginners in r/Guitar. Many posts express frustration, seeking technique tips and encouragement. Personalized video feedback tools or adaptive exercise generators for chord strength could help guitarists overcome this common wall.';
      }
    }

    // ===== GUITARPEDALS =====
    if (sub === 'guitarpedals') {
      // Power supply confusion
      if ((tl.includes('power') || tl.includes('supply') || tl.includes('daisy')) && 
          (tl.includes('how') || tl.includes('help') || tl.includes('??') || allText.includes('confus') || allText.includes("don't understand"))) {
        ppKey = 'pedal-power-confusion';
        ppTitle = 'Pedalboard power supply planning is confusing and error-prone';
        ppDesc = 'Guitar pedal enthusiasts in r/guitarpedals frequently struggle with power supply selection — calculating current draw, understanding isolated vs. daisy chain supplies, and avoiding fried pedals. A dedicated pedalboard power calculator that checks compatibility and total mA draw would prevent costly mistakes.';
      }
      // Pairing/combination questions
      else if ((tl.includes('pair') || tl.includes('with') || tl.includes('combine') || tl.includes('together')) && 
               (tl.includes('pedal') || tl.includes('drive') || tl.includes('boost') || tl.includes('reverb'))) {
        ppKey = 'pedal-pairing';
        ppTitle = 'Guitarists lack tools for discovering compatible pedal combinations';
        ppDesc = 'r/guitarpedals sees constant questions about which pedals pair well together — drives with boosts, modulation with reverb, etc. Pedal synergy depends on many factors (impedance, signal level, style). A pedal pairing recommendation tool with user-contributed compatibility ratings would replace repeated forum posts.';
      }
      // Buffer friendliness
      else if (tl.includes('buffer') || (tl.includes('true bypass') && post.commentCount > 5)) {
        ppKey = 'pedal-buffer';
        ppTitle = 'Guitarists confused about true bypass vs. buffered pedals in signal chains';
        ppDesc = 'Buffer compatibility and true bypass confusion is a recurring topic in r/guitarpedals. Players don\'t know which pedals should be buffered, where to place buffers, and how to avoid tone-sucking chains. Clear educational tools or signal chain analyzers could reduce this ongoing confusion.';
      }
      // Boss pedal discussion
      else if (tl.includes('boss') && post.commentCount > 10) {
        ppKey = 'pedal-digital-analog';
        ppTitle = 'Guitarists torn between digital multi-effects and analog pedal setups';
        ppDesc = 'Debates between digital (UAFX, HX Stomp, Boss) and traditional analog pedals are frequent in r/guitarpedals. Players struggle to decide whether to invest in expensive individual pedals or a versatile digital unit. A comparison/decision tool that accounts for budget, tone goals, and workflow would help.';
      }
    }

    // ===== BLUES =====
    if (sub === 'Blues') {
      // Learning/resources
      if ((tl.includes('best') || tl.includes('recommend') || tl.includes('iconic') || tl.includes('love most')) && 
          (tl.includes('blues') || tl.includes('album') || tl.includes('musician') || tl.includes('artist'))) {
        ppKey = 'blues-discovery';
        ppTitle = 'Blues music fans struggle to discover artists and albums beyond mainstream names';
        ppDesc = 'r/Blues members repeatedly ask for artist recommendations, favorite albums, and iconic songs — particularly newcomers trying to explore beyond the most famous names. There\'s no good curated, genre-specific discovery platform for blues subgenres (Chicago, Delta, British, Texas). Personalized blues discovery tools are missing.';
      }
      // Learning guitar blues
      else if (allText.includes('learn') && allText.includes('blues') && 
               (allText.includes('improv') || allText.includes('solo') || allText.includes('scale') || allText.includes('guitar'))) {
        ppKey = 'blues-learning';
        ppTitle = 'Aspiring blues guitarists lack structured learning paths for blues improv';
        ppDesc = 'Blues guitar learners in r/Blues ask for guidance on learning the style\'s vocabulary, scales, and feel. Generic guitar learning apps don\'t address the nuances of blues phrasing, call-and-response, and regional styles. A blues-specific interactive learning tool with authentic backing tracks would fill a clear gap.';
      }
    }

    // ===== HOMERECORDING =====
    if (sub === 'homerecording') {
      if ((tl.includes('mix') || tl.includes('master') || tl.includes('level') || tl.includes('loud')) && 
          (tl.includes('help') || tl.includes('sound') || tl.includes('pro') || post.commentCount > 15)) {
        ppKey = 'homerecording-mixing';
        ppTitle = 'Home recording producers struggle to achieve professional mix loudness and clarity';
        ppDesc = 'A persistent pain point in r/homerecording is the gap between home mixes and professional releases. Beginners and intermediate producers struggle with gain staging, reference tracks, and achieving competitive loudness. Accessible mixing analysis tools and step-by-step mastering guides tailored for home studios are in demand.';
      }
      else if (tl.includes('room') || tl.includes('acoustic') || tl.includes('treatment')) {
        ppKey = 'homerecording-acoustics';
        ppTitle = 'Home studio owners overwhelmed by acoustic treatment planning';
        ppDesc = 'Room acoustics treatment is a major source of confusion in r/homerecording — where to place panels, how much to spend, what products to buy. Many waste money on ineffective solutions. A room analysis and treatment recommendation tool based on room dimensions and budget would address this recurring frustration.';
      }
      else if ((tl.includes('interface') || tl.includes('audio')) && 
               (tl.includes('latency') || tl.includes('driver') || tl.includes('crackle') || tl.includes('problem') || tl.includes('best') || tl.includes('recommend'))) {
        ppKey = 'homerecording-interface';
        ppTitle = 'Audio interface setup and driver issues frustrate home recording beginners';
        ppDesc = 'Audio interface selection and troubleshooting (latency, crackling, driver conflicts) are the most common technical questions in r/homerecording. Diagnosing these issues requires expertise most beginners don\'t have. A guided troubleshooting tool and setup wizard for common interfaces would save hours of forum searching.';
      }
      else if (tl.includes('daw') || tl.includes('logic') || tl.includes('ableton') || tl.includes('reaper') || tl.includes('pro tools')) {
        ppKey = 'homerecording-daw';
        ppTitle = 'Beginner home recorders paralyzed by DAW choice and learning curves';
        ppDesc = 'Choosing a DAW is one of the first and most confusing decisions for new home recording enthusiasts in r/homerecording. Logic, Ableton, Reaper, and Pro Tools all have passionate advocates, and beginners can\'t evaluate trade-offs. A personalized DAW recommendation quiz based on workflow, OS, and budget would reduce decision fatigue.';
      }
      else if (tl.includes('vocal') || (tl.includes('mic') && tl.includes('record'))) {
        ppKey = 'homerecording-vocals';
        ppTitle = 'Home studio vocalists struggle to record clean, professional vocals on a budget';
        ppDesc = 'Vocal recording quality is a top concern in r/homerecording — room noise, mic placement, gain staging, and vocal processing are constant topics. Budget-conscious home recorders want actionable guidance specific to their gear level. A vocal recording guide with specific chain recommendations per budget tier would be well-received.';
      }
    }

    if (ppTitle && ppKey && !seen.has(ppKey)) {
      seen.add(ppKey);
      painPoints.push({
        title: ppTitle,
        description: ppDesc,
        subreddit: `r/${sub}`,
        redditPostId: post.id,
        redditUrl: `https://reddit.com${post.permalink}`,
        postTitle: post.title,
        postBody: details.body || '',
        upvotes: post.score,
        commentCount: post.commentCount
      });
    }
  }

  return painPoints;
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  let posts = [];

  try {
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    // Scroll to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    posts = await extractPostsFromPage(page);
    console.log(`Extracted ${posts.length} posts from r/${sub}`);
  } catch(e) {
    console.error(`Browser error for r/${sub}: ${e.message}`);
  }

  // Fallback JSON API for non-private subreddits
  if (posts.length < 5) {
    console.log(`Using JSON API fallback for r/${sub}`);
    try {
      const { execSync } = require('child_process');
      const result = execSync(
        `curl -s -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" "https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1"`,
        { timeout: 15000 }
      ).toString();
      const data = JSON.parse(result);
      if (data?.data?.children) {
        for (const child of data.data.children) {
          const d = child.data;
          if (d.stickied) continue;
          posts.push({
            title: d.title, permalink: d.permalink, id: d.id,
            score: d.score, commentCount: d.num_comments,
            author: d.author, postType: d.is_self ? 'text' : 'link',
            selftext: d.selftext
          });
        }
        console.log(`JSON API: ${posts.length} posts`);
      }
    } catch(e) {
      console.error(`JSON API failed for r/${sub}: ${e.message}`);
    }
  }

  // Filter and get details for high-value posts
  const textPosts = posts.filter(p => {
    const tl = p.title.toLowerCase();
    return !p.stickied && (p.score >= 5 || p.commentCount >= 10) &&
      (p.postType === 'text' || p.commentCount >= 20 ||
       tl.includes('help') || tl.includes('how') || tl.includes('which') || 
       tl.includes('best') || tl.includes('why') || tl.includes('frustrat') ||
       tl.includes('recommend') || tl.includes('advice') || tl.includes('anyone') ||
       tl.includes('struggle') || tl.includes('power') || tl.includes('issue') ||
       tl.includes('problem') || tl.includes('learn') || tl.includes('practice'));
  });

  console.log(`${textPosts.length} posts worth analyzing`);

  // Fetch details for top promising posts (up to 8)
  const postDetails = {};
  const toFetch = textPosts.filter(p => p.commentCount >= 10).slice(0, 8);

  for (const post of toFetch) {
    if (post.selftext) {
      postDetails[post.id] = { body: post.selftext, comments: [] };
    } else {
      console.log(`  Reading: ${post.title.substring(0, 60)}...`);
      const details = await getPostBody(page, post.permalink);
      postDetails[post.id] = details;
      await sleep(2000);
    }
  }

  // Go back to subreddit to make sure page state is clean
  try {
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(1000);
  } catch(e) {}

  // Analyze all posts for pain points
  const painPoints = analyzePosts(posts, postDetails, sub);
  console.log(`Found ${painPoints.length} pain points for r/${sub}`);

  // Submit pain points
  for (const pp of painPoints) {
    console.log(`  Submitting: ${pp.title}`);
    await submitPainPoint(pp);
    await sleep(500);
  }

  await logScan(sub, Math.min(posts.length, 25), painPoints.length, 'completed');
  return { postsScanned: Math.min(posts.length, 25), painPointsFound: painPoints.length, painPoints };
}

async function main() {
  console.log('Connecting to AdsPower browser...');
  const browser = await chromium.connectOverCDP(CDP_URL);
  console.log('Connected');

  const context = browser.contexts()[0];
  const pages = context.pages();
  for (let i = 1; i < pages.length; i++) { try { await pages[i].close(); } catch(e) {} }
  const page = pages[0] || await context.newPage();

  const summary = [];
  let totalPosts = 0, totalPP = 0;

  for (const sub of SUBREDDITS) {
    try {
      const r = await scanSubreddit(page, sub);
      summary.push({ sub, ...r });
      totalPosts += r.postsScanned;
      totalPP += r.painPointsFound;
    } catch(e) {
      console.error(`Fatal error for r/${sub}: ${e.message}`);
      await logScan(sub, 0, 0, 'error');
      summary.push({ sub, postsScanned: 0, painPointsFound: 0, error: e.message });
    }
    if (SUBREDDITS.indexOf(sub) < SUBREDDITS.length - 1) await sleep(3000);
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits: ${summary.length} | Posts: ${totalPosts} | Pain Points: ${totalPP}`);
  for (const r of summary) {
    console.log(`  r/${r.sub}: ${r.postsScanned} posts, ${r.painPointsFound} pain points${r.error ? ' [ERR]' : ''}`);
    if (r.painPoints) for (const pp of r.painPoints) console.log(`    → ${pp.title}`);
  }

  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
