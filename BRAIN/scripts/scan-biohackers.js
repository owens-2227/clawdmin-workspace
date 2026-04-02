const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:58609/devtools/browser/ed293906-99bd-4bac-863f-c4a36122199a';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const AGENT_ID = 'marco-v';
const SUB = 'Biohackers';
const CATEGORY = 'Biohacking';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function apiPost(path, data) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(data),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function main() {
  console.log('Connecting to CDP...');
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected!');
  } catch (e) {
    console.error('CDP failed:', e.message);
    process.exit(1);
  }

  const contexts = browser.contexts();
  const context = contexts[0] || await browser.newContext();
  let pages = context.pages();
  // Close all existing pages and open fresh
  for (const p of pages) await p.close().catch(() => {});
  const page = await context.newPage();

  console.log(`Navigating to r/${SUB}...`);
  try {
    await page.goto(`https://www.reddit.com/r/${SUB}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e) {
    console.error('Navigation failed:', e.message);
    process.exit(1);
  }
  await sleep(3000);

  const title = await page.title();
  const contentLen = (await page.content()).length;
  console.log(`Title: ${title}, content: ${contentLen}`);

  // Scroll to load more posts
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollBy(0, 1200));
    await sleep(1500);
  }

  // Extract posts
  let posts = await page.evaluate(() => {
    const results = [];
    const shredditPosts = document.querySelectorAll('shreddit-post');
    if (shredditPosts.length > 0) {
      shredditPosts.forEach(el => {
        const permalink = el.getAttribute('permalink') || el.getAttribute('content-href') || '';
        const postTitle = el.getAttribute('post-title') || el.querySelector('[slot="title"]')?.textContent?.trim() || '';
        const score = parseInt(el.getAttribute('score') || el.getAttribute('upvote-count') || '0');
        const commentCount = parseInt(el.getAttribute('comment-count') || '0');
        const idMatch = permalink.match(/\/comments\/([a-z0-9]+)\//);
        if (postTitle && permalink) {
          results.push({
            title: postTitle,
            url: permalink.startsWith('http') ? permalink : `https://www.reddit.com${permalink}`,
            score, commentCount,
            id: idMatch ? idMatch[1] : '',
            body: '',
          });
        }
      });
      return results;
    }
    // Fallback
    const links = Array.from(document.querySelectorAll('a[href*="/r/"][href*="/comments/"]'));
    const seen = new Set();
    links.forEach(link => {
      const href = link.getAttribute('href');
      const url = href.startsWith('http') ? href : `https://www.reddit.com${href}`;
      if (!seen.has(url) && link.textContent.trim().length > 10) {
        seen.add(url);
        const idMatch = href.match(/\/comments\/([a-z0-9]+)\//);
        results.push({ title: link.textContent.trim().substring(0, 200), url, score: 0, commentCount: 0, id: idMatch ? idMatch[1] : '', body: '' });
      }
    });
    return results.slice(0, 25);
  });

  console.log(`Found ${posts.length} posts`);

  const painKeywords = ['frustrated','frustrating','annoying','wish','want','need','problem','issue','hard to','difficult','struggle','struggling','can\'t find','looking for','is there a','does anyone know','how do i','anyone else','hate','sucks','impossible','overwhelming','confusing','expensive','too much','manual','automate','app for','tool for','software for','solution','alternative','workflow','broken','doesn\'t work','fails','slow','tedious','painful'];

  const detailedPosts = [];
  for (const post of posts.slice(0, 15)) {
    if (!post.url || !post.url.includes('/comments/')) continue;
    try {
      console.log(`  Reading: ${post.title.substring(0, 60)}`);
      await page.goto(post.url, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await sleep(2500);
      const details = await page.evaluate(() => {
        const bodyEls = document.querySelectorAll('[data-test-id="post-content"] [data-click-id="text"], shreddit-post [slot="text-body"], div[class*="usertext-body"]');
        const body = Array.from(bodyEls).map(e => e.textContent?.trim()).join(' ') || '';
        const comments = Array.from(document.querySelectorAll('shreddit-comment, div[data-testid*="comment"]'))
          .slice(0, 8).map(c => c.textContent?.trim().substring(0, 400) || '').filter(c => c.length > 20);
        return { body, comments };
      });
      detailedPosts.push({ ...post, ...details });
      await sleep(2000);
    } catch (e) {
      console.log(`  Error: ${e.message}`);
      detailedPosts.push(post);
    }
  }

  const allPosts = [...detailedPosts, ...posts.slice(15)];
  const painPoints = [];

  for (const post of allPosts) {
    if (!post.title || post.title.length < 10) continue;
    const text = `${post.title} ${post.body || ''} ${(post.comments || []).join(' ')}`.toLowerCase();
    const matchCount = painKeywords.filter(kw => text.includes(kw)).length;
    if (matchCount < 1) continue;
    const skipPatterns = ['[meme]', 'just wanted to share', 'look what i made', 'finally finished'];
    if (skipPatterns.some(p => post.title.toLowerCase().includes(p))) continue;

    let description = '';
    if (post.body && post.body.length > 50) {
      description = post.body.substring(0, 400).replace(/\n/g, ' ').trim();
    } else if (post.comments && post.comments.length > 0) {
      description = post.comments[0].substring(0, 400).trim();
    } else {
      description = `Users in r/${SUB} are experiencing: ${post.title}`;
    }
    const sentences = description.split(/[.!?]+/).filter(s => s.trim().length > 10);
    description = sentences.slice(0, 3).join('. ').trim();
    if (description && !description.endsWith('.')) description += '.';
    if (!description) description = `Recurring issue in r/${SUB}: ${post.title}`;

    painPoints.push({
      title: post.title.substring(0, 80),
      description: description.substring(0, 500),
      sourcePost: post,
    });

    if (painPoints.length >= 5) break;
  }

  console.log(`Found ${painPoints.length} pain points`);
  let submitted = 0;
  for (const pp of painPoints) {
    try {
      const result = await apiPost('/api/pain-points', {
        title: pp.title,
        description: pp.description,
        category: CATEGORY,
        subreddit: `r/${SUB}`,
        discoveredBy: AGENT_ID,
      });
      console.log('Created:', result.painPoint?.id || result.id || JSON.stringify(result).substring(0, 100));
      const ppId = result.painPoint?.id || result.id || result._id;
      if (ppId && pp.sourcePost) {
        await apiPost('/api/pain-points/posts', {
          painPointId: ppId,
          redditPostId: pp.sourcePost.id,
          redditUrl: pp.sourcePost.url,
          postTitle: pp.sourcePost.title,
          postBody: (pp.sourcePost.body || '').substring(0, 2000),
          upvotes: pp.sourcePost.score || 0,
          commentCount: pp.sourcePost.commentCount || 0,
          subreddit: `r/${SUB}`,
          discoveredBy: AGENT_ID,
        });
      }
      submitted++;
    } catch (e) {
      console.log(`Submit error: ${e.message}`);
    }
  }

  await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${SUB}`,
    postsScanned: allPosts.length,
    painPointsFound: submitted,
    status: 'completed',
  });

  console.log(`\nDone: ${allPosts.length} posts scanned, ${submitted} pain points submitted`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
