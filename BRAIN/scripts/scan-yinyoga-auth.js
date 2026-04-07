// Try to access private r/YinYoga via logged-in AdsPower profile
const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:57765/devtools/browser/552d3cae-4239-4d13-8d05-ed6ec91300a4';
const AGENT_ID = 'claire-t';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

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

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const pages = context.pages();
  for (let i = 1; i < pages.length; i++) await pages[i].close();
  const page = pages[0] || await context.newPage();

  // Check login status first
  await page.goto('https://www.reddit.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(2000);
  const loggedIn = await page.evaluate(() => {
    return !document.querySelector('[href="/login"]') || !!document.querySelector('[data-testid="user-menu"]');
  });
  console.log(`Logged in: ${loggedIn}`);

  // Try YinYoga
  await page.goto('https://www.reddit.com/r/YinYoga/hot/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3000);
  const title = await page.title();
  const content = await page.evaluate(() => document.body.innerText.substring(0, 800));
  console.log(`Title: ${title}`);
  console.log(`Content: ${content}`);

  // Check if we can see posts
  const posts = await page.evaluate(() => {
    const els = document.querySelectorAll('shreddit-post');
    return Array.from(els).map(el => ({
      title: el.getAttribute('post-title') || el.querySelector('a[slot="title"]')?.textContent?.trim() || '',
      score: parseInt(el.getAttribute('score') || '0'),
      comments: parseInt(el.getAttribute('comment-count') || '0'),
      permalink: el.getAttribute('permalink') || '',
      postId: el.getAttribute('thingid') || '',
    })).filter(p => p.title);
  });

  console.log(`Found ${posts.length} posts`);
  
  if (posts.length > 0) {
    // Scroll for more
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    const morePosts = await page.evaluate(() => {
      const els = document.querySelectorAll('shreddit-post');
      return Array.from(els).map(el => ({
        title: el.getAttribute('post-title') || el.querySelector('a[slot="title"]')?.textContent?.trim() || '',
        score: parseInt(el.getAttribute('score') || '0'),
        comments: parseInt(el.getAttribute('comment-count') || '0'),
        permalink: el.getAttribute('permalink') || '',
        postId: el.getAttribute('thingid') || '',
      })).filter(p => p.title);
    });
    console.log(`After scroll: ${morePosts.length} posts`);

    const painKws = ['help', 'how', 'question', 'anyone', 'tips', 'advice', 'tried',
      'can\'t', 'struggling', 'recommend', 'need', 'pain', 'tight', 'stiff',
      'pose', 'sequence', 'routine', 'practice', 'beginner', 'suggestion', 'yin'];

    const candidates = morePosts.filter(p => {
      const t = p.title.toLowerCase();
      return painKws.some(kw => t.includes(kw));
    });

    console.log(`${candidates.length} pain point candidates`);

    let painPointsFound = 0;
    for (const post of candidates.slice(0, 6)) {
      const title = post.title.length > 80 ? post.title.substring(0, 77) + '...' : post.title;
      const postUrl = post.permalink ? `https://reddit.com${post.permalink}` : 'https://reddit.com/r/YinYoga';
      const desc = `Yin yoga practitioners in r/YinYoga seek practice guidance. "${post.title}" (${post.score} upvotes, ${post.comments} comments) shows a need for better pose guidance, sequencing tools, or community support.`;

      const ppRes = await postJSON('/api/pain-points', {
        title, description: desc.substring(0, 500),
        category: 'Yoga', subreddit: 'r/YinYoga', discoveredBy: AGENT_ID,
      });

      const ppId = ppRes?.painPoint?.id || ppRes?.id;
      if (ppId) {
        await postJSON('/api/pain-points/posts', {
          painPointId: ppId, redditPostId: post.postId || 'unknown',
          redditUrl: postUrl, postTitle: post.title, postBody: '',
          upvotes: post.score, commentCount: post.comments,
          subreddit: 'r/YinYoga', discoveredBy: AGENT_ID,
        });
        painPointsFound++;
        console.log(`  ✓ "${title.substring(0, 60)}"`);
      }
      await sleep(800);
    }

    await postJSON('/api/pain-points/scan-logs', {
      agentId: AGENT_ID, subreddit: 'r/YinYoga',
      postsScanned: morePosts.length, painPointsFound, status: 'completed',
    });
    console.log(`Submitted ${painPointsFound} pain points from YinYoga`);
  } else {
    // Private / inaccessible
    await postJSON('/api/pain-points/scan-logs', {
      agentId: AGENT_ID, subreddit: 'r/YinYoga',
      postsScanned: 0, painPointsFound: 0, status: 'private_inaccessible',
    });
    console.log('YinYoga is private/inaccessible with this account');
  }

  await browser.close();
}

main().catch(console.error);
