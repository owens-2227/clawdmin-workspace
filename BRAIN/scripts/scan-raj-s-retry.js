const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:57042/devtools/browser/493bc8a0-652f-4d92-ae04-42ab9d9cc4a4';
const AGENT_ID = 'raj-s';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const SUBREDDITS = [
  { name: 'Meditation', category: 'Mental Health' },
  { name: 'Anxiety', category: 'Mental Health' },
];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function scanSubreddit(page, sub, category) {
  console.log(`\n=== Scanning r/${sub} ===`);
  
  let postsScanned = 0;
  let painPointsFound = 0;
  
  try {
    // Try new Reddit format
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(5000);

    const url = page.url();
    console.log('Current URL:', url);
    
    if (url.includes('login') || url.includes('captcha')) {
      console.log(`⚠️  Hit login/captcha wall on r/${sub}, skipping`);
      await apiPost('/api/pain-points/scan-logs', {
        agentId: AGENT_ID, subreddit: `r/${sub}`, postsScanned: 0, painPointsFound: 0, status: 'error',
      });
      return { postsScanned: 0, painPointsFound: 0 };
    }

    const pageTitle = await page.title();
    console.log('Page title:', pageTitle);

    const posts = await page.evaluate(() => {
      const results = [];
      
      const postElements = document.querySelectorAll('shreddit-post');
      postElements.forEach((el) => {
        const title = el.getAttribute('post-title') || '';
        const score = parseInt(el.getAttribute('score') || '0');
        const commentCount = parseInt(el.getAttribute('comment-count') || '0');
        const permalink = el.getAttribute('permalink') || '';
        const id = el.getAttribute('id') || '';
        if (title && permalink) {
          results.push({ title, score, commentCount, permalink, id });
        }
      });
      
      if (results.length === 0) {
        // Fallback: links approach
        const links = document.querySelectorAll('a[href*="/comments/"]');
        const seen = new Set();
        links.forEach(link => {
          const href = link.getAttribute('href');
          const match = href && href.match(/\/r\/\w+\/comments\/(\w+)\//);
          if (match && !seen.has(match[1])) {
            seen.add(match[1]);
            const title = link.textContent.trim();
            if (title.length > 10) {
              results.push({ title, score: 0, commentCount: 0, permalink: href, id: match[1] });
            }
          }
        });
      }
      
      // Deduplicate
      const seen2 = new Set();
      const deduped = [];
      for (const r of results) {
        const key = r.permalink || r.title;
        if (!seen2.has(key)) {
          seen2.add(key);
          deduped.push(r);
        }
      }
      return deduped.slice(0, 25);
    });
    
    console.log(`Found ${posts.length} posts`);
    
    if (posts.length === 0) {
      const textContent = await page.evaluate(() => document.body.innerText.slice(0, 1000));
      console.log('Page text sample:', textContent.slice(0, 500));
    }
    
    postsScanned = posts.length;
    
    const toRead = posts.slice(0, 10);
    const painPoints = [];
    
    for (const post of toRead) {
      await sleep(3000 + Math.random() * 2000);
      
      try {
        const fullUrl = post.permalink.startsWith('http') 
          ? post.permalink 
          : `https://www.reddit.com${post.permalink}`;
        
        await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(3000);
        
        const postData = await page.evaluate(() => {
          const bodyEl = document.querySelector('[data-testid="post-rtjson-content"], .RichTextJSON-root, [slot="text-body"], [data-click-id="text"]');
          const body = bodyEl ? bodyEl.textContent.trim() : '';
          
          const commentEls = document.querySelectorAll('[data-testid="comment"], shreddit-comment, .Comment');
          const comments = [];
          commentEls.forEach(el => {
            const text = el.querySelector('[data-testid="comment-top-meta"] ~ div, [slot="comment"], .RichTextJSON-root')?.textContent?.trim();
            if (text && text.length > 20) {
              comments.push(text.slice(0, 500));
            }
          });
          
          return { body: body.slice(0, 2000), comments: comments.slice(0, 8) };
        });
        
        console.log(`  Post: "${post.title.slice(0, 60)}" | body: ${postData.body.length} chars | comments: ${postData.comments.length}`);
        
        const combined = `TITLE: ${post.title}\n\nBODY: ${postData.body}\n\nCOMMENTS:\n${postData.comments.join('\n---\n')}`.toLowerCase();
        
        const painIndicators = [
          'is there an app', 'is there a tool', 'is there a way', 'how do i', 'how do you',
          'frustrated', 'frustrating', 'annoying', 'pain', 'struggle', 'struggling',
          'manually', 'wish there was', 'i wish', 'needs to be easier',
          'too expensive', 'too complicated', 'complex', 'overwhelming',
          'cant find', "can't find", 'looking for', 'recommend', 'help me find',
          'track', 'organize', 'keep track', 'manage', 'planning',
          'no good solution', 'best way to', 'what do you use for',
          'workflow', 'process', 'improve', 'better way', 'automate', 'automation',
          'anxiety', 'panic', 'worry', 'meditat', 'mindful', 'breath', 'stress',
          'technique', 'app', 'practice', 'help with', 'dealing with',
        ];
        
        const excludeIndicators = [
          'look at this', 'check out', '[oc]', 'just bought', 'just got',
          'appreciation post', 'show and tell', 'weekly thread', 'daily thread', 'megathread',
        ];
        
        const hasPainIndicator = painIndicators.some(indicator => combined.includes(indicator));
        const hasExclusion = excludeIndicators.some(exc => combined.includes(exc));
        
        if (hasPainIndicator && !hasExclusion && (postData.body.length > 30 || post.title.length > 20)) {
          const idMatch = post.permalink.match(/\/comments\/([a-z0-9]+)\//);
          const redditPostId = idMatch ? idMatch[1] : post.id || post.permalink;
          
          let painTitle = post.title.slice(0, 80);
          const descParts = [];
          if (postData.body.length > 30) descParts.push(postData.body.slice(0, 200));
          if (postData.comments.length > 0) descParts.push('Top comment: ' + postData.comments[0].slice(0, 150));
          const description = descParts.join(' | ').slice(0, 500) || post.title;
          
          painPoints.push({
            title: painTitle, description, category, subreddit: `r/${sub}`,
            redditPostId, redditUrl: `https://reddit.com${post.permalink.startsWith('/') ? post.permalink : '/' + post.permalink}`,
            postTitle: post.title, postBody: postData.body.slice(0, 2000),
            upvotes: post.score || 0, commentCount: post.commentCount || 0,
          });
          
          console.log(`  ✅ Pain point: "${painTitle.slice(0, 60)}"`);
        }
        
        await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(2000);
        
      } catch (err) {
        console.log(`  ⚠️  Error reading post "${post.title.slice(0, 40)}": ${err.message.slice(0, 100)}`);
        try {
          await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await sleep(2000);
        } catch {}
      }
    }
    
    for (const pp of painPoints) {
      try {
        const ppResult = await apiPost('/api/pain-points', {
          title: pp.title, description: pp.description, category: pp.category,
          subreddit: pp.subreddit, discoveredBy: AGENT_ID,
        });
        
        const ppId = ppResult?.id || ppResult?.data?.id || ppResult?.painPointId || ppResult?.painPoint?.id;
        
        if (ppId) {
          await apiPost('/api/pain-points/posts', {
            painPointId: ppId, redditPostId: pp.redditPostId, redditUrl: pp.redditUrl,
            postTitle: pp.postTitle, postBody: pp.postBody, upvotes: pp.upvotes,
            commentCount: pp.commentCount, subreddit: pp.subreddit, discoveredBy: AGENT_ID,
          });
        }
        
        painPointsFound++;
      } catch (err) {
        console.log(`  ⚠️  API error: ${err.message}`);
      }
    }
    
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID, subreddit: `r/${sub}`, postsScanned, painPointsFound, status: 'completed',
    });
    
    console.log(`  Done r/${sub}: ${postsScanned} posts scanned, ${painPointsFound} pain points`);
    
  } catch (err) {
    console.log(`❌ Error scanning r/${sub}: ${err.message.slice(0, 150)}`);
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID, subreddit: `r/${sub}`, postsScanned, painPointsFound, status: 'error',
    });
  }
  
  return { postsScanned, painPointsFound };
}

async function main() {
  console.log('🔍 Retry scan for Meditation and Anxiety...');
  
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('✅ Connected to browser');
    
    const context = browser.contexts()[0];
    const pages = context.pages();
    for (let i = 1; i < pages.length; i++) {
      try { await pages[i].close(); } catch {}
    }
    const page = pages[0] || await context.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    
    // First, navigate to reddit.com main page to reset any rate limit state
    await page.goto('https://www.reddit.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(5000);
    
    const results = { subredditsScanned: 0, totalPostsAnalyzed: 0, totalPainPointsFound: 0, details: [] };
    
    for (const { name, category } of SUBREDDITS) {
      const { postsScanned, painPointsFound } = await scanSubreddit(page, name, category);
      results.subredditsScanned++;
      results.totalPostsAnalyzed += postsScanned;
      results.totalPainPointsFound += painPointsFound;
      results.details.push({ subreddit: name, postsScanned, painPointsFound });
      await sleep(5000 + Math.random() * 3000);
    }
    
    console.log('\n============================');
    console.log('📊 RETRY SCAN COMPLETE');
    results.details.forEach(d => {
      console.log(`  r/${d.subreddit}: ${d.postsScanned} posts, ${d.painPointsFound} pain points`);
    });
    
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
}

main().catch(console.error);
