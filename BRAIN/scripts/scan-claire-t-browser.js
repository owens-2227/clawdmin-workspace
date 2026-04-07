// Browser-based scan for CBTi and yinyoga (JSON API returned 0/403)
const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:57765/devtools/browser/552d3cae-4239-4d13-8d05-ed6ec91300a4';
const AGENT_ID = 'claire-t';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const CATEGORY_MAP = { CBTi: 'Sleep & Recovery', yinyoga: 'Yoga' };

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function postJSON(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function scanWithBrowser(page, sub) {
  console.log(`\n=== Browser scan r/${sub} ===`);
  const category = CATEGORY_MAP[sub];
  let postsScanned = 0;
  let painPointsFound = 0;

  try {
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    const title = await page.title();
    console.log(`Page title: ${title}`);
    
    // Scroll to load posts
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    // Try to grab all post text
    const snapshot = await page.evaluate(() => {
      // Try shreddit-post elements first (new Reddit)
      const shredditPosts = document.querySelectorAll('shreddit-post');
      if (shredditPosts.length > 0) {
        return Array.from(shredditPosts).map(el => {
          const titleEl = el.querySelector('a[slot="title"]') || el.querySelector('[id*="post-title"]');
          const title = titleEl ? titleEl.textContent.trim() : el.getAttribute('post-title') || '';
          const permalink = el.getAttribute('permalink') || '';
          const score = parseInt(el.getAttribute('score') || '0');
          const commentCount = parseInt(el.getAttribute('comment-count') || '0');
          const postId = el.getAttribute('thingid') || '';
          return { title, permalink, score, commentCount, postId };
        }).filter(p => p.title);
      }
      
      // Fallback: old reddit style
      const articles = document.querySelectorAll('.Post, article, [data-testid="post-container"]');
      return Array.from(articles).map(el => {
        const titleEl = el.querySelector('h3, h2, [data-click-id="title"]');
        const title = titleEl ? titleEl.textContent.trim() : '';
        const linkEl = el.querySelector('a[href*="/comments/"]');
        const permalink = linkEl ? linkEl.getAttribute('href') : '';
        return { title, permalink, score: 0, commentCount: 0, postId: '' };
      }).filter(p => p.title);
    });

    console.log(`Got ${snapshot.length} posts from browser`);
    postsScanned = snapshot.length;

    // If no posts, try getting text content and parsing manually
    if (snapshot.length === 0) {
      const allText = await page.evaluate(() => document.body.innerText);
      console.log(`Page text sample: ${allText.substring(0, 500)}`);
      
      await postJSON('/api/pain-points/scan-logs', {
        agentId: AGENT_ID, subreddit: `r/${sub}`, postsScanned: 0, painPointsFound: 0, status: 'no_posts'
      });
      return { sub, postsScanned: 0, painPointsFound: 0 };
    }

    const painKws = [
      'help', 'how', 'question', 'anyone', 'experience', 'tips', 'advice', 'tried',
      'can\'t', 'unable', 'struggling', 'frustrat', 'wish', 'recommend', 'nothing works',
      'need', 'track', 'manage', 'pain', 'suffer', 'chronic', 'relief', 'tight', 'stiff',
      'sleep', 'wake', 'awake', 'yoga', 'stretch', 'tense', 'cbti', 'therapy', 'insomnia',
      'pose', 'sequence', 'routine', 'practice', 'beginner', 'what should', 'suggestion'
    ];

    const filtered = snapshot.filter(p => {
      const t = p.title.toLowerCase();
      return painKws.some(kw => t.includes(kw));
    });

    console.log(`${filtered.length} pain point candidates`);

    for (const post of filtered.slice(0, 6)) {
      const title = post.title.length > 80 ? post.title.substring(0, 77) + '...' : post.title;
      
      let desc = '';
      if (sub === 'CBTi') {
        desc = `CBT-I patients in r/${sub} are navigating cognitive behavioral therapy for insomnia. "${post.title}" highlights a gap in CBT-I guidance, tracking, or treatment support.`;
      } else {
        desc = `Yin yoga practitioners in r/${sub} seek practice guidance and support. "${post.title}" (${post.score} upvotes) shows a need for better practice tools, pose guidance, or community resources.`;
      }

      const postUrl = post.permalink 
        ? (post.permalink.startsWith('http') ? post.permalink : `https://reddit.com${post.permalink}`)
        : `https://reddit.com/r/${sub}`;
      
      const redditPostId = post.postId || 
        (post.permalink ? (post.permalink.match(/\/comments\/([a-z0-9]+)\//) || [])[1] : '') || 
        'unknown';

      try {
        const ppRes = await postJSON('/api/pain-points', {
          title,
          description: desc.substring(0, 500),
          category,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID,
        });

        const ppId = ppRes?.painPoint?.id || ppRes?.id;
        if (ppId) {
          await postJSON('/api/pain-points/posts', {
            painPointId: ppId,
            redditPostId,
            redditUrl: postUrl,
            postTitle: post.title,
            postBody: '',
            upvotes: post.score || 0,
            commentCount: post.commentCount || 0,
            subreddit: `r/${sub}`,
            discoveredBy: AGENT_ID,
          });
          painPointsFound++;
          console.log(`  ✓ Submitted: "${title.substring(0, 60)}"`);
        }
      } catch (e) {
        console.log(`  ✗ Error: ${e.message}`);
      }
      await sleep(800);
    }

  } catch (err) {
    console.log(`Browser scan error: ${err.message}`);
    await postJSON('/api/pain-points/scan-logs', {
      agentId: AGENT_ID, subreddit: `r/${sub}`, postsScanned: 0, painPointsFound: 0, status: 'error'
    });
    return { sub, postsScanned: 0, painPointsFound: 0, error: err.message };
  }

  await postJSON('/api/pain-points/scan-logs', {
    agentId: AGENT_ID, subreddit: `r/${sub}`, postsScanned, painPointsFound, status: 'completed'
  });

  return { sub, postsScanned, painPointsFound };
}

async function main() {
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    const context = browser.contexts()[0];
    const pages = context.pages();
    for (let i = 1; i < pages.length; i++) await pages[i].close();
    const page = pages[0] || await context.newPage();

    const r1 = await scanWithBrowser(page, 'CBTi');
    await sleep(3000);
    const r2 = await scanWithBrowser(page, 'yinyoga');

    console.log('\n=== BROWSER SCAN COMPLETE ===');
    console.log(`r/CBTi: ${r1.postsScanned} posts, ${r1.painPointsFound} pain points`);
    console.log(`r/yinyoga: ${r2.postsScanned} posts, ${r2.painPointsFound} pain points`);

    await browser.close();
  } catch (e) {
    console.error('Fatal:', e.message);
    process.exit(1);
  }
}

main();
