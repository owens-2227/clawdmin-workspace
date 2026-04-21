const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:54309/devtools/browser/e6cdce6b-6fa6-4094-99e0-8ac9dbc51fe3';
const AGENT_ID = 'marcus-j';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';

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

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
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
  try { return JSON.parse(text); } catch { return text; }
}

async function fetchSubredditJSON(page, subreddit) {
  const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=25&raw_json=1`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2000);
    const content = await page.evaluate(() => document.body.innerText);
    return JSON.parse(content);
  } catch (e) {
    console.log(`  JSON goto failed: ${e.message}`);
    return { error: e.message };
  }
}

async function fetchPostCommentsJSON(page, subreddit, postId) {
  const url = `https://www.reddit.com/r/${subreddit}/comments/${postId}.json?limit=10&raw_json=1`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(1500);
    const content = await page.evaluate(() => document.body.innerText);
    return JSON.parse(content);
  } catch (e) {
    return { error: e.message };
  }
}

function isPainPoint(post) {
  const title = (post.title || '').toLowerCase();
  const body = (post.selftext || '').toLowerCase();
  const combined = title + ' ' + body;

  if (post.score < 5) return false;
  if (post.stickied) return false;

  const painSignals = [
    /is there (an? )?(app|tool|software|plugin|way|method|solution)/,
    /how (do|does|can|should) (i|you|we)/,
    /can('t|not) (figure|find|afford|get)/,
    /frustrated|annoying|struggle|pain point|problem|issue|bug|broken/,
    /too (expensive|complex|complicated|hard|difficult)/,
    /wish (there was|i could|it had|it would)/,
    /anyone else (deal|struggle|have trouble|experience)/,
    /best (way|method|tool|app|software|plugin|pedal|interface|mic|daw|camera|lens) (to|for)/,
    /what (do you use|should i use|is the best|gear|setup)/,
    /help (with|me|needed)/,
    /manual(ly)? (do|doing|track|tracking|enter|entering)/,
    /workflow|organize|track|automate|manage/,
    /n(eed|eeding) (help|advice|recommendation)/,
    /looking for (a|an|some)/,
    /alternative to/,
    /keeps (breaking|crashing|freezing)/,
    /beginner|starting out|just started|new to/,
    /confused|overwhelmed|lost/,
    /recording|mixing|mastering|tracking/,
    /noise|hum|buzz|latency|signal/,
    /developing film|scanning|darkroom/,
    /keyboard (build|switch|layout|lubing)/,
    /jaw pain|clicking|locking|splint|bruxism|grinding/,
    /tight|tension|pose|flexibility|stretch/,
  ];

  return painSignals.some(re => re.test(combined));
}

function extractPainPointTitle(post) {
  let title = post.title;
  if (title.length > 80) title = title.substring(0, 77) + '...';
  return title;
}

function extractDescription(post, topComments) {
  let body = post.selftext ? post.selftext.replace(/\n+/g, ' ').trim() : '';
  let desc = body ? body.substring(0, 300) : post.title;
  if (topComments && topComments.length > 0) {
    desc += ` Top comment: "${topComments[0].substring(0, 150)}"`;
  }
  if (desc.length > 500) desc = desc.substring(0, 497) + '...';
  return desc.trim();
}

async function scanSubreddit(page, subreddit) {
  console.log(`\n=== Scanning r/${subreddit} ===`);
  const category = CATEGORY_MAP[subreddit] || 'General';
  
  const data = await fetchSubredditJSON(page, subreddit);
  
  if (data.error) {
    console.log(`  ERROR: ${data.error}`);
    await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${subreddit}`,
      postsScanned: 0,
      painPointsFound: 0,
      status: 'error',
    });
    return { postsScanned: 0, painPointsFound: 0 };
  }

  const posts = (data.data && data.data.children) ? data.data.children.map(c => c.data) : [];
  console.log(`  Found ${posts.length} posts`);

  const painPosts = posts.filter(isPainPoint);
  console.log(`  Pain point candidates: ${painPosts.length}`);

  let submitted = 0;

  for (const post of painPosts) {
    console.log(`  [PAIN POINT] ${post.title.substring(0, 70)} (score:${post.score}, comments:${post.num_comments})`);
    
    let topComments = [];
    if (post.num_comments >= 10) {
      await sleep(2000);
      const commentsData = await fetchPostCommentsJSON(page, subreddit, post.id);
      if (Array.isArray(commentsData) && commentsData[1]) {
        const commentChildren = (commentsData[1].data && commentsData[1].data.children) || [];
        topComments = commentChildren
          .filter(c => c.data && c.data.body && c.data.body !== '[deleted]' && c.data.body !== '[removed]')
          .slice(0, 5)
          .map(c => c.data.body);
      }
    }

    try {
      const ppTitle = extractPainPointTitle(post);
      const ppDesc = extractDescription(post, topComments);

      const ppResp = await apiPost('/api/pain-points', {
        title: ppTitle,
        description: ppDesc,
        category: category,
        subreddit: `r/${subreddit}`,
        discoveredBy: AGENT_ID,
      });

      const painPointId = ppResp && ppResp.id;
      console.log(`    API response: ${JSON.stringify(ppResp).substring(0, 100)}`);

      await apiPost('/api/pain-points/posts', {
        painPointId: painPointId || null,
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
      console.log(`    Error submitting: ${e.message}`);
    }
    
    await sleep(500);
  }

  await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: `r/${subreddit}`,
    postsScanned: posts.length,
    painPointsFound: submitted,
    status: 'completed',
  });

  console.log(`  Done: ${posts.length} posts, ${submitted} pain points submitted`);
  return { postsScanned: posts.length, painPointsFound: submitted };
}

async function main() {
  console.log('marcus-j scanner v2 starting...');
  
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('Connected to CDP browser');
  } catch (e) {
    console.error(`Failed to connect: ${e.message}`);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const pages = context.pages();
  let page;
  if (pages.length > 0) {
    page = pages[0];
    for (let i = 1; i < pages.length; i++) {
      await pages[i].close().catch(() => {});
    }
  } else {
    page = await context.newPage();
  }

  // Test navigation first
  console.log('Testing Reddit access...');
  try {
    await page.goto('https://www.reddit.com/r/Guitar/hot.json?limit=3&raw_json=1', { 
      waitUntil: 'domcontentloaded', timeout: 15000 
    });
    const testContent = await page.evaluate(() => document.body.innerText);
    const testData = JSON.parse(testContent);
    if (testData.data && testData.data.children) {
      console.log(`Reddit access OK - got ${testData.data.children.length} posts from test`);
    } else {
      console.log('Reddit response unusual:', testContent.substring(0, 200));
    }
  } catch (e) {
    console.log(`Reddit test failed: ${e.message}`);
    console.log('Will try anyway...');
  }

  let totalPosts = 0;
  let totalPainPoints = 0;
  const results = [];

  for (const subreddit of SUBREDDITS) {
    try {
      const result = await scanSubreddit(page, subreddit);
      totalPosts += result.postsScanned;
      totalPainPoints += result.painPointsFound;
      results.push({ subreddit, ...result });
    } catch (e) {
      console.log(`Error scanning r/${subreddit}: ${e.message}`);
      results.push({ subreddit, postsScanned: 0, painPointsFound: 0, error: e.message });
    }
    await sleep(3000);
  }

  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Subreddits scanned: ${SUBREDDITS.length}`);
  console.log(`Total posts analyzed: ${totalPosts}`);
  console.log(`Total pain points submitted: ${totalPainPoints}`);
  for (const r of results) {
    const err = r.error ? ` [ERROR: ${r.error}]` : '';
    console.log(`  r/${r.subreddit}: ${r.postsScanned} posts, ${r.painPointsFound} pain points${err}`);
  }

  process.exit(0);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
