// Fix script: link source posts to already-created pain points
// Pain points were created but linking failed due to response structure mismatch

const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const AGENT_ID = 'ty-m';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function fetchRedditJson(sub) {
  const url = `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Map of pain point IDs to their Reddit post titles (from the prior run)
const painPoints = [
  // bikecommuting
  { id: '9b23990d-7129-4a7c-9f8f-1d5c20644301', titleMatch: 'The old lady with double panniers', sub: 'bikecommuting' },
  { id: '169d1e50-cb73-4f5e-b34d-43239a593c4f', titleMatch: 'Dash" Cam Recommendations', sub: 'bikecommuting' },
  { id: '4a9ddf06-c92c-4e0a-b31a-8dab0b5793ae', titleMatch: 'Taking Bike on Amtrak', sub: 'bikecommuting' },
  { id: 'f41e84ac-3d93-4b84-9e76-15186740d8cf', titleMatch: 'lack of bike infrastructure', sub: 'bikecommuting' },
  // gravelcycling
  { id: '15bb2fe8-3d38-4051-9d2d-2729558fd959', titleMatch: 'bored with black components', sub: 'gravelcycling' },
  { id: '4bbaca24-0884-42b2-b633-0e874ec18e64', titleMatch: 'SRAM chain quick links', sub: 'gravelcycling' },
  // bikewrench
  { id: 'b0e05bc2-7853-41a3-b719-25dabbf800f3', titleMatch: 'convert this bike to a fixed gear', sub: 'bikewrench' },
  { id: '5af41e77-37da-4409-8b26-c9e13df8ced5', titleMatch: 'Need help to choose', sub: 'bikewrench' },
  // fuckcars
  { id: '33c086be-2fd4-42ae-a5dd-e7f34ef65f53', titleMatch: "Job doesn't require driving", sub: 'fuckcars' },
  { id: '9f41e7c8-97b8-49d6-9c74-01a0ab559407', titleMatch: 'Auto insurance companies punish', sub: 'fuckcars' },
  { id: '746d9fb1-35eb-4ef4-ae45-5ad285ae22a9', titleMatch: 'never go back to using a car', sub: 'fuckcars' },
];

async function main() {
  console.log('Fetching subreddit data to link source posts...');

  const subreddits = ['bikecommuting', 'gravelcycling', 'bikewrench', 'fuckcars'];
  const postsBySubreddit = {};

  for (const sub of subreddits) {
    try {
      const json = await fetchRedditJson(sub);
      postsBySubreddit[sub] = json.data.children.map(c => c.data);
      console.log(`[${sub}] Fetched ${postsBySubreddit[sub].length} posts`);
      await sleep(1000);
    } catch (err) {
      console.log(`[${sub}] Error: ${err.message}`);
      postsBySubreddit[sub] = [];
    }
  }

  let linked = 0;
  for (const pp of painPoints) {
    const posts = postsBySubreddit[pp.sub] || [];
    const match = posts.find(p => p.title.includes(pp.titleMatch) || pp.titleMatch.split(' ').every(word => p.title.includes(word)));
    
    if (!match) {
      console.log(`[${pp.sub}] No match found for: "${pp.titleMatch}"`);
      // Try partial match
      const partial = posts.find(p => {
        const words = pp.titleMatch.toLowerCase().split(' ');
        const title = p.title.toLowerCase();
        return words.filter(w => w.length > 4).some(w => title.includes(w));
      });
      if (partial) {
        console.log(`[${pp.sub}] Partial match: "${partial.title}"`);
      }
      continue;
    }

    console.log(`[${pp.sub}] Linking "${match.title}" to pain point ${pp.id}`);
    
    const res = await apiPost('/api/pain-points/posts', {
      painPointId: pp.id,
      redditPostId: match.id,
      redditUrl: `https://reddit.com${match.permalink}`,
      postTitle: match.title,
      postBody: (match.selftext || '').substring(0, 2000),
      upvotes: match.score,
      commentCount: match.num_comments,
      subreddit: `r/${pp.sub}`,
      discoveredBy: AGENT_ID
    });
    
    console.log(`  -> Response: ${JSON.stringify(res).substring(0, 100)}`);
    linked++;
    await sleep(300);
  }

  // Update scan logs with correct counts
  const subCounts = {};
  for (const pp of painPoints) {
    subCounts[pp.sub] = (subCounts[pp.sub] || 0) + 1;
  }

  const scanCounts = {
    bikecommuting: { posts: 19, pp: 4 },
    gravelcycling: { posts: 18, pp: 2 },
    bikewrench: { posts: 4, pp: 2 },
    fuckcars: { posts: 22, pp: 3 }
  };

  for (const [sub, counts] of Object.entries(scanCounts)) {
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned: counts.posts,
      painPointsFound: counts.pp,
      status: 'completed'
    });
    console.log(`[${sub}] Updated scan log: ${counts.posts} posts, ${counts.pp} pain points`);
  }

  console.log(`\nDone! Linked ${linked}/${painPoints.length} pain points to source posts.`);
  console.log('Total pain points created: 11');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
