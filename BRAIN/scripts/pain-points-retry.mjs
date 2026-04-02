#!/usr/bin/env node
// Reddit Pain Points Scanner - Retry for rate-limited subs
// Uses 5s base delay + exponential backoff on 429

const API_BASE = 'http://localhost:3000/api/pain-points';
const API_KEY = 'openclaw-scanner-key';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Only the 44 that got 429'd
const SUBREDDITS = [
  'remotework','productivity','personalfinance','cooking','solotravel',
  'frugal','HomeImprovement','DIY','woodworking','smoking',
  'nocode','Nootropics','Biohackers','SideProject','houseplants',
  'proplifting','plantclinic','IndoorGarden','AnalogCommunity','streetphotography',
  'MechanicalKeyboards','photocritique','insomnia','CBTi','TMJ',
  'yinyoga','bikecommuting','gravelcycling','bikewrench','fuckcars',
  'Meditation','Anxiety','therapists','Journaling','Guitar',
  'guitarpedals','Blues','homerecording','cats','rawpetfood',
  'ThriftStoreHauls','felinediabetes','EatCheapAndHealthy','lawncare'
];

const CATEGORY_MAP = {
  beyondthebump:'New Moms',Mommit:'New Moms',
  running:'Fitness',xxfitness:'Fitness',
  ADHD:'ADHD & Neurodivergent',
  languagelearning:'Language Learning',
  remotework:'Remote Work',
  productivity:'Productivity',
  personalfinance:'Personal Finance',frugal:'Personal Finance',
  cooking:'Cooking',EatCheapAndHealthy:'Cooking',
  solotravel:'Solo Travel',
  HomeImprovement:'Home & DIY',DIY:'Home & DIY',woodworking:'Home & DIY',
  smoking:'BBQ & Grilling',
  nocode:'No-Code & Builders',SideProject:'No-Code & Builders',
  Nootropics:'Biohacking',Biohackers:'Biohacking',
  gardening:'Gardening',lawncare:'Gardening',
  houseplants:'Plant Parents',proplifting:'Plant Parents',plantclinic:'Plant Parents',IndoorGarden:'Plant Parents',
  AnalogCommunity:'Photography',streetphotography:'Photography',photocritique:'Photography',
  MechanicalKeyboards:'Mechanical Keyboards',
  insomnia:'Sleep & Recovery',CBTi:'Sleep & Recovery',
  TMJ:'TMJ & Chronic Pain',
  yinyoga:'Yoga',
  bikecommuting:'Cycling',gravelcycling:'Cycling',bikewrench:'Cycling',fuckcars:'Cycling',
  Meditation:'Mental Health',Anxiety:'Mental Health',
  therapists:'Therapy',
  Journaling:'Journaling',
  Guitar:'Music',guitarpedals:'Music',Blues:'Music',homerecording:'Music',
  cats:'Cats & Pets',rawpetfood:'Cats & Pets',felinediabetes:'Cats & Pets',
  ThriftStoreHauls:'Thrifting'
};

const PAIN_SIGNALS = [
  /\b(struggling|frustrated|can't figure out|help me|need help|anyone know)\b/i,
  /\b(looking for|recommend|suggestion|alternative to|better way)\b/i,
  /\b(wish there was|tired of|hate that|annoying|pain point)\b/i,
  /\b(how do (i|you)|what's the best|is there a(n)?)\b/i,
  /\b(tool|app|software|service|solution|workflow)\b/i,
  /\b(automate|track|manage|organize|schedule|budget)\b/i,
  /\b(broken|doesn't work|stopped working|unreliable)\b/i,
  /\b(too expensive|overpriced|cheaper|free alternative)\b/i,
  /\b(beginner|newbie|just started|getting into)\b/i,
  /\b(problem|issue|challenge|difficulty|trouble)\b/i,
];

const EXCLUDE_SIGNALS = [
  /\b(rant|vent|just need to vent|off my chest)\b/i,
  /\b(meme|shitpost|lol|rofl)\b/i,
  /\b(finally did it|proud of|milestone|celebration|achievement)\b/i,
  /\b(boyfriend|girlfriend|husband|wife|partner|dating|breakup|divorce)\b/i,
  /\b(political|election|trump|biden|democrat|republican)\b/i,
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchWithRetry(url, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.status === 429) {
      const wait = Math.min(30000, 5000 * Math.pow(2, attempt)); // 5s, 10s, 20s, 30s
      console.log(`    429 rate limited, waiting ${wait/1000}s (attempt ${attempt+1}/${maxRetries+1})`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  throw new Error('HTTP 429 after max retries');
}

async function apiPost(endpoint, body) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

function scorePainPoint(title, body, comments) {
  const text = `${title} ${body || ''} ${(comments || []).join(' ')}`;
  for (const pat of EXCLUDE_SIGNALS) {
    if (pat.test(text)) return -1;
  }
  let score = 0;
  for (const pat of PAIN_SIGNALS) {
    if (pat.test(title)) score += 2;
    if (pat.test(text)) score += 1;
  }
  return score;
}

function extractPainPoint(post, comments) {
  const body = post.selftext || '';
  let description = body.slice(0, 300);
  if (comments && comments.length > 0) {
    const topComment = comments[0]?.body || '';
    if (topComment) description += `\n\nTop response: ${topComment.slice(0, 200)}`;
  }
  if (!description.trim()) description = post.title;
  return { title: post.title.slice(0, 200), description: description.slice(0, 600) };
}

async function scanSubreddit(sub) {
  const result = { postsScanned: 0, painPointsFound: 0, errors: [] };
  
  try {
    const data = await fetchWithRetry(`https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`);
    const posts = (data?.data?.children || []).map(c => c.data);
    
    for (const post of posts) {
      if (post.stickied || post.score < 5) continue;
      result.postsScanned++;
      
      let commentTexts = [];
      let topComments = [];
      
      if (post.num_comments >= 10) {
        await sleep(5000);
        try {
          const cData = await fetchWithRetry(`https://www.reddit.com${post.permalink}.json?limit=10&sort=top&raw_json=1`);
          if (cData?.[1]?.data?.children) {
            topComments = cData[1].data.children
              .filter(c => c.kind === 't1')
              .map(c => c.data)
              .slice(0, 10);
            commentTexts = topComments.map(c => c.body || '');
          }
        } catch (e) { /* non-fatal */ }
      }
      
      const score = scorePainPoint(post.title, post.selftext, commentTexts);
      if (score < 3) continue;
      
      const { title, description } = extractPainPoint(post, topComments);
      const category = CATEGORY_MAP[sub] || sub;
      
      try {
        const ppRes = await apiPost('', {
          title, description, category,
          subreddit: `r/${sub}`,
          discoveredBy: 'scanner-cron'
        });
        
        const painPointId = ppRes?.id || ppRes?.painPoint?.id || ppRes?.data?.id;
        
        if (painPointId) {
          await apiPost('/posts', {
            painPointId,
            redditPostId: post.id,
            redditUrl: `https://www.reddit.com${post.permalink}`,
            postTitle: post.title.slice(0, 300),
            postBody: (post.selftext || '').slice(0, 1000),
            upvotes: post.score,
            commentCount: post.num_comments,
            subreddit: `r/${sub}`,
            discoveredBy: 'scanner-cron'
          });
        }
        result.painPointsFound++;
      } catch (e) {
        result.errors.push(`Submit: ${e.message}`);
      }
    }
    
    await apiPost('/scan-logs', {
      agentId: 'scanner-cron', subreddit: `r/${sub}`,
      postsScanned: result.postsScanned,
      painPointsFound: result.painPointsFound,
      status: result.errors.length > 0 ? 'partial' : 'completed'
    });
    
  } catch (e) {
    result.errors.push(`Fetch: ${e.message}`);
    try {
      await apiPost('/scan-logs', {
        agentId: 'scanner-cron', subreddit: `r/${sub}`,
        postsScanned: 0, painPointsFound: 0, status: 'error'
      });
    } catch (_) {}
  }
  
  return result;
}

async function main() {
  console.log(`[Retry] Starting retry scan of ${SUBREDDITS.length} subs at ${new Date().toISOString()}`);
  
  const totals = { scanned: 0, posts: 0, painPoints: 0, errors: 0, failedSubs: [] };
  
  for (let i = 0; i < SUBREDDITS.length; i++) {
    const sub = SUBREDDITS[i];
    // 5s minimum between subreddits
    if (i > 0) await sleep(5000);
    
    process.stdout.write(`  [${i+1}/${SUBREDDITS.length}] r/${sub}...`);
    const result = await scanSubreddit(sub);
    totals.scanned++;
    totals.posts += result.postsScanned;
    totals.painPoints += result.painPointsFound;
    if (result.errors.length > 0) {
      totals.errors += result.errors.length;
      totals.failedSubs.push({ sub, errors: result.errors });
    }
    console.log(` ${result.postsScanned} posts, ${result.painPointsFound} pp${result.errors.length ? ` (${result.errors.length} err)` : ''}`);
  }
  
  console.log('\n[Retry] === COMPLETE ===');
  console.log(JSON.stringify(totals, null, 2));
}

main().catch(e => { console.error(`Fatal: ${e.message}`); process.exit(1); });
