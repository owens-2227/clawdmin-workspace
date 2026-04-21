const http = require('http');

const API_KEY = 'openclaw-scanner-key';
const AGENT_ID = 'jess-m';

// Actual counts from this scan run
const corrections = [
  { subreddit: 'r/beyondthebump', postsScanned: 23, painPointsFound: 3 },
  { subreddit: 'r/Mommit', postsScanned: 23, painPointsFound: 5 },
  { subreddit: 'r/running', postsScanned: 23, painPointsFound: 2 },
  { subreddit: 'r/xxfitness', postsScanned: 23, painPointsFound: 3 },
  { subreddit: 'r/ADHD', postsScanned: 23, painPointsFound: 5 },
  { subreddit: 'r/languagelearning', postsScanned: 23, painPointsFound: 5 },
  { subreddit: 'r/productivity', postsScanned: 23, painPointsFound: 4 },
  { subreddit: 'r/Meditation', postsScanned: 24, painPointsFound: 5 },
  { subreddit: 'r/Anxiety', postsScanned: 23, painPointsFound: 5 },
];

function apiPost(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const options = {
      hostname: 'localhost', port: 3000, path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = http.request(options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

async function main() {
  for (const c of corrections) {
    const result = await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: c.subreddit,
      postsScanned: c.postsScanned,
      painPointsFound: c.painPointsFound,
      status: 'completed',
    });
    console.log(`Updated log for ${c.subreddit}: ${c.painPointsFound} pain points`);
  }
  console.log('Done.');
}

main().catch(console.error);
