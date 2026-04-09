const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:50337/devtools/browser/b95db016-925a-4c97-8e17-92dfc9fdd4ba';
const AGENT_ID = 'marco-v';
const SUBREDDITS = ['nocode', 'Nootropics', 'Biohackers', 'SideProject'];
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const CATEGORY_MAP = {
  nocode: 'No-Code & Builders',
  SideProject: 'No-Code & Builders',
  Nootropics: 'Biohacking',
  Biohackers: 'Biohacking',
};

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function fetchSubredditJSON(page, subreddit) {
  // Use the browser's fetch (goes through AdsPower proxy)
  const result = await page.evaluate(async (sub) => {
    try {
      const res = await fetch(`https://www.reddit.com/r/${sub}/hot.json?limit=50&raw_json=1`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      });
      if (!res.ok) return { error: `HTTP ${res.status}`, posts: [] };
      const data = await res.json();
      if (!data.data || !data.data.children) return { error: 'No data', posts: [] };
      return {
        posts: data.data.children
          .map(c => c.data)
          .filter(p => !p.stickied && p.score >= 3)
          .map(p => ({
            id: p.id,
            title: p.title,
            body: (p.selftext || '').slice(0, 2000),
            upvotes: p.score,
            commentCount: p.num_comments,
            url: `https://reddit.com${p.permalink}`,
            isSelf: p.is_self,
          }))
      };
    } catch (e) {
      return { error: e.message, posts: [] };
    }
  }, subreddit);
  return result;
}

async function fetchPostComments(page, postUrl) {
  try {
    const jsonUrl = postUrl.replace('reddit.com/', 'reddit.com/') + '.json?raw_json=1&limit=10';
    const result = await page.evaluate(async (url) => {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data[1] || !data[1].data || !data[1].data.children) return null;
      return data[1].data.children
        .slice(0, 5)
        .map(c => c.data)
        .filter(c => c.body)
        .map(c => c.body.slice(0, 300))
        .join('\n---\n');
    }, jsonUrl);
    return result;
  } catch {
    return null;
  }
}

async function submitPainPoint({ title, description, category, subreddit, post }) {
  console.log(`  → Submitting: "${title.slice(0, 60)}..."`);
  const pp = await apiPost('/api/pain-points', {
    title,
    description,
    category,
    subreddit: `r/${subreddit}`,
    discoveredBy: AGENT_ID,
  });
  console.log(`    Created ID: ${pp.id || JSON.stringify(pp).slice(0, 80)}`);

  if (pp.id && post) {
    await apiPost('/api/pain-points/posts', {
      painPointId: pp.id,
      redditPostId: post.id,
      redditUrl: post.url,
      postTitle: post.title,
      postBody: (post.body || '').slice(0, 2000),
      upvotes: post.upvotes,
      commentCount: post.commentCount,
      subreddit: `r/${subreddit}`,
      discoveredBy: AGENT_ID,
    });
  }
  return pp.id;
}

async function logScan({ subreddit, postsScanned, painPointsFound, status }) {
  await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned,
    painPointsFound,
    status,
  });
  console.log(`  Logged: r/${subreddit} — ${postsScanned} posts, ${painPointsFound} pain points [${status}]`);
}

const PAIN_PATTERNS = [
  { rx: /is there (an?|any) (app|tool|way|software|plugin|extension|solution|service|method)/i, weight: 3 },
  { rx: /looking for (an?|a) (tool|app|way|solution|software|service|resource|recommendation)/i, weight: 3 },
  { rx: /anyone (know|use|tried|recommend|using|built)/i, weight: 2 },
  { rx: /how (do|can|does) (i|you|we|anyone)\b/i, weight: 2 },
  { rx: /frustrated|annoying|pain in the|struggle with|problem with|issue with/i, weight: 2 },
  { rx: /manually (doing|tracking|entering|managing|copying|updating|creating)/i, weight: 3 },
  { rx: /wish (there was|i could|it would|they had|someone would)/i, weight: 2 },
  { rx: /can't (find|figure|seem to|get)/i, weight: 2 },
  { rx: /too (expensive|complex|complicated|hard|overwhelming)/i, weight: 2 },
  { rx: /automate|automation|workflow|integrate|integration/i, weight: 2 },
  { rx: /what (do|does|should|would) (you|everyone|people)/i, weight: 1 },
  { rx: /best (way|tool|app|method|approach|option)/i, weight: 2 },
  { rx: /help(ing)? me|need (help|advice|suggestions|recommendations)/i, weight: 1 },
  { rx: /spent (hours|days|weeks)|time[- ]consuming|waste of time/i, weight: 2 },
  { rx: /no (good|decent|free|cheap|easy) (tool|app|way|option|solution)/i, weight: 3 },
  { rx: /doesn'?t exist|doesn'?t work|broken|buggy/i, weight: 2 },
];

function scorePainPoint(post) {
  const text = `${post.title} ${post.body || ''}`;
  let score = 0;
  for (const { rx, weight } of PAIN_PATTERNS) {
    if (rx.test(text)) score += weight;
  }
  // Boost for engagement
  if (post.upvotes >= 50) score += 2;
  if (post.upvotes >= 100) score += 2;
  if (post.commentCount >= 20) score += 2;
  if (post.commentCount >= 50) score += 2;
  return score;
}

function generateTitle(postTitle) {
  let title = postTitle.trim().replace(/^\[.+?\]\s*/, '');
  if (title.length > 80) title = title.slice(0, 77) + '...';
  return title;
}

function generateDescription(post, subreddit, comments) {
  const contextMap = {
    nocode: 'no-code builders',
    SideProject: 'indie makers and side project builders',
    Nootropics: 'nootropics users and cognitive enhancement enthusiasts',
    Biohackers: 'biohackers and self-optimization enthusiasts',
  };
  const audience = contextMap[subreddit] || 'users';
  const bodySnippet = post.body ? ` "${post.body.slice(0, 200).trim()}"` : '';
  const commentsSnippet = comments ? ` Community responses: "${comments.slice(0, 150).trim()}"` : '';
  return `Raised by ${audience} in r/${subreddit} (${post.upvotes} upvotes, ${post.commentCount} comments).${bodySnippet}${commentsSnippet}`.trim();
}

async function scanSubreddit(page, subreddit) {
  console.log(`\n=== Scanning r/${subreddit} ===`);
  const category = CATEGORY_MAP[subreddit] || 'No-Code & Builders';

  const { posts, error } = await fetchSubredditJSON(page, subreddit);
  if (error) console.log(`  Warning: ${error}`);
  console.log(`  Fetched ${posts.length} posts`);

  if (posts.length === 0) {
    await logScan({ subreddit, postsScanned: 0, painPointsFound: 0, status: 'error' });
    return { postsScanned: 0, painPointsFound: 0 };
  }

  // Score and rank posts
  const scored = posts
    .map(p => ({ ...p, painScore: scorePainPoint(p) }))
    .filter(p => p.painScore >= 2)
    .sort((a, b) => b.painScore - a.painScore);

  console.log(`  ${scored.length} posts scored as potential pain points`);

  // Fetch comments for top posts
  const topPosts = scored.slice(0, 8);
  for (const post of topPosts) {
    await sleep(1500);
    post.comments = await fetchPostComments(page, post.url);
  }

  // Build pain points from top scored posts, deduplicate similar
  const seen = new Set();
  const painPoints = [];
  for (const post of topPosts.slice(0, 6)) {
    const titleKey = post.title.toLowerCase().slice(0, 50);
    if (seen.has(titleKey)) continue;
    seen.add(titleKey);
    painPoints.push({
      title: generateTitle(post.title),
      description: generateDescription(post, subreddit, post.comments),
      category,
      subreddit,
      post,
    });
  }

  let submitted = 0;
  for (const pp of painPoints) {
    try {
      const id = await submitPainPoint(pp);
      if (id) submitted++;
      await sleep(500);
    } catch (err) {
      console.log(`  Submit error: ${err.message}`);
    }
  }

  await logScan({ subreddit, postsScanned: posts.length, painPointsFound: submitted, status: 'completed' });
  return { postsScanned: posts.length, painPointsFound: submitted, painPointTitles: painPoints.map(p => p.title) };
}

async function main() {
  console.log('Connecting to AdsPower via CDP...');
  const browser = await chromium.connectOverCDP(CDP_URL);
  console.log('Connected!');

  const context = browser.contexts()[0];
  const pages = context.pages();
  for (let i = 1; i < pages.length; i++) await pages[i].close();
  const page = pages[0] || await context.newPage();

  const summary = {
    subredditsScanned: 0,
    totalPostsAnalyzed: 0,
    totalPainPointsFound: 0,
    painPointTitles: [],
    errors: [],
  };

  for (const subreddit of SUBREDDITS) {
    try {
      const result = await scanSubreddit(page, subreddit);
      summary.subredditsScanned++;
      summary.totalPostsAnalyzed += result.postsScanned;
      summary.totalPainPointsFound += result.painPointsFound;
      if (result.painPointTitles) summary.painPointTitles.push(...result.painPointTitles);
    } catch (err) {
      console.log(`Error scanning r/${subreddit}: ${err.message}`);
      summary.errors.push(`r/${subreddit}: ${err.message}`);
      try { await logScan({ subreddit, postsScanned: 0, painPointsFound: 0, status: 'error' }); } catch {}
    }
    await sleep(3000);
  }

  // Disconnect cleanly (don't stop the AdsPower profile)
  try { await browser.close(); } catch {}

  console.log('\n=== SCAN COMPLETE ===');
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

main().then(s => { console.log('Done.'); process.exit(0); })
      .catch(err => { console.error('Fatal:', err); process.exit(1); });
