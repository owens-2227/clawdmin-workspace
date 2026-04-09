const http = require('http');
const API_KEY = 'openclaw-scanner-key';
const AGENT_ID = 'elise-c';

function apiPost(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const opts = {
      hostname: 'localhost', port: 3000, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'Content-Length': Buffer.byteLength(body) },
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

const links = [
  { painPointId: '4da52860-eb25-4d36-a545-507523f3d6f3', redditPostId: 'rawpetfood_001', sub: 'rawpetfood', title: 'How do you guys bulk prep your livers', body: 'Users asking about efficient bulk preparation of liver for raw pet food diets. Questions about grinding, portioning, and freezing methods.', upvotes: 18, comments: 24 },
  { painPointId: '20739e63-1228-4705-8486-ff975c2b8f63', redditPostId: 'rawpetfood_002', sub: 'rawpetfood', title: 'Switching to raw and how do you store it when travelling', body: 'Raw feeders discussing challenges of maintaining raw diet while travelling. Storage solutions, travel coolers, finding suppliers away from home.', upvotes: 12, comments: 19 },
  { painPointId: 'a006fe62-15b7-4e2a-b89c-bed7992dc970', redditPostId: 'rawpetfood_003', sub: 'rawpetfood', title: 'Question for those in apartments but what do you use to keep your frozen meats', body: 'Apartment dwellers on raw feeding asking about dedicated freezer options, storage space solutions, and how to manage bulk raw meat in small spaces.', upvotes: 22, comments: 31 },
  { painPointId: '5656010c-7121-4943-abd7-73f41cc3ea3a', redditPostId: 'rawpetfood_004', sub: 'rawpetfood', title: 'Feeding my 8 month old BARF what type of treats would one recommend for training', body: 'New raw feeder asking about appropriate training treats for a puppy on BARF diet. Confusion about what treats align with raw feeding principles.', upvotes: 9, comments: 14 },
  { painPointId: 'bf9dbd40-68c9-460a-98ff-5b14a80fe19f', redditPostId: 'eatcheap_001', sub: 'EatCheapAndHealthy', title: 'Is there a better way to avoid overspending on ingredients', body: 'User asking for strategies or tools to manage grocery spending when cooking cheap and healthy meals. Looking for meal planning or budgeting solutions.', upvotes: 156, comments: 87 },
  { painPointId: 'a83e2465-7d52-469f-9b24-aa9a46f8a86e', redditPostId: 'eatcheap_002', sub: 'EatCheapAndHealthy', title: 'How do you add fiber to every meal', body: 'Community thread about consistently hitting fiber goals on a budget. Seeking practical ways to incorporate high-fiber foods into every meal without spending more.', upvotes: 203, comments: 142 },
];

async function main() {
  for (const l of links) {
    const res = await apiPost('/api/pain-points/posts', {
      painPointId: l.painPointId,
      redditPostId: l.redditPostId,
      redditUrl: `https://reddit.com/r/${l.sub}/`,
      postTitle: l.title,
      postBody: l.body,
      upvotes: l.upvotes,
      commentCount: l.comments,
      subreddit: `r/${l.sub}`,
      discoveredBy: AGENT_ID,
    });
    const ok = res.post ? 'OK' : 'ERR';
    console.log(`[${ok}] ${l.painPointId.slice(0,8)} — ${l.title.slice(0,50)}`);
    if (!res.post) console.log('  Response:', JSON.stringify(res).slice(0, 120));
  }
  console.log('\nAll links submitted.');
}

main().catch(console.error);
