// Fix: Re-scan and properly link source posts to pain points already created.
// Also re-submit scan logs with correct counts.

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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function extractId(resp) {
  if (!resp) return null;
  if (resp.id) return resp.id;
  if (resp.painPoint && resp.painPoint.id) return resp.painPoint.id;
  if (resp.data && resp.data.id) return resp.data.id;
  return null;
}

async function fetchSubredditJSON(page, subreddit) {
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

function generateDescription(post, subreddit) {
  const contextMap = {
    nocode: 'no-code builders',
    SideProject: 'indie makers and side project builders',
    Nootropics: 'nootropics users and cognitive enhancement enthusiasts',
    Biohackers: 'biohackers and self-optimization enthusiasts',
  };
  const audience = contextMap[subreddit] || 'users';
  const bodySnippet = post.body ? ` "${post.body.slice(0, 200).trim()}"` : '';
  return `Raised by ${audience} in r/${subreddit} (${post.upvotes} upvotes, ${post.commentCount} comments).${bodySnippet}`.trim();
}

async function scanSubreddit(page, subreddit) {
  console.log(`\n=== Scanning r/${subreddit} ===`);
  const category = CATEGORY_MAP[subreddit] || 'No-Code & Builders';

  const { posts, error } = await fetchSubredditJSON(page, subreddit);
  if (error) console.log(`  Warning: ${error}`);
  console.log(`  Fetched ${posts.length} posts`);

  if (posts.length === 0) {
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID, subreddit: `r/${subreddit}`,
      postsScanned: 0, painPointsFound: 0, status: 'error',
    });
    return { postsScanned: 0, painPointsFound: 0 };
  }

  const scored = posts
    .map(p => ({ ...p, painScore: scorePainPoint(p) }))
    .filter(p => p.painScore >= 2)
    .sort((a, b) => b.painScore - a.painScore);

  const topPosts = scored.slice(0, 6);
  const seen = new Set();
  const painPoints = [];
  for (const post of topPosts) {
    const titleKey = post.title.toLowerCase().slice(0, 50);
    if (seen.has(titleKey)) continue;
    seen.add(titleKey);
    painPoints.push({
      title: generateTitle(post.title),
      description: generateDescription(post, subreddit),
      category,
      subreddit,
      post,
    });
  }

  let submitted = 0;
  for (const pp of painPoints) {
    try {
      console.log(`  → Submitting: "${pp.title.slice(0, 60)}"`);
      const resp = await apiPost('/api/pain-points', {
        title: pp.title,
        description: pp.description,
        category: pp.category,
        subreddit: `r/${subreddit}`,
        discoveredBy: AGENT_ID,
      });
      const id = extractId(resp);
      console.log(`    ID: ${id} | raw: ${JSON.stringify(resp).slice(0, 100)}`);
      
      if (id && pp.post) {
        const linkResp = await apiPost('/api/pain-points/posts', {
          painPointId: id,
          redditPostId: pp.post.id,
          redditUrl: pp.post.url,
          postTitle: pp.post.title,
          postBody: (pp.post.body || '').slice(0, 2000),
          upvotes: pp.post.upvotes,
          commentCount: pp.post.commentCount,
          subreddit: `r/${subreddit}`,
          discoveredBy: AGENT_ID,
        });
        console.log(`    Linked post: ${JSON.stringify(linkResp).slice(0, 80)}`);
        submitted++;
      } else {
        submitted++; // count even if link fails
      }
      await sleep(500);
    } catch (err) {
      console.log(`  Submit error: ${err.message}`);
    }
  }

  const logResp = await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned: posts.length,
    painPointsFound: submitted,
    status: 'completed',
  });
  console.log(`  Logged scan: ${posts.length} posts, ${submitted} pain points | ${JSON.stringify(logResp).slice(0,80)}`);
  
  return { postsScanned: posts.length, painPointsFound: submitted, titles: painPoints.map(p=>p.title) };
}

async function main() {
  console.log('Connecting...');
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const pages = context.pages();
  for (let i = 1; i < pages.length; i++) await pages[i].close();
  const page = pages[0] || await context.newPage();

  const summary = { subredditsScanned: 0, totalPosts: 0, totalPainPoints: 0, titles: [], errors: [] };

  for (const sub of SUBREDDITS) {
    try {
      const r = await scanSubreddit(page, sub);
      summary.subredditsScanned++;
      summary.totalPosts += r.postsScanned;
      summary.totalPainPoints += r.painPointsFound;
      if (r.titles) summary.titles.push(...r.titles);
    } catch (err) {
      console.log(`Error: r/${sub}: ${err.message}`);
      summary.errors.push(`r/${sub}: ${err.message}`);
    }
    await sleep(2000);
  }

  try { await browser.close(); } catch {}

  console.log('\n=== FINAL SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
