#!/usr/bin/env node
// Analyze Reddit JSON API data and submit pain points to the dashboard
const https = require('https');

const AGENT_ID = 'ty-m';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const SUBREDDITS = ['bikecommuting', 'gravelcycling', 'bikewrench', 'fuckcars'];
const CATEGORY = 'Cycling';

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' }
    };
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse error: ' + e.message)); }
      });
    }).on('error', reject);
  });
}

function apiPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = require('http').request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(responseData) }); }
        catch(e) { resolve({ status: res.statusCode, body: responseData }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function fetchSubreddit(subreddit) {
  const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=25&raw_json=1`;
  console.log(`\nFetching r/${subreddit}...`);
  const data = await httpsGet(url);
  if (!data?.data?.children) {
    console.log(`No data for r/${subreddit}`);
    return [];
  }
  const posts = data.data.children
    .filter(c => !c.data.stickied && c.data.score >= 5 && c.data.title)
    .map(c => ({
      id: c.data.id,
      title: c.data.title,
      score: c.data.score,
      comments: c.data.num_comments,
      permalink: c.data.permalink,
      body: (c.data.selftext || '').slice(0, 2000),
      subreddit: c.data.subreddit,
      url: `https://reddit.com${c.data.permalink}`
    }));
  console.log(`  Got ${posts.length} posts`);
  return posts;
}

// Analyze posts and extract pain points
function analyzePainPoints(posts, subreddit) {
  const painPoints = [];
  
  for (const post of posts) {
    const text = (post.title + ' ' + post.body).toLowerCase();
    
    // Skip pure image posts (no body) with low comments
    if (!post.body && post.comments < 10) continue;
    
    // Skip memes/celebrations/humor indicators
    if (post.title.match(/^(hi |my commute|love |🚲|beautiful|scenic|[a-z]+ dew:|kona)/i) && !post.body) continue;
    
    let painPoint = null;
    
    // Pattern: asking for tools/apps/solutions
    if (text.match(/is there (an?|any) (app|tool|way|solution|software)/i) ||
        text.match(/best (way|tool|app|method) to/i) ||
        text.match(/how (do|can|should) (i|you)/i) ||
        text.match(/any (recommendations?|suggestions?|advice)/i)) {
      painPoint = { post, type: 'seeking_solution' };
    }
    
    // Pattern: frustration/complaint
    if (!painPoint && (
        text.match(/frustrat|annoying|hate|horrible|problem|issue|struggle|difficult|hard to/i) ||
        text.match(/(doesn't|don't|can't|won't|isn't) work/i))) {
      painPoint = { post, type: 'frustration' };
    }
    
    // Pattern: cost/price pain
    if (!painPoint && text.match(/(expensive|costly|price|cost|afford|cheap|budget)/i)) {
      painPoint = { post, type: 'cost_pain' };
    }
    
    // Pattern: safety concerns  
    if (!painPoint && (
        text.match(/unsafe|dangerous|safety|risk|accident|close call|near miss/i) ||
        text.match(/driver|car|traffic/i)) && post.comments >= 10) {
      painPoint = { post, type: 'safety' };
    }
    
    // Pattern: process/workflow pain (measuring, tracking, planning)
    if (!painPoint && text.match(/(track|measure|mileage|plan|organize|schedule|log|record)/i) && post.body) {
      painPoint = { post, type: 'workflow' };
    }
    
    if (painPoint && post.comments >= 5) {
      painPoints.push(painPoint);
    }
  }
  
  return painPoints;
}

// Map to dashboard pain point format
function formatPainPoint(pp, subreddit) {
  const { post, type } = pp;
  
  let title = post.title.slice(0, 80);
  let description = '';
  
  if (post.body && post.body.length > 50) {
    // Use first 300 chars of body as description supplement
    const bodyExcerpt = post.body.slice(0, 300).replace(/\n/g, ' ');
    description = `Reddit cyclists discuss: "${bodyExcerpt}..." (${post.comments} comments, ${post.score} upvotes)`;
  } else {
    description = `High-engagement post in r/${subreddit} with ${post.comments} comments and ${post.score} upvotes. Type: ${type} pain point.`;
  }
  
  description = description.slice(0, 500);
  
  return {
    title,
    description,
    category: CATEGORY,
    subreddit: `r/${subreddit}`,
    discoveredBy: AGENT_ID,
    redditPostId: post.id,
    redditUrl: post.url,
    postTitle: post.title,
    postBody: post.body,
    upvotes: post.score,
    commentCount: post.comments
  };
}

async function submitPainPoint(formatted) {
  // Create pain point
  const createRes = await apiPost('/api/pain-points', {
    title: formatted.title,
    description: formatted.description,
    category: formatted.category,
    subreddit: formatted.subreddit,
    discoveredBy: formatted.discoveredBy
  });
  
  console.log(`  Create pain point: ${createRes.status}`, JSON.stringify(createRes.body).slice(0, 200));
  
  if (createRes.status !== 200 && createRes.status !== 201) {
    return null;
  }
  
  const id = createRes.body?.id || createRes.body?.data?.id;
  if (!id) {
    console.log('  No ID returned from create');
    return null;
  }
  
  // Link source post
  const linkRes = await apiPost('/api/pain-points/posts', {
    painPointId: id,
    redditPostId: formatted.redditPostId,
    redditUrl: formatted.redditUrl,
    postTitle: formatted.postTitle,
    postBody: formatted.postBody,
    upvotes: formatted.upvotes,
    commentCount: formatted.commentCount,
    subreddit: formatted.subreddit,
    discoveredBy: formatted.discoveredBy
  });
  
  console.log(`  Link post: ${linkRes.status}`);
  return id;
}

async function logScan(subreddit, postsScanned, painPointsFound, status) {
  const res = await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned,
    painPointsFound,
    status
  });
  console.log(`  Scan log: ${res.status}`);
}

async function main() {
  console.log('=== TY-M Pain Point Scanner ===');
  const summary = [];
  
  for (const subreddit of SUBREDDITS) {
    console.log(`\n--- r/${subreddit} ---`);
    let posts = [];
    let error = null;
    
    try {
      posts = await fetchSubreddit(subreddit);
      await new Promise(r => setTimeout(r, 2000)); // rate limit
    } catch (e) {
      console.log(`  Error fetching: ${e.message}`);
      error = e.message;
    }
    
    if (error) {
      await logScan(subreddit, 0, 0, 'error');
      summary.push({ subreddit, postsScanned: 0, painPointsFound: 0, error });
      continue;
    }
    
    // Analyze
    const painPoints = analyzePainPoints(posts, subreddit);
    console.log(`  Identified ${painPoints.length} potential pain points`);
    
    // Submit top pain points (max 5 per subreddit to avoid spam)
    const toSubmit = painPoints.slice(0, 5);
    let submitted = 0;
    const submittedTitles = [];
    
    for (const pp of toSubmit) {
      try {
        const formatted = formatPainPoint(pp, subreddit);
        console.log(`  Submitting: "${formatted.title.slice(0, 60)}..."`);
        const id = await submitPainPoint(formatted);
        if (id) {
          submitted++;
          submittedTitles.push(formatted.title);
        }
        await new Promise(r => setTimeout(r, 1000));
      } catch (e) {
        console.log(`  Submit error: ${e.message}`);
      }
    }
    
    // Log scan
    await logScan(subreddit, posts.length, submitted, 'completed');
    
    summary.push({
      subreddit,
      postsScanned: posts.length,
      painPointsFound: submitted,
      submittedTitles
    });
    
    await new Promise(r => setTimeout(r, 3000)); // pause between subreddits
  }
  
  console.log('\n\n=== FINAL SUMMARY ===');
  for (const s of summary) {
    console.log(`\nr/${s.subreddit}:`);
    console.log(`  Posts scanned: ${s.postsScanned}`);
    console.log(`  Pain points submitted: ${s.painPointsFound}`);
    if (s.submittedTitles) {
      s.submittedTitles.forEach(t => console.log(`    - ${t.slice(0, 70)}`));
    }
    if (s.error) console.log(`  Error: ${s.error}`);
  }
  
  const total = summary.reduce((a, b) => a + b.painPointsFound, 0);
  const totalPosts = summary.reduce((a, b) => a + b.postsScanned, 0);
  console.log(`\nTotal: ${totalPosts} posts scanned, ${total} pain points submitted`);
}

main().catch(console.error);
