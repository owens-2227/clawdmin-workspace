// Fix script: Link Reddit posts to already-created pain points and update scan logs
// Pain points were created but ppRes.id was wrong (needed ppRes.painPoint.id)

const AGENT_ID = 'raj-s';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchRedditJSON(sub) {
  const res = await fetch(`https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Known pain point IDs and their titles from the previous run
const painPoints = [
  // AnalogCommunity
  { id: 'c72c7f5d-f470-4b94-97b0-f638b66939af', sub: 'AnalogCommunity', titleFragment: 'underexposed meme' },
  { id: '4be7b90d-9a46-4f87-8a2f-f0d896ed9567', sub: 'AnalogCommunity', titleFragment: 'Point n shoot 35mm' },
  { id: 'd657098e-a4e4-4548-9947-c10e753d2fcf', sub: 'AnalogCommunity', titleFragment: 'breaking point with film' },
  { id: 'a6428d65-689e-4848-a2f8-d55a8b731744', sub: 'AnalogCommunity', titleFragment: 'Blue edges when DSLR scanning' },
  { id: '13b49272-a6c9-4c25-85fe-461e609c0176', sub: 'AnalogCommunity', titleFragment: 'Me, lab or film' },
  // streetphotography
  { id: 'fd1bd0ce-6def-4c14-9751-dfd5a0d5451c', sub: 'streetphotography', titleFragment: 'New to photography' },
  { id: '36b3828f-bdac-4cb2-8b5f-02564bc692f6', sub: 'streetphotography', titleFragment: 'first year of street photography' },
  { id: 'bd8621b9-1992-4461-ae4c-377ccade23a7', sub: 'streetphotography', titleFragment: 'Allow photos in comments' },
  // MechanicalKeyboards
  { id: '51517dde-a3a7-4685-a1f9-490153918355', sub: 'MechanicalKeyboards', titleFragment: 'Leopold fc660m' },
  // photocritique
  { id: 'b82e7702-ab56-47f7-a4e4-265820067275', sub: 'photocritique', titleFragment: 'Light/Shadow composition' },
];

const subCounts = {
  AnalogCommunity: 0,
  streetphotography: 0,
  MechanicalKeyboards: 0,
  photocritique: 0
};

async function main() {
  // Group pain points by subreddit
  const bySubreddit = {};
  for (const pp of painPoints) {
    if (!bySubreddit[pp.sub]) bySubreddit[pp.sub] = [];
    bySubreddit[pp.sub].push(pp);
  }

  for (const [sub, ppList] of Object.entries(bySubreddit)) {
    console.log(`\nFetching r/${sub} to link posts...`);
    let posts = [];
    try {
      const data = await fetchRedditJSON(sub);
      if (data && data.data && data.data.children) {
        posts = data.data.children.map(c => c.data);
      }
    } catch (err) {
      console.log(`Failed to fetch r/${sub}: ${err.message}`);
      continue;
    }
    await sleep(2000);

    for (const pp of ppList) {
      // Find matching post by title fragment
      const post = posts.find(p => p.title && p.title.toLowerCase().includes(pp.titleFragment.toLowerCase()));
      if (!post) {
        console.log(`  Could not find post for: "${pp.titleFragment}"`);
        subCounts[sub]++;
        continue;
      }

      console.log(`  Linking post "${post.title}" to pain point ${pp.id}`);
      const res = await apiPost('/api/pain-points/posts', {
        painPointId: pp.id,
        redditPostId: post.id,
        redditUrl: `https://reddit.com/r/${sub}/comments/${post.id}/`,
        postTitle: post.title,
        postBody: (post.selftext || '').substring(0, 2000),
        upvotes: post.score,
        commentCount: post.num_comments,
        subreddit: `r/${sub}`,
        discoveredBy: AGENT_ID
      });
      console.log(`  Result: ${JSON.stringify(res).substring(0, 150)}`);
      subCounts[sub]++;
      await sleep(500);
    }
  }

  // Update scan logs with correct pain point counts
  console.log('\nUpdating scan logs with correct counts...');
  for (const [sub, count] of Object.entries(subCounts)) {
    const logRes = await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned: 25,
      painPointsFound: count,
      status: 'completed'
    });
    console.log(`Scan log for r/${sub} (${count} pain points): ${JSON.stringify(logRes).substring(0, 150)}`);
    await sleep(500);
  }

  console.log('\n=== FIX COMPLETE ===');
  console.log('Pain points linked and scan logs updated.');
  console.log(`Total pain points: ${painPoints.length}`);
  for (const [sub, count] of Object.entries(subCounts)) {
    console.log(`  r/${sub}: ${count}`);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
