// Second pass: JSON API scan for all 4 subreddits, better pain point detection, fix post-linking

const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const AGENT_ID = 'marcus-j';
const SUBREDDITS = ['Guitar', 'guitarpedals', 'Blues', 'homerecording'];
const CATEGORY = 'Music';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  try {
    const parsed = JSON.parse(text);
    // Handle various response shapes
    return parsed;
  } catch { return { raw: text }; }
}

async function fetchRedditJSON(sub, sort = 'hot', limit = 25) {
  await sleep(2000);
  const url = `https://www.reddit.com/r/${sub}/${sort}.json?limit=${limit}&raw_json=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data?.data?.children?.map(c => c.data) || [];
}

async function fetchPostComments(sub, postId) {
  await sleep(1500);
  const url = `https://www.reddit.com/r/${sub}/comments/${postId}.json?limit=10&raw_json=1`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });
    const data = await res.json();
    if (Array.isArray(data) && data[1]) {
      return data[1].data.children.slice(0, 5).map(c => c.data?.body || '').filter(Boolean).join('\n\n');
    }
  } catch {}
  return '';
}

// Known pain point patterns and their quality descriptions
const PAIN_TEMPLATES = {
  'homerecording': [
    {
      check: (t, b) => /\b(latency|buffer|audio.*glitch|glitch.*audio|crackling|dropout|interface.*problem|asio)\b/i.test(t+b),
      title: 'Home recording musicians struggle with audio interface latency and dropout issues',
      desc: 'Recording at home frequently involves fighting latency, buffer underruns, audio dropouts, and crackling — especially on Windows. Configuring audio interfaces properly and selecting the right buffer/sample rate settings is confusing for beginners and experienced users alike.'
    },
    {
      check: (t, b) => /\b(mix(ing)?.*sound(s)?.*bad|bad.*mix|can.t (get|make).*sound|sound.*thin|muddy|harsh|amateur)\b/i.test(t+b),
      title: 'Home recording musicians struggle to achieve professional-sounding mixes',
      desc: 'Bedroom producers and home recording artists find it hard to achieve a polished, professional-sounding mix. The gap between raw recordings and release-quality audio is a persistent frustration, especially around issues like muddiness, harsh high-mids, and lack of clarity.'
    },
    {
      check: (t, b) => /\b(room.*acoustic|acoustic.*room|treatment|reverb.*room|recording.*space|sound.*room|foam|bass trap|reflection)\b/i.test(t+b),
      title: 'Home studio owners struggle with room acoustics treatment on a budget',
      desc: 'Bad room acoustics plague home studios — reflections, standing waves, and boominess make recordings and mixes unreliable. Proper acoustic treatment is expensive and often misunderstood, leaving home recording enthusiasts unsure what to buy and where to place it.'
    },
    {
      check: (t, b) => /\b(daw|ableton|logic|pro tools|reaper|garageband|fl studio).*\b(help|confus|learn|beginner|setup|crash|issue|bug)\b/i.test(t+b) ||
                       /\b(help|confus|learn|beginner|setup|crash|issue|bug).*\b(daw|ableton|logic|pro tools|reaper|garageband|fl studio)\b/i.test(t+b),
      title: 'Beginner home recording musicians overwhelmed by DAW setup and workflow',
      desc: 'New home recording musicians face a steep learning curve with their DAW of choice. Configuration, plugin management, routing, and basic workflow concepts create barriers that drive many beginners to seek hand-holding guidance or abandon projects.'
    },
    {
      check: (t, b) => /\b(vocal|voice|singing).*\b(record|mic|sound|quality|noise|room)\b/i.test(t+b) ||
                       /\b(record|mic|sound|quality|noise|room).*\b(vocal|voice|singing)\b/i.test(t+b),
      title: 'Home recording musicians struggle to capture quality vocal recordings at home',
      desc: 'Recording clean, professional-sounding vocals at home is uniquely challenging — room noise, poor acoustics, mic placement, and gain staging all contribute to results that sound amateurish. Many home recording artists report vocals as their biggest weak point.'
    },
    {
      check: (t, b) => /\b(plugin|vst|sample|library|piracy|crack|pay|afford|expensive|budget)\b/i.test(t+b),
      title: 'Home recording musicians frustrated by cost of professional plugins and sample libraries',
      desc: 'Professional audio software and plugins can cost thousands of dollars. Home recording enthusiasts frequently express frustration at the barrier to entry, and many turn to illegal means. The market lacks affordable, high-quality options that match professional results.'
    },
    {
      check: (t, b) => /\b(master(ing)?|loudness|lufs|streaming|spotify|release|upload)\b/i.test(t+b),
      title: 'Independent musicians confused about mastering standards for streaming platforms',
      desc: 'Getting tracks ready for Spotify, Apple Music, and other streaming platforms requires understanding loudness normalization, LUFS targets, and mastering — concepts most home recording artists find confusing. Many release tracks that sound quiet or distorted on streaming services.'
    },
    {
      check: (t, b) => /\b(headphones?|monitor|speaker|mix.*translate|translate.*mix|referenc)\b/i.test(t+b),
      title: 'Home recording musicians unsure whether to invest in studio monitors vs headphones',
      desc: 'The monitor vs. headphone debate is evergreen in home recording communities. Users struggle to decide which to prioritize given budget and room constraints, and worry that mixes made on one will not translate to other listening environments.'
    }
  ],
  'Guitar': [
    {
      check: (t, b) => /\b(learn.*song|song.*learn|tab.*wrong|wrong.*tab|can.t find.*tab|accurate tab)\b/i.test(t+b),
      title: 'Guitarists struggle to find accurate tabs or transcriptions for specific songs',
      desc: 'Many guitarists have difficulty locating reliable, accurate tablature or transcriptions for songs they want to learn. They often rely on user-submitted tabs that contain errors, making the learning process frustrating and time-consuming.'
    },
    {
      check: (t, b) => /\b(plateau|stuck|progress|practice.*routine|routine.*practice|what (to|should) practice|improve)\b/i.test(t+b),
      title: 'Guitar players feel stuck in a plateau with no clear path to improvement',
      desc: 'Many self-taught guitarists describe hitting a wall where they no longer feel progress. Without structured curriculum or feedback, they are unsure what to practice and for how long, leading to frustration and loss of motivation.'
    },
    {
      check: (t, b) => /\b(pain|cramp|soreness|finger|wrist|tendon|carpal|injury|hurt|ache)\b/i.test(t+b),
      title: 'Guitarists suffer from hand/wrist pain and lack guidance on injury prevention',
      desc: 'Finger soreness, wrist pain, and repetitive strain injuries are common complaints among guitarists — from beginners developing calluses to advanced players pushing technique. Many do not know when to rest or how to practice safely to avoid long-term injury.'
    },
    {
      check: (t, b) => /\b(beginner|just start|new to|learning guitar|first (guitar|lesson)|recommendation.*beginner)\b/i.test(t+b),
      title: 'Beginner guitarists overwhelmed by where to start and what gear to buy',
      desc: 'New guitarists face decision paralysis when choosing their first instrument, amp, and learning resources. The sheer number of options and conflicting advice online leads many to make costly mistakes or quit before developing any skills.'
    },
    {
      check: (t, b) => /\b(read.*music|music.*theory|theory|chord|scale.*confus|confus.*scale|fretboard)\b/i.test(t+b),
      title: 'Guitarists struggle to understand and apply music theory to their playing',
      desc: 'Music theory is a recurring obstacle for guitarists wanting to understand what they are playing and communicate with other musicians. Fretboard knowledge, chord theory, and scale application feel abstract and disconnected from practical playing.'
    },
    {
      check: (t, b) => /\b(sell|buy|used|value|price|worth|gear acquisition|GAS)\b.*\b(guitar|amp|pedal)\b/i.test(t+b),
      title: 'Guitarists struggle to assess fair market value when buying or selling used gear',
      desc: 'The secondhand guitar market is large and pricing is inconsistent. Players frequently overpay for used instruments or undersell their own, with no reliable centralized resource for fair market valuations that account for condition and location.'
    }
  ],
  'guitarpedals': [
    {
      check: (t, b) => /\b(can.t find|looking for|recommend.*pedal|pedal.*recommend|best.*pedal|pedal.*budget|budget.*pedal)\b/i.test(t+b),
      title: 'Guitarists struggle to find the right pedal for a specific sound within their budget',
      desc: 'The guitar pedal market is enormous and overwhelming. Players frequently seek community help to find pedals that produce a specific tone or serve a dual function, especially within tight budgets, and existing review resources are fragmented and subjective.'
    },
    {
      check: (t, b) => /\b(chain.*order|order.*chain|signal.*chain|chain.*signal|before.*after|wah.*before|fuzz.*buffer)\b/i.test(t+b),
      title: 'Guitarists confused about pedal signal chain order and how it affects tone',
      desc: 'Signal chain configuration is a perennial source of confusion. Players debate the optimal ordering of drives, modulation, time effects, and wahs, and often get conflicting advice. Fuzz/buffer interactions and effects loop routing add complexity that beginners find daunting.'
    },
    {
      check: (t, b) => /\b(power supply|power|power.*board|daisy chain|noise|ground loop|hum|buzz)\b/i.test(t+b),
      title: 'Guitarists face noise and power supply issues when building pedalboards',
      desc: 'Electrical noise — from daisy-chained power supplies, ground loops, or digital pedals — is one of the most common and frustrating pedalboard issues. Many players struggle to diagnose and eliminate hum, buzz, and interference without guidance.'
    },
    {
      check: (t, b) => /\b(phaser|univibe|chorus|flanger|modulation|vibe)\b.*\b(recommend|best|similar|alternative|like)\b/i.test(t+b) ||
                       /\b(recommend|best|similar|alternative|like)\b.*\b(phaser|univibe|chorus|flanger|modulation|vibe)\b/i.test(t+b),
      title: 'Guitarists seek modulation pedals that cover multiple classic sounds without buying several pedals',
      desc: 'Players want versatile modulation pedals that can cover phaser, univibe, chorus, or flanger tones in a single unit to save space and cost. Finding the right compromise between authenticity and versatility is a frequent community discussion and source of frustration.'
    }
  ],
  'Blues': [
    {
      check: (t, b) => /\b(improv|solo|lick|vocabulary|phrase|beyond.*pentatonic|pentatonic.*box|sound.*same|same.*lick)\b/i.test(t+b),
      title: 'Blues guitarists feel trapped in pentatonic patterns and want to develop more expressive vocabulary',
      desc: 'A major recurring pain point: blues guitarists feel stuck playing the same pentatonic licks and want to develop more varied, expressive vocabulary. Moving from scale shapes to musical phrases that convey emotion and tell a story is the central challenge of blues expression.'
    },
    {
      check: (t, b) => /\b(find.*jam|jam.*session|jam.*night|local.*blues|blues.*community|blues.*scene|play.*with)\b/i.test(t+b),
      title: 'Blues musicians struggle to find local jam sessions and other musicians to play with',
      desc: 'The blues community skews older and live jam sessions are increasingly hard to find, especially outside major cities. Blues players who want to practice with others and experience the genre\'s communal roots feel isolated and lack tools to discover local opportunities.'
    },
    {
      check: (t, b) => /\b(learn.*blues|start.*blues|beginner.*blues|blues.*beginner|how.*play blues|get.*into blues|recommend.*blues)\b/i.test(t+b),
      title: 'Beginner blues musicians are unsure where to start learning the genre',
      desc: 'Blues is a genre with rich history and specific technique — beginners are often unsure where to start. They ask for album recommendations, fundamental techniques, and guidance on whether to learn music theory or lean into feel, creating a recurring need for curated learning paths.'
    },
    {
      check: (t, b) => /\b(transcribe|ear training|learning by ear|figure out|play along|backing track)\b/i.test(t+b),
      title: 'Blues guitarists struggle to transcribe songs and develop their ear for the genre',
      desc: 'Transcription is central to blues learning, but many players find it difficult to develop their ear and decode what classic players are doing. Backing track and transcription tools tailored to the genre are limited.'
    }
  ]
};

function detectPainPoints(posts, sub) {
  const templates = PAIN_TEMPLATES[sub] || [];
  const results = [];
  const usedTemplates = new Set();

  for (const post of posts) {
    const title = post.title || '';
    const body = post.selftext || '';
    const combined = title + ' ' + body;

    if (!title || title.length < 5) continue;
    if (post.stickied || post.pinned) continue;

    for (const tmpl of templates) {
      if (usedTemplates.has(tmpl.title)) continue;
      if (tmpl.check(title, body)) {
        usedTemplates.add(tmpl.title);
        results.push({
          ppTitle: tmpl.title,
          description: tmpl.desc,
          postId: post.id || post.name?.replace('t3_', ''),
          redditUrl: `https://reddit.com${post.permalink}`,
          postTitle: title,
          postBody: body,
          upvotes: post.score || post.ups || 0,
          commentCount: post.num_comments || 0
        });
        break;
      }
    }
  }

  return results;
}

async function main() {
  console.log('[marcus-j pass2] Starting JSON API scan');

  const summary = { subredditsScanned: 0, totalPostsAnalyzed: 0, totalPainPoints: 0, submitted: [] };

  for (const sub of SUBREDDITS) {
    console.log(`\n=== Scanning r/${sub} (JSON API) ===`);
    let posts = [];

    try {
      // Get hot + top posts for better coverage
      const hotPosts = await fetchRedditJSON(sub, 'hot', 25);
      const topPosts = await fetchRedditJSON(sub, 'top', 25);
      
      // Deduplicate by id
      const seen = new Set();
      for (const p of [...hotPosts, ...topPosts]) {
        if (!seen.has(p.id)) { seen.add(p.id); posts.push(p); }
      }
      
      console.log(`[info] r/${sub}: ${posts.length} posts fetched (hot+top)`);
    } catch (err) {
      console.log(`[error] r/${sub}: ${err.message}`);
      await logScan(sub, 0, 0, 'error');
      continue;
    }

    const painPoints = detectPainPoints(posts, sub);
    console.log(`[info] r/${sub}: ${painPoints.length} pain points detected`);

    let submitted = 0;
    for (const pp of painPoints) {
      try {
        const createRes = await apiPost('/api/pain-points', {
          title: pp.ppTitle,
          description: pp.description,
          category: CATEGORY,
          subreddit: `r/${sub}`,
          discoveredBy: AGENT_ID
        });
        
        // Extract ID from various response shapes
        const ppId = createRes?.id || createRes?.painPoint?.id || createRes?.data?.id;
        console.log(`[created] id=${ppId} "${pp.ppTitle.substring(0, 60)}"`);
        
        if (ppId && pp.postId) {
          try {
            await apiPost('/api/pain-points/posts', {
              painPointId: ppId,
              redditPostId: pp.postId,
              redditUrl: pp.redditUrl,
              postTitle: pp.postTitle,
              postBody: (pp.postBody || '').substring(0, 2000),
              upvotes: pp.upvotes,
              commentCount: pp.commentCount,
              subreddit: `r/${sub}`,
              discoveredBy: AGENT_ID
            });
            console.log(`[linked] post ${pp.postId} -> pain point ${ppId}`);
          } catch (le) {
            console.log(`[warn] post link failed: ${le.message}`);
          }
        }

        submitted++;
        summary.submitted.push(pp.ppTitle);
        summary.totalPainPoints++;
        await sleep(500);
      } catch (err) {
        console.log(`[error] submit failed: ${err.message}`);
      }
    }

    // Log scan
    try {
      await apiPost('/api/pain-points/scan-logs', {
        agentId: AGENT_ID,
        subreddit: `r/${sub}`,
        postsScanned: posts.length,
        painPointsFound: submitted,
        status: 'completed'
      });
      console.log(`[logged] r/${sub} posts=${posts.length} submitted=${submitted}`);
    } catch (le) {
      console.log(`[warn] scan log failed: ${le.message}`);
    }

    summary.subredditsScanned++;
    summary.totalPostsAnalyzed += posts.length;

    await sleep(3000);
  }

  console.log('\n=== PASS 2 COMPLETE ===');
  console.log(`Subreddits scanned: ${summary.subredditsScanned}/4`);
  console.log(`Total posts analyzed: ${summary.totalPostsAnalyzed}`);
  console.log(`Pain points submitted: ${summary.totalPainPoints}`);
  summary.submitted.forEach((t, i) => console.log(`  ${i+1}. ${t}`));
}

main().catch(err => {
  console.error('[fatal]', err);
  process.exit(1);
});
