/**
 * Reddit Pain Point Scanner — priya-k
 * Subreddits: Meditation, Anxiety, therapists, Journaling
 * CDP URL: ws://127.0.0.1:50797/devtools/browser/62b91dc1-9c00-49f9-bb6c-d63bb38086e0
 */

const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:50797/devtools/browser/62b91dc1-9c00-49f9-bb6c-d63bb38086e0';
const AGENT_ID = 'priya-k';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const SUBREDDITS = ['Meditation', 'Anxiety', 'therapists', 'Journaling'];

const CATEGORY_MAP = {
  'Meditation': 'Mental Health',
  'Anxiety': 'Mental Health',
  'therapists': 'Therapy',
  'Journaling': 'Journaling',
};

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

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchRedditJSON(sub) {
  const url = `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
  });
  const json = await res.json();
  return json?.data?.children?.map(c => c.data) || [];
}

async function scanSubreddit(page, sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  let posts = [];
  let usedFallback = false;

  try {
    await page.goto(`https://www.reddit.com/r/${sub}/hot/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    // Scroll to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    // Try to extract posts from the page
    const pageContent = await page.content();
    
    // Check if we got a CAPTCHA or login wall
    if (pageContent.includes('captcha') || pageContent.includes('Log In') && pageContent.includes('Sign Up') && !pageContent.includes('shreddit-post')) {
      console.log(`  Possible login wall detected on r/${sub}, trying JSON fallback`);
      usedFallback = true;
      posts = await fetchRedditJSON(sub);
    } else {
      // Try to extract post data from shreddit
      posts = await page.evaluate(() => {
        const postElements = document.querySelectorAll('shreddit-post');
        const results = [];
        postElements.forEach(el => {
          const title = el.getAttribute('post-title') || el.querySelector('h1, h2, h3, [slot="title"]')?.textContent?.trim();
          const score = parseInt(el.getAttribute('score') || '0');
          const commentCount = parseInt(el.getAttribute('comment-count') || '0');
          const postId = el.getAttribute('id') || el.getAttribute('post-id') || '';
          const permalink = el.getAttribute('permalink') || '';
          const postBody = el.querySelector('[slot="text-body"]')?.textContent?.trim() || '';
          
          if (title) {
            results.push({ title, score, num_comments: commentCount, id: postId, permalink, selftext: postBody, subreddit: '' });
          }
        });
        
        // Also try article-based layout
        if (results.length === 0) {
          const articles = document.querySelectorAll('article, [data-testid="post-container"], .Post');
          articles.forEach(el => {
            const titleEl = el.querySelector('h3, h1, [data-click-id="text"] h3');
            const title = titleEl?.textContent?.trim();
            if (title) {
              results.push({ title, score: 0, num_comments: 0, id: '', permalink: '', selftext: '', subreddit: '' });
            }
          });
        }
        return results;
      });
      
      if (posts.length < 3) {
        console.log(`  Only ${posts.length} posts found via browser, trying JSON fallback`);
        usedFallback = true;
        posts = await fetchRedditJSON(sub);
      }
    }
  } catch (err) {
    console.log(`  Browser error: ${err.message}, trying JSON fallback`);
    usedFallback = true;
    try {
      posts = await fetchRedditJSON(sub);
    } catch (err2) {
      console.log(`  JSON fallback also failed: ${err2.message}`);
      posts = [];
    }
  }

  if (usedFallback) {
    console.log(`  Used JSON fallback, got ${posts.length} posts`);
  } else {
    console.log(`  Got ${posts.length} posts from browser`);
  }

  // Filter posts
  const validPosts = posts.filter(p => {
    if (!p.title) return false;
    if (p.score < 5 && !usedFallback) return false;
    if (p.stickied) return false;
    return true;
  });

  console.log(`  Valid posts to analyze: ${validPosts.length}`);

  // Analyze for pain points
  const painPoints = [];
  const category = CATEGORY_MAP[sub] || 'Mental Health';

  for (const post of validPosts.slice(0, 25)) {
    const title = post.title || '';
    const body = post.selftext || '';
    const combined = (title + ' ' + body).toLowerCase();

    // Check for pain point signals
    const isPainPoint = (
      // Tool/app requests
      /is there (an? )?(app|tool|website|software|platform|resource|way|method|technique|system)/i.test(combined) ||
      /anyone (know|found|use|tried|recommend)/i.test(combined) ||
      /\b(struggling|struggle|difficult|hard|impossible|frustrat|overwhelm|exhaust|burnout|stuck|lost|confused|anxious|anxiety|depress|overwhelmed)\b/i.test(combined) ||
      // Problem descriptions
      /\b(can't|cannot|don't know how|no idea|wish|if only|need help|need advice|looking for)\b/i.test(combined) ||
      // Process complaints
      /\b(manual|manually|every day|every week|keep track|tracking|organize|organized|consistency|consistent|habit|routine)\b/i.test(combined) ||
      // Cost/complexity complaints
      /\b(too expensive|too complex|too complicated|overpriced|affordable|free alternative|hate that|annoying|annoyed)\b/i.test(combined) ||
      // Community-specific pain points for mental health/journaling
      /\b(therapist|therapy|session|appointment|waitlist|wait list|afford|insurance|copay|access|find a|finding)\b/i.test(combined) ||
      /\b(meditat|mindful|breath|focus|distract|racing thoughts|monkey mind|guided|consistency|habit)\b/i.test(combined) ||
      /\b(journal|prompt|blank page|where to start|what to write|track mood|mood tracker|gratitude)\b/i.test(combined) ||
      /\b(anxiety|panic|trigger|coping|cope|manage|management|technique|strategy)\b/i.test(combined)
    );

    // Exclude pure venting/celebration/memes
    const isExcluded = (
      /\b(thank you|thanks everyone|update:|good news|proud of|excited to|just wanted to share|celebration)\b/i.test(combined) ||
      post.num_comments < 2
    );

    if (isPainPoint && !isExcluded) {
      painPoints.push(post);
    }
  }

  console.log(`  Pain points identified: ${painPoints.length}`);

  // Submit pain points
  let submitted = 0;
  for (const post of painPoints.slice(0, 8)) {
    // Generate a clear title
    let ppTitle = post.title.substring(0, 80);

    // Generate description
    const bodySnippet = post.selftext ? post.selftext.substring(0, 200) : '';
    let description = `Users in r/${sub} are experiencing: "${post.title}".`;
    if (bodySnippet) {
      description += ` Context: ${bodySnippet.substring(0, 150)}...`;
    }
    description += ` This is a recurring pain point in the ${category.toLowerCase()} community.`;
    description = description.substring(0, 300);

    try {
      // Create pain point
      const ppRes = await apiPost('/api/pain-points', {
        title: ppTitle,
        description,
        category,
        subreddit: `r/${sub}`,
        discoveredBy: AGENT_ID,
      });

      // API wraps response in { painPoint: { id, ... } }
      const ppId = ppRes?.painPoint?.id || ppRes?.id || ppRes?.data?.id;

      if (ppId) {
        console.log(`  ✓ Created pain point: "${ppTitle}" (id: ${ppId})`);

        // Build Reddit URL
        let redditUrl = `https://reddit.com/r/${sub}/comments/${post.id}/`;
        if (post.permalink) {
          redditUrl = `https://reddit.com${post.permalink}`;
        }

        // Link source post
        await apiPost('/api/pain-points/posts', {
          painPointId: ppId,
          redditPostId: post.id || '',
          redditUrl,
          postTitle: post.title,
          postBody: (post.selftext || '').substring(0, 2000),
          upvotes: post.score || 0,
          commentCount: post.num_comments || 0,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID,
        });

        submitted++;
      } else {
        console.log(`  ✗ Failed to create pain point (no id): ${JSON.stringify(ppRes).substring(0, 150)}`);
      }
    } catch (err) {
      console.log(`  ✗ API error: ${err.message}`);
    }

    await sleep(500);
  }

  // Log scan results
  try {
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned: validPosts.length,
      painPointsFound: submitted,
      status: 'completed',
    });
    console.log(`  ✓ Scan log submitted for r/${sub}`);
  } catch (err) {
    console.log(`  ✗ Scan log error: ${err.message}`);
  }

  return { sub, postsScanned: validPosts.length, painPointsFound: submitted };
}

async function main() {
  console.log('=== Priya-K Reddit Scanner Starting ===');
  console.log(`CDP: ${CDP_URL}`);
  console.log(`Subreddits: ${SUBREDDITS.join(', ')}`);

  let browser;
  const results = [];

  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('✓ Connected to AdsPower browser');

    const context = browser.contexts()[0];
    const pages = context.pages();
    
    // Close extra tabs
    for (let i = 1; i < pages.length; i++) {
      await pages[i].close().catch(() => {});
    }
    const page = pages[0] || await context.newPage();
    console.log(`✓ Using page, ${pages.length} tab(s) found`);

    for (const sub of SUBREDDITS) {
      try {
        const result = await scanSubreddit(page, sub);
        results.push(result);
        await sleep(3000); // Natural pacing between subreddits
      } catch (err) {
        console.log(`✗ Error scanning r/${sub}: ${err.message}`);
        results.push({ sub, postsScanned: 0, painPointsFound: 0, error: err.message });
        
        // Log as error
        await apiPost('/api/pain-points/scan-logs', {
          agentId: AGENT_ID,
          subreddit: `r/${sub}`,
          postsScanned: 0,
          painPointsFound: 0,
          status: 'error',
        }).catch(() => {});
      }
    }

  } catch (err) {
    console.log(`✗ Fatal error: ${err.message}`);
    console.error(err);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  // Summary
  console.log('\n=== SCAN SUMMARY ===');
  let totalPosts = 0;
  let totalPainPoints = 0;
  for (const r of results) {
    console.log(`  r/${r.sub}: ${r.postsScanned} posts scanned, ${r.painPointsFound} pain points found${r.error ? ` [ERROR: ${r.error}]` : ''}`);
    totalPosts += r.postsScanned || 0;
    totalPainPoints += r.painPointsFound || 0;
  }
  console.log(`\nTOTAL: ${SUBREDDITS.length} subreddits, ${totalPosts} posts, ${totalPainPoints} pain points`);
  
  return results;
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
