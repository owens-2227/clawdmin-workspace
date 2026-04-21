#!/usr/bin/env node
// marcus-j scanner - direct Reddit JSON approach (no proxy needed)

const { execSync } = require('child_process');

const AGENT_ID = 'marcus-j';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const SUBREDDITS = [
  'Guitar', 'guitarpedals', 'Blues', 'homerecording',
  'AnalogCommunity', 'streetphotography', 'MechanicalKeyboards',
  'photocritique', 'TMJ', 'yinyoga'
];

const CATEGORY_MAP = {
  'Guitar': 'Music',
  'guitarpedals': 'Music',
  'Blues': 'Music',
  'homerecording': 'Music',
  'AnalogCommunity': 'Photography',
  'streetphotography': 'Photography',
  'MechanicalKeyboards': 'Mechanical Keyboards',
  'photocritique': 'Photography',
  'TMJ': 'TMJ & Chronic Pain',
  'yinyoga': 'Yoga',
};

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function fetchRedditJSON(subreddit, path = 'hot', limit = 25) {
  const url = `https://www.reddit.com/r/${subreddit}/${path}.json?limit=${limit}&raw_json=1`;
  try {
    const result = execSync(
      `curl -s -m 20 -H "User-Agent: ${UA}" "${url}"`,
      { maxBuffer: 5 * 1024 * 1024 }
    );
    return JSON.parse(result.toString());
  } catch (e) {
    return { error: e.message };
  }
}

function fetchCommentsJSON(subreddit, postId) {
  const url = `https://www.reddit.com/r/${subreddit}/comments/${postId}.json?limit=10&raw_json=1`;
  try {
    const result = execSync(
      `curl -s -m 15 -H "User-Agent: ${UA}" "${url}"`,
      { maxBuffer: 2 * 1024 * 1024 }
    );
    return JSON.parse(result.toString());
  } catch (e) {
    return { error: e.message };
  }
}

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
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function isPainPoint(post) {
  const title = (post.title || '').toLowerCase();
  const body = (post.selftext || '').toLowerCase();
  const combined = title + ' ' + body;

  if (post.score < 5) return false;
  if (post.stickied) return false;
  // Skip pure image posts with no selftext
  if (!post.is_self && !post.selftext && post.score < 50) return false;

  const painSignals = [
    /is there (an? )?(app|tool|software|plugin|way|method|solution|resource)/,
    /how (do|does|can|should) (i|you|we)/,
    /can'?t (figure|find|afford|get|seem to)/,
    /frustrated|frustrating|annoying|struggle|struggling/,
    /too (expensive|complex|complicated|hard|difficult)/,
    /wish (there was|i could|it had|it would|we had)/,
    /anyone else (deal|struggle|have trouble|experiencing)/,
    /best (way|method|tool|app|software|plugin|pedal|interface|mic|daw|camera|lens|technique) (to|for)/,
    /what (do you use|should i use|is the best|gear|setup|software)/,
    /help (with|me|needed)/,
    /workflow|organize|track|automate|manage/,
    /need(ing)? (help|advice|recommendation|suggestions)/,
    /looking for (a|an|some)/,
    /alternative to/,
    /keeps (breaking|crashing|freezing|happening)/,
    /beginner.*(help|advice|tips|guide)/,
    /confused|overwhelmed|lost.*guitar|lost.*recording|lost.*photo/,
    // Music specific
    /recording|mixing|mastering|tracking|latency|interface/,
    /noise|hum|buzz|ground.loop|signal.chain/,
    /pedal.*(order|chain|signal|power|noise)/,
    /daw.*(crash|slow|issue|problem|help)/,
    /how.*(tune|intonate|setup|set up|record|mix)/,
    // Photo specific
    /developing|darkroom|scanning|film.*(choice|expired|push|pull)/,
    /exposure.*(meter|wrong|off)|focusing.*(problem|issue|hard)/,
    // Keyboard specific
    /keyboard.*(build|switch|layout|lube|lubing|rattle|wobble|ping)/,
    /switch.*(feel|sound|choice|comparison)/,
    // TMJ specific
    /jaw.*(pain|clicking|locking|pop|crack)|bruxism|grinding|splint|night.?guard/,
    /tmj.*(worse|flare|trigger|help|advice|treatment)/,
    // Yoga specific
    /tight|tension|pose.*(help|advice|difficult)|flexibility|stretch/,
    /hip.*(opener|tight|pain)|back.*(pain|tight)|modification/,
  ];

  return painSignals.some(re => re.test(combined));
}

function trimTitle(title) {
  if (title.length > 80) return title.substring(0, 77) + '...';
  return title;
}

function buildDescription(post, topComments) {
  let body = (post.selftext || '').replace(/\n+/g, ' ').trim();
  let desc = body ? body.substring(0, 350) : post.title;
  if (topComments && topComments.length > 0) {
    const comment = topComments[0].replace(/\n+/g, ' ').trim().substring(0, 150);
    desc += ` Top response: "${comment}"`;
  }
  if (desc.length > 500) desc = desc.substring(0, 497) + '...';
  return desc;
}

async function scanSubreddit(subreddit) {
  console.log(`\n=== r/${subreddit} ===`);
  const category = CATEGORY_MAP[subreddit] || 'General';

  const data = fetchRedditJSON(subreddit);
  if (data.error) {
    console.log(`  ERROR: ${data.error}`);
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID, subreddit: `r/${subreddit}`,
      postsScanned: 0, painPointsFound: 0, status: 'error'
    });
    return { postsScanned: 0, painPointsFound: 0 };
  }

  const posts = (data.data?.children || []).map(c => c.data);
  console.log(`  ${posts.length} posts loaded`);

  const candidates = posts.filter(isPainPoint);
  console.log(`  ${candidates.length} pain point candidates`);

  let submitted = 0;

  for (const post of candidates) {
    const label = post.title.substring(0, 65);
    console.log(`  → ${label} (score:${post.score}, comments:${post.num_comments})`);

    let topComments = [];
    if (post.num_comments >= 8) {
      await sleep(1200);
      const cd = fetchCommentsJSON(subreddit, post.id);
      if (Array.isArray(cd) && cd[1]) {
        topComments = (cd[1].data?.children || [])
          .filter(c => c.data?.body && !['[deleted]','[removed]'].includes(c.data.body))
          .slice(0, 5)
          .map(c => c.data.body);
      }
    }

    try {
      const ppResp = await apiPost('/api/pain-points', {
        title: trimTitle(post.title),
        description: buildDescription(post, topComments),
        category,
        subreddit: `r/${subreddit}`,
        discoveredBy: AGENT_ID,
      });

      console.log(`    Created: ${JSON.stringify(ppResp).substring(0, 80)}`);
      const painPointId = ppResp?.id || null;

      await apiPost('/api/pain-points/posts', {
        painPointId,
        redditPostId: post.id,
        redditUrl: `https://reddit.com${post.permalink}`,
        postTitle: post.title,
        postBody: (post.selftext || '').substring(0, 2000),
        upvotes: post.score,
        commentCount: post.num_comments,
        subreddit: `r/${subreddit}`,
        discoveredBy: AGENT_ID,
      });

      submitted++;
    } catch (e) {
      console.log(`    Submit error: ${e.message}`);
    }

    await sleep(400);
  }

  await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned: posts.length,
    painPointsFound: submitted,
    status: 'completed',
  });

  console.log(`  Done: ${posts.length} scanned, ${submitted} submitted`);
  return { postsScanned: posts.length, painPointsFound: submitted };
}

async function main() {
  console.log('marcus-j direct scanner starting...');
  console.log(`Agent: ${AGENT_ID} | Dashboard: ${API_BASE}`);

  let totalPosts = 0;
  let totalPainPoints = 0;
  const results = [];

  for (const sub of SUBREDDITS) {
    try {
      const r = await scanSubreddit(sub);
      totalPosts += r.postsScanned;
      totalPainPoints += r.painPointsFound;
      results.push({ sub, ...r });
    } catch (e) {
      console.log(`Fatal error on r/${sub}: ${e.message}`);
      results.push({ sub, postsScanned: 0, painPointsFound: 0, error: e.message });
    }
    await sleep(2500);
  }

  console.log('\n===== SCAN COMPLETE =====');
  console.log(`Subreddits: ${SUBREDDITS.length}`);
  console.log(`Posts analyzed: ${totalPosts}`);
  console.log(`Pain points submitted: ${totalPainPoints}`);
  console.log('\nBreakdown:');
  for (const r of results) {
    const err = r.error ? ` [ERR: ${r.error.substring(0,50)}]` : '';
    console.log(`  r/${r.sub}: ${r.postsScanned} posts → ${r.painPointsFound} pain points${err}`);
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
