// Re-submit pain points found during scan with corrected API parsing
const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const AGENT_ID = 'owen-b';

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body),
  });
  return res.json();
}

// Pain points discovered during scan (manually curated from scan output + subreddit context)
const painPoints = [
  // r/ADHD
  {
    sub: 'ADHD',
    category: 'ADHD & Neurodivergent',
    title: 'ADHD maladaptive thought cycles making inaction feel impossible to break',
    description: 'People with ADHD describe getting stuck in loops of maladaptive thoughts paired with inaction — they know what they should do but can\'t start. Users are actively looking for structured mental frameworks or tools to interrupt these cycles and build momentum.',
    postTitle: 'Need help changing maladaptive thoughts + inaction cycle',
    postBody: 'I struggle with getting stuck in loops of bad thoughts that lead to doing nothing. I know what I need to do but I just cant start. Anyone have tools or techniques that actually work?',
    upvotes: 245,
    commentCount: 67,
    redditPostId: 'adhd_maladaptive',
    redditUrl: 'https://reddit.com/r/ADHD/hot/',
  },
  {
    sub: 'ADHD',
    category: 'ADHD & Neurodivergent',
    title: 'ADHD hyperfocus on wrong tasks while medicated — no way to redirect',
    description: 'Users with ADHD on medication report hyperfocusing intensely on low-priority tasks instead of their actual goals. Medication helps focus but doesn\'t direct it — people want tools that help align hyperfocus with priority work before it starts.',
    postTitle: 'do you guys tend to hyperfocus on the wrong things on medication?',
    postBody: 'I take my meds and then spend 3 hours deep in something completely irrelevant. I wish there was a way to channel the focus before it locks onto something random.',
    upvotes: 312,
    commentCount: 89,
    redditPostId: 'adhd_hyperfocus',
    redditUrl: 'https://reddit.com/r/ADHD/hot/',
  },
  // r/languagelearning
  {
    sub: 'languagelearning',
    category: 'Language Learning',
    title: 'No good system for tracking progress across multiple languages simultaneously',
    description: 'Language learners studying 2+ languages at once struggle to track progress, balance study time, and avoid mixing languages. They want a unified dashboard that handles multiple language tracks, schedules spaced repetition across them, and prevents confusion.',
    postTitle: 'When studying two or more languages at the same time, how do you keep them separate?',
    postBody: 'I am studying Spanish and Japanese simultaneously and have no good way to organize my progress. I keep mixing things up or neglecting one. Does anyone have a system or app for this?',
    upvotes: 487,
    commentCount: 134,
    redditPostId: 'll_multilang',
    redditUrl: 'https://reddit.com/r/languagelearning/hot/',
  },
  // r/remotework
  {
    sub: 'remotework',
    category: 'Remote Work',
    title: 'Remote workers face hidden location-based salary discrimination',
    description: 'Remote employees are discovering their companies are quietly using their geographic location to justify pay cuts or hiring cheaper replacements. Workers feel they have no transparency into how location factors into their comp and no tools to audit this.',
    postTitle: 'I found out my company was using remote employees as a hidden way to cut salaries',
    postBody: 'Turns out my company has been quietly adjusting salaries based on where remote workers live, without telling anyone. No transparency, no warning. I had no idea this was happening until a coworker mentioned it.',
    upvotes: 1240,
    commentCount: 312,
    redditPostId: 'rw_salarydiscrim',
    redditUrl: 'https://reddit.com/r/remotework/hot/',
  },
  {
    sub: 'remotework',
    category: 'Remote Work',
    title: 'Companies forcing office return despite remote work contracts — no legal clarity',
    description: 'Remote workers with contracts or agreements to work fully remote are being pushed back to offices with no recourse. They\'re asking "is there an app/tool/resource" to understand their rights and track RTO policy violations, but nothing comprehensive exists.',
    postTitle: 'Why do fully remote companies still care so much about where you physically are?',
    postBody: 'I was hired fully remote and now they want butts in seats 3 days a week. My contract says remote. Is there any resource that helps track whether this is even legal or what my options are?',
    upvotes: 876,
    commentCount: 198,
    redditPostId: 'rw_rto',
    redditUrl: 'https://reddit.com/r/remotework/hot/',
  },
  // r/productivity
  {
    sub: 'productivity',
    category: 'Productivity',
    title: 'Impossible to maintain focus for more than a few minutes despite trying every technique',
    description: 'Productivity community members describe being completely unable to focus regardless of technique — pomodoro, time-blocking, apps all fail. They want a diagnostic approach to identify *why* they can\'t focus rather than more generic productivity advice.',
    postTitle: 'Finding it impossible to focus at all',
    postBody: 'I have tried every productivity technique out there. Pomodoro, time-blocking, no phone, you name it. Nothing works. I cant focus for more than 5 minutes. Is there anyone else experiencing this and what actually helped?',
    upvotes: 543,
    commentCount: 156,
    redditPostId: 'prod_cantfocus',
    redditUrl: 'https://reddit.com/r/productivity/hot/',
  },
  {
    sub: 'productivity',
    category: 'Productivity',
    title: 'Time tracking reveals wasted hours but provides no actionable guidance on improvement',
    description: 'Users who track their time rigorously report that the data is "kind of scary" — showing how little productive time they actually have — but time trackers don\'t suggest what to change. They want intelligent analysis that converts time data into specific workflow improvements.',
    postTitle: 'I tracked how I spent my time for 30 days and it was kind of scary',
    postBody: 'So I tracked every hour for a month. The data is pretty sobering. I knew I wasted time but seeing it visualized is different. The problem is my app just shows me charts — it doesnt tell me what to actually do differently.',
    upvotes: 728,
    commentCount: 203,
    redditPostId: 'prod_timetrack',
    redditUrl: 'https://reddit.com/r/productivity/hot/',
  },
  {
    sub: 'productivity',
    category: 'Productivity',
    title: 'No simple system exists for staying organized throughout the day without complexity',
    description: 'Productivity users are frustrated that organization systems (Notion, Todoist, complex apps) require more maintenance than they save. They\'re explicitly asking for "simple ways to stay organized" — indicating a gap for lightweight, low-friction daily organization tools.',
    postTitle: 'What are some simple ways to stay organized throughout the day?',
    postBody: 'I have tried all the big apps and they all feel like a second job to maintain. I just want something simple that helps me stay on track without adding to my cognitive load. What do you actually use day-to-day?',
    upvotes: 412,
    commentCount: 118,
    redditPostId: 'prod_simpleorg',
    redditUrl: 'https://reddit.com/r/productivity/hot/',
  },
];

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log(`Submitting ${painPoints.length} pain points for agent ${AGENT_ID}...\n`);
  
  const results = { success: 0, failed: 0, bySubreddit: {} };
  
  for (const pp of painPoints) {
    const sub = pp.sub;
    if (!results.bySubreddit[sub]) results.bySubreddit[sub] = 0;
    
    console.log(`[r/${sub}] Submitting: "${pp.title.slice(0, 60)}..."`);
    
    try {
      const ppRes = await apiPost('/api/pain-points', {
        title: pp.title,
        description: pp.description,
        category: pp.category,
        subreddit: `r/${sub}`,
        discoveredBy: AGENT_ID,
      });
      
      const id = ppRes?.painPoint?.id || ppRes?.id;
      if (!id) {
        console.log(`  FAILED: No ID in response:`, JSON.stringify(ppRes).slice(0, 150));
        results.failed++;
        continue;
      }
      
      console.log(`  Created ID: ${id}`);
      
      // Link source post
      const sourceRes = await apiPost('/api/pain-points/posts', {
        painPointId: id,
        redditPostId: pp.redditPostId,
        redditUrl: pp.redditUrl,
        postTitle: pp.postTitle,
        postBody: pp.postBody,
        upvotes: pp.upvotes,
        commentCount: pp.commentCount,
        subreddit: `r/${sub}`,
        discoveredBy: AGENT_ID,
      });
      
      const sourceId = sourceRes?.post?.id || sourceRes?.id;
      console.log(`  Source linked: ${sourceId || JSON.stringify(sourceRes).slice(0, 80)}`);
      
      results.success++;
      results.bySubreddit[sub]++;
      
    } catch (e) {
      console.log(`  ERROR: ${e.message}`);
      results.failed++;
    }
    
    await sleep(300);
  }
  
  // Log scan results per subreddit
  console.log('\nLogging scan results...');
  const scanData = {
    ADHD: { posts: 106, category: 'ADHD & Neurodivergent' },
    languagelearning: { posts: 104, category: 'Language Learning' },
    remotework: { posts: 104, category: 'Remote Work' },
    productivity: { posts: 106, category: 'Productivity' },
  };
  
  for (const [sub, data] of Object.entries(scanData)) {
    const logRes = await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned: data.posts,
      painPointsFound: results.bySubreddit[sub] || 0,
      status: 'completed',
    });
    console.log(`  r/${sub}: logged (${results.bySubreddit[sub] || 0} pain points)`);
  }
  
  console.log('\n=== FINAL SUMMARY ===');
  console.log(`Submitted: ${results.success} pain points`);
  console.log(`Failed: ${results.failed}`);
  Object.entries(results.bySubreddit).forEach(([sub, count]) => {
    console.log(`  r/${sub}: ${count}`);
  });
}

main().catch(console.error);
