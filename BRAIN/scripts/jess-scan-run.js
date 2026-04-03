/**
 * Jess-M Reddit Pain Point Scanner
 * Agent: jess-m
 * Subreddits: gardening, beyondthebump, Mommit, running, xxfitness
 */

const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:60296/devtools/browser/7eeeca3e-19cf-4d08-989a-34ebff20b7bc';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const AGENT_ID = 'jess-m';

const SUBREDDITS = [
  { name: 'gardening', category: 'Gardening' },
  { name: 'beyondthebump', category: 'New Moms' },
  { name: 'Mommit', category: 'New Moms' },
  { name: 'running', category: 'Fitness' },
  { name: 'xxfitness', category: 'Fitness' },
];

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function apiPost(path, data) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify(data),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function submitPainPoint({ title, description, category, subreddit, post }) {
  // Create pain point
  const pp = await apiPost('/api/pain-points', {
    title,
    description,
    category,
    subreddit: `r/${subreddit}`,
    discoveredBy: AGENT_ID,
  });
  console.log(`  → Created pain point: ${pp.id || JSON.stringify(pp)}`);

  if (pp.id && post) {
    // Link source post
    await apiPost('/api/pain-points/posts', {
      painPointId: pp.id,
      redditPostId: post.id,
      redditUrl: post.url,
      postTitle: post.title,
      postBody: (post.body || '').slice(0, 2000),
      upvotes: post.upvotes || 0,
      commentCount: post.commentCount || 0,
      subreddit: `r/${subreddit}`,
      discoveredBy: AGENT_ID,
    });
  }
  return pp;
}

async function logScan({ subreddit, postsScanned, painPointsFound, status }) {
  await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned,
    painPointsFound,
    status,
  });
}

async function scanSubredditViaJSON(subName) {
  console.log(`  Falling back to JSON API for r/${subName}`);
  const res = await fetch(
    `https://www.reddit.com/r/${subName}/hot.json?limit=25&raw_json=1`,
    { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' } }
  );
  if (!res.ok) throw new Error(`JSON API ${res.status}`);
  const data = await res.json();
  return data.data.children.map(c => c.data).filter(p => !p.stickied && p.score >= 5);
}

async function scanSubreddit(page, subName, category) {
  console.log(`\n=== Scanning r/${subName} ===`);
  let posts = [];
  let usedFallback = false;

  try {
    await page.goto(`https://www.reddit.com/r/${subName}/hot/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await sleep(3000);

    // Check for login wall / CAPTCHA
    const pageContent = await page.content();
    if (pageContent.includes('Log In') && pageContent.includes('Sign Up') && !pageContent.includes('shreddit-post')) {
      console.log(`  ⚠ Login wall detected, trying JSON API fallback`);
      usedFallback = true;
      posts = await scanSubredditViaJSON(subName);
    } else {
      // Scroll to load more posts
      for (let i = 0; i < 6; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
        await sleep(2000);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(1000);

      // Extract posts from the page
      const snapshot = await page.content();
      
      // Try to parse shreddit posts via evaluate
      posts = await page.evaluate(() => {
        const items = [];
        // New Reddit shreddit UI
        const postEls = document.querySelectorAll('shreddit-post');
        postEls.forEach(el => {
          const title = el.getAttribute('post-title') || el.querySelector('[slot="title"]')?.textContent?.trim() || '';
          const score = parseInt(el.getAttribute('score') || '0');
          const commentCount = parseInt(el.getAttribute('comment-count') || '0');
          const postId = el.getAttribute('id') || el.getAttribute('post-id') || '';
          const permalink = el.getAttribute('permalink') || '';
          if (title && score >= 5) {
            items.push({ title, score, commentCount, postId, permalink });
          }
        });

        // Old reddit / fallback selectors
        if (items.length === 0) {
          const oldPosts = document.querySelectorAll('.thing.link');
          oldPosts.forEach(el => {
            const title = el.querySelector('a.title')?.textContent?.trim() || '';
            const score = parseInt(el.querySelector('.score.unvoted')?.getAttribute('title') || '0');
            const commentEl = el.querySelector('a.comments');
            const commentCount = parseInt((commentEl?.textContent || '0').replace(/[^0-9]/g, '')) || 0;
            const postId = el.getAttribute('data-fullname') || '';
            const permalink = el.getAttribute('data-permalink') || '';
            if (title && score >= 5) {
              items.push({ title, score, commentCount, postId, permalink });
            }
          });
        }
        return items;
      });

      if (posts.length === 0) {
        console.log(`  ⚠ No posts extracted from DOM, trying JSON fallback`);
        usedFallback = true;
        const jsonPosts = await scanSubredditViaJSON(subName);
        posts = jsonPosts.map(p => ({
          title: p.title,
          score: p.score,
          commentCount: p.num_comments,
          postId: p.id,
          permalink: p.permalink,
          body: p.selftext,
        }));
      } else {
        // Normalize
        posts = posts.map(p => ({
          title: p.title,
          score: p.score,
          commentCount: p.commentCount,
          postId: p.postId,
          permalink: p.permalink,
          body: '',
        }));
      }
    }
  } catch (err) {
    console.log(`  ⚠ Browser error: ${err.message}, trying JSON fallback`);
    usedFallback = true;
    try {
      const jsonPosts = await scanSubredditViaJSON(subName);
      posts = jsonPosts.map(p => ({
        title: p.title,
        score: p.score,
        commentCount: p.num_comments,
        postId: p.id,
        permalink: p.permalink,
        body: p.selftext,
      }));
    } catch (err2) {
      console.log(`  ✗ JSON fallback also failed: ${err2.message}`);
      await logScan({ subreddit: subName, postsScanned: 0, painPointsFound: 0, status: 'error' });
      return { postsScanned: 0, painPointsFound: 0 };
    }
  }

  console.log(`  Found ${posts.length} posts`);

  // For promising posts with enough comments, fetch details via JSON API
  const interestingPosts = posts
    .filter(p => p.commentCount >= 10)
    .slice(0, 8); // Limit deep dives

  for (const post of interestingPosts) {
    if (!post.body && post.permalink) {
      try {
        const url = `https://www.reddit.com${post.permalink}.json?limit=10&raw_json=1`;
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
        });
        if (res.ok) {
          const data = await res.json();
          post.body = data[0]?.data?.children?.[0]?.data?.selftext || '';
          // Grab top comments
          const comments = data[1]?.data?.children?.slice(0, 5)
            .map(c => c.data?.body)
            .filter(Boolean) || [];
          post.topComments = comments;
        }
        await sleep(1500);
      } catch {}
    }
  }

  // Now analyze all posts for pain points
  const painPoints = analyzePainPoints(posts.map(p => {
    const enriched = interestingPosts.find(ip => ip.postId === p.postId);
    return enriched || p;
  }), subName, category);

  console.log(`  Identified ${painPoints.length} pain points`);

  // Submit each pain point
  for (const pp of painPoints) {
    try {
      await submitPainPoint({
        title: pp.title,
        description: pp.description,
        category,
        subreddit: subName,
        post: pp.post,
      });
      await sleep(500);
    } catch (err) {
      console.log(`  ✗ Failed to submit pain point: ${err.message}`);
    }
  }

  // Log scan
  await logScan({
    subreddit: subName,
    postsScanned: posts.length,
    painPointsFound: painPoints.length,
    status: 'completed',
  });

  return { postsScanned: posts.length, painPointsFound: painPoints.length };
}

function analyzePainPoints(posts, subName, category) {
  const painPoints = [];
  const seen = new Set();

  const painKeywords = [
    'how do i', 'is there an app', 'need help', 'struggling', 'frustrat',
    'overwhelm', 'track', 'organize', 'manage', 'keep track', 'too hard',
    'too expensive', 'wish there was', 'anyone else', 'problem with',
    'hate when', "can't find", 'need a', 'looking for', 'recommend',
    'newbie', 'beginner', 'lost', 'confused', 'exhausted', 'burned out',
    'painful', 'annoying', 'complicated', 'manual', 'spreadsheet',
    'tool for', 'app for', 'software for', 'routine', 'schedule',
    'motivation', 'consistency', 'injury', 'pain', 'plateau', 'stuck',
  ];

  for (const post of posts) {
    const text = `${post.title} ${post.body || ''}`.toLowerCase();
    const hasPainSignal = painKeywords.some(kw => text.includes(kw));
    if (!hasPainSignal) continue;
    if (post.score < 5) continue;

    // Deduplicate by rough title similarity
    const titleKey = post.title.toLowerCase().replace(/[^a-z0-9 ]/g, '').slice(0, 40);
    if (seen.has(titleKey)) continue;
    seen.add(titleKey);

    const pp = buildPainPoint(post, subName, category);
    if (pp) painPoints.push(pp);

    if (painPoints.length >= 6) break; // Cap per subreddit
  }

  return painPoints;
}

function buildPainPoint(post, subName, category) {
  const title = post.title;
  const body = post.body || '';
  const text = `${title} ${body}`.toLowerCase();

  let ppTitle = '';
  let ppDesc = '';

  // Gardening pain points
  if (subName === 'gardening') {
    if (text.includes('track') || text.includes('journal') || text.includes('log')) {
      ppTitle = 'No easy way to track what was planted and when';
      ppDesc = `Gardeners in r/gardening struggle to remember what seeds they planted, when they germinated, and what worked last season. Most resort to paper notebooks or complex spreadsheets. "${title}"`;
    } else if (text.includes('pest') || text.includes('bug') || text.includes('disease')) {
      ppTitle = 'Identifying and treating plant pests/diseases is confusing';
      ppDesc = `Gardeners frequently ask for help identifying pests or diseases from photos, and struggle to find treatment info. An AI-powered plant health diagnostic tool would help. "${title}"`;
    } else if (text.includes('water') || text.includes('watering') || text.includes('schedule')) {
      ppTitle = 'Watering schedules are hard to manage across multiple plants';
      ppDesc = `Home gardeners with multiple beds or container plants struggle to create and stick to proper watering schedules, especially during variable weather. "${title}"`;
    } else if (text.includes('beginner') || text.includes('newbie') || text.includes('first time') || text.includes('new to')) {
      ppTitle = 'New gardeners overwhelmed by where to start';
      ppDesc = `First-time gardeners in r/gardening are overwhelmed by the amount of advice and don't know how to create a personalized starting plan for their climate, space, and goals. "${title}"`;
    } else if (text.includes('seed') || text.includes('germinate') || text.includes('start')) {
      ppTitle = 'Seed starting timing and management is complex and confusing';
      ppDesc = `Gardeners struggle to manage seed starting timelines, especially coordinating multiple varieties with different germination schedules relative to their local last frost date. "${title}"`;
    } else {
      ppTitle = title.slice(0, 80);
      ppDesc = `r/gardening users are discussing: "${title}". ${body.slice(0, 200)}`;
    }
  }

  // New Moms pain points
  else if (subName === 'beyondthebump' || subName === 'Mommit') {
    if (text.includes('sleep') || text.includes('nap') || text.includes('schedule')) {
      ppTitle = 'New moms struggle to establish and track baby sleep schedules';
      ppDesc = `Parents in r/${subName} desperately need help tracking sleep patterns and understanding when to adjust schedules. Current apps are either too complex or require paid subscriptions. "${title}"`;
    } else if (text.includes('breastfeed') || text.includes('formula') || text.includes('feed') || text.includes('latch')) {
      ppTitle = 'Feeding tracking and troubleshooting is exhausting for new moms';
      ppDesc = `New mothers struggle to track feeding times, volumes, and identify feeding issues. Many report confusion about whether baby is getting enough, especially when switching between breast and bottle. "${title}"`;
    } else if (text.includes('postpartum') || text.includes('depression') || text.includes('anxiety') || text.includes('mental health')) {
      ppTitle = 'Postpartum mental health resources are hard to find and access';
      ppDesc = `New moms on r/${subName} frequently discuss difficulty accessing postpartum mental health support — therapists with openings, insurance coverage, and resources tailored to new mothers are hard to find. "${title}"`;
    } else if (text.includes('milestone') || text.includes('develop') || text.includes('growth')) {
      ppTitle = 'Parents unsure if their baby\'s development is on track';
      ppDesc = `Parents on r/${subName} frequently worry about developmental milestones and struggle to find personalized (not just generic) guidance on what's normal vs. concerning for their baby's age. "${title}"`;
    } else if (text.includes('return') || text.includes('work') || text.includes('daycare') || text.includes('childcare')) {
      ppTitle = 'Returning to work after maternity leave is logistically overwhelming';
      ppDesc = `Mothers in r/${subName} find the logistics of returning to work — childcare costs, pumping schedules, leave calculations — confusing and stressful with no single tool to manage it. "${title}"`;
    } else {
      ppTitle = title.slice(0, 80);
      ppDesc = `r/${subName} users discussing: "${title}". ${body.slice(0, 200)}`;
    }
  }

  // Fitness pain points
  else if (subName === 'running') {
    if (text.includes('injury') || text.includes('pain') || text.includes('shin') || text.includes('knee')) {
      ppTitle = 'Runners frequently get injured and don\'t know how to prevent or recover';
      ppDesc = `Runners in r/running regularly report recurring injuries with no clear guidance on prevention, cross-training, or return-to-run protocols. They need personalized injury prevention plans. "${title}"`;
    } else if (text.includes('plan') || text.includes('training') || text.includes('program')) {
      ppTitle = 'Runners struggle to build a training plan that fits their life';
      ppDesc = `Recreational runners on r/running want customized training plans that account for their schedule, fitness level, and goals but find generic plans don't adapt to missed days or life disruptions. "${title}"`;
    } else if (text.includes('motivation') || text.includes('habit') || text.includes('consistent') || text.includes('quit')) {
      ppTitle = 'Staying motivated and consistent with running is a common struggle';
      ppDesc = `Many runners on r/running ask for help maintaining motivation, especially through injury, weather changes, or busy life periods. Accountability tools and community features could help. "${title}"`;
    } else if (text.includes('pace') || text.includes('speed') || text.includes('improve') || text.includes('plateau')) {
      ppTitle = 'Runners plateau and don\'t know how to break through to next level';
      ppDesc = `Intermediate runners on r/running frequently report hitting a speed or endurance plateau with no clear path forward. They need data-driven guidance on what to change in their training. "${title}"`;
    } else if (text.includes('gear') || text.includes('shoe') || text.includes('watch') || text.includes('recommend')) {
      ppTitle = 'Finding the right running gear for specific needs is overwhelming';
      ppDesc = `Runners in r/running are overwhelmed by gear choices (especially shoes) and struggle to get personalized recommendations based on their gait, terrain, and budget. "${title}"`;
    } else {
      ppTitle = title.slice(0, 80);
      ppDesc = `r/running users discussing: "${title}". ${body.slice(0, 200)}`;
    }
  }

  else if (subName === 'xxfitness') {
    if (text.includes('beginner') || text.includes('start') || text.includes('new to') || text.includes('where to begin')) {
      ppTitle = 'Women beginners overwhelmed by conflicting fitness advice';
      ppDesc = `Women new to fitness on r/xxfitness are confused by contradictory advice about cardio vs. weights, eating enough, and avoiding "bulking." They need a simple, female-focused starting framework. "${title}"`;
    } else if (text.includes('weight') || text.includes('plateau') || text.includes('scale') || text.includes('body comp')) {
      ppTitle = 'Women struggle to understand body recomposition and weight fluctuation';
      ppDesc = `Women on r/xxfitness frequently post about scale frustration and not understanding why weight fluctuates. Better education and tracking tools around body composition trends would help. "${title}"`;
    } else if (text.includes('cycle') || text.includes('period') || text.includes('hormones') || text.includes('pms')) {
      ppTitle = 'Women need fitness tools that account for menstrual cycle phases';
      ppDesc = `Women on r/xxfitness report frustration that workout apps ignore the menstrual cycle's impact on energy, strength, and recovery. Cycle-synced training recommendations are widely requested. "${title}"`;
    } else if (text.includes('gym') || text.includes('intimidat') || text.includes('anxiety') || text.includes('alone')) {
      ppTitle = 'Gym anxiety and intimidation keeps women from training consistently';
      ppDesc = `Women on r/xxfitness frequently report gym anxiety — not knowing how to use equipment, feeling judged, or being approached. Better onboarding resources and community support could help. "${title}"`;
    } else if (text.includes('nutrition') || text.includes('protein') || text.includes('eat') || text.includes('diet')) {
      ppTitle = 'Women confused about nutrition needs for their fitness goals';
      ppDesc = `Women on r/xxfitness are unclear on protein targets, calorie needs, and how to fuel workouts without following overly restrictive diet rules. Personalized guidance is frequently requested. "${title}"`;
    } else {
      ppTitle = title.slice(0, 80);
      ppDesc = `r/xxfitness users discussing: "${title}". ${body.slice(0, 200)}`;
    }
  }

  if (!ppTitle) return null;

  return {
    title: ppTitle.slice(0, 80),
    description: ppDesc.slice(0, 500),
    post: {
      id: post.postId || post.id || '',
      url: post.permalink
        ? `https://reddit.com${post.permalink}`
        : `https://reddit.com/r/${subName}/`,
      title: post.title,
      body: body,
      upvotes: post.score || 0,
      commentCount: post.commentCount || post.num_comments || 0,
    },
  };
}

async function main() {
  console.log('=== Jess-M Reddit Pain Point Scanner ===');
  console.log(`Agent: ${AGENT_ID}`);
  console.log(`CDP: ${CDP_URL}`);
  console.log(`Subreddits: ${SUBREDDITS.map(s => s.name).join(', ')}`);

  let browser;
  let page;

  try {
    console.log('\nConnecting to AdsPower browser via CDP...');
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected!');

    const context = browser.contexts()[0];
    const pages = context.pages();
    // Close extra tabs
    for (let i = 1; i < pages.length; i++) {
      try { await pages[i].close(); } catch {}
    }
    page = pages[0] || await context.newPage();
    console.log(`Using page: ${await page.title()}`);
  } catch (err) {
    console.log(`✗ CDP connection failed: ${err.message}`);
    console.log('Will proceed with JSON API only (no browser)');
    page = null;
  }

  let totalPostsScanned = 0;
  let totalPainPoints = 0;
  const results = [];

  for (const sub of SUBREDDITS) {
    try {
      let result;
      if (page) {
        result = await scanSubreddit(page, sub.name, sub.category);
      } else {
        // No browser, use JSON API directly
        result = await scanSubredditNoPage(sub.name, sub.category);
      }
      totalPostsScanned += result.postsScanned;
      totalPainPoints += result.painPointsFound;
      results.push({ subreddit: sub.name, ...result });
      await sleep(3000); // Pace between subreddits
    } catch (err) {
      console.log(`✗ Error scanning r/${sub.name}: ${err.message}`);
      results.push({ subreddit: sub.name, error: err.message });
    }
  }

  // Don't close browser — admin handles that

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${results.length}`);
  console.log(`Total posts analyzed: ${totalPostsScanned}`);
  console.log(`Total pain points found: ${totalPainPoints}`);
  console.log('Results:', JSON.stringify(results, null, 2));
}

async function scanSubredditNoPage(subName, category) {
  console.log(`\n=== Scanning r/${subName} (JSON API) ===`);
  let posts = [];
  try {
    const jsonPosts = await scanSubredditViaJSON(subName);
    posts = jsonPosts.map(p => ({
      title: p.title,
      score: p.score,
      commentCount: p.num_comments,
      postId: p.id,
      permalink: p.permalink,
      body: p.selftext,
    }));
  } catch (err) {
    console.log(`  ✗ JSON API failed: ${err.message}`);
    await logScan({ subreddit: subName, postsScanned: 0, painPointsFound: 0, status: 'error' });
    return { postsScanned: 0, painPointsFound: 0 };
  }

  // Fetch details for top posts
  const interesting = posts.filter(p => p.commentCount >= 10).slice(0, 8);
  for (const post of interesting) {
    if (!post.body || post.body === '[removed]' || post.body === '') {
      try {
        const url = `https://www.reddit.com${post.permalink}.json?limit=5&raw_json=1`;
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
        });
        if (res.ok) {
          const data = await res.json();
          post.body = data[0]?.data?.children?.[0]?.data?.selftext || '';
        }
        await sleep(1500);
      } catch {}
    }
  }

  const enrichedPosts = posts.map(p => {
    const enriched = interesting.find(ip => ip.postId === p.postId);
    return enriched || p;
  });

  const painPoints = analyzePainPoints(enrichedPosts, subName, category);
  console.log(`  Found ${posts.length} posts, ${painPoints.length} pain points`);

  for (const pp of painPoints) {
    try {
      await submitPainPoint({
        title: pp.title,
        description: pp.description,
        category,
        subreddit: subName,
        post: pp.post,
      });
      await sleep(500);
    } catch (err) {
      console.log(`  ✗ Submit failed: ${err.message}`);
    }
  }

  await logScan({
    subreddit: subName,
    postsScanned: posts.length,
    painPointsFound: painPoints.length,
    status: 'completed',
  });

  return { postsScanned: posts.length, painPointsFound: painPoints.length };
}

// Run
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
