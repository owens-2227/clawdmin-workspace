const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:57974/devtools/browser/e34900d6-75a5-47d9-893a-4ffadcfa9f31';
const AGENT_ID = 'priya-k';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const SUBREDDITS = ['Meditation', 'Anxiety', 'therapists', 'Journaling'];

const CATEGORY_MAP = {
  'Meditation': 'Mental Health',
  'Anxiety': 'Mental Health',
  'therapists': 'Therapy',
  'Journaling': 'Journaling',
};

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

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  const painPoints = [];
  let postsScanned = 0;

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

    // Try to get post data from the page
    let posts = await page.evaluate(() => {
      const results = [];
      // Try shreddit-post elements (new Reddit)
      const postEls = document.querySelectorAll('shreddit-post, [data-testid="post-container"]');
      postEls.forEach(el => {
        const title = el.getAttribute('post-title') || el.querySelector('h1,h2,h3,[slot="title"]')?.textContent?.trim() || '';
        const score = parseInt(el.getAttribute('score') || el.getAttribute('upvotes') || '0');
        const commentCount = parseInt(el.getAttribute('comment-count') || '0');
        const permalink = el.getAttribute('permalink') || el.querySelector('a[href*="/comments/"]')?.getAttribute('href') || '';
        const postId = el.getAttribute('id') || permalink.split('/comments/')[1]?.split('/')[0] || '';
        if (title) results.push({ title, score, commentCount, permalink, postId });
      });
      return results;
    });

    if (posts.length < 3) {
      // Fallback: look for links with /comments/ in href
      posts = await page.evaluate(() => {
        const seen = new Set();
        const results = [];
        document.querySelectorAll('a[href*="/comments/"]').forEach(a => {
          const href = a.getAttribute('href');
          if (!href || seen.has(href)) return;
          seen.add(href);
          const title = a.textContent?.trim();
          if (title && title.length > 10) {
            const postId = href.split('/comments/')[1]?.split('/')[0] || '';
            results.push({ title, score: 0, commentCount: 0, permalink: href, postId });
          }
        });
        return results.slice(0, 30);
      });
    }

    if (posts.length < 3) {
      // JSON API fallback
      console.log(`  Using JSON API fallback for r/${sub}`);
      const jsonUrl = `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`;
      await page.goto(jsonUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(2000);
      const jsonText = await page.evaluate(() => document.body.innerText);
      try {
        const data = JSON.parse(jsonText);
        posts = (data.data?.children || []).map(c => ({
          title: c.data.title,
          score: c.data.score,
          commentCount: c.data.num_comments,
          permalink: c.data.permalink,
          postId: c.data.id,
          selftext: c.data.selftext,
          stickied: c.data.stickied,
        })).filter(p => !p.stickied && p.score >= 5);
      } catch (e) {
        console.log(`  JSON parse failed: ${e.message}`);
      }
    }

    console.log(`  Found ${posts.length} posts`);
    postsScanned = posts.length;

    // Filter and analyze posts
    const candidates = posts.filter(p =>
      p.score >= 5 &&
      p.title.length > 10 &&
      !p.stickied
    ).slice(0, 25);

    // For promising posts, click in to read body + comments
    for (const post of candidates) {
      try {
        const fullUrl = post.permalink.startsWith('http')
          ? post.permalink
          : `https://www.reddit.com${post.permalink}`;

        let body = post.selftext || '';
        let topComments = [];

        // Only fetch details for posts with engagement and potentially useful titles
        const titleLower = post.title.toLowerCase();
        const isPainPoint = (
          titleLower.includes('how do') ||
          titleLower.includes('how can') ||
          titleLower.includes('struggling') ||
          titleLower.includes('can\'t') ||
          titleLower.includes('can not') ||
          titleLower.includes('hard to') ||
          titleLower.includes('difficult') ||
          titleLower.includes('help') ||
          titleLower.includes('advice') ||
          titleLower.includes('app') ||
          titleLower.includes('tool') ||
          titleLower.includes('track') ||
          titleLower.includes('organize') ||
          titleLower.includes('manage') ||
          titleLower.includes('frustrated') ||
          titleLower.includes('annoying') ||
          titleLower.includes('wish') ||
          titleLower.includes('best way') ||
          titleLower.includes('any way') ||
          titleLower.includes('tip') ||
          titleLower.includes('habit') ||
          titleLower.includes('routine') ||
          titleLower.includes('consistent') ||
          titleLower.includes('motivation') ||
          titleLower.includes('start') ||
          titleLower.includes('beginner') ||
          titleLower.includes('anxiety') ||
          titleLower.includes('meditat') ||
          titleLower.includes('journal') ||
          titleLower.includes('therapy') ||
          titleLower.includes('therapist')
        );

        if (isPainPoint && post.commentCount >= 5 && !body) {
          await sleep(2500);
          await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await sleep(2000);

          body = await page.evaluate(() => {
            const bodyEl = document.querySelector('[data-testid="post-content"] p, shreddit-post [slot="text-body"], .usertext-body .md');
            return bodyEl?.textContent?.trim() || '';
          });

          topComments = await page.evaluate(() => {
            const comments = [];
            document.querySelectorAll('[data-testid="comment"], shreddit-comment').forEach(el => {
              const text = el.querySelector('p, [slot="comment"]')?.textContent?.trim();
              if (text && text.length > 20) comments.push(text.slice(0, 300));
            });
            return comments.slice(0, 5);
          });
        }

        // Analyze if this is a real pain point worth submitting
        const combinedText = (post.title + ' ' + body + ' ' + topComments.join(' ')).toLowerCase();
        const isActionable = (
          combinedText.includes('app') ||
          combinedText.includes('tool') ||
          combinedText.includes('track') ||
          combinedText.includes('automat') ||
          combinedText.includes('organize') ||
          combinedText.includes('remind') ||
          combinedText.includes('consistent') ||
          combinedText.includes('habit') ||
          combinedText.includes('start') ||
          combinedText.includes('how do') ||
          combinedText.includes('best way') ||
          combinedText.includes('struggling') ||
          combinedText.includes('hard to') ||
          combinedText.includes('difficult') ||
          combinedText.includes('wish there') ||
          combinedText.includes('wish i') ||
          combinedText.includes('can\'t find') ||
          combinedText.includes('looking for') ||
          combinedText.includes('recommend') ||
          combinedText.includes('expensive') ||
          combinedText.includes('complex') ||
          combinedText.includes('complicated') ||
          combinedText.includes('afford') ||
          (sub === 'therapists' && (combinedText.includes('note') || combinedText.includes('session') || combinedText.includes('client') || combinedText.includes('billing') || combinedText.includes('schedule')))
        );

        if (isActionable && isPainPoint) {
          painPoints.push({ post, body: body.slice(0, 2000), topComments });
          console.log(`  ✓ Pain point: "${post.title.slice(0, 70)}"`);
        }
      } catch (e) {
        console.log(`  Error reading post: ${e.message}`);
      }
    }

    // Submit pain points
    let submitted = 0;
    for (const { post, body, topComments } of painPoints) {
      try {
        const description = `${body ? body.slice(0, 300) : post.title}${topComments.length ? ' Top comment: ' + topComments[0]?.slice(0, 200) : ''}`.trim();

        const ppRes = await apiPost('/api/pain-points', {
          title: post.title.slice(0, 80),
          description: description.slice(0, 500) || `User on r/${sub} experiencing: ${post.title.slice(0, 200)}`,
          category: CATEGORY_MAP[sub] || 'Mental Health',
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID,
        });

        console.log(`  Submitted pain point, id=${ppRes.id || ppRes.raw}`);

        if (ppRes.id) {
          const permalink = post.permalink.startsWith('http') ? post.permalink : `https://reddit.com${post.permalink}`;
          await apiPost('/api/pain-points/posts', {
            painPointId: ppRes.id,
            redditPostId: post.postId,
            redditUrl: permalink,
            postTitle: post.title.slice(0, 300),
            postBody: body.slice(0, 2000),
            upvotes: post.score || 0,
            commentCount: post.commentCount || 0,
            subreddit: `r/${sub}`,
            discoveredBy: AGENT_ID,
          });
          submitted++;
        }

        await sleep(1000);
      } catch (e) {
        console.log(`  Error submitting pain point: ${e.message}`);
      }
    }

    // Log scan result
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned,
      painPointsFound: submitted,
      status: 'completed',
    });

    console.log(`  Logged scan: ${postsScanned} posts, ${submitted} pain points`);
    return { sub, postsScanned, painPointsFound: submitted, painPoints: painPoints.map(p => p.post.title) };

  } catch (e) {
    console.log(`  ERROR scanning r/${sub}: ${e.message}`);
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned,
      painPointsFound: 0,
      status: 'error',
    }).catch(() => {});
    return { sub, postsScanned, painPointsFound: 0, error: e.message };
  }
}

async function main() {
  console.log('Connecting to AdsPower CDP...');
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
  } catch (e) {
    console.error('Failed to connect via CDP:', e.message);
    process.exit(1);
  }

  const contexts = browser.contexts();
  const context = contexts[0] || await browser.newContext();

  const pages = context.pages();
  // Close extra tabs, keep one
  for (let i = 1; i < pages.length; i++) {
    try { await pages[i].close(); } catch {}
  }
  const page = pages[0] || await context.newPage();

  console.log('Connected. Starting scan...');

  const results = [];
  for (const sub of SUBREDDITS) {
    const result = await scanSubreddit(page, sub);
    results.push(result);
    await sleep(3000); // pause between subreddits
  }

  // Summary
  console.log('\n=== SCAN COMPLETE ===');
  let totalPosts = 0;
  let totalPainPoints = 0;
  for (const r of results) {
    totalPosts += r.postsScanned;
    totalPainPoints += r.painPointsFound;
    console.log(`r/${r.sub}: ${r.postsScanned} posts, ${r.painPointsFound} pain points${r.error ? ' [ERROR: ' + r.error + ']' : ''}`);
    if (r.painPoints?.length) {
      r.painPoints.forEach(t => console.log(`  - ${t.slice(0, 70)}`));
    }
  }
  console.log(`\nTotal: ${totalPosts} posts scanned, ${totalPainPoints} pain points submitted`);

  // Don't close browser — admin agent handles that
  await browser.close(); // just disconnect from CDP without closing the profile
  process.exit(0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
