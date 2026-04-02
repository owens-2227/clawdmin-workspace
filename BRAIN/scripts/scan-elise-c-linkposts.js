// Link Reddit source posts to existing pain points created by elise-c
// Also logs scan results

const AGENT_ID = 'elise-c';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const SUBREDDITS = ['cats', 'rawpetfood', 'ThriftStoreHauls', 'felinediabetes', 'EatCheapAndHealthy', 'lawncare'];

const CATEGORY_MAP = {
  cats: 'Cats & Pets',
  rawpetfood: 'Cats & Pets',
  felinediabetes: 'Cats & Pets',
  ThriftStoreHauls: 'Thrifting',
  EatCheapAndHealthy: 'Cooking',
  lawncare: 'Gardening',
};

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'x-api-key': API_KEY },
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function fetchSubredditJSON(sub) {
  try {
    const res = await fetch(`https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });
    const json = await res.json();
    return json.data?.children?.map(c => c.data) || [];
  } catch (e) {
    console.error(`JSON fetch failed for ${sub}:`, e.message);
    return [];
  }
}

function isPainPoint(post) {
  if (post.score < 5) return false;
  if (post.stickied) return false;
  const text = (post.title + ' ' + (post.selftext || '')).toLowerCase();
  const signals = [
    'how do i', 'how can i', 'struggling', 'frustrated', 'annoying', 'difficult',
    'is there an app', 'is there a tool', 'is there a way', 'anyone else have',
    'keep track', 'tracking', 'organize', 'manage', 'automate', 'manually',
    'expensive', 'complicated', 'confusing', 'overwhelmed', 'help me',
    'need advice', 'looking for', 'recommend', 'alternative to',
    'problem', 'issue', 'trouble', 'hard to', 'cant figure', "can't figure",
    'wish there was', 'why is it so', 'does anyone know', 'anyone have a solution',
    'spreadsheet', 'calculator', 'reminder', 'schedule', 'planning',
    'cost', 'budget', 'afford', 'cheap', 'free option',
    'vet', 'diagnosis', 'treatment', 'insulin', 'glucose', 'blood sugar',
    'raw diet', 'feeding', 'transition', 'recipe', 'meal prep',
    'thrift', 'resell', 'find', 'identify', 'price check',
    'lawn', 'grass', 'weed', 'fertilize', 'mow', 'disease',
  ];
  return signals.some(s => text.includes(s));
}

async function main() {
  console.log('Fetching existing pain points created by elise-c...');
  const existing = await apiGet(`/api/pain-points?discoveredBy=${AGENT_ID}&limit=100`);
  const existingPPs = existing?.painPoints || [];
  console.log(`Found ${existingPPs.length} existing pain points`);

  const subResults = {};
  
  for (const sub of SUBREDDITS) {
    console.log(`\n=== Processing r/${sub} ===`);
    const category = CATEGORY_MAP[sub] || 'General';
    
    // Get reddit posts
    const posts = await fetchSubredditJSON(sub);
    const painPointPosts = posts.filter(isPainPoint).slice(0, 5);
    console.log(`  ${posts.length} total posts, ${painPointPosts.length} pain point candidates`);
    
    // Find matching pain points by subreddit and title match
    const subPPs = existingPPs.filter(pp => pp.subreddit === `r/${sub}`);
    console.log(`  ${subPPs.length} existing pain points for this sub`);
    
    let linked = 0;
    let newPPs = 0;
    
    for (const post of painPointPosts) {
      const postTitle = post.title.substring(0, 80);
      
      // Check if we already have a PP for this
      let ppId = subPPs.find(pp => pp.title === postTitle)?.id;
      
      if (!ppId) {
        // Create new pain point
        console.log(`  [NEW] "${postTitle.substring(0, 60)}..."`);
        const res = await apiPost('/api/pain-points', {
          title: postTitle,
          description: `From r/${post.subreddit}: ${post.title}${post.selftext ? '. ' + post.selftext.substring(0, 300) : ''}`.substring(0, 400),
          category,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID,
        });
        ppId = res?.id || res?.data?.id || res?.painPoint?.id;
        if (ppId) newPPs++;
      } else {
        console.log(`  [EXISTS] "${postTitle.substring(0, 60)}..." → ${ppId}`);
      }
      
      if (ppId) {
        // Link source post
        const linkRes = await apiPost('/api/pain-points/posts', {
          painPointId: ppId,
          redditPostId: post.id,
          redditUrl: `https://reddit.com${post.permalink}`,
          postTitle: post.title,
          postBody: (post.selftext || '').substring(0, 2000),
          upvotes: post.score,
          commentCount: post.num_comments,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID,
        });
        const linkId = linkRes?.id || linkRes?.post?.id || linkRes?.painPointPost?.id;
        if (linkId || typeof linkRes === 'object') {
          linked++;
          console.log(`    ✓ Linked post ${post.id}`);
        } else {
          console.log(`    ⚠ Link response: ${JSON.stringify(linkRes).substring(0, 100)}`);
        }
      }
      
      await sleep(300);
    }
    
    subResults[sub] = { postsScanned: posts.length, painPointsFound: newPPs + subPPs.length, linked };
    
    // Log scan results
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned: posts.length,
      painPointsFound: newPPs + subPPs.length,
      status: 'completed',
    });
    console.log(`  ✓ Logged scan: ${posts.length} posts, ${newPPs + subPPs.length} pain points, ${linked} linked`);
    
    await sleep(1000);
  }
  
  console.log('\n=== FINAL SUMMARY ===');
  let totalPosts = 0, totalPPs = 0, totalLinked = 0;
  for (const [sub, r] of Object.entries(subResults)) {
    console.log(`r/${sub}: ${r.postsScanned} posts → ${r.painPointsFound} pain points, ${r.linked} posts linked`);
    totalPosts += r.postsScanned;
    totalPPs += r.painPointsFound;
    totalLinked += r.linked;
  }
  console.log(`\nTotals: ${totalPosts} posts scanned, ${totalPPs} pain points, ${totalLinked} posts linked`);
}

main().then(() => {
  console.log('\nDone.');
  process.exit(0);
}).catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
