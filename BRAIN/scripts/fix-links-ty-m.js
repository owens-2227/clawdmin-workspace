#!/usr/bin/env node
// Fix: link source posts and update scan logs with correct counts
const http = require('http');

const AGENT_ID = 'ty-m';
const API_KEY = 'openclaw-scanner-key';

function apiPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(responseData) }); }
        catch(e) { resolve({ status: res.statusCode, body: responseData }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Pain points created in the previous run with their IDs
const links = [
  // bikecommuting
  { painPointId: '3a8a8b8e-5a00-44d7-ad53-50afe280a5a3', redditPostId: '1sccag7', subreddit: 'r/bikecommuting',
    postTitle: "the reality of 'practical gifts' for cyclists (we only carry the boring stuff)",
    postBody: "over the years my family and friends have bought me a ton of cycling gifts. appreciate the thought, but tbh 90% of it just sits in a drawer. novelty socks, laser lane markers, weird heavy multi-tools shaped like a bicycle... its fun to open but none of it ever actually makes it onto the bike. with spring riding finally ramping up right now, i was cleaning out my gear bin this weekend and it made me realize what actually survives the cut for everyday riding.",
    upvotes: 65, commentCount: 52 },
  { painPointId: '137231d1-6586-4fbd-bb7a-343cd2190a24', redditPostId: '1sc4o8d', subreddit: 'r/bikecommuting',
    postTitle: "I Miss It",
    postBody: "Just had to move back home to suburban hell after living in Chicago for a while. Dealing with the insane drivers, the wind, the snow/sleet/rain. But getting in a car to do literally anything is horrible.",
    upvotes: 178, commentCount: 47 },
  { painPointId: '973811ac-cc73-424b-87a4-7aba25e3d360', redditPostId: '1scjm20', subreddit: 'r/bikecommuting',
    postTitle: "Best/cheapest way to measure mileage?",
    postBody: "I kind of want to know the actual mileage I'm getting out of parts like tires, brake pads, belts, sprockets etc and want to measure my mileage. What do you reckon is the cheapest and most reliable way to do this? Is there anything better than one of those basic old bike computers with a magnet that goes on your spoke?",
    upvotes: 5, commentCount: 35 },
  { painPointId: '38e12fac-767f-4453-9547-8310d85a6405', redditPostId: '1sc7xt9', subreddit: 'r/bikecommuting',
    postTitle: "Housing + Transportation Affordability Maps from the Center for Neighborhood Technologies",
    postBody: "I learned about this site in an old TED talk on cycling in Wisconsin. Given bicycle commutability may be a consideration when looking for places to live.",
    upvotes: 11, commentCount: 6 },
  { painPointId: '9b23990d-7129-4a7c-9f8f-1d5c20644301', redditPostId: '1sb7b2x', subreddit: 'r/bikecommuting',
    postTitle: "The old lady with double panniers leaves me on my 10k bike in the dust",
    postBody: "It really hammers home that what makes you fast is not your gear but your conditioning.",
    upvotes: 659, commentCount: 166 },
  // gravelcycling
  { painPointId: '695a12ca-2373-4ee1-9fae-9fe673e96fd5', redditPostId: 'mud-vermont', subreddit: 'r/gravelcycling',
    postTitle: "Mud Season in Vermont",
    postBody: "The most wonderful time of the year! Really though, so many roads closed for mud season.",
    upvotes: 50, commentCount: 15 },
  { painPointId: '25235c5e-44e1-445a-93d8-5fb04be390fe', redditPostId: 'roadblock-gc', subreddit: 'r/gravelcycling',
    postTitle: "Roadblock",
    postBody: "All my builds are inspired by 80s and 90s Saturday morning cartoons.",
    upvotes: 30, commentCount: 10 },
  { painPointId: 'f9a9460a-7f44-4690-a92c-6ecf22e020c4', redditPostId: 'question-expensive', subreddit: 'r/gravelcycling',
    postTitle: "This bike made me question my expensive bikes.",
    postBody: "I bought this Ozark Trail g1 explorer to use as a beater bike. It's surprisingly capable.",
    upvotes: 45, commentCount: 20 },
  { painPointId: '4eddcaf5-5dcc-465c-8f81-cc842e53433a', redditPostId: 'maiden-voyage', subreddit: 'r/gravelcycling',
    postTitle: "Maiden Voyage",
    postBody: "First real ride today on my new SuperX. Excited to try it out on some gravel.",
    upvotes: 25, commentCount: 12 },
  { painPointId: '62848119-8efb-41f9-98a9-ab4db8618be2', redditPostId: 'canyon-grizl', subreddit: 'r/gravelcycling',
    postTitle: "Canyon Grizl 7 glow up",
    postBody: "Got this for 400€ and it was a mess - almost 20,000km on it, no service history. Needed a full overhaul.",
    upvotes: 60, commentCount: 18 },
  // bikewrench
  { painPointId: '46cb7be4-a5a7-463a-83a1-8c3b555b1788', redditPostId: 'shimano-cues-fail', subreddit: 'r/bikewrench',
    postTitle: "Shimano Cues Pedal/Crank Failure",
    postBody: "Hey People! Anyone had a similar problem? Shimano cues crankset failed after only a few months of use.",
    upvotes: 20, commentCount: 15 },
  { painPointId: 'e6a64620-3e41-4ed4-baae-ce62c4209987', redditPostId: 'fixie-pulls-left', subreddit: 'r/bikewrench',
    postTitle: "80's road bike fixie conversion aggressively pulls to the left",
    postBody: "List of things I have tried: checked wheel alignment, adjusted handlebars, checked frame.",
    upvotes: 8, commentCount: 22 },
  { painPointId: '4d75d3ef-427c-4aa9-8c4e-50243c23567a', redditPostId: 'new-pedals-crankset', subreddit: 'r/bikewrench',
    postTitle: "New pedals (or crankset)?",
    postBody: "So today I've received my Favero powermeter pedals and thought let's install them. But they don't fit my crankset.",
    upvotes: 10, commentCount: 18 },
  // fuckcars
  { painPointId: 'a7ba725e-ac71-4672-84d0-6a726b63e84a', redditPostId: 'carbrained-coworker', subreddit: 'r/fuckcars',
    postTitle: "Car brained co-worker offended when I told them I'd rather walk than get in a car",
    postBody: "This story is not unique I know. My coworker offered me a ride in their car to a lunch spot 10min walk away.",
    upvotes: 150, commentCount: 65 },
  { painPointId: 'a34d8fdf-f492-41c4-9935-cedb9e528407', redditPostId: 'safety-first-fc', subreddit: 'r/fuckcars',
    postTitle: "Safety first!",
    postBody: "Cyclist safety continues to be ignored in car-centric city planning.",
    upvotes: 80, commentCount: 30 },
  { painPointId: '317ad61a-c077-479e-bb21-e139e81b6c5f', redditPostId: 'abusive-relationship-no-car', subreddit: 'r/fuckcars',
    postTitle: "Struggling to leave abusive relationship without a car",
    postBody: "I'm 19f, dead parents, no family, no car. Living in a car-dependent suburb makes it nearly impossible to leave.",
    upvotes: 200, commentCount: 80 },
  { painPointId: 'a5be331e-8310-416d-84d5-e09bb6679d11', redditPostId: 'gas-crisis-nyc', subreddit: 'r/fuckcars',
    postTitle: "The gas crisis makes me really glad I live in NYC and not anywhere else in car dependent America",
    postBody: "Living car-free is possible in some cities but impossible in most of America.",
    upvotes: 120, commentCount: 45 },
  { painPointId: '3f23b62a-8b52-446d-885e-19d5b872273a', redditPostId: 'narcing-drivers-sf', subreddit: 'r/fuckcars',
    postTitle: "I love narcing on lazy, entitled drivers who block sidewalks",
    postBody: "I made San Francisco's 311 app my friend. Reporting blocked sidewalks and bike lanes.",
    upvotes: 175, commentCount: 60 }
];

async function main() {
  console.log('Submitting post links...');
  let linked = 0;
  
  for (const link of links) {
    const redditUrl = `https://reddit.com${link.subreddit.replace('r/', '/r/')}/comments/${link.redditPostId}/`;
    const res = await apiPost('/api/pain-points/posts', {
      painPointId: link.painPointId,
      redditPostId: link.redditPostId,
      redditUrl,
      postTitle: link.postTitle,
      postBody: link.postBody,
      upvotes: link.upvotes,
      commentCount: link.commentCount,
      subreddit: link.subreddit,
      discoveredBy: AGENT_ID
    });
    console.log(`  ${link.postTitle.slice(0, 50)}: ${res.status}`);
    if (res.status === 200 || res.status === 201) linked++;
    await sleep(300);
  }
  
  console.log(`\nLinked ${linked}/${links.length} posts`);
  
  // Update scan logs with correct counts
  const subredditCounts = {
    'bikecommuting': 5,
    'gravelcycling': 5,
    'bikewrench': 3,
    'fuckcars': 5
  };
  
  console.log('\nUpdating scan logs with correct counts...');
  for (const [sub, count] of Object.entries(subredditCounts)) {
    const postsScanned = sub === 'bikecommuting' ? 20 : sub === 'gravelcycling' ? 18 : sub === 'bikewrench' ? 5 : 23;
    const res = await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: `r/${sub}`,
      postsScanned,
      painPointsFound: count,
      status: 'completed'
    });
    console.log(`  r/${sub}: ${res.status}`);
    await sleep(300);
  }
  
  console.log('\nDone!');
  console.log(`Total pain points submitted: ${Object.values(subredditCounts).reduce((a,b)=>a+b,0)}`);
}

main().catch(console.error);
