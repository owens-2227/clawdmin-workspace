const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:62260/devtools/browser/d0549843-8e03-41e4-8186-cd1f9a845b0c';
const AGENT_ID = 'marcus-j';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const SUBREDDITS = ['Guitar', 'guitarpedals', 'Blues', 'homerecording'];
const CATEGORY = 'Music';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function submitPainPoint(title, description, subreddit) {
  const result = await apiPost('/api/pain-points', {
    title,
    description,
    category: CATEGORY,
    subreddit: `r/${subreddit}`,
    discoveredBy: AGENT_ID
  });
  console.log(`[pain-point created] id=${result.id} title="${title}"`);
  return result.id;
}

async function submitPost(painPointId, redditPostId, redditUrl, postTitle, postBody, upvotes, commentCount, subreddit) {
  const result = await apiPost('/api/pain-points/posts', {
    painPointId,
    redditPostId,
    redditUrl,
    postTitle,
    postBody: (postBody || '').substring(0, 2000),
    upvotes,
    commentCount,
    subreddit: `r/${subreddit}`,
    discoveredBy: AGENT_ID
  });
  console.log(`[post linked] painPointId=${painPointId} postId=${redditPostId}`);
  return result;
}

async function logScan(subreddit, postsScanned, painPointsFound, status = 'completed') {
  const result = await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned,
    painPointsFound,
    status
  });
  console.log(`[scan logged] r/${subreddit} posts=${postsScanned} painPoints=${painPointsFound}`);
  return result;
}

async function fetchJsonFallback(subreddit) {
  const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=25&raw_json=1`;
  console.log(`[fallback] Fetching JSON for r/${subreddit}`);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
  });
  const data = await res.json();
  return data?.data?.children?.map(c => c.data) || [];
}

async function scanSubreddit(page, subreddit) {
  console.log(`\n=== Scanning r/${subreddit} ===`);
  let posts = [];

  try {
    await page.goto(`https://www.reddit.com/r/${subreddit}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    // Scroll to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    // Try to get post data from page
    const pageContent = await page.content();
    
    // Check for login wall or captcha
    if (pageContent.includes('log in') && pageContent.includes('CAPTCHA') || 
        pageContent.includes('are you human')) {
      console.log(`[warn] r/${subreddit}: CAPTCHA/login wall detected, using JSON fallback`);
      posts = await fetchJsonFallback(subreddit);
    } else {
      // Extract posts using shreddit selectors
      posts = await page.evaluate(() => {
        const results = [];
        
        // Try shreddit post elements
        const postElements = document.querySelectorAll('shreddit-post, [data-testid="post-container"], article');
        
        postElements.forEach(el => {
          try {
            const title = el.querySelector('h1, h2, h3, [slot="title"], .Post__title, a[data-click-id="body"]')?.textContent?.trim() ||
                         el.getAttribute('post-title') || '';
            const score = parseInt(el.getAttribute('score') || el.querySelector('[data-click-id="upvote"]')?.textContent?.replace(/[^0-9]/g, '') || '0');
            const comments = parseInt(el.getAttribute('comment-count') || '0');
            const permalink = el.getAttribute('permalink') || el.querySelector('a[href*="/comments/"]')?.getAttribute('href') || '';
            const id = el.getAttribute('id') || permalink.split('/comments/')[1]?.split('/')[0] || '';
            const body = el.querySelector('.md, [data-testid="post-body"]')?.textContent?.trim() || '';
            
            if (title && title.length > 5) {
              results.push({ title, score, num_comments: comments, permalink, id, selftext: body });
            }
          } catch (e) {}
        });
        
        // Also try anchor-based detection for new Reddit
        if (results.length < 3) {
          const links = document.querySelectorAll('a[href*="/comments/"]');
          const seen = new Set();
          links.forEach(link => {
            const href = link.getAttribute('href');
            const match = href?.match(/\/comments\/([a-z0-9]+)\//);
            if (match && !seen.has(match[1])) {
              seen.add(match[1]);
              const container = link.closest('article, [data-testid], shreddit-post') || link.parentElement;
              const title = link.textContent?.trim() || container?.querySelector('h1,h2,h3')?.textContent?.trim() || '';
              if (title && title.length > 10 && !title.includes('comments')) {
                results.push({
                  title,
                  score: 0,
                  num_comments: 0,
                  permalink: href,
                  id: match[1],
                  selftext: ''
                });
              }
            }
          });
        }
        
        return results;
      });
      
      console.log(`[browser] r/${subreddit}: found ${posts.length} posts from page`);
      
      // Fallback to JSON if too few posts
      if (posts.length < 5) {
        console.log(`[info] Too few posts from browser (${posts.length}), using JSON fallback`);
        posts = await fetchJsonFallback(subreddit);
      }
    }
  } catch (err) {
    console.log(`[error] r/${subreddit} browser error: ${err.message}, using JSON fallback`);
    try {
      posts = await fetchJsonFallback(subreddit);
    } catch (err2) {
      console.log(`[error] JSON fallback also failed: ${err2.message}`);
      await logScan(subreddit, 0, 0, 'error');
      return [];
    }
  }

  console.log(`[info] r/${subreddit}: analyzing ${posts.length} posts`);

  // Analyze posts for pain points
  const painPoints = [];
  let postsAnalyzed = 0;

  for (const post of posts) {
    if (!post.title || post.title.length < 5) continue;
    if (post.stickied || post.pinned) continue;
    if ((post.score || 0) < 5 && posts.length > 10) continue;

    postsAnalyzed++;
    const title = post.title || '';
    const body = post.selftext || '';
    const combined = (title + ' ' + body).toLowerCase();

    // Pain point detection heuristics
    const painSignals = [
      /\b(frustrat|annoy|hate|struggle|pain|difficult|hard|problem|issue|can't figure|stuck|confused)\b/i,
      /\b(is there (an?|any) (app|tool|software|plugin|way|method))\b/i,
      /\b(how do (i|you)|anyone know how|best way to|what('s| is) the best)\b/i,
      /\b(too expensive|can't afford|overpriced|cheaper alternative)\b/i,
      /\b(wish (there was|i could|it had)|would love (a|an|to)|need (a|an) better)\b/i,
      /\b(manual(ly)?|tedious|time.consuming|waste of time)\b/i,
      /\b(can't find|looking for|searching for|recommend)\b/i,
      /\bhelp\b.*\b(with|me|please)\b/i,
      /\bbeginners?\b.*\b(lost|confused|overwhelm)\b/i,
    ];

    const hasPainSignal = painSignals.some(r => r.test(combined));
    if (!hasPainSignal) continue;

    // Skip pure memes/celebrations
    const excludeSignals = [
      /\b(look what (i|my)|just got|check out|GAS|meme|joke|funny|lol|lmao)\b/i,
      /\b(ngd|new guitar day|show off|flex)\b/i,
    ];
    if (excludeSignals.some(r => r.test(combined))) continue;

    const postId = post.id || post.name?.replace('t3_', '') || '';
    const permalink = post.permalink || '';
    const redditUrl = permalink.startsWith('http') ? permalink : `https://reddit.com${permalink}`;
    const upvotes = post.score || post.ups || 0;
    const commentCount = post.num_comments || 0;

    // Build pain point description
    let description = '';
    let ppTitle = '';

    // Guitar-specific pain points
    if (/\b(tab|transcri|learn.*song|song.*learn)\b/i.test(combined)) {
      ppTitle = 'Guitarists struggle to find accurate tabs or transcriptions for specific songs';
      description = 'Many guitarists have difficulty locating reliable, accurate tablature or transcriptions for songs they want to learn. They often rely on user-submitted tabs that contain errors, making the learning process frustrating.';
    } else if (/\b(tone|sound|dial(ing)?|eq|settings)\b.*\b(can't|hard|struggle|help)\b/i.test(combined) ||
               /\b(can't|hard|struggle|help)\b.*\b(tone|sound|dial|eq|settings)\b/i.test(combined)) {
      ppTitle = 'Guitarists struggle to dial in their desired tone from gear';
      description = 'Players frequently find it difficult to translate a tone they hear in their head or on a recording into their own rig. Pedal chains, amp settings, and EQ choices create a complex system that is hard to navigate without guidance.';
    } else if (/\b(pedal|effect|chain|board|order)\b.*\b(confus|help|best|right|wrong)\b/i.test(combined) ||
               /\b(confus|help|best|right|wrong)\b.*\b(pedal|effect|chain|board|order)\b/i.test(combined)) {
      ppTitle = 'Guitarists confused about pedal chain order and signal routing';
      description = 'Signal chain configuration is a common source of confusion for guitarists building a pedalboard. Players often ask about the right order for effects and struggle to understand why certain configurations sound wrong.';
    } else if (/\b(record(ing)?|home studio|daw|interface|latency|monitor)\b.*\b(help|problem|issue|confus|noob|beginner)\b/i.test(combined) ||
               /\b(help|problem|issue|confus|noob|beginner)\b.*\b(record(ing)?|home studio|daw|interface|latency|monitor)\b/i.test(combined)) {
      ppTitle = 'Home recording beginners overwhelmed by audio interface and DAW setup';
      description = 'Musicians new to home recording face a steep learning curve when configuring audio interfaces, choosing DAWs, and dealing with latency. The breadth of choices and technical requirements lead to confusion and frustration.';
    } else if (/\b(budget|cheap|affordable|under \$|best for (the )?price)\b/i.test(combined)) {
      ppTitle = 'Musicians seeking affordable gear recommendations within tight budgets';
      description = 'Budget-constrained musicians struggle to identify quality gear at lower price points. Without reliable guidance, they risk spending on gear that fails to meet their needs or buying something overpriced for their level.';
    } else if (/\b(practice|routine|schedule|progress|improve|plateau)\b.*\b(help|struggle|advice|tips?)\b/i.test(combined) ||
               /\b(help|struggle|advice|tips?)\b.*\b(practice|routine|schedule|progress|improve|plateau)\b/i.test(combined)) {
      ppTitle = 'Guitarists struggling to structure practice routines and track progress';
      description = 'Many guitar players — especially self-taught — lack a structured practice routine and feel stuck in a plateau. They struggle to know what to practice, for how long, and how to measure improvement over time.';
    } else if (/\b(sell|buy|value|worth|price|market)\b.*\b(guitar|pedal|gear|amp)\b/i.test(combined)) {
      ppTitle = 'Musicians struggle to assess fair market value when buying/selling gear';
      description = 'Guitarists and musicians often have difficulty knowing whether a used piece of gear is fairly priced. The secondhand market for instruments and effects is large and opaque, making it easy to overpay or undersell.';
    } else if (/\b(mixing|mastering|mix|master|sound.*good|production)\b.*\b(help|hard|difficult|struggle|beginner|issue)\b/i.test(combined)) {
      ppTitle = 'Home recording musicians struggle with mixing and getting professional-sounding results';
      description = 'Bedroom producers and home recording artists find it hard to achieve a polished, professional-sounding mix. The gap between raw recordings and release-quality audio is a persistent frustration for self-producing musicians.';
    } else if (/\b(blues|improv|scale|lick|solo|phrase|vocab)\b.*\b(help|learn|stuck|struggle|beginner|tips?)\b/i.test(combined)) {
      ppTitle = 'Blues guitarists struggle to develop vocabulary beyond basic scales';
      description = 'Many blues guitar players feel stuck relying on the pentatonic scale and want to develop more expressive vocabulary and phrasing. Moving beyond "noodling" to intentional musical ideas is a widely-shared challenge.';
    } else {
      // Generic pain point from title
      ppTitle = title.length > 80 ? title.substring(0, 77) + '...' : title;
      description = `Recurring problem in r/${subreddit}: ${title}. ${body ? body.substring(0, 200) : 'Community members are seeking solutions or tools to address this issue.'}`;
    }

    // Deduplicate similar titles
    const alreadyHave = painPoints.some(p => p.ppTitle === ppTitle);
    if (alreadyHave) continue;

    painPoints.push({ ppTitle, description, postId, redditUrl, title, body, upvotes, commentCount });
    console.log(`[pain point] "${ppTitle}" (post: "${title.substring(0, 60)}")`);

    await sleep(300);
  }

  // Submit to API
  let submitted = 0;
  for (const pp of painPoints) {
    try {
      const ppId = await submitPainPoint(pp.ppTitle, pp.description, subreddit);
      if (ppId && pp.postId) {
        await submitPost(ppId, pp.postId, pp.redditUrl, pp.title, pp.body, pp.upvotes, pp.commentCount, subreddit);
      }
      submitted++;
      await sleep(500);
    } catch (err) {
      console.log(`[error] Failed to submit pain point: ${err.message}`);
    }
  }

  await logScan(subreddit, postsAnalyzed, submitted);
  return painPoints;
}

async function main() {
  console.log(`[marcus-j scanner] Starting. CDP: ${CDP_URL}`);
  
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('[connected] Browser connected via CDP');
  } catch (err) {
    console.error(`[fatal] Could not connect to CDP: ${err.message}`);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const pages = context.pages();
  
  // Close extra tabs
  for (let i = 1; i < pages.length; i++) {
    try { await pages[i].close(); } catch {}
  }
  const page = pages[0] || await context.newPage();

  const allPainPoints = [];
  const summary = { subredditsScanned: 0, totalPostsAnalyzed: 0, totalPainPoints: 0 };

  for (const sub of SUBREDDITS) {
    try {
      const pps = await scanSubreddit(page, sub);
      allPainPoints.push(...pps);
      summary.subredditsScanned++;
      summary.totalPainPoints += pps.length;
    } catch (err) {
      console.log(`[error] r/${sub} scan failed: ${err.message}`);
      await logScan(sub, 0, 0, 'error');
    }
    // Pace between subreddits
    await sleep(3000);
  }

  // Don't close browser — admin agent handles that
  await browser.close(); // Just disconnect, not close

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${summary.subredditsScanned}`);
  console.log(`Pain points discovered: ${allPainPoints.length}`);
  allPainPoints.forEach((pp, i) => console.log(`  ${i+1}. ${pp.ppTitle}`));

  return summary;
}

main().catch(err => {
  console.error('[fatal]', err);
  process.exit(1);
});
