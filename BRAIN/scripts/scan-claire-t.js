const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:61512/devtools/browser/952346f0-5b07-4729-bebd-b882a7a30fbb';
const AGENT_ID = 'claire-t';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const SUBREDDITS = [
  { name: 'insomnia', category: 'Sleep & Recovery' },
  { name: 'CBTi', category: 'Sleep & Recovery' },
  { name: 'TMJ', category: 'TMJ & Chronic Pain' },
  { name: 'yinyoga', category: 'Yoga' },
];

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function apiPost(path, body) {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(`API error ${res.status} for ${path}: ${text.slice(0, 200)}`);
      return null;
    }
    return JSON.parse(text);
  } catch (err) {
    console.error(`API fetch error for ${path}: ${err.message}`);
    return null;
  }
}

async function submitPainPoint({ title, description, category, subreddit }) {
  const result = await apiPost('/api/pain-points', {
    title,
    description,
    category,
    subreddit: `r/${subreddit}`,
    discoveredBy: AGENT_ID,
  });
  const id = result?.id || result?.painPoint?.id;
  if (id) {
    console.log(`  ✓ Pain point created: [${id}] ${title}`);
    return id;
  }
  console.error(`  ✗ Failed to create pain point: ${title}`);
  return null;
}

async function linkPost(painPointId, { redditPostId, redditUrl, postTitle, postBody, upvotes, commentCount, subreddit }) {
  const result = await apiPost('/api/pain-points/posts', {
    painPointId,
    redditPostId,
    redditUrl,
    postTitle,
    postBody: (postBody || '').slice(0, 2000),
    upvotes,
    commentCount,
    subreddit: `r/${subreddit}`,
    discoveredBy: AGENT_ID,
  });
  if (result) {
    console.log(`    ↳ Linked source post: ${redditPostId}`);
  }
}

async function logScan({ subreddit, postsScanned, painPointsFound, status }) {
  await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned,
    painPointsFound,
    status,
  });
  console.log(`  📝 Logged scan: ${subreddit} — ${postsScanned} posts, ${painPointsFound} pain points, ${status}`);
}

function isPainPointPost(title, body) {
  const t = (title || '').toLowerCase();
  const b = (body || '').toLowerCase();
  const combined = t + ' ' + b;
  
  // Exclude pure memes/humor/celebrations
  if (t.match(/\b(meme|lol|lmao|haha|😂|😹|🎉)\b/)) return false;

  return (
    /\b(help|struggling|can't|cannot|doesn't work|frustrated|anyone else|is there an? (app|tool)|how do|how to|track|manage|nothing works|tried everything|years?|months?|weeks?|worse|every night|every day|wake up|tired|exhausted|restless|painful|chronic|advice|tips?|recommend|advice|supplements?|treatment|doctor|therapy|dentist|splint|mouthguard|grind|clench|jaw|tmj|pain|stiffness|popping|clicking|insomnia|sleep|cbti|cbt-i|anxiety|stress|burnout|injury|tight|tension|meditation|app|tool|tracker|software|program|course)\b/.test(combined)
  );
}

async function extractPostsFromBrowser(page) {
  return page.evaluate(() => {
    const results = [];
    
    // New Reddit (shreddit-post elements)
    const shredPosts = document.querySelectorAll('shreddit-post');
    if (shredPosts.length > 0) {
      shredPosts.forEach(el => {
        const permalink = el.getAttribute('permalink') || el.getAttribute('content-href') || '';
        const postTitle = el.getAttribute('post-title') || el.querySelector('[slot="title"]')?.textContent?.trim() || '';
        const score = parseInt(el.getAttribute('score') || '0', 10);
        const commentCount = parseInt(el.getAttribute('comment-count') || '0', 10);
        const idMatch = permalink.match(/\/comments\/([a-z0-9]+)\//);
        const postId = idMatch ? idMatch[1] : (el.getAttribute('id') || '');
        const selfText = el.querySelector('[slot="text-body"]')?.textContent?.trim() || '';
        if (postTitle) {
          results.push({ title: postTitle, score, num_comments: commentCount, permalink, id: postId, selftext: selfText, stickied: false });
        }
      });
      return results;
    }
    
    // Old Reddit / fallback
    document.querySelectorAll('.thing.link').forEach(el => {
      const a = el.querySelector('a.title');
      const href = a?.getAttribute('href') || '';
      const postTitle = a?.textContent?.trim() || '';
      const idMatch = el.id?.match(/thing_t3_([a-z0-9]+)/);
      const postId = idMatch ? idMatch[1] : '';
      const score = parseInt(el.querySelector('.score.unvoted')?.getAttribute('title') || '0', 10);
      const commentsA = el.querySelector('a.comments');
      const commentText = commentsA?.textContent || '0';
      const commentCount = parseInt(commentText.match(/\d+/)?.[0] || '0', 10);
      const stickied = el.classList.contains('stickied');
      if (postTitle) {
        results.push({ title: postTitle, score, num_comments: commentCount, permalink: href, id: postId, selftext: '', stickied });
      }
    });
    
    return results;
  });
}

async function scanSubreddit(page, sub, category) {
  console.log(`\n🔍 Scanning r/${sub}...`);
  const painPoints = [];
  let postsScanned = 0;
  let posts = [];

  try {
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    const title = await page.title();
    const url = page.url();
    console.log(`  Page title: "${title}" | URL: ${url}`);

    if (title.toLowerCase().includes('captcha') || title.toLowerCase().includes('just a moment')) {
      console.warn(`  ⚠️ Bot check detected on r/${sub} — trying JSON fallback`);
    } else if (url.includes('/login') || title.toLowerCase().includes('sign in')) {
      console.warn(`  ⚠️ Login wall — r/${sub} may be private`);
    } else {
      // Scroll to load posts
      for (let i = 0; i < 6; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
        await sleep(1500);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(1000);

      posts = await extractPostsFromBrowser(page);
      console.log(`  Browser extracted: ${posts.length} posts`);
    }

    // Fallback to JSON API if browser didn't yield results
    if (posts.length < 3) {
      console.log(`  Using JSON API fallback...`);
      try {
        const res = await fetch(`https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        });
        if (res.ok) {
          const json = await res.json();
          const jsonPosts = (json.data?.children || []).map(c => c.data);
          if (jsonPosts.length > posts.length) {
            posts = jsonPosts;
            console.log(`  JSON API returned ${posts.length} posts`);
          }
        } else {
          const errBody = await res.text().catch(() => '');
          console.log(`  JSON API returned ${res.status}: ${errBody.slice(0, 100)}`);
        }
      } catch (fetchErr) {
        console.log(`  JSON API fetch error: ${fetchErr.message}`);
      }
    }

    // Also try /new if hot is empty
    if (posts.length < 3) {
      console.log(`  Trying /new endpoint...`);
      try {
        const res = await fetch(`https://www.reddit.com/r/${sub}/new.json?limit=25&raw_json=1`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
        });
        if (res.ok) {
          const json = await res.json();
          const newPosts = (json.data?.children || []).map(c => c.data);
          posts = [...posts, ...newPosts];
          console.log(`  /new added ${newPosts.length} posts (total: ${posts.length})`);
        }
      } catch (e) {}
    }

  } catch (err) {
    console.error(`  Navigation error: ${err.message}`);
    // Last resort JSON
    try {
      const res = await fetch(`https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      });
      if (res.ok) {
        const json = await res.json();
        posts = (json.data?.children || []).map(c => c.data);
      }
    } catch (e) {}
  }

  postsScanned = posts.length;
  console.log(`  Total posts to analyze: ${postsScanned}`);

  if (postsScanned === 0) {
    console.log(`  ⚠️ No posts found for r/${sub} — logging as skipped`);
    await logScan({ subreddit: sub, postsScanned: 0, painPointsFound: 0, status: 'skipped' });
    return { postsScanned: 0, painPoints: [] };
  }

  // Analyze posts for pain points
  for (const post of posts) {
    if (!post.title) continue;
    if (post.stickied) continue;
    // Skip very low score on larger subreddits
    if ((post.score || 0) < 3 && postsScanned > 15) continue;

    const body = post.selftext || post.body || '';
    if (!isPainPointPost(post.title, body)) continue;

    // Skip pure emotional venting without actionable angle
    const titleLower = post.title.toLowerCase();
    if (
      (titleLower.includes("i'm so") || titleLower.includes("i feel")) &&
      !body &&
      (post.num_comments || 0) < 5
    ) continue;

    const postId = post.id || '';
    const permalink = post.permalink || '';
    const fullUrl = permalink.startsWith('http') ? permalink : `https://www.reddit.com${permalink}`;

    console.log(`  📌 "${post.title.slice(0, 80)}" (↑${post.score} 💬${post.num_comments})`);

    // Fetch post body if missing and highly engaged
    let postBody = body;
    if (!postBody && (post.num_comments || 0) >= 15 && postId) {
      try {
        await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await sleep(2000);
        postBody = await page.evaluate(() => {
          return (
            document.querySelector('[data-testid="post-content"] .RichTextJSON-root')?.textContent?.trim() ||
            document.querySelector('shreddit-post [slot="text-body"]')?.textContent?.trim() ||
            document.querySelector('.expando .usertext-body')?.textContent?.trim() ||
            ''
          );
        });
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        await sleep(1500);
      } catch (e) {
        // No body, that's fine
      }
    }

    // Build description
    const bodyPreview = postBody ? ` Post body: "${postBody.slice(0, 150).trim()}..."` : '';
    let description = '';
    if (category === 'Sleep & Recovery') {
      description = `r/${sub} user: "${post.title}".${bodyPreview} Sleep sufferers frequently share this type of frustration — tracking, treatment gaps, and finding what works are common needs (${post.num_comments || 0} comments).`;
    } else if (category === 'TMJ & Chronic Pain') {
      description = `r/TMJ user: "${post.title}".${bodyPreview} TMJD sufferers often struggle with diagnosis, tracking symptoms, and finding effective treatment — a recurring pattern across ${post.num_comments || 0} comments.`;
    } else {
      description = `r/${sub} user: "${post.title}".${bodyPreview} Yin yoga practitioners express needs around guidance, sequencing, and tracking progress (${post.num_comments || 0} comments).`;
    }

    // Trim description to reasonable length
    if (description.length > 400) description = description.slice(0, 397) + '...';

    const ppId = await submitPainPoint({
      title: post.title.slice(0, 80),
      description,
      category,
      subreddit: sub,
    });

    if (ppId && postId) {
      await linkPost(ppId, {
        redditPostId: postId,
        redditUrl: fullUrl,
        postTitle: post.title,
        postBody,
        upvotes: post.score || 0,
        commentCount: post.num_comments || 0,
        subreddit: sub,
      });
    }

    if (ppId) painPoints.push(post.title.slice(0, 80));
    await sleep(300);
  }

  await logScan({
    subreddit: sub,
    postsScanned,
    painPointsFound: painPoints.length,
    status: 'completed',
  });

  return { postsScanned, painPoints };
}

async function main() {
  console.log('🚀 Claire-T scanner starting...');
  console.log(`CDP: ${CDP_URL}`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('✅ Connected to AdsPower browser via CDP');
  } catch (err) {
    console.error(`❌ Failed to connect via CDP: ${err.message}`);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  if (!context) {
    console.error('❌ No browser context found');
    await browser.close().catch(() => {});
    process.exit(1);
  }

  const pages = context.pages();
  for (let i = 1; i < pages.length; i++) {
    await pages[i].close().catch(() => {});
  }
  const page = pages[0] || await context.newPage();

  const summary = {
    subredditsScanned: 0,
    totalPostsAnalyzed: 0,
    allPainPoints: [],
    errors: [],
  };

  for (const { name, category } of SUBREDDITS) {
    try {
      const { postsScanned, painPoints } = await scanSubreddit(page, name, category);
      summary.subredditsScanned++;
      summary.totalPostsAnalyzed += postsScanned;
      summary.allPainPoints.push(...painPoints.map(p => `r/${name}: ${p}`));
    } catch (err) {
      console.error(`❌ Error scanning r/${name}: ${err.message}`);
      summary.errors.push(`r/${name}: ${err.message}`);
      try {
        await logScan({ subreddit: name, postsScanned: 0, painPointsFound: 0, status: 'error' });
      } catch (e) {}
    }
    await sleep(2000);
  }

  console.log('\n========== SCAN COMPLETE ==========');
  console.log(`Subreddits scanned: ${summary.subredditsScanned}`);
  console.log(`Total posts analyzed: ${summary.totalPostsAnalyzed}`);
  console.log(`Pain points discovered: ${summary.allPainPoints.length}`);
  summary.allPainPoints.forEach(p => console.log(`  - ${p}`));
  if (summary.errors.length) {
    console.log(`Errors:`);
    summary.errors.forEach(e => console.log(`  ⚠️ ${e}`));
  }

  await browser.close().catch(() => {});

  const output = {
    subredditsScanned: summary.subredditsScanned,
    totalPostsAnalyzed: summary.totalPostsAnalyzed,
    painPointsFound: summary.allPainPoints.length,
    painPoints: summary.allPainPoints,
    errors: summary.errors,
  };
  process.stdout.write('\n__SUMMARY__\n' + JSON.stringify(output, null, 2) + '\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
