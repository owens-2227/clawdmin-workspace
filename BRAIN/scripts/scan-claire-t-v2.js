/**
 * Reddit Pain Point Scanner — claire-t v2
 * Subreddits: insomnia, CBTi, TMJ, yinyoga
 * Fixed: API ID extraction (painPoint.id), browser-first approach
 */

const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:50609/devtools/browser/a31005de-f071-4f9d-8679-a109aaeb5cdd';
const AGENT_ID = 'claire-t';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const SUBREDDITS = ['insomnia', 'CBTi', 'TMJ', 'yinyoga'];

const CATEGORY_MAP = {
  insomnia: 'Sleep & Recovery',
  CBTi: 'Sleep & Recovery',
  TMJ: 'TMJ & Chronic Pain',
  yinyoga: 'Yoga',
};

async function sleep(ms) {
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

function extractId(res) {
  // API wraps response as { painPoint: { id: ... } }
  return res?.painPoint?.id || res?.id || res?.data?.id || null;
}

async function getPostsViaJson(sub) {
  const url = `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    });
    if (!res.ok) { console.log(`JSON API HTTP ${res.status} for r/${sub}`); return []; }
    const data = await res.json();
    return (data?.data?.children || []).map(c => c.data);
  } catch (e) {
    console.log(`JSON API error for r/${sub}: ${e.message}`);
    return [];
  }
}

async function extractPostsFromPage(page) {
  return page.evaluate(() => {
    const results = [];
    // shreddit-post custom elements
    const shreddits = document.querySelectorAll('shreddit-post');
    shreddits.forEach(el => {
      const title = el.getAttribute('post-title') || el.querySelector('[slot="title"]')?.textContent?.trim();
      const score = parseInt(el.getAttribute('score') || '0');
      const comments = parseInt(el.getAttribute('comment-count') || '0');
      const permalink = el.getAttribute('permalink') || '';
      const postId = el.getAttribute('id') || permalink.match(/\/comments\/([a-z0-9]+)\//i)?.[1] || '';
      if (title && permalink) {
        results.push({ title, score, comments, url: `https://www.reddit.com${permalink}`, postId, selftext: '' });
      }
    });

    if (results.length > 0) return results;

    // Fallback: data-testid articles
    const articles = document.querySelectorAll('[data-testid="post-container"], article');
    articles.forEach(el => {
      const titleEl = el.querySelector('h3, h2, [data-adclicklocation="title"] a');
      const title = titleEl?.textContent?.trim();
      const scoreEl = el.querySelector('[aria-label*="upvote"]');
      const score = parseInt(scoreEl?.parentElement?.querySelector('span')?.textContent || '0') || 0;
      const linkEl = el.querySelector('a[data-click-id="body"], a[href*="/comments/"]');
      const href = linkEl?.href || '';
      const match = href.match(/\/comments\/([a-z0-9]+)\//i);
      const postId = match ? match[1] : '';
      if (title && postId) {
        results.push({ title, score, comments: 0, url: href, postId, selftext: '' });
      }
    });
    return results;
  });
}

function isPainPoint(title, body) {
  const full = `${title} ${body}`.toLowerCase();
  return (
    /is there (an app|a tool|a way|software|something)/i.test(full) ||
    /anyone (know|tried|using|recommend)/i.test(full) ||
    /what (do you|does everyone|should i|works|helped)/i.test(full) ||
    /how (do|can|should) (i|you|we)/i.test(full) ||
    /looking for (a|an|something|help|advice|recommendations)/i.test(full) ||
    /frustrated|struggling|can'?t sleep|can'?t figure|doesn'?t work|nothing works|tried everything/i.test(full) ||
    /so hard|so difficult|overwhelming|exhausted|desperate/i.test(full) ||
    /track(ing)?|manage|organiz|reminder|schedule|log(ging)?|monitor/i.test(full) ||
    /app|tool|software|program|device|gadget/i.test(full) ||
    /pain|flare|symptom|trigger|relief|treatment|therapy/i.test(full) ||
    /help|advice|tips|suggestions|recommend/i.test(full)
  );
}

function isExcluded(title) {
  return /\[meme\]|\[humor\]|\[celebration\]|\[rant\]/i.test(title);
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  const category = CATEGORY_MAP[sub] || 'General';
  let posts = [];
  let usedFallback = false;

  try {
    // First try browser-based scanning
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    // Scroll to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(1500);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    posts = await extractPostsFromPage(page);
    console.log(`Browser extracted ${posts.length} posts`);

    // Fallback to JSON API if browser got too few
    if (posts.length < 3) {
      console.log(`Low browser count — trying JSON API fallback`);
      const jsonPosts = await getPostsViaJson(sub);
      if (jsonPosts.length > posts.length) {
        posts = jsonPosts.map(p => ({
          title: p.title,
          score: p.score || 0,
          comments: p.num_comments || 0,
          url: `https://www.reddit.com${p.permalink}`,
          postId: p.id,
          selftext: p.selftext || '',
          stickied: p.stickied,
        }));
        usedFallback = true;
        console.log(`JSON API returned ${posts.length} posts`);
      }
    }

    // Filter
    const filtered = posts.filter(p => !p.stickied && (p.score >= 1 || !p.score) && p.title && p.title.length > 10);
    console.log(`After filtering: ${filtered.length} posts`);

    if (filtered.length === 0) {
      console.log(`No posts found for r/${sub} — skipping`);
      await apiPost('/api/pain-points/scan-logs', {
        agentId: AGENT_ID, subreddit: `r/${sub}`, postsScanned: 0, painPointsFound: 0, status: 'completed',
      });
      return { sub, postsScanned: 0, painPointsFound: 0, painPointTitles: [] };
    }

    // For browser mode, visit top candidate posts to get body text
    const candidates = filtered.slice(0, 20);
    const enriched = [];

    for (const post of candidates) {
      let body = post.selftext || '';

      // Visit post page if no body and looks promising
      if (!usedFallback && !body && post.title) {
        try {
          await page.goto(post.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await sleep(2000);

          body = await page.evaluate(() => {
            const el = document.querySelector('shreddit-post [slot="text-body"], [data-click-id="text"] div, .RichTextJSON-root');
            return el?.textContent?.trim() || '';
          });

          // Also grab top comments for context
          const comments = await page.evaluate(() => {
            const els = document.querySelectorAll('shreddit-comment [slot="comment"], [data-testid="comment"] p');
            return Array.from(els).slice(0, 3).map(e => e.textContent?.trim()).filter(Boolean).join(' | ');
          });

          if (comments) body = `${body} [Comments: ${comments}]`.slice(0, 1000);

          await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          await sleep(2000);
        } catch (e) {
          console.log(`Post detail error: ${e.message}`);
        }
      }

      enriched.push({ ...post, body });
      await sleep(500);
    }

    // Identify pain points
    const painPoints = enriched.filter(p => isPainPoint(p.title, p.body) && !isExcluded(p.title));
    console.log(`Pain points identified: ${painPoints.length}`);

    // Submit pain points
    let submitted = 0;
    const submittedTitles = [];

    for (const post of painPoints.slice(0, 6)) {
      try {
        const ppRes = await apiPost('/api/pain-points', {
          title: post.title.slice(0, 80),
          description: `From r/${sub}: ${(post.body || post.title).slice(0, 350)}`,
          category,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID,
        });

        const ppId = extractId(ppRes);
        console.log(`Created pain point ID: ${ppId} — "${post.title.slice(0, 60)}"`);

        if (ppId) {
          await apiPost('/api/pain-points/posts', {
            painPointId: ppId,
            redditPostId: post.postId,
            redditUrl: post.url,
            postTitle: post.title,
            postBody: (post.body || '').slice(0, 2000),
            upvotes: post.score || 0,
            commentCount: post.comments || 0,
            subreddit: `r/${sub}`,
            discoveredBy: AGENT_ID,
          });
          submitted++;
          submittedTitles.push(post.title.slice(0, 70));
        }

        await sleep(500);
      } catch (e) {
        console.log(`Submit error: ${e.message}`);
      }
    }

    // Log scan
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID, subreddit: `r/${sub}`,
      postsScanned: candidates.length, painPointsFound: submitted, status: 'completed',
    });

    console.log(`r/${sub}: ${submitted} pain points submitted`);
    return { sub, postsScanned: candidates.length, painPointsFound: submitted, painPointTitles: submittedTitles };

  } catch (err) {
    console.error(`Error scanning r/${sub}:`, err.message);
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID, subreddit: `r/${sub}`, postsScanned: 0, painPointsFound: 0, status: 'error',
    }).catch(() => {});
    return { sub, postsScanned: 0, painPointsFound: 0, error: err.message };
  }
}

async function main() {
  console.log('Connecting to AdsPower browser via CDP...');
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected!');
  } catch (e) {
    console.error('CDP connect failed:', e.message);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const pages = context.pages();
  for (let i = 1; i < pages.length; i++) await pages[i].close().catch(() => {});
  const page = pages[0] || await context.newPage();

  const results = [];
  for (let i = 0; i < SUBREDDITS.length; i++) {
    const result = await scanSubreddit(page, SUBREDDITS[i]);
    results.push(result);
    if (i < SUBREDDITS.length - 1) {
      console.log('Pausing 5s before next subreddit...');
      await sleep(5000);
    }
  }

  console.log('\n=== SCAN COMPLETE ===');
  const totalPosts = results.reduce((a, r) => a + (r.postsScanned || 0), 0);
  const totalPP = results.reduce((a, r) => a + (r.painPointsFound || 0), 0);
  console.log(`Summary: ${results.length} subreddits | ${totalPosts} posts scanned | ${totalPP} pain points submitted`);
  for (const r of results) {
    console.log(`  r/${r.sub}: ${r.postsScanned} posts → ${r.painPointsFound} pain points`);
    if (r.painPointTitles?.length) r.painPointTitles.forEach(t => console.log(`    • ${t}`));
    if (r.error) console.log(`    ⚠️ Error: ${r.error}`);
  }

  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
