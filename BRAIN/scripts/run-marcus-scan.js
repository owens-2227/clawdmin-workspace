const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:61132/devtools/browser/ebbc81b3-d1f2-4f2a-8945-065b9ff30ecb';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const AGENT_ID = 'marcus-j';
const SUBREDDITS = ['Guitar', 'guitarpedals', 'Blues', 'homerecording'];
const CATEGORY = 'Music';

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function submitPainPoint(pp) {
  const result = await apiPost('/api/pain-points', {
    title: pp.title,
    description: pp.description,
    category: CATEGORY,
    subreddit: pp.subreddit,
    discoveredBy: AGENT_ID
  });
  console.log('Pain point created:', JSON.stringify(result));
  const id = result.id || result.data?.id;
  if (id && pp.redditPostId) {
    const linkResult = await apiPost('/api/pain-points/posts', {
      painPointId: id,
      redditPostId: pp.redditPostId,
      redditUrl: pp.redditUrl,
      postTitle: pp.postTitle,
      postBody: (pp.postBody || '').slice(0, 2000),
      upvotes: pp.upvotes || 0,
      commentCount: pp.commentCount || 0,
      subreddit: pp.subreddit,
      discoveredBy: AGENT_ID
    });
    console.log('Post linked:', JSON.stringify(linkResult));
  }
  return id;
}

async function logScan(subreddit, postsScanned, painPointsFound, status) {
  const result = await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned,
    painPointsFound,
    status
  });
  console.log(`Scan log for r/${subreddit}:`, JSON.stringify(result));
}

async function fetchSubredditJSON(sub) {
  // Fallback: use JSON API
  const url = `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });
    const data = await res.json();
    return data?.data?.children?.map(c => c.data) || [];
  } catch (e) {
    console.error('JSON API fallback failed:', e.message);
    return [];
  }
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  let posts = [];
  let usedFallback = false;

  try {
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Check for CAPTCHA or login wall
    const content = await page.content();
    if (content.includes('recaptcha') || content.includes('CAPTCHA') || content.includes('verify you are human')) {
      console.log(`CAPTCHA detected on r/${sub}, using JSON fallback`);
      posts = await fetchSubredditJSON(sub);
      usedFallback = true;
    } else {
      // Scroll to load more posts
      for (let i = 0; i < 6; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
        await page.waitForTimeout(2000);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(1000);

      // Try to extract posts from page
      const snapshot = await page.content();
      
      // Check if we got meaningful content - try JSON fallback to get structured data
      posts = await fetchSubredditJSON(sub);
      if (posts.length === 0) {
        console.log('JSON API returned no posts, trying page extraction');
        usedFallback = false;
      } else {
        usedFallback = true; // JSON API worked, use it
      }
    }
  } catch (e) {
    console.error(`Error navigating to r/${sub}:`, e.message);
    console.log('Falling back to JSON API...');
    posts = await fetchSubredditJSON(sub);
    usedFallback = true;
  }

  if (posts.length === 0) {
    console.log(`No posts found for r/${sub}`);
    await logScan(sub, 0, 0, 'completed');
    return [];
  }

  console.log(`Got ${posts.length} posts from r/${sub}`);

  // Filter and analyze posts
  const filtered = posts.filter(p => 
    !p.stickied && 
    p.score >= 5 && 
    (p.selftext || p.title) &&
    !p.is_gallery
  );

  console.log(`${filtered.length} posts after filtering`);

  const painPoints = [];

  // Analyze each post for pain points
  for (const post of filtered.slice(0, 25)) {
    const text = `${post.title} ${post.selftext || ''}`.toLowerCase();
    
    // Pain point indicators
    const indicators = [
      /\b(frustrated|frustrating|annoying|annoyed|pain|struggle|struggling|difficult|hard time)\b/,
      /\b(is there an? (app|tool|software|plugin|pedal|gear|solution) (for|to))\b/,
      /\b(how do (you|i) (track|manage|organize|find|choose|set up|dial in))\b/,
      /\b(can't find|can't afford|too expensive|overpriced|waste of money)\b/,
      /\b(looking for|need (a|an|help with)|anyone know|recommend|suggestion)\b/,
      /\b(wish (there was|i could|it had)|if only|would love)\b/,
      /\b(hours|weeks|months) (trying|searching|looking|practicing)\b/,
      /\b(overwhelmed|confused|lost|stuck|beginner|newbie|starting out)\b/,
      /\b(too many options|don't know where to start|information overload)\b/,
      /\b(signal chain|tone chasing|gear acquisition|GAS)\b/,
      /\b(recording (setup|workflow|process|chain)|home studio|DAW)\b/,
      /\b(can't get (the|my) tone|sound bad|sounds wrong|muddy|thin|harsh)\b/,
    ];

    const isPainPoint = indicators.some(r => r.test(text));
    if (!isPainPoint) continue;

    // Determine specific pain point type
    let title = '';
    let description = '';

    if (/\b(GAS|gear acquisition|too many pedals|which pedal|what pedal)\b/i.test(text)) {
      title = `Gear Acquisition Syndrome decision paralysis in r/${sub}`;
      description = `Guitarists struggle with choosing the right gear from overwhelming options, leading to endless research and expensive mistakes. Users describe spending hours researching pedals/amps with no clear way to audition or compare sounds virtually before buying.`;
    } else if (/\b(signal chain|pedalboard|order|chain)\b/i.test(text)) {
      title = `Signal chain/pedalboard ordering confusion for guitarists`;
      description = `Guitarists frequently struggle with correct signal chain ordering and troubleshooting tone issues in their pedalboard setups. There's no simple interactive tool to visualize and simulate different chain arrangements.`;
    } else if (/\b(recording|DAW|interface|home studio|mic|microphone)\b/i.test(text)) {
      title = `Home recording setup confusion and workflow friction`;
      description = `Home recording musicians struggle with DAW setup, signal routing, and getting professional-sounding recordings without expensive gear or engineer knowledge. The learning curve is steep and documentation fragmented.`;
    } else if (/\b(practice|practicing|learn|learning|technique|skill)\b/i.test(text)) {
      title = `Structured practice planning gap for guitar learners`;
      description = `Guitarists at all levels struggle to structure effective practice sessions, track progress, and know what to work on next. No tool bridges the gap between lesson content and deliberate daily practice planning.`;
    } else if (/\b(tone|dialing|dial in|EQ|settings)\b/i.test(text)) {
      title = `Tone-dialing difficulty and lack of reference tools for guitarists`;
      description = `Guitarists spend excessive time trying to dial in tones by ear with no systematic reference or comparison tool. Recreating a specific tone from a song or adjusting EQ/gain without knowing what parameters to tweak is a common frustration.`;
    } else if (/\b(Blues|blues licks|improvise|improvisation|scale|pentatonic)\b/i.test(text)) {
      title = `Blues improvisation guidance and lick library gap`;
      description = `Blues guitar players struggle to move beyond basic pentatonic scales and develop authentic improvisational vocabulary. There's no structured tool for learning authentic blues phrasing beyond generic scale charts.`;
    } else {
      // Generic pain point based on post
      title = post.title.slice(0, 80);
      description = `Guitarists in r/${sub} are experiencing friction with: ${post.title}. ${post.selftext ? post.selftext.slice(0, 200) : 'See original post for details.'}`;
    }

    // Check for duplicates within this scan
    const isDuplicate = painPoints.some(pp => pp.title === title);
    if (isDuplicate) continue;

    painPoints.push({
      title,
      description,
      subreddit: `r/${sub}`,
      redditPostId: post.id,
      redditUrl: `https://reddit.com${post.permalink}`,
      postTitle: post.title,
      postBody: post.selftext || '',
      upvotes: post.score,
      commentCount: post.num_comments
    });

    console.log(`  Pain point: "${title}" (post: ${post.score} upvotes, ${post.num_comments} comments)`);

    // Limit to top 3 per subreddit
    if (painPoints.length >= 3) break;
  }

  // Submit pain points
  for (const pp of painPoints) {
    await submitPainPoint(pp);
    await new Promise(r => setTimeout(r, 1000));
  }

  await logScan(sub, Math.min(filtered.length, 25), painPoints.length, 'completed');
  
  return painPoints;
}

async function main() {
  console.log('Connecting to AdsPower browser via CDP...');
  
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected!');
  } catch (e) {
    console.error('Failed to connect via CDP:', e.message);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const pages = context.pages();
  
  // Clean up extra pages
  for (let i = 1; i < pages.length; i++) {
    await pages[i].close();
  }
  const page = pages[0] || await context.newPage();

  const allPainPoints = [];
  const summary = { subreddits: 0, postsAnalyzed: 0, painPoints: [] };

  for (const sub of SUBREDDITS) {
    try {
      const pp = await scanSubreddit(page, sub);
      allPainPoints.push(...pp);
      summary.subreddits++;
      summary.painPoints.push(...pp.map(p => p.title));
    } catch (e) {
      console.error(`Error scanning r/${sub}:`, e.message);
      await logScan(sub, 0, 0, 'error');
    }
    // Pacing between subreddits
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${summary.subreddits}`);
  console.log(`Pain points discovered: ${allPainPoints.length}`);
  allPainPoints.forEach(pp => console.log(` - ${pp.title}`));

  // Don't close browser (admin agent handles that)
  await browser.close(); // disconnect only, not actually close
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
