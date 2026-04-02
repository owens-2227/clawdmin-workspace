const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:54317/devtools/browser/55f6ff62-d156-4211-98a3-16261cf1575f';
const AGENT_ID = 'raj-s';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const SUBREDDITS = ['AnalogCommunity', 'streetphotography', 'MechanicalKeyboards', 'photocritique'];

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

async function submitPainPoint(pp) {
  const result = await apiPost('/api/pain-points', {
    title: pp.title.slice(0, 80),
    description: pp.description,
    category: pp.category,
    subreddit: pp.subreddit,
    discoveredBy: AGENT_ID,
  });
  console.log('Created pain point:', JSON.stringify(result));
  return result;
}

async function submitPost(painPointId, post) {
  const result = await apiPost('/api/pain-points/posts', {
    painPointId,
    redditPostId: post.redditPostId,
    redditUrl: post.redditUrl,
    postTitle: post.postTitle,
    postBody: (post.postBody || '').slice(0, 2000),
    upvotes: post.upvotes,
    commentCount: post.commentCount,
    subreddit: post.subreddit,
    discoveredBy: AGENT_ID,
  });
  console.log('Linked source post:', JSON.stringify(result));
  return result;
}

async function logScan(subreddit, postsScanned, painPointsFound, status) {
  const result = await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned,
    painPointsFound,
    status,
  });
  console.log('Scan log:', JSON.stringify(result));
  return result;
}

async function fetchSubredditJSON(subreddit) {
  const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=25&raw_json=1`;
  console.log(`Fetching JSON: ${url}`);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  const data = await res.json();
  return data?.data?.children?.map(c => c.data) || [];
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function scanSubreddit(page, subreddit) {
  console.log(`\n=== Scanning r/${subreddit} ===`);
  const painPoints = [];
  let posts = [];

  // Try browser first
  try {
    await page.goto(`https://www.reddit.com/r/${subreddit}/hot/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await sleep(3000);

    // Scroll to load posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    // Get page content
    const content = await page.content();
    console.log(`Page length: ${content.length}`);

    // Check if we hit a block/captcha
    if (content.includes('captcha') || content.includes('Are you a robot') || content.length < 5000) {
      console.log('Possible block/captcha, falling back to JSON API');
      posts = await fetchSubredditJSON(subreddit);
    } else {
      // Try to extract posts from the page snapshot
      const snapshot = await page.evaluate(() => {
        const items = [];
        // Try shreddit-post elements (new Reddit)
        const postEls = document.querySelectorAll('shreddit-post');
        for (const el of postEls) {
          const title = el.getAttribute('post-title') || el.querySelector('[slot="title"]')?.textContent?.trim() || '';
          const score = parseInt(el.getAttribute('score') || el.getAttribute('upvotes') || '0', 10);
          const commentCount = parseInt(el.getAttribute('comment-count') || '0', 10);
          const permalink = el.getAttribute('permalink') || '';
          const id = el.getAttribute('id') || permalink.split('/')[4] || '';
          const author = el.getAttribute('author') || '';
          items.push({ title, score, commentCount, permalink, id, author });
        }

        // Fallback: look for article or post wrappers
        if (items.length === 0) {
          const articles = document.querySelectorAll('article');
          for (const art of articles) {
            const titleEl = art.querySelector('h1, h2, h3, [data-testid="post-content"] h3');
            const title = titleEl?.textContent?.trim() || '';
            const scoreEl = art.querySelector('[data-testid="vote-arrows"] span, .score');
            const score = parseInt(scoreEl?.textContent?.trim() || '0', 10) || 0;
            items.push({ title, score, commentCount: 0, permalink: '', id: '' });
          }
        }

        return items;
      });

      console.log(`Browser found ${snapshot.length} posts`);

      if (snapshot.length > 0) {
        posts = snapshot.map(p => ({
          id: p.id,
          title: p.title,
          score: p.score,
          num_comments: p.commentCount,
          permalink: p.permalink,
          selftext: '',
          url: p.permalink ? `https://reddit.com${p.permalink}` : '',
        }));
      } else {
        console.log('Browser extraction yielded 0 posts, falling back to JSON API');
        posts = await fetchSubredditJSON(subreddit);
      }
    }
  } catch (err) {
    console.log(`Browser navigation failed: ${err.message}, falling back to JSON API`);
    posts = await fetchSubredditJSON(subreddit);
  }

  console.log(`Total posts available: ${posts.length}`);

  // Filter posts
  const eligible = posts.filter(p => {
    if (!p.title) return false;
    if (p.score < 5 && p.ups < 5) return false;
    if (p.stickied || p.pinned) return false;
    return true;
  });

  console.log(`Eligible posts: ${eligible.length}`);

  // Analyze each post for pain points
  const categoryMap = {
    AnalogCommunity: 'Photography',
    streetphotography: 'Photography',
    photocritique: 'Photography',
    MechanicalKeyboards: 'Mechanical Keyboards',
  };

  const PAIN_KEYWORDS = [
    'frustrated', 'frustrating', 'annoying', 'annoyed', 'hate', 'struggle', 'struggling',
    'hard to', 'difficult', 'pain', 'problem', 'issue', 'fix', 'broken', 'terrible',
    'wish', 'want', 'need', 'help', 'how do i', 'how do you', 'is there a way',
    'is there an app', 'is there a tool', 'looking for', 'recommend', 'any suggestions',
    'manually', 'time consuming', 'expensive', 'too much', 'can\'t find', 'can\'t afford',
    'not working', 'doesn\'t work', 'stopped working', 'confused', 'confusing',
    'complicated', 'overwhelming', 'why is', 'what am i doing wrong',
  ];

  for (const post of eligible) {
    const titleLower = (post.title || '').toLowerCase();
    const bodyLower = (post.selftext || '').toLowerCase();
    const combined = titleLower + ' ' + bodyLower;

    const matchCount = PAIN_KEYWORDS.filter(kw => combined.includes(kw)).length;
    const hasEnoughComments = (post.num_comments || post.commentCount || 0) >= 5;
    const isQuestion = titleLower.includes('?') || titleLower.startsWith('how') || titleLower.startsWith('why') || titleLower.startsWith('what') || titleLower.startsWith('is there') || titleLower.startsWith('any ');

    if (matchCount >= 1 || (isQuestion && hasEnoughComments)) {
      // This looks like a pain point
      const score = post.score || post.ups || 0;
      const commentCount = post.num_comments || post.commentCount || 0;
      const permalink = post.permalink || '';
      const postId = post.id || (permalink ? permalink.split('/')[4] : '') || '';
      const postUrl = permalink ? `https://reddit.com${permalink}` : (post.url || '');
      const subredditLabel = `r/${subreddit}`;

      // Generate a description from what we have
      const bodySnippet = (post.selftext || '').slice(0, 300).trim();
      let description = `Users in ${subredditLabel} are experiencing: "${post.title.slice(0, 120)}".`;
      if (bodySnippet) description += ` Context: ${bodySnippet.slice(0, 150)}`;
      description += ` (${score} upvotes, ${commentCount} comments)`;

      const pp = {
        title: post.title.slice(0, 80),
        description: description.slice(0, 500),
        category: categoryMap[subreddit] || 'Photography',
        subreddit: subredditLabel,
        redditPostId: postId,
        redditUrl: postUrl,
        postTitle: post.title,
        postBody: post.selftext || '',
        upvotes: score,
        commentCount,
      };

      painPoints.push(pp);
    }
  }

  console.log(`Pain points found: ${painPoints.length}`);

  // Submit pain points
  let submitted = 0;
  for (const pp of painPoints) {
    try {
      const created = await submitPainPoint(pp);
      const painPointId = created?.id || created?.data?.id;
      if (painPointId) {
        await submitPost(painPointId, pp);
      }
      submitted++;
      await sleep(500);
    } catch (err) {
      console.log(`Failed to submit pain point: ${err.message}`);
    }
  }

  // Log scan result
  await logScan(subreddit, eligible.length, submitted, 'completed');

  return { subreddit, postsScanned: eligible.length, painPointsFound: submitted };
}

async function main() {
  console.log('Connecting to AdsPower browser via CDP...');
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected!');
  } catch (err) {
    console.log(`CDP connection failed: ${err.message}`);
    console.log('Will use JSON API fallback for all subreddits');
  }

  const results = [];

  if (browser) {
    const contexts = browser.contexts();
    const context = contexts[0] || await browser.newContext();
    const pages = context.pages();

    // Close extra tabs
    for (let i = 1; i < pages.length; i++) {
      await pages[i].close().catch(() => {});
    }
    const page = pages[0] || await context.newPage();

    for (const subreddit of SUBREDDITS) {
      try {
        const result = await scanSubreddit(page, subreddit);
        results.push(result);
      } catch (err) {
        console.log(`Error scanning ${subreddit}: ${err.message}`);
        await logScan(subreddit, 0, 0, 'error');
        results.push({ subreddit, postsScanned: 0, painPointsFound: 0, error: err.message });
      }
      await sleep(3000);
    }
  } else {
    // No browser connection — use JSON API for all
    const mockPage = null;
    for (const subreddit of SUBREDDITS) {
      try {
        let posts = await fetchSubredditJSON(subreddit);
        console.log(`\n=== Scanning r/${subreddit} (JSON API) === ${posts.length} posts`);

        const categoryMap = {
          AnalogCommunity: 'Photography',
          streetphotography: 'Photography',
          photocritique: 'Photography',
          MechanicalKeyboards: 'Mechanical Keyboards',
        };

        const PAIN_KEYWORDS = [
          'frustrated', 'frustrating', 'annoying', 'struggle', 'hard to', 'difficult',
          'wish', 'want', 'need', 'help', 'how do i', 'how do you', 'is there a way',
          'is there an app', 'is there a tool', 'looking for', 'recommend', 'any suggestions',
          'manually', 'time consuming', 'expensive', 'can\'t find', 'not working', 'confused',
          'complicated', 'overwhelming', 'why is', 'what am i doing wrong',
        ];

        const eligible = posts.filter(p => !p.stickied && p.score >= 5 && p.title);
        const painPoints = [];

        for (const post of eligible) {
          const titleLower = (post.title || '').toLowerCase();
          const bodyLower = (post.selftext || '').toLowerCase();
          const combined = titleLower + ' ' + bodyLower;
          const matchCount = PAIN_KEYWORDS.filter(kw => combined.includes(kw)).length;
          const isQuestion = titleLower.includes('?') || /^(how|why|what|is there|any )/i.test(titleLower);
          const hasEnoughComments = (post.num_comments || 0) >= 5;

          if (matchCount >= 1 || (isQuestion && hasEnoughComments)) {
            const postId = post.id || '';
            const permalink = post.permalink || '';
            const postUrl = permalink ? `https://reddit.com${permalink}` : '';
            const bodySnippet = (post.selftext || '').slice(0, 300).trim();
            let description = `Users in r/${subreddit} are experiencing: "${post.title.slice(0, 120)}".`;
            if (bodySnippet) description += ` Context: ${bodySnippet.slice(0, 150)}`;
            description += ` (${post.score} upvotes, ${post.num_comments} comments)`;

            painPoints.push({
              title: post.title.slice(0, 80),
              description: description.slice(0, 500),
              category: categoryMap[subreddit] || 'Photography',
              subreddit: `r/${subreddit}`,
              redditPostId: postId,
              redditUrl: postUrl,
              postTitle: post.title,
              postBody: post.selftext || '',
              upvotes: post.score,
              commentCount: post.num_comments,
            });
          }
        }

        console.log(`Pain points found: ${painPoints.length}`);
        let submitted = 0;
        for (const pp of painPoints) {
          try {
            const created = await submitPainPoint(pp);
            const painPointId = created?.id || created?.data?.id;
            if (painPointId) {
              await submitPost(painPointId, pp);
            }
            submitted++;
            await sleep(500);
          } catch (err) {
            console.log(`Submit error: ${err.message}`);
          }
        }

        await logScan(subreddit, eligible.length, submitted, 'completed');
        results.push({ subreddit, postsScanned: eligible.length, painPointsFound: submitted });
      } catch (err) {
        console.log(`Error: ${err.message}`);
        await logScan(subreddit, 0, 0, 'error').catch(() => {});
        results.push({ subreddit, postsScanned: 0, painPointsFound: 0, error: err.message });
      }
      await sleep(2000);
    }
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
