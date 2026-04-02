const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:65392/devtools/browser/063f29d6-006e-471e-9b1c-69f8caaca27f';
const AGENT_ID = 'owen-b';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const SUBREDDITS = [
  { name: 'ADHD', category: 'ADHD & Neurodivergent' },
  { name: 'languagelearning', category: 'Language Learning' },
  { name: 'remotework', category: 'Remote Work' },
  { name: 'productivity', category: 'Productivity' },
];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

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
  let json;
  try { json = JSON.parse(text); } catch(e) { json = { raw: text }; }
  return { status: res.status, data: json };
}

async function submitPainPoint(painPoint) {
  const res = await apiPost('/api/pain-points', {
    title: painPoint.title,
    description: painPoint.description,
    category: painPoint.category,
    subreddit: painPoint.subreddit,
    discoveredBy: AGENT_ID,
  });
  console.log(`  Submitted pain point: ${res.status}`, JSON.stringify(res.data).slice(0, 200));
  return res.data;
}

async function submitSource(painPointId, post) {
  const res = await apiPost('/api/pain-points/posts', {
    painPointId,
    redditPostId: post.id,
    redditUrl: post.url,
    postTitle: post.title,
    postBody: (post.body || '').slice(0, 2000),
    upvotes: post.upvotes,
    commentCount: post.commentCount,
    subreddit: post.subreddit,
    discoveredBy: AGENT_ID,
  });
  console.log(`  Submitted source: ${res.status}`);
}

async function logScan(subreddit, postsScanned, painPointsFound, status = 'completed') {
  const res = await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned,
    painPointsFound,
    status,
  });
  console.log(`  Scan log submitted: ${res.status}`);
}

async function scanSubreddit(page, subredditInfo) {
  const { name, category } = subredditInfo;
  console.log(`\n=== Scanning r/${name} ===`);

  try {
    await page.goto(`https://www.reddit.com/r/${name}/hot/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await sleep(3000);

    // Extract posts using page evaluation
    const posts = await page.evaluate(() => {
      const results = [];
      
      // Try shreddit (new Reddit) format
      const postElements = document.querySelectorAll('shreddit-post, [data-testid="post-container"]');
      
      if (postElements.length > 0) {
        postElements.forEach((el, idx) => {
          if (idx >= 25) return;
          const title = el.getAttribute('post-title') || 
                        el.querySelector('[slot="title"]')?.textContent?.trim() ||
                        el.querySelector('h3')?.textContent?.trim() || '';
          const permalink = el.getAttribute('permalink') || 
                           el.querySelector('a[slot="full-post-link"]')?.getAttribute('href') || '';
          const score = parseInt(el.getAttribute('score') || '0');
          const commentCount = parseInt(el.getAttribute('comment-count') || '0');
          const id = el.getAttribute('id') || permalink.split('/')[6] || '';
          const isStickied = el.hasAttribute('is-pinned') || el.getAttribute('is-pinned') === 'true';
          
          if (title && !isStickied) {
            results.push({ title, permalink, score, commentCount, id });
          }
        });
      }
      
      // Fallback: old Reddit / listings
      if (results.length === 0) {
        const links = document.querySelectorAll('.thing.link, .Post');
        links.forEach((el, idx) => {
          if (idx >= 25) return;
          const title = el.querySelector('.title a.title, h3')?.textContent?.trim() || '';
          const permalink = el.querySelector('a.title, a[data-click-id="body"]')?.getAttribute('href') || '';
          const score = parseInt(el.querySelector('.score.unvoted, .score.likes')?.textContent || '0');
          const commentCount = parseInt(el.querySelector('.comments')?.textContent?.match(/\d+/)?.[0] || '0');
          const id = el.getAttribute('data-fullname')?.replace('t3_', '') || '';
          const isStickied = el.classList.contains('stickied');
          
          if (title && !isStickied) {
            results.push({ title, permalink, score, commentCount, id });
          }
        });
      }
      
      return results;
    });

    console.log(`  Found ${posts.length} posts on listing page`);

    // Filter viable posts
    const viablePosts = posts.filter(p => p.score >= 5 && p.commentCount >= 10).slice(0, 20);
    console.log(`  ${viablePosts.length} viable posts (score≥5, comments≥10)`);

    const painPoints = [];
    let postsAnalyzed = 0;

    for (const post of viablePosts.slice(0, 15)) {
      try {
        const postUrl = post.permalink.startsWith('http') 
          ? post.permalink 
          : `https://www.reddit.com${post.permalink}`;
        
        console.log(`  Reading: ${post.title.slice(0, 60)}... (score: ${post.score}, comments: ${post.commentCount})`);
        
        await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(2500);

        // Extract post body and comments
        const postData = await page.evaluate(() => {
          // Post body
          const bodyEl = document.querySelector('[slot="text-body"], .md, [data-click-id="text"] .RichTextJSON-root, .expando .md');
          const body = bodyEl?.textContent?.trim() || '';
          
          // Comments
          const commentEls = document.querySelectorAll('shreddit-comment, .comment .md, [data-testid="comment"]');
          const comments = [];
          commentEls.forEach((el, idx) => {
            if (idx >= 10) return;
            const text = el.querySelector('[slot="comment"]')?.textContent?.trim() ||
                        el.querySelector('p')?.textContent?.trim() ||
                        el.textContent?.trim() || '';
            if (text.length > 20) comments.push(text.slice(0, 500));
          });
          
          return { body, comments };
        });

        postsAnalyzed++;

        // Analyze for pain points
        const fullText = `${post.title} ${postData.body} ${postData.comments.join(' ')}`.toLowerCase();
        
        const painIndicators = [
          'frustrated', 'frustrating', 'annoying', 'annoyed', 'struggle', 'struggling',
          'is there an app', 'is there a tool', 'does anyone know', 'how do you',
          'manually', 'wish there was', 'would love', 'need help', 'can\'t find',
          'too expensive', 'too complex', 'complicated', 'broken', 'doesn\'t work',
          'keeps forgetting', 'hard to track', 'no way to', 'automate', 'organize',
          'overwhelmed', 'lost track', 'can\'t keep up', 'hate how', 'problem with',
        ];

        const matchedIndicators = painIndicators.filter(ind => fullText.includes(ind));
        
        if (matchedIndicators.length >= 2 || 
            fullText.includes('is there an app') || 
            fullText.includes('is there a tool') ||
            fullText.includes('wish there was')) {
          
          // Generate a pain point description
          const bodyPreview = postData.body.slice(0, 300);
          
          painPoints.push({
            title: post.title.slice(0, 80),
            description: `User in r/${name} reports: ${bodyPreview || post.title}. Matched indicators: ${matchedIndicators.slice(0, 3).join(', ')}. This post has ${post.commentCount} comments indicating community resonance.`,
            category,
            subreddit: `r/${name}`,
            sourcePost: {
              id: post.id || post.permalink.split('/')[6] || 'unknown',
              url: postUrl,
              title: post.title,
              body: postData.body.slice(0, 2000),
              upvotes: post.score,
              commentCount: post.commentCount,
            }
          });
          
          console.log(`  ✓ Pain point found: ${post.title.slice(0, 60)}`);
        }

        await sleep(2000);
      } catch (err) {
        console.log(`  Error reading post: ${err.message}`);
      }
    }

    // Submit pain points
    let submitted = 0;
    for (const pp of painPoints) {
      try {
        const result = await submitPainPoint(pp);
        const id = result?.id || result?.data?.id || result?._id;
        if (id && pp.sourcePost) {
          await submitSource(id, pp.sourcePost);
        }
        submitted++;
        await sleep(500);
      } catch (err) {
        console.log(`  Error submitting pain point: ${err.message}`);
      }
    }

    await logScan(name, postsAnalyzed, submitted);

    return { subreddit: name, postsScanned: postsAnalyzed, painPointsFound: submitted };
  } catch (err) {
    console.log(`  Error scanning r/${name}: ${err.message}`);
    await logScan(name, 0, 0, 'error').catch(() => {});
    return { subreddit: name, postsScanned: 0, painPointsFound: 0, error: err.message };
  }
}

async function main() {
  console.log('Connecting to browser via CDP...');
  let browser;
  
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected!');
    
    const contexts = browser.contexts();
    console.log(`  Contexts: ${contexts.length}`);
    
    let context, page;
    if (contexts.length > 0) {
      context = contexts[0];
      const existingPages = context.pages();
      console.log(`  Existing pages: ${existingPages.length}`);
      if (existingPages.length > 0) {
        page = existingPages[0];
        // Close extra pages
        for (let i = 1; i < existingPages.length; i++) {
          await existingPages[i].close().catch(() => {});
        }
      } else {
        page = await context.newPage();
      }
    } else {
      context = await browser.newContext();
      page = await context.newPage();
    }
    
    console.log(`  Page ready: ${!!page}`);

    const results = [];
    
    for (const subredditInfo of SUBREDDITS) {
      const result = await scanSubreddit(page, subredditInfo);
      results.push(result);
      await sleep(3000); // pause between subreddits
    }

    console.log('\n=== SCAN COMPLETE ===');
    console.log('Results:', JSON.stringify(results, null, 2));
    
    const totalPosts = results.reduce((s, r) => s + r.postsScanned, 0);
    const totalPainPoints = results.reduce((s, r) => s + r.painPointsFound, 0);
    
    console.log(`\nSummary:`);
    console.log(`  Subreddits scanned: ${results.length}`);
    console.log(`  Total posts analyzed: ${totalPosts}`);
    console.log(`  Pain points discovered: ${totalPainPoints}`);
    
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
  // Note: Do NOT close the browser — admin agent handles that
  process.exit(0);
}

main();
