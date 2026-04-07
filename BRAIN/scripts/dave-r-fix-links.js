// Fix: link source posts to the pain points that were already created
// Also update scan logs with correct counts

const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const AGENT_ID = 'dave-r';

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function getRedditPostsJSON(sub) {
  const res = await fetch(`https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  const data = await res.json();
  return data?.data?.children?.map(c => c.data) || [];
}

// Pain points we created with their IDs from the output
const createdPainPoints = [
  {
    id: '0a7477d1-5048-480a-92e8-710965ee9ebc',
    title: 'Tips for enlarging hole w/ holesaw',
    subreddit: 'HomeImprovement',
  },
  {
    id: 'd68286fe-a56e-4b55-8516-a09a7d38e277',
    title: 'Need Advice - New Build CAT 6',
    subreddit: 'DIY',
  },
  {
    id: '33177cbc-c7d4-446e-b025-909b3fb52a76',
    title: 'Uneven door that catches at the top. How do I fix this?',
    subreddit: 'DIY',
  },
  {
    id: '2422939d-9632-4ef0-9a54-6ed10ae306e2',
    title: 'How do I create a concrete\\cement mould-cast for rotary line anchor?',
    subreddit: 'DIY',
  },
  {
    id: '4fcebef9-5332-4ad8-86d8-a23ce332132c',
    title: 'How to create clean plywood edges like this?',
    subreddit: 'woodworking',
  },
  {
    id: '90a43f0a-994b-4d7b-8cee-97c2f42814d6',
    title: 'Got an older Grizzly JK5005 jointer. How to restore it?',
    subreddit: 'woodworking',
  },
];

// Subreddit counts for corrected scan log
const scanCounts = {
  HomeImprovement: { postsScanned: 15, painPointsFound: 1 },
  DIY: { postsScanned: 21, painPointsFound: 3 },
  woodworking: { postsScanned: 23, painPointsFound: 2 },
  smoking: { postsScanned: 26, painPointsFound: 0 },
};

async function main() {
  console.log('Fixing source post links...');
  
  // Group pain points by subreddit
  const bySubreddit = {};
  for (const pp of createdPainPoints) {
    if (!bySubreddit[pp.subreddit]) bySubreddit[pp.subreddit] = [];
    bySubreddit[pp.subreddit].push(pp);
  }

  for (const [sub, pps] of Object.entries(bySubreddit)) {
    console.log(`\nFetching posts for r/${sub}...`);
    const posts = await getRedditPostsJSON(sub);
    
    for (const pp of pps) {
      // Find matching post by title
      const match = posts.find(p => {
        const normalizedTitle = p.title?.replace(/\\/g, '\\\\');
        return p.title === pp.title || normalizedTitle === pp.title || 
               p.title?.toLowerCase() === pp.title.toLowerCase();
      });
      
      if (match) {
        console.log(`  Found match for "${pp.title}" → post id: ${match.id}`);
        const linkRes = await apiPost('/api/pain-points/posts', {
          painPointId: pp.id,
          redditPostId: match.id,
          redditUrl: `https://reddit.com${match.permalink}`,
          postTitle: match.title,
          postBody: (match.selftext || '').substring(0, 2000),
          upvotes: match.score || 0,
          commentCount: match.num_comments || 0,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID,
        });
        console.log(`  Link result: ${JSON.stringify(linkRes).substring(0, 80)}`);
      } else {
        console.log(`  No match found for "${pp.title}" in r/${sub}`);
      }
    }
    
    await new Promise(r => setTimeout(r, 1500));
  }

  // Submit corrected scan logs
  console.log('\nSubmitting corrected scan logs...');
  for (const [sub, counts] of Object.entries(scanCounts)) {
    const logRes = await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned: counts.postsScanned,
      painPointsFound: counts.painPointsFound,
      status: 'completed',
    });
    console.log(`  r/${sub}: ${JSON.stringify(logRes).substring(0, 60)}`);
  }

  console.log('\nFix complete!');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
