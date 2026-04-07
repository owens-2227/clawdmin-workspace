const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:61314/devtools/browser/1c79175d-12cb-4073-ae45-0ba9f88a6064';
const AGENT_ID = 'nora-p';
const SUBREDDITS = ['houseplants', 'proplifting', 'plantclinic', 'IndoorGarden'];
const CATEGORY = 'Plant Parents';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

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
  try {
    return JSON.parse(text);
  } catch(e) {
    return { raw: text };
  }
}

async function submitPainPoint({ title, description, subreddit, redditPostId, redditUrl, postTitle, postBody, upvotes, commentCount }) {
  const pp = await apiPost('/api/pain-points', {
    title,
    description,
    category: CATEGORY,
    subreddit: `r/${subreddit}`,
    discoveredBy: AGENT_ID
  });
  console.log('Created pain point:', JSON.stringify(pp));

  if (pp && pp.id) {
    const linked = await apiPost('/api/pain-points/posts', {
      painPointId: pp.id,
      redditPostId,
      redditUrl,
      postTitle,
      postBody: (postBody || '').slice(0, 2000),
      upvotes: upvotes || 0,
      commentCount: commentCount || 0,
      subreddit: `r/${subreddit}`,
      discoveredBy: AGENT_ID
    });
    console.log('Linked post:', JSON.stringify(linked));
  }
  return pp;
}

async function logScan(subreddit, postsScanned, painPointsFound, status = 'completed') {
  const res = await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned,
    painPointsFound,
    status
  });
  console.log(`Logged scan for r/${subreddit}:`, JSON.stringify(res));
}

async function scanSubreddit(page, subreddit) {
  console.log(`\n=== Scanning r/${subreddit} ===`);
  const painPoints = [];
  let postsScanned = 0;

  try {
    // Try navigating to hot page
    await page.goto(`https://www.reddit.com/r/${subreddit}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    // Scroll to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    // Extract posts from the page
    const posts = await page.evaluate(() => {
      const results = [];
      
      // Try shreddit-post elements (new Reddit)
      const shredditPosts = document.querySelectorAll('shreddit-post');
      if (shredditPosts.length > 0) {
        shredditPosts.forEach(el => {
          const title = el.getAttribute('post-title') || el.querySelector('h1,h2,h3,[slot="title"]')?.textContent?.trim() || '';
          const score = parseInt(el.getAttribute('score') || el.getAttribute('upvotes') || '0');
          const commentCount = parseInt(el.getAttribute('comment-count') || '0');
          const permalink = el.getAttribute('permalink') || el.getAttribute('content-href') || '';
          const postId = el.getAttribute('id') || permalink.split('/comments/')[1]?.split('/')[0] || '';
          const isStickied = el.getAttribute('stickied') === 'true' || el.getAttribute('pinned') === 'true';
          
          if (title && !isStickied && score >= 5) {
            results.push({ title, score, commentCount, permalink, postId });
          }
        });
      }
      
      // Try old Reddit style article elements
      if (results.length === 0) {
        document.querySelectorAll('.thing.link:not(.stickied)').forEach(el => {
          const title = el.querySelector('a.title')?.textContent?.trim() || '';
          const score = parseInt(el.querySelector('.score.unvoted, .score.likes, .score.dislikes')?.getAttribute('title') || '0');
          const commentCount = parseInt(el.querySelector('.comments')?.textContent?.match(/\d+/)?.[0] || '0');
          const permalink = el.querySelector('a.title')?.getAttribute('href') || '';
          const postId = el.getAttribute('data-fullname')?.replace('t3_', '') || '';
          
          if (title && score >= 5) {
            results.push({ title, score, commentCount, permalink, postId });
          }
        });
      }
      
      return results;
    });

    console.log(`Found ${posts.length} posts on page for r/${subreddit}`);
    postsScanned = posts.length;

    // If no posts found via DOM, try JSON API fallback
    let postList = posts;
    if (posts.length === 0) {
      console.log('No posts found via DOM, trying JSON API fallback...');
      const jsonUrl = `https://www.reddit.com/r/${subreddit}/hot.json?limit=25&raw_json=1`;
      await page.goto(jsonUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(2000);
      const jsonText = await page.evaluate(() => document.body.innerText);
      try {
        const data = JSON.parse(jsonText);
        const children = data.data?.children || [];
        postList = children
          .filter(c => !c.data.stickied && c.data.score >= 5)
          .map(c => ({
            title: c.data.title,
            score: c.data.score,
            commentCount: c.data.num_comments,
            permalink: `https://www.reddit.com${c.data.permalink}`,
            postId: c.data.id,
            selftext: c.data.selftext
          }));
        postsScanned = postList.length;
        console.log(`JSON fallback found ${postList.length} posts`);
      } catch(e) {
        console.log('JSON parse failed:', e.message);
      }
    }

    // Analyze pain-point candidates — posts with 10+ comments
    const candidates = postList.filter(p => p.commentCount >= 10).slice(0, 8);
    console.log(`Analyzing ${candidates.length} candidate posts for pain points...`);

    for (const post of candidates) {
      await sleep(2000);
      const fullUrl = post.permalink.startsWith('http') ? post.permalink : `https://www.reddit.com${post.permalink}`;
      
      let postBody = post.selftext || '';
      let topComments = [];
      
      // Fetch post detail via JSON
      try {
        const detailUrl = fullUrl.replace(/\/$/, '') + '.json?limit=10&raw_json=1';
        await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await sleep(2000);
        const detailText = await page.evaluate(() => document.body.innerText);
        const detailData = JSON.parse(detailText);
        if (Array.isArray(detailData) && detailData[0]) {
          const postData = detailData[0].data?.children?.[0]?.data;
          if (postData) postBody = postData.selftext || '';
        }
        if (Array.isArray(detailData) && detailData[1]) {
          const comments = detailData[1].data?.children || [];
          topComments = comments
            .filter(c => c.kind === 't1' && c.data?.body)
            .slice(0, 5)
            .map(c => c.data.body);
        }
      } catch(e) {
        console.log(`Failed to fetch detail for post ${post.postId}: ${e.message}`);
      }

      // Analyze the post for pain points
      const combinedText = `${post.title}\n${postBody}\n${topComments.join('\n')}`.toLowerCase();
      
      const isPainPoint = (
        combinedText.match(/\b(app|tool|software|tracker|spreadsheet|automat|organize|track|manage|remind|help me|struggle|frustrat|annoying|wish there|is there a way|how do you|does anyone|hard to|difficult|impossible|keep track|forget|overwhelm|confus)\b/i) &&
        !combinedText.match(/\b(celebrat|beautiful|gorgeous|excited|proud|amazed|happy|love|obsess|update|just sharing|look at|weekly thread|megathread)\b/i)
      );

      if (isPainPoint) {
        console.log(`Pain point candidate: "${post.title}" (score: ${post.score}, comments: ${post.commentCount})`);
        
        // Generate title and description
        let ppTitle = post.title.slice(0, 80);
        let ppDesc = `Plant enthusiasts in r/${subreddit} are struggling with: "${post.title}". `;
        if (postBody && postBody.length > 20) {
          ppDesc += postBody.slice(0, 200) + (postBody.length > 200 ? '...' : '');
        } else if (topComments.length > 0) {
          ppDesc += 'Community discussion highlights the need for better tools or solutions in this area.';
        }
        ppDesc = ppDesc.slice(0, 400);

        // Refine title to be more descriptive if possible
        if (ppTitle.length < 30 && postBody.length > 30) {
          ppTitle = post.title;
        }

        try {
          const result = await submitPainPoint({
            title: ppTitle,
            description: ppDesc,
            subreddit,
            redditPostId: post.postId,
            redditUrl: fullUrl.split('?')[0],
            postTitle: post.title,
            postBody,
            upvotes: post.score,
            commentCount: post.commentCount
          });
          if (result && result.id) {
            painPoints.push({ title: ppTitle, id: result.id });
          }
        } catch(e) {
          console.log('Failed to submit pain point:', e.message);
        }
      }
    }

    await logScan(subreddit, postsScanned, painPoints.length, 'completed');
    console.log(`r/${subreddit}: scanned ${postsScanned} posts, found ${painPoints.length} pain points`);
    return { subreddit, postsScanned, painPoints };

  } catch(err) {
    console.log(`Error scanning r/${subreddit}: ${err.message}`);
    await logScan(subreddit, postsScanned, painPoints.length, 'error');
    return { subreddit, postsScanned, painPoints, error: err.message };
  }
}

async function main() {
  console.log('Connecting to AdsPower browser via CDP...');
  const browser = await chromium.connectOverCDP(CDP_URL);
  console.log('Connected!');

  const context = browser.contexts()[0];
  const pages = context.pages();
  
  // Close extra tabs
  for (let i = 1; i < pages.length; i++) await pages[i].close();
  const page = pages[0] || await context.newPage();

  const results = [];
  for (const subreddit of SUBREDDITS) {
    const result = await scanSubreddit(page, subreddit);
    results.push(result);
    await sleep(3000); // Pause between subreddits
  }

  // Summary
  console.log('\n=== SCAN COMPLETE ===');
  let totalPosts = 0;
  let totalPainPoints = 0;
  for (const r of results) {
    totalPosts += r.postsScanned;
    totalPainPoints += r.painPoints.length;
    console.log(`r/${r.subreddit}: ${r.postsScanned} posts, ${r.painPoints.length} pain points${r.error ? ` (ERROR: ${r.error})` : ''}`);
    for (const pp of r.painPoints) {
      console.log(`  - [${pp.id}] ${pp.title}`);
    }
  }
  console.log(`\nTOTAL: ${SUBREDDITS.length} subreddits, ${totalPosts} posts scanned, ${totalPainPoints} pain points found`);

  // Do NOT close the browser — admin agent handles that
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
