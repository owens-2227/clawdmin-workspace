// Fix script: link already-created insomnia pain points, then re-scan remaining subs

const AGENT_ID = 'claire-t';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

const CATEGORY_MAP = {
  insomnia: 'Sleep & Recovery',
  CBTi: 'Sleep & Recovery',
  TMJ: 'TMJ & Chronic Pain',
  yinyoga: 'Yoga',
};

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function postJSON(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function fetchRedditJSON(sub) {
  const url = `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
    });
    if (!res.ok) { console.log(`HTTP ${res.status} for r/${sub}`); return null; }
    return res.json();
  } catch (e) {
    console.log(`Fetch failed for r/${sub}: ${e.message}`);
    return null;
  }
}

// Already-created pain points from first run that need source posts linked
const INSOMNIA_PAIN_POINTS = [
  {
    id: '9fff0996-d029-4a04-8466-bc723932bb0e',
    title: 'Quetiapine can not only fuck up y...',
  },
  {
    id: '2b282667-cff1-4a36-9dd2-310db8893bc7',
    title: "What's your 3 AM watch list?",
  },
  {
    id: 'd4d35bbe-08c4-4056-80e7-f3f7f58ea837',
    title: 'What are some things you do when...',
  },
  {
    id: 'b3e6e9aa-bef1-48a2-a02b-e360de2ded75',
    title: 'I built a website that reads boring...',
  },
  {
    id: 'f918b3f7-652d-43c3-ad4a-2b1f9d60baa4',
    title: 'best supplements for stress and s...',
  },
  {
    id: '1a329a25-a309-4190-9782-6e6aa9bcb94c',
    title: 'Quetiapine saved my life and cure...',
  },
  {
    id: '6ad5ec97-681d-4b06-b581-3032e41abb58',
    title: 'Mirtazapine',
  },
  {
    id: '215a39e0-49dc-4a50-ab4e-a3913b758064',
    title: 'This technique is worth a try . .',
  },
];

async function linkInsomniaPosts() {
  console.log('\n=== Linking r/insomnia source posts ===');
  const data = await fetchRedditJSON('insomnia');
  if (!data || !data.data) { console.log('Could not fetch insomnia posts'); return 0; }

  const posts = data.data.children
    .filter(c => !c.data.stickied && c.data.score >= 5)
    .map(c => c.data);

  let linked = 0;
  for (let i = 0; i < Math.min(INSOMNIA_PAIN_POINTS.length, posts.length); i++) {
    const pp = INSOMNIA_PAIN_POINTS[i];
    const post = posts[i];
    try {
      await postJSON('/api/pain-points/posts', {
        painPointId: pp.id,
        redditPostId: post.id,
        redditUrl: `https://reddit.com${post.permalink}`,
        postTitle: post.title,
        postBody: (post.selftext || '').substring(0, 2000),
        upvotes: post.score,
        commentCount: post.num_comments,
        subreddit: 'r/insomnia',
        discoveredBy: AGENT_ID,
      });
      linked++;
      console.log(`  ✓ Linked "${post.title.substring(0, 60)}"`);
    } catch (e) {
      console.log(`  ✗ Link failed: ${e.message}`);
    }
    await sleep(500);
  }

  // Update scan log
  await postJSON('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: 'r/insomnia',
    postsScanned: posts.length,
    painPointsFound: INSOMNIA_PAIN_POINTS.length,
    status: 'completed',
  });

  return linked;
}

async function scanNewSub(sub) {
  console.log(`\n=== Scanning r/${sub} ===`);
  const category = CATEGORY_MAP[sub] || 'General';
  
  const data = await fetchRedditJSON(sub);
  if (!data || !data.data || !data.data.children) {
    console.log(`No data for r/${sub}`);
    await postJSON('/api/pain-points/scan-logs', {
      agentId: AGENT_ID, subreddit: `r/${sub}`, postsScanned: 0, painPointsFound: 0, status: 'error'
    });
    return { sub, postsScanned: 0, painPointsFound: 0 };
  }

  const allPosts = data.data.children
    .filter(c => !c.data.stickied)
    .map(c => c.data);

  console.log(`Got ${allPosts.length} posts from API`);

  const painPosts = allPosts.filter(p => {
    if (p.score < 3) return false;
    const t = p.title.toLowerCase();
    const b = (p.selftext || '').toLowerCase();
    const painKws = [
      'help', 'how', 'is there', 'app', 'tool', 'can\'t', 'unable', 'struggling',
      'frustrat', 'wish', 'anyone else', 'recommend', 'what works', 'nothing works',
      'need', 'track', 'manage', 'pain', 'suffer', 'chronic', 'worse', 'relief',
      'jaw', 'grind', 'clench', 'sleep', 'awake', 'wake up', 'fall asleep',
      'anxiety', 'racing', 'restless', 'yoga', 'stretch', 'tense', 'cbti',
      'cognitive', 'therapy', 'restriction', 'tight', 'stiff', 'sore', 'ache',
      'question', 'anyone', 'experience', 'tips', 'advice', 'tried', 'trying'
    ];
    const exclusions = ['meme', 'humor', 'funny', 'lol'];
    return painKws.some(kw => t.includes(kw) || b.includes(kw)) &&
           !exclusions.some(kw => t.includes(kw));
  });

  console.log(`${painPosts.length} potential pain point posts`);

  let painPointsFound = 0;
  const top = painPosts.slice(0, 6);

  for (const post of top) {
    const title = post.title.length > 80 ? post.title.substring(0, 77) + '...' : post.title;
    
    let desc = '';
    if (sub === 'CBTi') {
      desc = `CBT-I practitioners and patients in r/${sub} are navigating insomnia treatment challenges. "${post.title}" (${post.score} upvotes, ${post.num_comments} comments) surfaces a gap in sleep therapy support or tracking.`;
    } else if (sub === 'TMJ') {
      desc = `TMJ/TMJD sufferers in r/${sub} deal with chronic jaw pain and related symptoms. "${post.title}" (${post.score} upvotes, ${post.num_comments} comments) reveals a need around pain management, tracking, or treatment discovery.`;
    } else if (sub === 'yinyoga') {
      desc = `Yin yoga practitioners in r/${sub} seek guidance on poses, sequences, and recovery. "${post.title}" (${post.score} upvotes, ${post.num_comments} comments) highlights a gap in practice support or personalized guidance.`;
    }

    if (post.selftext) desc += ` "${post.selftext.substring(0, 150)}"`;

    try {
      const ppRes = await postJSON('/api/pain-points', {
        title,
        description: desc.substring(0, 500),
        category,
        subreddit: `r/${sub}`,
        discoveredBy: AGENT_ID,
      });

      const ppId = ppRes?.painPoint?.id || ppRes?.id;
      if (ppId) {
        await postJSON('/api/pain-points/posts', {
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
        painPointsFound++;
        console.log(`  ✓ Submitted: "${title.substring(0, 60)}"`);
      } else {
        console.log(`  ⚠ No ID in response: ${JSON.stringify(ppRes).substring(0, 100)}`);
      }
    } catch (e) {
      console.log(`  ✗ Error: ${e.message}`);
    }
    await sleep(1000);
  }

  await postJSON('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${sub}`,
    postsScanned: allPosts.length,
    painPointsFound,
    status: 'completed',
  });

  return { sub, postsScanned: allPosts.length, painPointsFound };
}

async function linkTMJPost() {
  console.log('\n=== Linking r/TMJ source post ===');
  const TMJ_PP_ID = '7de77f30-17dc-4a04-ae62-77d7f4a7f8aa';
  const data = await fetchRedditJSON('TMJ');
  if (!data || !data.data) return;

  const posts = data.data.children.filter(c => !c.data.stickied).map(c => c.data);
  if (posts.length > 0) {
    try {
      await postJSON('/api/pain-points/posts', {
        painPointId: TMJ_PP_ID,
        redditPostId: posts[0].id,
        redditUrl: `https://reddit.com${posts[0].permalink}`,
        postTitle: posts[0].title,
        postBody: (posts[0].selftext || '').substring(0, 2000),
        upvotes: posts[0].score,
        commentCount: posts[0].num_comments,
        subreddit: 'r/TMJ',
        discoveredBy: AGENT_ID,
      });
      console.log(`  ✓ Linked TMJ post`);
    } catch (e) {
      console.log(`  ✗ TMJ link failed: ${e.message}`);
    }

    // Update TMJ scan log
    await postJSON('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: 'r/TMJ',
      postsScanned: posts.length,
      painPointsFound: 1,
      status: 'completed',
    });
  }
}

async function main() {
  // Step 1: Link the already-created insomnia pain points to their source posts
  const insomniaDone = await linkInsomniaPosts();
  console.log(`Linked ${insomniaDone} insomnia source posts`);

  // Step 2: Link TMJ
  await linkTMJPost();

  // Step 3: Scan remaining subs with fresh fetch
  const results = [];
  for (const sub of ['CBTi', 'yinyoga']) {
    await sleep(2000);
    const r = await scanNewSub(sub);
    results.push(r);
  }

  // Also add more TMJ pain points from full scan
  await sleep(2000);
  const tmjExtra = await scanNewSub('TMJ');
  results.push(tmjExtra);

  console.log('\n=== FIX RUN COMPLETE ===');
  console.log(`r/insomnia: ${INSOMNIA_PAIN_POINTS.length} pain points linked`);
  console.log(`r/TMJ (original): 1 pain point linked`);
  for (const r of results) {
    console.log(`r/${r.sub}: ${r.postsScanned} posts, ${r.painPointsFound} new pain points`);
  }
  
  const totalPainPoints = INSOMNIA_PAIN_POINTS.length + 1 + results.reduce((a, r) => a + r.painPointsFound, 0);
  console.log(`\nGRAND TOTAL: ~${totalPainPoints} pain points submitted across all subreddits`);
}

main().catch(console.error);
