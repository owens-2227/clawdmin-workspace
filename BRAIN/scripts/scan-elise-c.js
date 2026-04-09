const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:50997/devtools/browser/26ff073c-1e59-4165-96bb-cec09fb55f7f';
const AGENT_ID = 'elise-c';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const SUBREDDITS = ['cats', 'rawpetfood', 'ThriftStoreHauls', 'felinediabetes'];

const CATEGORY_MAP = {
  'cats': 'Cats & Pets',
  'rawpetfood': 'Cats & Pets',
  'felinediabetes': 'Cats & Pets',
  'ThriftStoreHauls': 'Thrifting',
};

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function logScan(subreddit, postsScanned, painPointsFound, status = 'completed') {
  try {
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${subreddit}`,
      postsScanned,
      painPointsFound,
      status
    });
    console.log(`[LOG] r/${subreddit}: ${postsScanned} posts, ${painPointsFound} pain points — ${status}`);
  } catch (e) {
    console.error(`[LOG ERROR] ${e.message}`);
  }
}

async function submitPainPoint(title, description, category, subreddit, post) {
  try {
    const pp = await apiPost('/api/pain-points', {
      title,
      description,
      category,
      subreddit: `r/${subreddit}`,
      discoveredBy: AGENT_ID
    });
    const ppId = pp?.painPoint?.id || pp?.id || pp?.data?.id;
    if (!ppId) {
      console.error('[PAIN POINT] No ID returned:', JSON.stringify(pp));
      return null;
    }
    console.log(`[PAIN POINT] Created: ${ppId} — ${title}`);

    await apiPost('/api/pain-points/posts', {
      painPointId: ppId,
      redditPostId: post.id,
      redditUrl: post.url,
      postTitle: post.title,
      postBody: (post.body || '').substring(0, 2000),
      upvotes: post.upvotes,
      commentCount: post.commentCount,
      subreddit: `r/${subreddit}`,
      discoveredBy: AGENT_ID
    });
    console.log(`[SOURCE] Linked post for ${ppId}`);
    return ppId;
  } catch (e) {
    console.error(`[SUBMIT ERROR] ${e.message}`);
    return null;
  }
}

async function scanSubredditViaJSON(subreddit) {
  console.log(`\n[SCAN] r/${subreddit} via JSON API fallback...`);
  const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=25&raw_json=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
  });
  if (!res.ok) throw new Error(`JSON API returned ${res.status}`);
  const data = await res.json();
  return data.data.children.map(c => ({
    id: c.data.id,
    title: c.data.title,
    body: c.data.selftext,
    upvotes: c.data.score,
    commentCount: c.data.num_comments,
    url: `https://reddit.com${c.data.permalink}`,
    stickied: c.data.stickied,
    isSelf: c.data.is_self
  })).filter(p => !p.stickied && p.upvotes >= 5);
}

async function scanSubreddit(page, subreddit) {
  const category = CATEGORY_MAP[subreddit] || 'General';
  let posts = [];
  let usedFallback = false;

  try {
    console.log(`\n[BROWSE] Navigating to r/${subreddit}...`);
    await page.goto(`https://www.reddit.com/r/${subreddit}/hot/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await sleep(3000);

    // Check for CAPTCHA or login wall
    const pageContent = await page.content();
    if (pageContent.includes('captcha') || pageContent.includes('verify you\'re human')) {
      console.log(`[CAPTCHA] Detected on r/${subreddit}, using JSON fallback`);
      posts = await scanSubredditViaJSON(subreddit);
      usedFallback = true;
    } else {
      // Scroll to load more posts
      for (let i = 0; i < 6; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
        await sleep(2000);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(1000);

      // Try to extract posts from page
      posts = await page.evaluate(() => {
        const results = [];
        // Try shreddit-post elements
        const postEls = document.querySelectorAll('shreddit-post, [data-testid="post-container"], article[data-testid="post-rtjson-content"]');
        
        if (postEls.length > 0) {
          postEls.forEach(el => {
            const title = el.getAttribute('post-title') || el.querySelector('h1, h2, h3, [slot="title"]')?.textContent?.trim() || '';
            const score = parseInt(el.getAttribute('score') || el.getAttribute('upvote-count') || '0');
            const commentCount = parseInt(el.getAttribute('comment-count') || '0');
            const permalink = el.getAttribute('permalink') || el.querySelector('a[href*="/comments/"]')?.getAttribute('href') || '';
            const id = el.getAttribute('id') || permalink.split('/comments/')[1]?.split('/')[0] || '';
            if (title && score >= 5) {
              results.push({ id, title, body: '', upvotes: score, commentCount, url: permalink ? `https://reddit.com${permalink}` : '' });
            }
          });
        }
        
        // Try generic link approach if shreddit didn't work
        if (results.length === 0) {
          document.querySelectorAll('a[href*="/r/"][href*="/comments/"]').forEach(a => {
            const text = a.textContent.trim();
            if (text.length > 20 && !text.includes('comment')) {
              const href = a.getAttribute('href');
              const id = href.split('/comments/')[1]?.split('/')[0];
              if (id && !results.find(r => r.id === id)) {
                results.push({ id, title: text, body: '', upvotes: 10, commentCount: 0, url: `https://reddit.com${href}` });
              }
            }
          });
        }
        
        return results;
      });

      console.log(`[BROWSE] Found ${posts.length} posts via browser`);
      
      if (posts.length < 5) {
        console.log(`[FALLBACK] Too few posts (${posts.length}), using JSON API`);
        posts = await scanSubredditViaJSON(subreddit);
        usedFallback = true;
      }
    }
  } catch (e) {
    console.error(`[BROWSE ERROR] ${e.message}, trying JSON fallback`);
    try {
      posts = await scanSubredditViaJSON(subreddit);
      usedFallback = true;
    } catch (e2) {
      console.error(`[JSON FALLBACK ERROR] ${e2.message}`);
      await logScan(subreddit, 0, 0, 'error');
      return 0;
    }
  }

  console.log(`[SCAN] r/${subreddit}: Analyzing ${posts.length} posts (fallback: ${usedFallback})`);

  // For posts with good comment counts, fetch full content via JSON
  const enrichedPosts = [];
  for (const post of posts.slice(0, 20)) {
    if (post.commentCount >= 10 && post.url) {
      try {
        await sleep(2000);
        const jsonUrl = post.url.replace('https://reddit.com', 'https://www.reddit.com').replace(/\/$/, '') + '.json?raw_json=1';
        const res = await fetch(jsonUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
        });
        if (res.ok) {
          const data = await res.json();
          const postData = data[0]?.data?.children[0]?.data;
          if (postData) {
            post.body = postData.selftext || '';
            post.upvotes = postData.score || post.upvotes;
            // Get top comments
            const comments = data[1]?.data?.children
              ?.slice(0, 8)
              ?.map(c => c.data?.body)
              ?.filter(Boolean)
              ?.join('\n\n') || '';
            post.topComments = comments;
          }
        }
      } catch (e) {
        // continue without enrichment
      }
    }
    enrichedPosts.push(post);
  }

  // Analyze pain points
  const painPoints = [];
  
  for (const post of enrichedPosts) {
    const fullText = `${post.title} ${post.body || ''} ${post.topComments || ''}`.toLowerCase();
    
    // Pain point signals
    const signals = [
      /is there (an? )?(app|tool|way|method|software|service)/i,
      /looking for (an? )?(app|tool|way|recommendation|solution)/i,
      /how do (you|i|we) (track|manage|organize|keep track)/i,
      /frustrated|annoying|pain in the|struggle|struggling|difficult|hard to/i,
      /wish (there was|i could|i had|someone would)/i,
      /can't find|couldn't find|no good (app|tool|way|solution)/i,
      /does anyone (know|have|use)/i,
      /what do you use for|how do you handle/i,
      /need (help|advice|recommendations?) (with|for|on)/i,
      /problem with|issue with|trouble (with|tracking|managing)/i,
      /manually (tracking|doing|entering|recording)/i,
      /spreadsheet to (track|manage|keep)/i,
      /expensive|too (much|costly)|can't afford/i,
      /complicated|complex|confusing|hard to use/i,
    ];
    
    const hasSignal = signals.some(s => s.test(fullText));
    
    // Must have some engagement
    if (!hasSignal || post.upvotes < 10) continue;
    
    // Generate a pain point based on the post
    let title = '';
    let description = '';
    
    if (/cats|cat/i.test(subreddit)) {
      if (/track|monitor|schedule/i.test(fullText)) {
        title = 'Cat owners struggle to track health/medication schedules';
        description = `Cat owners in r/${subreddit} frequently discuss difficulty tracking medications, vet appointments, and health metrics for their cats. Many resort to paper notes or generic reminder apps that lack pet-specific features.`;
      } else if (/diet|food|feed/i.test(fullText)) {
        title = 'No simple tool for tracking cat diet and feeding schedules';
        description = `Owners struggle to manage feeding schedules, portion sizes, and dietary restrictions across multiple cats. Existing pet apps are too complex or not designed for daily feeding management.`;
      } else if (/vet|appointment|cost|expensive/i.test(fullText)) {
        title = 'Pet healthcare costs are hard to track and plan for';
        description = `Cat owners in r/${subreddit} express frustration with unexpected vet bills and difficulty budgeting for pet healthcare. No simple tool exists to forecast and track cat medical expenses.`;
      }
    }
    
    // Build title/description from post if not already set
    if (!title) {
      // Truncate title to 80 chars
      const rawTitle = post.title.length > 80 ? post.title.substring(0, 77) + '...' : post.title;
      title = rawTitle;
      description = `From r/${subreddit}: "${post.title}". ${post.body ? post.body.substring(0, 200) + '...' : 'Community members are asking for better tools or solutions for this recurring issue.'} Upvoted by ${post.upvotes} people with ${post.commentCount} comments.`;
    }
    
    painPoints.push({ title, description, post });
  }
  
  // Deduplicate and limit to top pain points per subreddit
  const uniquePainPoints = painPoints.filter((pp, i, arr) =>
    arr.findIndex(p => p.title === pp.title) === i
  ).slice(0, 5);
  
  let submittedCount = 0;
  for (const pp of uniquePainPoints) {
    const id = await submitPainPoint(pp.title, pp.description, category, subreddit, pp.post);
    if (id) submittedCount++;
    await sleep(1000);
  }
  
  await logScan(subreddit, enrichedPosts.length, submittedCount, 'completed');
  return submittedCount;
}

async function main() {
  console.log(`[START] elise-c scanner starting at ${new Date().toISOString()}`);
  console.log(`[CDP] Connecting to ${CDP_URL}`);
  
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('[CDP] Connected successfully');
  } catch (e) {
    console.error(`[CDP ERROR] Failed to connect: ${e.message}`);
    process.exit(1);
  }
  
  const contexts = browser.contexts();
  const context = contexts[0] || await browser.newContext();
  
  const pages = context.pages();
  // Close extra pages but keep one
  for (let i = 1; i < pages.length; i++) {
    try { await pages[i].close(); } catch {}
  }
  const page = pages[0] || await context.newPage();
  
  let totalPainPoints = 0;
  const results = [];
  
  for (const subreddit of SUBREDDITS) {
    try {
      const count = await scanSubreddit(page, subreddit);
      totalPainPoints += count;
      results.push({ subreddit, count, status: 'ok' });
    } catch (e) {
      console.error(`[ERROR] r/${subreddit}: ${e.message}`);
      results.push({ subreddit, count: 0, status: 'error', error: e.message });
      await logScan(subreddit, 0, 0, 'error');
    }
    await sleep(3000);
  }
  
  console.log('\n[DONE] Scan complete');
  console.log(`Total subreddits: ${SUBREDDITS.length}`);
  console.log(`Total pain points submitted: ${totalPainPoints}`);
  console.log('Results by subreddit:');
  results.forEach(r => console.log(`  r/${r.subreddit}: ${r.count} pain points (${r.status})`));
  
  // DO NOT close the browser — admin agent handles that
  await browser.close(); // just disconnect, not shut down
}

main().catch(e => {
  console.error('[FATAL]', e);
  process.exit(1);
});
