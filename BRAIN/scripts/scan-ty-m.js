const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:62149/devtools/browser/4567aacd-5408-4f55-b13a-d1e997f2985b';
const AGENT_ID = 'ty-m';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const SUBREDDITS = ['bikecommuting', 'gravelcycling', 'bikewrench', 'fuckcars'];
const CATEGORY = 'Cycling';

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
  try { return JSON.parse(text); } catch(e) { return { raw: text }; }
}

async function submitPainPoint(pp) {
  console.log(`  [submit] ${pp.title}`);
  const created = await apiPost('/api/pain-points', {
    title: pp.title,
    description: pp.description,
    category: CATEGORY,
    subreddit: `r/${pp.subreddit}`,
    discoveredBy: AGENT_ID,
  });
  console.log(`  [created] id=${created.id || JSON.stringify(created)}`);
  if (created.id && pp.post) {
    const linked = await apiPost('/api/pain-points/posts', {
      painPointId: created.id,
      redditPostId: pp.post.id,
      redditUrl: pp.post.url,
      postTitle: pp.post.title,
      postBody: (pp.post.body || '').slice(0, 2000),
      upvotes: pp.post.upvotes || 0,
      commentCount: pp.post.commentCount || 0,
      subreddit: `r/${pp.subreddit}`,
      discoveredBy: AGENT_ID,
    });
    console.log(`  [linked post] ${JSON.stringify(linked)}`);
  }
  return created;
}

async function logScan(subreddit, postsScanned, painPointsFound, status) {
  const result = await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned,
    painPointsFound,
    status,
  });
  console.log(`  [scan-log] ${subreddit}: ${postsScanned} posts, ${painPointsFound} pain points — ${JSON.stringify(result)}`);
}

async function fetchSubredditJSON(sub) {
  try {
    const res = await fetch(
      `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' } }
    );
    const json = await res.json();
    return json.data?.children?.map(c => c.data) || [];
  } catch(e) {
    console.log(`  [json-fallback error] ${e.message}`);
    return [];
  }
}

async function scanSubredditWithPage(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  let posts = [];

  try {
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Scroll to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await page.waitForTimeout(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1000);

    // Try to extract posts from page
    const pageContent = await page.content();
    
    // Check for CAPTCHA/login wall
    if (pageContent.includes('verify you are human') || pageContent.includes('log in to Reddit')) {
      console.log(`  [warning] CAPTCHA or login wall detected on r/${sub}, using JSON fallback`);
      posts = await fetchSubredditJSON(sub);
    } else {
      // Try to extract post data from the page
      posts = await page.evaluate(() => {
        const results = [];
        // Try shreddit-post elements (new Reddit)
        const postEls = document.querySelectorAll('shreddit-post, [data-testid="post-container"], article');
        postEls.forEach(el => {
          const title = el.getAttribute('post-title') || el.querySelector('h1,h2,h3,[slot="title"]')?.textContent?.trim();
          const permalink = el.getAttribute('permalink') || el.querySelector('a[href*="/comments/"]')?.getAttribute('href');
          const score = parseInt(el.getAttribute('score') || el.querySelector('[data-click-id="upvote"]')?.textContent || '0');
          const comments = parseInt(el.getAttribute('comment-count') || '0');
          const id = el.getAttribute('id') || (permalink ? permalink.split('/comments/')[1]?.split('/')[0] : null);
          if (title && permalink) {
            results.push({ title, permalink, score, comments, id, postType: el.getAttribute('post-type') });
          }
        });
        return results;
      });

      if (posts.length === 0) {
        console.log(`  [info] No posts from DOM extraction, using JSON fallback`);
        posts = await fetchSubredditJSON(sub);
      } else {
        // Convert DOM format to JSON format
        posts = posts.map(p => ({
          id: p.id || p.permalink?.split('/comments/')[1]?.split('/')[0],
          title: p.title,
          permalink: p.permalink,
          url: `https://reddit.com${p.permalink}`,
          score: p.score || 0,
          num_comments: p.comments || 0,
          selftext: '',
          is_self: true,
          stickied: false,
        }));
      }
    }
  } catch(e) {
    console.log(`  [nav error] ${e.message} — using JSON fallback`);
    posts = await fetchSubredditJSON(sub);
  }

  console.log(`  [posts loaded] ${posts.length} posts`);
  return posts;
}

function analyzePainPoints(posts, sub) {
  const painPointKeywords = [
    'frustrat', 'annoying', 'hate', 'wish', 'need help', 'struggling', 'problem', 'issue',
    'is there an app', 'is there a tool', 'is there software', 'anyone else', 'how do you',
    'manual', 'tedious', 'overwhelm', 'expensive', 'complex', 'confusing', 'track', 'organize',
    'can\'t find', 'looking for', 'recommend', 'help me', 'advice', 'broken', 'fail', 'worst',
    'keep forgetting', 'hard to', 'difficult to', 'no way to', 'why is', 'why doesn\'t',
    'should be', 'better way', 'alternative', 'replace', 'upgrade', 'fix', 'repair',
    'painful', 'sucks', 'terrible', 'nightmare', 'stress', 'worry', 'concern'
  ];

  const excludeKeywords = [
    'beautiful', 'love this', 'amazing ride', 'finally did it', 'milestone', 'celebration',
    'look at my', 'just got', 'first time', 'meme', 'funny', 'lol', 'haha'
  ];

  const painPoints = [];

  for (const post of posts) {
    // Skip stickied, very low score, or image-only posts
    if (post.stickied) continue;
    if ((post.score || 0) < 3) continue;
    
    const titleLower = (post.title || '').toLowerCase();
    const bodyLower = (post.selftext || '').toLowerCase();
    const combined = titleLower + ' ' + bodyLower;

    // Skip excluded
    if (excludeKeywords.some(k => combined.includes(k))) continue;

    // Check for pain point keywords
    const matchedKeywords = painPointKeywords.filter(k => combined.includes(k));
    if (matchedKeywords.length === 0) continue;

    // Determine pain point title and description
    let ppTitle = post.title;
    if (ppTitle.length > 80) ppTitle = ppTitle.slice(0, 77) + '...';

    let description = '';
    if (post.selftext && post.selftext.length > 20) {
      description = post.selftext.slice(0, 300).trim();
      if (description.length === 300) description += '...';
    }
    if (!description) {
      description = `Reddit post from r/${sub} about: ${post.title}`;
    }

    // Add context about who experiences it
    const whoExperiences = sub === 'bikecommuting' ? 'bike commuters' :
                           sub === 'gravelcycling' ? 'gravel cyclists' :
                           sub === 'bikewrench' ? 'cyclists doing their own bike maintenance' :
                           'car-free / cycling advocates';
    
    description = description + ` Relevant to ${whoExperiences}.`;

    painPoints.push({
      title: ppTitle,
      description: description.slice(0, 500),
      subreddit: sub,
      post: {
        id: post.id,
        title: post.title,
        url: post.url || `https://reddit.com${post.permalink}`,
        body: post.selftext || '',
        upvotes: post.score || 0,
        commentCount: post.num_comments || 0,
      },
      matchedKeywords,
    });
  }

  return painPoints;
}

async function getPostDetails(page, post, sub) {
  // Try to fetch post details via JSON API for posts with good comment counts
  if ((post.num_comments || 0) >= 10 || post.comments >= 10) {
    try {
      const postId = post.id;
      if (postId) {
        const res = await fetch(
          `https://www.reddit.com/r/${sub}/comments/${postId}.json?limit=10&raw_json=1`,
          { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' } }
        );
        const json = await res.json();
        if (Array.isArray(json) && json[0]?.data?.children?.[0]?.data) {
          const postData = json[0].data.children[0].data;
          post.selftext = postData.selftext || post.selftext || '';
        }
      }
    } catch(e) {
      // ignore
    }
  }
  return post;
}

async function main() {
  console.log(`Starting scan as ${AGENT_ID}`);
  console.log(`Connecting to CDP: ${CDP_URL}`);

  const browser = await chromium.connectOverCDP(CDP_URL);
  console.log('Connected to browser');

  const context = browser.contexts()[0] || await browser.newContext();
  const pages = context.pages();
  
  // Close extra tabs, keep one
  for (let i = 1; i < pages.length; i++) {
    try { await pages[i].close(); } catch(e) {}
  }
  const page = pages[0] || await context.newPage();

  const summary = {
    subredditsScanned: 0,
    totalPostsAnalyzed: 0,
    painPointsFound: [],
    errors: [],
  };

  for (const sub of SUBREDDITS) {
    try {
      let posts = await scanSubredditWithPage(page, sub);
      
      // Filter to analyzable posts
      const analyzable = posts.filter(p => !p.stickied && (p.score || 0) >= 3);
      console.log(`  [analyzable] ${analyzable.length} posts after filtering`);

      // For promising posts, fetch more details
      const promising = analyzable.filter(p => (p.num_comments || 0) >= 5).slice(0, 8);
      for (const post of promising) {
        await getPostDetails(page, post, sub);
        await new Promise(r => setTimeout(r, 1500));
      }

      // Analyze for pain points
      const painPoints = analyzePainPoints(analyzable, sub);
      console.log(`  [pain points] ${painPoints.length} found`);

      // Submit pain points
      for (const pp of painPoints) {
        try {
          await submitPainPoint(pp);
          summary.painPointsFound.push(pp.title);
          await new Promise(r => setTimeout(r, 1000));
        } catch(e) {
          console.log(`  [submit error] ${e.message}`);
          summary.errors.push(`submit: ${e.message}`);
        }
      }

      // Log scan result
      await logScan(sub, analyzable.length, painPoints.length, 'completed');
      summary.subredditsScanned++;
      summary.totalPostsAnalyzed += analyzable.length;

      // Pace between subreddits
      await new Promise(r => setTimeout(r, 3000));

    } catch(e) {
      console.log(`  [ERROR scanning r/${sub}] ${e.message}`);
      summary.errors.push(`r/${sub}: ${e.message}`);
      await logScan(sub, 0, 0, 'error');
    }
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${summary.subredditsScanned}`);
  console.log(`Total posts analyzed: ${summary.totalPostsAnalyzed}`);
  console.log(`Pain points found: ${summary.painPointsFound.length}`);
  summary.painPointsFound.forEach((t, i) => console.log(`  ${i+1}. ${t}`));
  if (summary.errors.length > 0) {
    console.log(`Errors: ${summary.errors.join('; ')}`);
  }

  // Don't close browser — admin agent handles that
  await browser.close(); // disconnect only, not kill
}

main().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
