#!/usr/bin/env node
// Reddit Pain Points Scanner - Daily Cron
// Scans 51 subreddits for actionable pain points and submits to dashboard

const API_BASE = 'http://localhost:3000/api/pain-points';
const API_KEY = 'openclaw-scanner-key';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

const SUBREDDITS = [
  'gardening','beyondthebump','Mommit','running','xxfitness',
  'ADHD','languagelearning','remotework','productivity','personalfinance',
  'cooking','solotravel','frugal','HomeImprovement','DIY',
  'woodworking','smoking','nocode','Nootropics','Biohackers',
  'SideProject','houseplants','proplifting','plantclinic','IndoorGarden',
  'AnalogCommunity','streetphotography','MechanicalKeyboards','photocritique','insomnia',
  'CBTi','TMJ','yinyoga','bikecommuting','gravelcycling',
  'bikewrench','fuckcars','Meditation','Anxiety','therapists',
  'Journaling','Guitar','guitarpedals','Blues','homerecording',
  'cats','rawpetfood','ThriftStoreHauls','felinediabetes','EatCheapAndHealthy',
  'lawncare'
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

// Pain point detection patterns
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

// Exclude patterns (rants, memes, celebrations, relationship)
const EXCLUDE_SIGNALS = [
  /\b(rant|vent|just need to vent|off my chest)\b/i,
  /\b(meme|shitpost|lol|rofl)\b/i,
  /\b(finally did it|proud of|milestone|celebration|achievement)\b/i,
  /\b(boyfriend|girlfriend|husband|wife|partner|dating|breakup|divorce)\b/i,
  /\b(political|election|trump|biden|democrat|republican)\b/i,
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
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
  
  // Check excludes first
  for (const pat of EXCLUDE_SIGNALS) {
    if (pat.test(text)) return -1;
  }
  
  let score = 0;
  for (const pat of PAIN_SIGNALS) {
    if (pat.test(title)) score += 2; // Title matches worth more
    if (pat.test(text)) score += 1;
  }
  return score;
}

function extractPainPoint(post, comments) {
  const title = post.title;
  const body = post.selftext || '';
  const allText = `${title}\n${body}\n${(comments || []).map(c => c.body).join('\n')}`;
  
  // Build description from post + top comments
  let description = body.slice(0, 300);
  if (comments && comments.length > 0) {
    const topComment = comments[0]?.body || '';
    if (topComment) description += `\n\nTop response: ${topComment.slice(0, 200)}`;
  }
  if (!description.trim()) description = title;
  
  return { title: title.slice(0, 200), description: description.slice(0, 600) };
}

async function scanSubreddit(sub) {
  const result = { postsScanned: 0, painPointsFound: 0, errors: [] };
  
  try {
    const data = await fetchJSON(`https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`);
    const posts = (data?.data?.children || []).map(c => c.data);
    
    for (const post of posts) {
      if (post.stickied || post.score < 5) continue;
      result.postsScanned++;
      
      let commentTexts = [];
      let topComments = [];
      
      // Fetch comments for popular posts
      if (post.num_comments >= 10) {
        await sleep(2000);
        try {
          const cData = await fetchJSON(`https://www.reddit.com${post.permalink}.json?limit=10&sort=top&raw_json=1`);
          if (cData?.[1]?.data?.children) {
            topComments = cData[1].data.children
              .filter(c => c.kind === 't1')
              .map(c => c.data)
              .slice(0, 10);
            commentTexts = topComments.map(c => c.body || '');
          }
        } catch (e) {
          // Non-fatal, continue without comments
        }
      }
      
      const score = scorePainPoint(post.title, post.selftext, commentTexts);
      if (score < 3) continue; // Need at least 3 signal matches
      
      const { title, description } = extractPainPoint(post, topComments);
      const category = CATEGORY_MAP[sub] || sub;
      
      try {
        // Submit pain point
        const ppRes = await apiPost('', {
          title, description, category,
          subreddit: `r/${sub}`,
          discoveredBy: 'scanner-cron'
        });
        
        const painPointId = ppRes?.id || ppRes?.painPoint?.id || ppRes?.data?.id;
        
        // Link the post
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
        result.errors.push(`Submit error for "${title.slice(0,50)}": ${e.message}`);
      }
    }
    
    // Log scan
    await apiPost('/scan-logs', {
      agentId: 'scanner-cron',
      subreddit: `r/${sub}`,
      postsScanned: result.postsScanned,
      painPointsFound: result.painPointsFound,
      status: result.errors.length > 0 ? 'partial' : 'completed'
    });
    
  } catch (e) {
    result.errors.push(`Fetch error: ${e.message}`);
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
  console.log(`[Scanner] Starting scan of ${SUBREDDITS.length} subreddits at ${new Date().toISOString()}`);
  
  const totals = { scanned: 0, posts: 0, painPoints: 0, errors: 0, failedSubs: [] };
  const BATCH_SIZE = 5;
  
  for (let i = 0; i < SUBREDDITS.length; i += BATCH_SIZE) {
    const batch = SUBREDDITS.slice(i, i + BATCH_SIZE);
    console.log(`[Scanner] Batch ${Math.floor(i/BATCH_SIZE)+1}/${Math.ceil(SUBREDDITS.length/BATCH_SIZE)}: ${batch.join(', ')}`);
    
    // Process batch sequentially to respect rate limits
    for (const sub of batch) {
      await sleep(2000); // 2s between Reddit API calls
      const result = await scanSubreddit(sub);
      totals.scanned++;
      totals.posts += result.postsScanned;
      totals.painPoints += result.painPointsFound;
      if (result.errors.length > 0) {
        totals.errors += result.errors.length;
        totals.failedSubs.push({ sub, errors: result.errors });
      }
      console.log(`  r/${sub}: ${result.postsScanned} posts, ${result.painPointsFound} pain points${result.errors.length ? ` (${result.errors.length} errors)` : ''}`);
    }
  }
  
  // Final report
  const report = {
    timestamp: new Date().toISOString(),
    subsScanned: totals.scanned,
    totalSubreddits: SUBREDDITS.length,
    postsAnalyzed: totals.posts,
    painPointsFound: totals.painPoints,
    errors: totals.errors,
    failedSubs: totals.failedSubs
  };
  
  console.log('\n[Scanner] === SCAN COMPLETE ===');
  console.log(JSON.stringify(report, null, 2));
}

main().catch(e => {
  console.error(`[Scanner] Fatal: ${e.message}`);
  process.exit(1);
});
