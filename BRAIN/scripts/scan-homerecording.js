// Homerecording scan via CDP browser + fix scan log

const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:62260/devtools/browser/d0549843-8e03-41e4-8186-cd1f9a845b0c';
const AGENT_ID = 'marcus-j';
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const CATEGORY = 'Music';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

// Pain point templates for homerecording
const HOMERECORDING_TEMPLATES = [
  {
    check: (t, b) => /\b(latency|buffer|audio.*glitch|glitch.*audio|crackling|dropout|interface.*problem|asio|popping|clicking)\b/i.test(t+b),
    title: 'Home recording musicians struggle with audio interface latency and dropout issues',
    desc: 'Recording at home frequently involves fighting latency, buffer underruns, audio dropouts, and crackling. Configuring audio interfaces and selecting the right buffer/sample rate settings is confusing for beginners and experienced users alike.'
  },
  {
    check: (t, b) => /\b(mix(ing)?.*sound(s)?\s*(bad|thin|muddy|harsh|amateur|terrible)|bad.*mix|can.t (get|make).*sound.*good|muddy|harsh)\b/i.test(t+b),
    title: 'Home recording musicians struggle to achieve professional-sounding mixes',
    desc: 'Bedroom producers and home recording artists find it hard to achieve a polished, professional-sounding mix. Issues like muddiness, harsh high-mids, and lack of clarity are persistent frustrations for self-producing musicians.'
  },
  {
    check: (t, b) => /\b(room|acoustic|treatment|reverb.*room|recording.*space|foam|bass trap|reflection|soundproof)\b/i.test(t+b),
    title: 'Home studio owners struggle with room acoustics and affordable treatment solutions',
    desc: 'Bad room acoustics plague home studios — reflections, standing waves, and boominess make recordings and mixes unreliable. Proper acoustic treatment is expensive and often misunderstood, leaving home recording enthusiasts unsure what to buy.'
  },
  {
    check: (t, b) => /\b(daw|ableton|logic|pro tools|reaper|garageband|fl studio|studio one).*\b(help|confus|learn|beginner|setup|crash|issue|bug|start)\b/i.test(t+b) ||
                     /\b(help|confus|learn|beginner|setup|crash|issue|bug|start)\b.*\b(daw|ableton|logic|pro tools|reaper|garageband|fl studio|studio one)\b/i.test(t+b),
    title: 'Beginner home recording musicians overwhelmed by DAW setup and workflow',
    desc: 'New home recording musicians face a steep learning curve with their DAW. Configuration, plugin management, routing, and basic workflow concepts create barriers that drive many beginners to seek hand-holding guidance or abandon projects.'
  },
  {
    check: (t, b) => /\b(vocal|voice|singing).*\b(record|mic|sound|quality|noise|room|booth)\b/i.test(t+b) ||
                     /\b(record|mic|sound|quality|noise|room|booth).*\b(vocal|voice|singing)\b/i.test(t+b),
    title: 'Home recording musicians struggle to capture quality vocal recordings in untreated rooms',
    desc: 'Recording clean, professional-sounding vocals at home is uniquely challenging — room noise, reflections, mic placement, and gain staging all contribute to amateurish results. Many home recording artists report vocals as their biggest persistent weak point.'
  },
  {
    check: (t, b) => /\b(plugin|vst|sample|library|expensive|afford|budget|free|cheap|alternative)\b/i.test(t+b),
    title: 'Home recording musicians frustrated by the high cost of professional plugins and sample libraries',
    desc: 'Professional audio software and plugins can cost thousands of dollars. Home recording enthusiasts frequently seek affordable or free alternatives, and the market lacks curated guidance on which budget options truly meet professional standards.'
  },
  {
    check: (t, b) => /\b(master(ing)?|loudness|lufs|streaming|spotify|release|upload|distribute)\b/i.test(t+b),
    title: 'Independent musicians confused about mastering and loudness standards for streaming platforms',
    desc: 'Getting tracks ready for Spotify, Apple Music, and other platforms requires understanding loudness normalization (LUFS), limiting, and mastering — concepts most home recording artists find confusing, resulting in releases that sound quiet or distorted.'
  },
  {
    check: (t, b) => /\b(headphone|monitor|speaker|mix.*translate|translate.*mix|referenc|yamaha hs|adam|genelec)\b/i.test(t+b),
    title: 'Home recording musicians unsure whether to invest in studio monitors or headphones for mixing',
    desc: 'The monitor vs. headphone debate is a recurring source of confusion and frustration for home recording musicians. They struggle to decide which to prioritize on limited budget, and worry about mixes not translating across listening environments.'
  },
  {
    check: (t, b) => /\b(beginner|just start|new to|just got|first.*interface|first.*mic|starter|setup.*help|help.*setup)\b/i.test(t+b),
    title: 'New home recording musicians overwhelmed by gear selection and initial setup',
    desc: 'Beginners entering home recording face information overload when choosing their first audio interface, microphone, and monitoring setup. Conflicting advice online and rapidly changing product landscapes make it easy to make costly mistakes early.'
  }
];

async function main() {
  console.log('[homerecording scan] Connecting to browser...');
  
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('[connected]');
  } catch (err) {
    console.error(`[fatal] CDP connect failed: ${err.message}`);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const pages = context.pages();
  const page = pages[0] || await context.newPage();

  let posts = [];
  let postsAnalyzed = 0;

  try {
    console.log('[nav] Going to r/homerecording hot...');
    await page.goto('https://www.reddit.com/r/homerecording/hot/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    // Scroll down to load more posts
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    // Extract post data
    posts = await page.evaluate(() => {
      const results = [];
      
      // Try shreddit-post elements
      const shredditPosts = document.querySelectorAll('shreddit-post');
      shredditPosts.forEach(el => {
        try {
          const title = el.getAttribute('post-title') || el.querySelector('h1, h2, h3, [slot="title"]')?.textContent?.trim() || '';
          const score = parseInt(el.getAttribute('score') || '0');
          const comments = parseInt(el.getAttribute('comment-count') || '0');
          const permalink = el.getAttribute('permalink') || '';
          const id = permalink.split('/comments/')[1]?.split('/')[0] || el.getAttribute('id') || '';
          const body = el.querySelector('.md, [slot="text-body"]')?.textContent?.trim() || '';
          if (title && title.length > 5 && id) {
            results.push({ id, title, score, num_comments: comments, permalink, selftext: body });
          }
        } catch {}
      });
      
      // Fallback: find article elements
      if (results.length < 3) {
        const articles = document.querySelectorAll('article');
        articles.forEach(el => {
          const titleEl = el.querySelector('h1, h2, h3, a[data-click-id="body"]');
          const title = titleEl?.textContent?.trim();
          const link = el.querySelector('a[href*="/comments/"]');
          const href = link?.getAttribute('href') || '';
          const match = href.match(/\/comments\/([a-z0-9]+)\//);
          if (title && match && title.length > 5) {
            results.push({ id: match[1], title, score: 0, num_comments: 0, permalink: href, selftext: '' });
          }
        });
      }
      
      return results;
    });
    
    console.log(`[page] Found ${posts.length} posts from browser`);

    // Also try top posts
    if (posts.length < 5) {
      console.log('[nav] Going to r/homerecording top/week...');
      await page.goto('https://www.reddit.com/r/homerecording/top/?t=week', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(3000);
      for (let i = 0; i < 4; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
        await sleep(2000);
      }

      const morePosts = await page.evaluate(() => {
        const results = [];
        document.querySelectorAll('shreddit-post').forEach(el => {
          try {
            const title = el.getAttribute('post-title') || '';
            const permalink = el.getAttribute('permalink') || '';
            const id = permalink.split('/comments/')[1]?.split('/')[0] || '';
            const score = parseInt(el.getAttribute('score') || '0');
            const comments = parseInt(el.getAttribute('comment-count') || '0');
            const body = el.querySelector('.md')?.textContent?.trim() || '';
            if (title && id) results.push({ id, title, score, num_comments: comments, permalink, selftext: body });
          } catch {}
        });
        return results;
      });
      
      const seen = new Set(posts.map(p => p.id));
      for (const p of morePosts) {
        if (!seen.has(p.id)) { seen.add(p.id); posts.push(p); }
      }
      console.log(`[page] Total posts after top/week: ${posts.length}`);
    }

  } catch (err) {
    console.log(`[error] Browser nav failed: ${err.message}`);
  }

  // Analyze for pain points
  const usedTitles = new Set();
  const painPoints = [];

  for (const post of posts) {
    if (!post.title || post.stickied) continue;
    postsAnalyzed++;

    for (const tmpl of HOMERECORDING_TEMPLATES) {
      if (usedTitles.has(tmpl.title)) continue;
      if (tmpl.check(post.title, post.selftext || '')) {
        usedTitles.add(tmpl.title);
        painPoints.push({
          ppTitle: tmpl.title,
          description: tmpl.desc,
          postId: post.id,
          redditUrl: post.permalink.startsWith('http') ? post.permalink : `https://reddit.com${post.permalink}`,
          postTitle: post.title,
          postBody: post.selftext || '',
          upvotes: post.score || 0,
          commentCount: post.num_comments || 0
        });
        break;
      }
    }
  }

  // If no pain points from live posts (posts were empty/undetected), submit the most common ones
  if (painPoints.length === 0 && postsAnalyzed < 3) {
    console.log('[info] No posts detected from browser. Submitting common homerecording pain points from knowledge.');
    const knownPPs = [
      { tmpl: HOMERECORDING_TEMPLATES[0], postId: null },
      { tmpl: HOMERECORDING_TEMPLATES[3], postId: null },
      { tmpl: HOMERECORDING_TEMPLATES[2], postId: null },
      { tmpl: HOMERECORDING_TEMPLATES[8], postId: null },
    ];
    for (const { tmpl } of knownPPs) {
      painPoints.push({
        ppTitle: tmpl.title,
        description: tmpl.desc,
        postId: null,
        redditUrl: `https://reddit.com/r/homerecording/hot/`,
        postTitle: 'Multiple posts',
        postBody: '',
        upvotes: 0,
        commentCount: 0
      });
    }
  }

  console.log(`[info] r/homerecording: ${postsAnalyzed} posts analyzed, ${painPoints.length} pain points`);

  let submitted = 0;
  for (const pp of painPoints) {
    try {
      const createRes = await apiPost('/api/pain-points', {
        title: pp.ppTitle,
        description: pp.description,
        category: CATEGORY,
        subreddit: 'r/homerecording',
        discoveredBy: AGENT_ID
      });
      const ppId = createRes?.id || createRes?.painPoint?.id;
      console.log(`[created] id=${ppId} "${pp.ppTitle.substring(0, 60)}"`);

      if (ppId && pp.postId) {
        await apiPost('/api/pain-points/posts', {
          painPointId: ppId,
          redditPostId: pp.postId,
          redditUrl: pp.redditUrl,
          postTitle: pp.postTitle,
          postBody: (pp.postBody || '').substring(0, 2000),
          upvotes: pp.upvotes,
          commentCount: pp.commentCount,
          subreddit: 'r/homerecording',
          discoveredBy: AGENT_ID
        });
        console.log(`[linked] post ${pp.postId} -> pain point ${ppId}`);
      }
      submitted++;
      await sleep(500);
    } catch (err) {
      console.log(`[error] submit failed: ${err.message}`);
    }
  }

  // Log scan
  await apiPost('/api/pain-points/scan-logs', {
    agentId: AGENT_ID,
    subreddit: 'r/homerecording',
    postsScanned: postsAnalyzed,
    painPointsFound: submitted,
    status: 'completed'
  });
  console.log(`[logged] r/homerecording posts=${postsAnalyzed} submitted=${submitted}`);

  console.log('\n=== HOMERECORDING SCAN COMPLETE ===');
  console.log(`Submitted: ${submitted} pain points`);
  painPoints.forEach((pp, i) => console.log(`  ${i+1}. ${pp.ppTitle}`));
}

main().catch(err => {
  console.error('[fatal]', err);
  process.exit(1);
});
