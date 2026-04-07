const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:61786/devtools/browser/a7512840-8b27-4c62-8194-62db63e423a1';
const AGENT_ID = 'marcus-j';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function submitPainPoint(pp) {
  console.log(`  → Submitting: "${pp.title.slice(0, 70)}"`);
  const result = await apiPost('/api/pain-points', {
    title: pp.title.slice(0, 80),
    description: pp.description,
    category: 'Music',
    subreddit: pp.subreddit,
    discoveredBy: AGENT_ID
  });
  const id = result?.id;
  console.log(`    Created id: ${id}`);
  if (id && pp.post) {
    const linkResult = await apiPost('/api/pain-points/posts', {
      painPointId: id,
      redditPostId: pp.post.id || '',
      redditUrl: pp.post.url || '',
      postTitle: pp.post.title || '',
      postBody: (pp.post.body || '').slice(0, 2000),
      upvotes: pp.post.upvotes || 0,
      commentCount: pp.post.commentCount || 0,
      subreddit: pp.subreddit,
      discoveredBy: AGENT_ID
    });
    console.log(`    Linked:`, linkResult?.id || JSON.stringify(linkResult).slice(0,60));
  }
  return id;
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const pages = context.pages();
  for (let i = 1; i < pages.length; i++) await pages[i].close();
  const page = pages[0] || await context.newPage();
  console.log('Connected to browser');

  // Try homerecording
  console.log('\n=== r/homerecording ===');
  let postsScanned = 0;
  let painPointsFound = 0;
  
  try {
    await page.goto('https://www.reddit.com/r/homerecording/hot/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await page.waitForTimeout(4000);
    
    const title = await page.title();
    console.log('Page title:', title);
    
    // Scroll
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await page.waitForTimeout(2000);
    }
    
    const posts = await page.evaluate(() => {
      const results = [];
      const shredditPosts = document.querySelectorAll('shreddit-post');
      for (const el of shredditPosts) {
        const title = el.getAttribute('post-title') || '';
        const score = parseInt(el.getAttribute('score') || '0');
        const commentCount = parseInt(el.getAttribute('comment-count') || '0');
        const permalink = el.getAttribute('permalink') || '';
        if (title) results.push({ title, score, commentCount, permalink });
      }
      // fallback
      if (results.length === 0) {
        const links = document.querySelectorAll('a[href*="/comments/"]');
        for (const a of links) {
          const text = a.textContent?.trim();
          if (text && text.length > 20) {
            results.push({ title: text, score: 0, commentCount: 0, permalink: a.href });
          }
        }
      }
      return results;
    });
    
    console.log(`Extracted ${posts.length} posts`);
    postsScanned = posts.length;
    
    // Pain point signals
    const signals = [
      /\b(is there|looking for|need|want|wish)\s+(an?\s+)?(app|tool|plugin|software|interface|audio|daw|way)\b/i,
      /\bstruggl/i, /\bfrustrat/i, /\bcan't (figure|afford|get|find)\b/i,
      /\btoo (expensive|complex|hard|difficult)\b/i,
      /\bwhat (should i|do you|do i)\b/i,
      /\bbest (way|daw|interface|mic|plugin)\b/i,
      /\bhelp (me|with)\b/i,
      /\bconfus/i, /\boverwhel/i,
      /\bnot sure (how|what|which|if)\b/i,
      /\badvice\b/i, /\brecommend/i,
      /\b(mixing|mastering|recording|monitoring) (problem|issue|trouble|help)\b/i,
      /\b(latency|noise|hum|buzz|feedback|distortion) (problem|issue|help)\b/i,
      /\bworth it\b/i, /\bvs\b/i,
    ];
    
    const candidates = posts.filter(p => {
      if (p.score < 3) return false;
      return signals.some(s => s.test(p.title));
    });
    
    console.log(`${candidates.length} pain point candidates`);
    
    // If browser has session, also try to get post bodies for top candidates
    for (const post of candidates.slice(0, 6)) {
      let body = '';
      if (post.permalink) {
        try {
          const postUrl = post.permalink.startsWith('http') ? post.permalink : `https://www.reddit.com${post.permalink}`;
          await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await page.waitForTimeout(2000);
          body = await page.evaluate(() => {
            const b = document.querySelector('[data-test-id="post-content"] div, .RichTextJSON-root, shreddit-post [slot="text-body"]');
            return b?.textContent?.trim() || '';
          });
          await page.waitForTimeout(1500);
        } catch(e) {
          // ignore
        }
      }
      
      const pp = {
        title: post.title.slice(0, 80),
        description: body 
          ? `Home recording discussion: ${body.slice(0, 300)}`
          : `Recurring question/problem in r/homerecording: ${post.title}`,
        subreddit: 'r/homerecording',
        post: {
          id: post.permalink?.split('/comments/')[1]?.split('/')[0] || '',
          url: post.permalink?.startsWith('http') ? post.permalink : `https://reddit.com${post.permalink}`,
          title: post.title,
          body,
          upvotes: post.score,
          commentCount: post.commentCount
        }
      };
      
      await submitPainPoint(pp);
      painPointsFound++;
      await new Promise(r => setTimeout(r, 500));
    }
  } catch(e) {
    console.error('Error:', e.message);
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID, subreddit: 'r/homerecording',
      postsScanned, painPointsFound, status: 'error'
    });
    return;
  }

  const logResult = await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID, subreddit: 'r/homerecording',
    postsScanned, painPointsFound, status: 'completed'
  });
  console.log('Log:', logResult?.log?.id);
  console.log(`\nDone: ${postsScanned} posts, ${painPointsFound} pain points`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
