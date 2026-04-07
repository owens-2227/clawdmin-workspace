const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:57873/devtools/browser/379ce349-2d9e-4520-b579-89b0553fbb4d';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const AGENT_ID = 'ty-m';
const SUBREDDITS = ['bikecommuting', 'gravelcycling', 'bikewrench', 'fuckcars'];

async function apiPost(path, data) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(data)
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchJson(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await sleep(1500);
  const text = await page.evaluate(() => document.body.innerText);
  return JSON.parse(text);
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  const posts = [];

  // Primary: JSON API
  try {
    const data = await fetchJson(page, `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`);
    const children = data.data?.children || [];
    for (const c of children) {
      const d = c.data;
      if (d.stickied || d.score < 3) continue;
      posts.push({
        title: d.title,
        score: d.score,
        commentCount: d.num_comments,
        permalink: `https://reddit.com${d.permalink}`,
        postId: d.id,
        body: d.selftext || '',
        comments: ''
      });
    }
    console.log(`JSON API: ${posts.length} posts`);
  } catch(e) {
    console.log(`JSON API failed for r/${sub}: ${e.message}`);
  }

  // Fetch bodies/comments for posts with 8+ comments
  const toEnrich = posts.filter(p => p.commentCount >= 8 && !p.body).slice(0, 10);
  for (const post of toEnrich) {
    try {
      const data = await fetchJson(page, `https://www.reddit.com/r/${sub}/comments/${post.postId}.json?limit=10&raw_json=1`);
      post.body = data[0]?.data?.children?.[0]?.data?.selftext || '';
      const comments = (data[1]?.data?.children || [])
        .slice(0, 8)
        .map(c => c.data?.body || '')
        .filter(b => b && b !== '[deleted]' && b !== '[removed]')
        .join('\n---\n');
      post.comments = comments;
    } catch(e) {
      // ignore
    }
    await sleep(1500);
  }

  return posts;
}

function analyzePainPoints(posts, sub) {
  const painKeywords = [
    'frustrat', 'annoying', 'hate', 'problem', 'issue', 'struggle', 'difficult', 'hard to',
    'wish there was', 'wish i could', 'need a way', 'is there an app', 'tool for',
    'any app', 'any tool', 'any software', 'any way to', 'manually', 'tedious',
    'complicated', 'expensive', 'too much', "can't find", 'cant find', 'looking for',
    'recommendation', 'best way to', 'how do you', 'help with', 'advice', 'tips for',
    'overwhelmed', 'confused', 'no idea', "doesn't work", 'broken', 'fails',
    'keeps happening', 'recurring', 'always have to', 'every time',
    'what do you use', 'tracking', 'organize', 'manage', 'plan', 'schedule',
    'where do i', 'where can i', 'should i', 'anyone know', 'anyone use',
    'tried everything', 'not working', 'help me', 'confused about',
    'what app', 'recommend', 'suggestions', 'tips', 'advice needed',
    'maintenance', 'repair', 'fix', 'broken', 'worn out', 'replace',
    'route', 'navigation', 'map', 'planning', 'commute', 'distance',
    'gear', 'setup', 'upgrade', 'component', 'compatibility'
  ];

  const results = [];

  for (const post of posts) {
    const fullText = (post.title + ' ' + post.body + ' ' + post.comments).toLowerCase();
    const matchCount = painKeywords.filter(k => fullText.includes(k)).length;

    // Include if: keyword match + decent engagement, OR high engagement question/discussion
    const isQuestion = /\?|how do|what('s| is)|any(one| recommendations?)|best way|advice|tips/i.test(post.title);
    const isProblem = /problem|issue|frustrat|help|broken|fix|struggle|difficult/i.test(post.title + ' ' + post.body.slice(0, 200));
    const hasEngagement = post.commentCount >= 10 || post.score >= 50;

    if ((matchCount >= 2 && hasEngagement) || (isProblem && hasEngagement) || (isQuestion && post.commentCount >= 15)) {
      results.push({ post, matchCount, isQuestion, isProblem });
    }
  }

  results.sort((a, b) => (b.post.commentCount + b.post.score/10) - (a.post.commentCount + a.post.score/10));
  return results.slice(0, 6);
}

async function main() {
  let browser;
  const summary = { subreddits: [], totalPosts: 0, totalPainPoints: 0, errors: [], painPointTitles: [] };

  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected to AdsPower browser');

    const context = browser.contexts()[0];
    const pages = context.pages();
    for (let i = 1; i < pages.length; i++) {
      try { await pages[i].close(); } catch {}
    }
    const page = pages[0] || await context.newPage();

    for (const sub of SUBREDDITS) {
      const subResult = { sub, postsScanned: 0, painPointsFound: 0, error: null };

      try {
        const posts = await scanSubreddit(page, sub);
        subResult.postsScanned = posts.length;
        summary.totalPosts += posts.length;

        const painPoints = analyzePainPoints(posts, sub);
        console.log(`\nPain points for r/${sub}: ${painPoints.length}`);

        for (const { post } of painPoints) {
          try {
            let desc = post.body ? post.body.slice(0, 500).trim() : '';
            if (!desc || desc === '[removed]' || desc === '[deleted]') desc = '';

            // Build a meaningful description
            let fullDesc = desc
              ? `${desc.slice(0, 400)}${desc.length > 400 ? '...' : ''}`
              : post.title;
            
            // Append comment context if useful
            if (post.comments && post.comments.length > 20) {
              const firstComment = post.comments.split('\n---\n')[0].trim().slice(0, 200);
              if (firstComment) fullDesc += ` | Top comment: "${firstComment}"`;
            }

            const ppData = {
              title: post.title.slice(0, 80),
              description: fullDesc.slice(0, 600),
              category: 'Cycling',
              subreddit: `r/${sub}`,
              discoveredBy: AGENT_ID
            };

            console.log(`  Submitting: ${ppData.title.slice(0, 70)}`);
            const ppRes = await apiPost('/api/pain-points', ppData);
            const ppId = ppRes.painPoint?.id || ppRes.id || ppRes.data?.id;
            console.log(`  API response id: ${ppId}, upserted: ${ppRes.upserted}`);

            if (ppId) {
              const linkRes = await apiPost('/api/pain-points/posts', {
                painPointId: ppId,
                redditPostId: post.postId,
                redditUrl: post.permalink,
                postTitle: post.title,
                postBody: (post.body || '').slice(0, 2000),
                upvotes: post.score,
                commentCount: post.commentCount,
                subreddit: `r/${sub}`,
                discoveredBy: AGENT_ID
              });
              console.log(`  Linked source post: ${JSON.stringify(linkRes).slice(0, 100)}`);
              subResult.painPointsFound++;
              summary.totalPainPoints++;
              summary.painPointTitles.push(`[r/${sub}] ${post.title.slice(0, 60)}`);
            } else {
              console.log(`  WARNING: No ID returned. Full response: ${JSON.stringify(ppRes).slice(0, 200)}`);
            }
          } catch(e) {
            console.log(`  Submit error: ${e.message}`);
          }
          await sleep(500);
        }

      } catch(e) {
        subResult.error = e.message;
        summary.errors.push(`r/${sub}: ${e.message}`);
        console.log(`Error scanning r/${sub}: ${e.message}`);
      }

      // Log scan result
      try {
        const logRes = await apiPost('/api/pain-points/scan-logs', {
          agentId: AGENT_ID,
          subreddit: `r/${sub}`,
          postsScanned: subResult.postsScanned,
          painPointsFound: subResult.painPointsFound,
          status: subResult.error ? 'error' : 'completed'
        });
        console.log(`Scan log: ${JSON.stringify(logRes).slice(0, 100)}`);
      } catch(e) {
        console.log(`Log error: ${e.message}`);
      }

      summary.subreddits.push(subResult);
      await sleep(3000);
    }

  } catch(e) {
    console.error('Fatal:', e.message);
    summary.errors.push(`Fatal: ${e.message}`);
  }

  console.log('\n========== SCAN COMPLETE ==========');
  console.log(`Subreddits: ${summary.subreddits.length}`);
  console.log(`Posts analyzed: ${summary.totalPosts}`);
  console.log(`Pain points submitted: ${summary.totalPainPoints}`);
  console.log('\nPer subreddit:');
  for (const s of summary.subreddits) {
    console.log(`  r/${s.sub}: ${s.postsScanned} posts, ${s.painPointsFound} pain points${s.error ? ` [ERR: ${s.error}]` : ''}`);
  }
  if (summary.painPointTitles.length > 0) {
    console.log('\nPain points submitted:');
    summary.painPointTitles.forEach(t => console.log(`  - ${t}`));
  }
  if (summary.errors.length > 0) {
    console.log('\nErrors:', summary.errors.join('; '));
  }

  console.log('\nSUMMARY_JSON:' + JSON.stringify(summary));
}

main().catch(e => {
  console.error('Unhandled:', e);
  process.exit(1);
});
