const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:59634/devtools/browser/ff096228-bfb5-4f78-89db-b78e8c31468b';
const AGENT_ID = 'marco-v';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const SUBREDDITS = [
  { name: 'nocode', category: 'No-Code & Builders' },
  { name: 'Nootropics', category: 'Biohacking' },
  { name: 'Biohackers', category: 'Biohacking' },
  { name: 'SideProject', category: 'No-Code & Builders' },
  { name: 'personalfinance', category: 'Personal Finance' },
  { name: 'cooking', category: 'Cooking' },
  { name: 'solotravel', category: 'Solo Travel' },
  { name: 'frugal', category: 'Personal Finance' },
  { name: 'therapists', category: 'Therapy' },
  { name: 'Journaling', category: 'Journaling' },
];

async function apiPost(path, data) {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify(data),
  });
  const text = await resp.text();
  try { return JSON.parse(text); } catch(e) { return { raw: text }; }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchRedditJSON(url) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json',
    }
  });
  return resp.json();
}

async function scanSubreddit(sub, category) {
  console.log(`\n=== Scanning r/${sub} ===`);
  
  let posts = [];
  
  // Use Reddit JSON API directly
  try {
    const data = await fetchRedditJSON(`https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`);
    if (data.data && data.data.children) {
      posts = data.data.children
        .filter(c => !c.data.stickied && c.data.score >= 3)
        .map(c => ({
          title: c.data.title,
          score: c.data.score,
          comments: c.data.num_comments,
          url: `https://www.reddit.com${c.data.permalink}`,
          body: c.data.selftext || '',
          postId: c.data.id,
          flair: c.data.link_flair_text || '',
        }));
      console.log(`JSON API returned ${posts.length} posts`);
    }
  } catch (err) {
    console.log(`JSON API failed: ${err.message}`);
    return { sub, postsScanned: 0, painPointsFound: 0, error: err.message };
  }
  
  await sleep(1500);
  
  // For interesting posts with 10+ comments, fetch more details
  const interestingPosts = posts
    .filter(p => p.comments >= 10 && (p.body.length < 50))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  
  for (const post of interestingPosts) {
    try {
      const jsonUrl = `https://www.reddit.com${post.url.split('reddit.com')[1]}.json?limit=5&raw_json=1`;
      const data = await fetchRedditJSON(jsonUrl);
      if (Array.isArray(data) && data[0]) {
        const postData = data[0].data.children[0]?.data;
        if (postData) {
          post.body = postData.selftext || '';
        }
        if (data[1] && data[1].data.children) {
          post.topComments = data[1].data.children
            .slice(0, 5)
            .map(c => c.data.body)
            .filter(Boolean)
            .join('\n\n')
            .substring(0, 1000);
        }
      }
      await sleep(1500);
    } catch(e) {
      // ignore
    }
  }
  
  // Analyze pain points
  const painPoints = analyzePainPoints(posts, sub, category);
  console.log(`Found ${painPoints.length} pain points`);
  
  // Submit pain points
  let submitted = 0;
  for (const pp of painPoints) {
    try {
      const created = await apiPost('/api/pain-points', {
        title: pp.title,
        description: pp.description,
        category: pp.category,
        subreddit: `r/${sub}`,
        discoveredBy: AGENT_ID,
      });
      
      console.log(`  Create response:`, JSON.stringify(created).substring(0, 200));
      
      const ppId = created?.id || created?.data?.id || created?.painPoint?.id;
      if (ppId) {
        await apiPost('/api/pain-points/posts', {
          painPointId: ppId,
          redditPostId: pp.postId || '',
          redditUrl: pp.url,
          postTitle: pp.postTitle,
          postBody: (pp.postBody || '').substring(0, 2000),
          upvotes: pp.upvotes || 0,
          commentCount: pp.commentCount || 0,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID,
        });
        submitted++;
        console.log(`  ✓ Submitted: ${pp.title}`);
      } else {
        console.log(`  ✗ No ID in response for: ${pp.title}`);
      }
    } catch(e) {
      console.log(`  ✗ Submit failed: ${pp.title} — ${e.message}`);
    }
    await sleep(500);
  }
  
  // Log scan
  try {
    const logResp = await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned: posts.length,
      painPointsFound: submitted,
      status: 'completed',
    });
    console.log(`  Log response:`, JSON.stringify(logResp).substring(0, 100));
  } catch(e) {
    console.log(`  ✗ Failed to log scan: ${e.message}`);
  }
  
  return { sub, postsScanned: posts.length, painPointsFound: submitted };
}

function analyzePainPoints(posts, sub, category) {
  const painPoints = [];
  
  const painKeywords = [
    'how do i', 'is there an app', 'is there a tool', 'is there a way', 
    'struggling with', 'frustrated', 'annoying', 'wish there was', 
    "can't find", 'manually', 'spreadsheet', 'too expensive', 'complicated',
    'overwhelmed', 'hard to', 'difficult to', 'need help', 'recommendations',
    'looking for', 'automate', 'track', 'organize', 'manage', 'reminder',
    'hate that', 'problem with', 'issue with', 'anyone else', 'tips for',
    'advice on', 'help with', 'better way', 'what do you use', 'best way',
    'how to', "don't know how", 'confused', 'help me', 'suggest', 'recommend',
    'workflow', 'pain point', 'challenge', 'nightmare', 'impossible',
    'no way to', 'wish i could', 'lack of', 'missing feature',
  ];
  
  const skipKeywords = [
    'my ex', 'my husband', 'my wife', 'my boyfriend', 'my girlfriend',
    'relationship advice', 'breakup', 'divorce', 'meme', ' lol ', 'funny',
    'update:', 'i did it', 'success', 'achievement',
  ];
  
  for (const post of posts) {
    const titleLower = post.title.toLowerCase();
    const bodyLower = (post.body || '').toLowerCase();
    const combined = titleLower + ' ' + bodyLower;
    
    const isPainPoint = painKeywords.some(kw => combined.includes(kw));
    if (!isPainPoint) continue;
    if (skipKeywords.some(kw => combined.includes(kw))) continue;
    
    // Build description
    let description = '';
    if (post.body && post.body.length > 50) {
      description = post.body.substring(0, 300).replace(/\n+/g, ' ').trim();
    } else {
      description = `Users in r/${sub} asking about or struggling with this issue. Post has ${post.score} upvotes and ${post.comments} comments indicating community interest.`;
    }
    
    if (post.topComments) {
      description += ` Top responses: ${post.topComments.substring(0, 150)}`;
    }
    
    let title = post.title;
    if (title.length > 80) title = title.substring(0, 77) + '...';
    
    painPoints.push({
      title,
      description: description.substring(0, 500),
      category,
      subreddit: sub,
      postTitle: post.title,
      postBody: post.body || '',
      url: post.url,
      postId: post.postId || '',
      upvotes: post.score || 0,
      commentCount: post.comments || 0,
    });
  }
  
  // Return top 5 by engagement
  return painPoints
    .sort((a, b) => (b.upvotes + b.commentCount * 2) - (a.upvotes + a.commentCount * 2))
    .slice(0, 5);
}

async function main() {
  // Quick check: test API connectivity
  console.log('Testing API connectivity...');
  try {
    const resp = await fetch(`${API_BASE}/api/pain-points`, {
      headers: { 'x-api-key': API_KEY }
    });
    console.log(`API status: ${resp.status}`);
  } catch(e) {
    console.log(`API unreachable: ${e.message}`);
  }
  
  const results = [];
  
  for (const { name, category } of SUBREDDITS) {
    try {
      const result = await scanSubreddit(name, category);
      results.push(result);
    } catch (err) {
      console.log(`Error scanning r/${name}: ${err.message}`);
      results.push({ sub: name, postsScanned: 0, painPointsFound: 0, error: err.message });
      
      try {
        await apiPost('/api/pain-points/scan-logs', {
          agentId: AGENT_ID,
          subreddit: `r/${name}`,
          postsScanned: 0,
          painPointsFound: 0,
          status: 'error',
        });
      } catch(e) {}
    }
    
    await sleep(2000);
  }
  
  // Summary
  console.log('\n=== SCAN COMPLETE ===');
  let totalPosts = 0, totalPainPoints = 0;
  for (const r of results) {
    const err = r.error ? ` (ERROR: ${r.error})` : '';
    console.log(`r/${r.sub}: ${r.postsScanned} posts scanned, ${r.painPointsFound} pain points${err}`);
    totalPosts += r.postsScanned || 0;
    totalPainPoints += r.painPointsFound || 0;
  }
  console.log(`\nTOTAL: ${results.length} subreddits, ${totalPosts} posts, ${totalPainPoints} pain points submitted`);
}

main().catch(console.error);
