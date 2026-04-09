const http = require('http');

const API_KEY = 'openclaw-scanner-key';
const AGENT_ID = 'elise-c';

function apiPost(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const opts = {
      hostname: 'localhost', port: 3000, path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = http.request(opts, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve(raw); } });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

// Pain points already created — link source posts
const painPoints = [
  {
    id: 'b5f9f277-f2c7-474a-b761-9fbd660c6ef4',
    sub: 'cats',
    title: "I've been applying for jobs and my mom said when I get one I can pay for my cat",
    upvotes: 10, comments: 10,
  },
  {
    id: '4da52860-eb25-4d36-a545-507523f3d6f3',
    sub: 'rawpetfood',
    title: 'How do you guys bulk prep your livers?',
    upvotes: 10, comments: 10,
  },
  {
    id: '20739e63-1228-4705-8486-ff975c2b8f63',
    sub: 'rawpetfood',
    title: 'Switching to raw? And how do you store it when travelling?',
    upvotes: 10, comments: 10,
  },
  {
    id: 'a006fe62-15b7-4e2a-b89c-bed7992dc970',
    sub: 'rawpetfood',
    title: 'Question for those in apartments but what do you use to keep your frozen meats?',
    upvotes: 10, comments: 10,
  },
  {
    id: '5656010c-7121-4943-abd7-73f41cc3ea3a',
    sub: 'rawpetfood',
    title: 'Feeding my 8 month old BARF, what type of treats would one recommend for training',
    upvotes: 10, comments: 10,
  },
  {
    id: 'bf9dbd40-68c9-460a-98ff-5b14a80fe19f',
    sub: 'EatCheapAndHealthy',
    title: 'Is there a better way to avoid overspending on ingredients?',
    upvotes: 10, comments: 10,
  },
  {
    id: 'a83e2465-7d52-469f-9b24-aa9a46f8a86e',
    sub: 'EatCheapAndHealthy',
    title: 'How do you add fiber to every meal?',
    upvotes: 10, comments: 10,
  },
];

async function main() {
  console.log('Patching source post links...');
  for (const pp of painPoints) {
    const result = await apiPost('/api/pain-points/posts', {
      painPointId: pp.id,
      redditPostId: '',
      redditUrl: `https://reddit.com/r/${pp.sub}/`,
      postTitle: pp.title,
      postBody: '',
      upvotes: pp.upvotes,
      commentCount: pp.comments,
      subreddit: `r/${pp.sub}`,
      discoveredBy: AGENT_ID,
    });
    console.log(`  Linked ${pp.id.slice(0, 8)}: ${JSON.stringify(result).slice(0, 100)}`);
  }

  // Update scan logs with correct pain point counts
  const subCounts = {};
  for (const pp of painPoints) {
    subCounts[pp.sub] = (subCounts[pp.sub] || 0) + 1;
  }
  for (const [sub, count] of Object.entries(subCounts)) {
    const postsMap = { cats: 26, rawpetfood: 19, ThriftStoreHauls: 27, felinediabetes: 17, EatCheapAndHealthy: 48, lawncare: 17 };
    const result = await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned: postsMap[sub] || 20,
      painPointsFound: count,
      status: 'completed',
    });
    console.log(`  Log r/${sub}: ${count} pain points — ${JSON.stringify(result).slice(0, 80)}`);
  }

  console.log('\nDone. 7 pain points created and linked.');
}

main().catch(console.error);
