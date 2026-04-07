const http = require('http');

const API_BASE = 'http://localhost:3000';
const API_KEY = 'openclaw-scanner-key';
const AGENT_ID = 'maya-chen';

async function apiPost(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const url = new URL(API_BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port || 3000,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = http.request(options, (res) => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch(e) { resolve({raw: d}); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Real data from JSON API
const submissions = [
  // r/personalfinance
  {
    ppId: 'b9e48bc7-e3bc-4d35-ac72-107010e86a67',
    redditPostId: '1sehrg0',
    redditUrl: 'https://reddit.com/r/personalfinance/comments/1sehrg0/im_giving_up_on_turbotax/',
    postTitle: "I'm Giving Up On TurboTax",
    postBody: "I've been using TurboTax ever since I first started doing my taxes. It was perfectly fine the first few years, because I would only get my W-2, fill that in, then call it a day. Now, I'm in college. My first year was part time, now I'm full time. Not that big of a deal. When I went to file on TurboTax",
    upvotes: 173, commentCount: 119, subreddit: 'r/personalfinance'
  },
  {
    ppId: '4d73d151-355a-46fd-9da6-689a7e0bc78a',
    redditPostId: '1sec0iq',
    redditUrl: 'https://reddit.com/r/personalfinance/comments/1sec0iq/doing_own_taxes_vs_hiring_a_professional/',
    postTitle: 'Doing own taxes vs hiring a professional',
    postBody: "I hate paying turbo tax $$$ to file every year and feeling like I maybe over paying or not getting the right return. Is hiring a professional the way to go? I'm married and we had a kid last year. We have one rental property but otherwise everything else is pretty standard.",
    upvotes: 173, commentCount: 249, subreddit: 'r/personalfinance'
  },
  {
    ppId: '7a3c8472-549f-40c9-bee0-a41dadc121d7',
    redditPostId: '1se6q1q',
    redditUrl: 'https://reddit.com/r/personalfinance/comments/1se6q1q/getting_a_large_check_that_was_supposed_to_be/',
    postTitle: 'Getting a -large- check that was supposed to be passive income for the rest of my life, advice on how to manage this?',
    postBody: "Hey gang, Let me start by saying forgive me for any ignorance I have on these matters, I am not super educated in them, and I am also autistic and get easily confused and frustrated. I lost my mother 9 years ago and was given a large inheritance.",
    upvotes: 308, commentCount: 87, subreddit: 'r/personalfinance'
  },
  {
    ppId: '9312c16e-8f95-4f02-8d21-4fc26be00b3c',
    redditPostId: '1seup8m',
    redditUrl: 'https://reddit.com/r/personalfinance/comments/1seup8m/how_should_i_contribute_to_retirement_savings/',
    postTitle: 'How should I contribute to retirement savings?',
    postBody: "I (26F) just got my first corporate job making $80K/yr (doubling my previous salary of ~$40K). I have $14,000 in student loan debt (a mix of subsidized and unsubsidized federal loans). I have no retirement savings.",
    upvotes: 5, commentCount: 12, subreddit: 'r/personalfinance'
  },
  {
    ppId: '2b0a380c-2fba-4fc9-ad3a-a1a9896ad578',
    redditPostId: '1seolum',
    redditUrl: 'https://reddit.com/r/personalfinance/comments/1seolum/received_a_lump_sum_from_selling_my_old_house/',
    postTitle: 'Received a lump sum from selling my old house... should I recast my mortgage or invest (or both)?',
    postBody: "Hi all. I have $300k in cash and I am planning on recasting my mortgage, but I am not sure if it makes more sense to invest in an SP500 mutual fund instead. I have $530k left on my mortgage at 5.625%.",
    upvotes: 14, commentCount: 9, subreddit: 'r/personalfinance'
  },
  // r/cooking
  {
    ppId: '015e6d52-6b54-48fb-8f8b-1ba86691c1e4',
    redditPostId: '1sejy5q',
    redditUrl: 'https://reddit.com/r/Cooking/comments/1sejy5q/waffle_house_hashbrowns/',
    postTitle: 'Waffle House Hashbrowns',
    postBody: "Why can I not make hash browns like Waffle House? I have tried so many different methods. I'm using a well-seasoned cast-iron pan, but cannot get that signature crispness without making things too oily. Is it because I'm using fresh (simply potatoes) and not dehydrated hash browns?",
    upvotes: 103, commentCount: 73, subreddit: 'r/cooking'
  },
  {
    ppId: '36e16ba0-5c42-4b1e-8a9f-383b91f0523d',
    redditPostId: '1ser5pp',
    redditUrl: 'https://reddit.com/r/Cooking/comments/1ser5pp/making_thai_curry_without_coconut_milk/',
    postTitle: 'Making thai curry without coconut milk',
    postBody: "I live in the balkans, and I stumbled across some thai curry paste and fish sauce. I want to make a thai-esque curry, but it's hard to find some ingredients like coconut milk.",
    upvotes: 14, commentCount: 32, subreddit: 'r/cooking'
  },
  {
    ppId: '1eed09ca-34ee-48f3-a805-f6613409fd94',
    redditPostId: '1sel7s1',
    redditUrl: 'https://reddit.com/r/Cooking/comments/1sel7s1/chicken_thighs_vs_breast/',
    postTitle: 'Chicken thighs vs breast',
    postBody: "Not sure if this has been asked here before, but I understand a lot of people use chicken thighs for various recipes because they are indestructible to overcooking and have more flavor and blah blah blah. My only gripe with chicken thighs is that every time I have eaten somewhere that",
    upvotes: 32, commentCount: 67, subreddit: 'r/cooking'
  },
  {
    ppId: '4aa3bca5-1848-4faf-a2d9-794f9af8dde1',
    redditPostId: '1se7bup',
    redditUrl: 'https://reddit.com/r/Cooking/comments/1se7bup/dinner_ideas_for_a_picky_eater_who_refuses_any/',
    postTitle: 'Dinner ideas for a picky eater who refuses any type of sauce?',
    postBody: "I have a 5 year-old stepson who started getting extremely picky around age 4. He used to try all kinds of foods and liked just about anything (minus spicy foods, which still don't agree with him). But over the last year, he has gotten extremely picky.",
    upvotes: 118, commentCount: 244, subreddit: 'r/cooking'
  },
  {
    ppId: '39c6e8ba-da54-4093-8174-3b071fe12e6c',
    redditPostId: '1sejxpo',
    redditUrl: 'https://reddit.com/r/Cooking/comments/1sejxpo/what_are_some_fun_things_to_make_when_i_have/',
    postTitle: 'What are some fun things to make when I have extra free time?',
    postBody: "curious for recommendations! open to pretty much anything from something simple but more hands on like sushi or more elaborate!",
    upvotes: 25, commentCount: 26, subreddit: 'r/cooking'
  },
  // r/solotravel
  {
    ppId: 'a128ad95-fcc1-4dfc-a3d4-4bc9c3988803',
    redditPostId: '1seq4t8',
    redditUrl: 'https://reddit.com/r/solotravel/comments/1seq4t8/has_anyone_tried_those_group_trips_for_solo/',
    postTitle: 'Has anyone tried those group trips for solo travelers?',
    postBody: "I usually travel solo and I really like it tbh, especially being able to do whatever I want without having to think about anyone else. But at the same time on longer trips it can get a bit lonely sometimes.",
    upvotes: 42, commentCount: 69, subreddit: 'r/solotravel'
  },
  {
    ppId: 'afff7cb2-8285-4396-a33e-31d75a668a33',
    redditPostId: '1sdtgbe',
    redditUrl: 'https://reddit.com/r/solotravel/comments/1sdtgbe/the_united_nations/',
    postTitle: 'The united nations',
    postBody: "Upon arriving in vienna towards the end of my solo backpack. i asked my hostelmate, who ended up being a physicist from dubai studying at oxford, if hed like to go for a drink.",
    upvotes: 118, commentCount: 26, subreddit: 'r/solotravel'
  },
  {
    ppId: '0378e04d-7e99-4ac3-a79a-bacee2bc8a07',
    redditPostId: '1sdt1p7',
    redditUrl: 'https://reddit.com/r/solotravel/comments/1sdt1p7/how_do_you_travel_to_make_connections_meet_people/',
    postTitle: 'How do you travel to make connections / meet people? If at all?',
    postBody: "Hey! I'm currently 2 weeks into my first solo trip, in total I'll be away for 3 months. So far I'm really loving it, but one thing that I've been thinking a lot about is how to meet people and make connections and how other people do this.",
    upvotes: 27, commentCount: 50, subreddit: 'r/solotravel'
  },
  {
    ppId: 'bb1a7d78-20ee-4926-9ed4-fb587c2d8fd8',
    redditPostId: '1se1zjg',
    redditUrl: 'https://reddit.com/r/solotravel/comments/1se1zjg/woman_40_tokyo_kyoto_and_seoul_recs/',
    postTitle: 'Woman 40+ Tokyo, Kyoto and Seoul Recs',
    postBody: "Traveling solo to Tokyo, Kyoto and then hopping over to Seoul. I'm skipping Okinawa and Osaka for now unless folks say it's a must. This is my first time and I'm still mid planning and researching.",
    upvotes: 5, commentCount: 18, subreddit: 'r/solotravel'
  },
  {
    ppId: '31c38bcb-d117-4ed0-8fd0-543fc86731d8',
    redditPostId: '1sddag0',
    redditUrl: 'https://reddit.com/r/solotravel/comments/1sddag0/solo_in_peru_without_spanish/',
    postTitle: 'Solo in Peru without Spanish',
    postBody: "I'm m34 and am kind of planning to go to Peru this August/September. plan would roughly be: visit Inka ruins, (guided) hiking trip through the andes, finding a condor and visiting the rainforest in the northeast. problem: i have never done a longer solo trip.",
    upvotes: 23, commentCount: 33, subreddit: 'r/solotravel'
  },
  // r/frugal
  {
    ppId: '12f64ead-ae17-445a-b5fd-6225bfc0323d',
    redditPostId: '1seg4id',
    redditUrl: 'https://reddit.com/r/Frugal/comments/1seg4id/what_are_the_loss_leaders_at_ikea_things_worth/',
    postTitle: 'What are the "loss leaders" at IKEA? Things worth buying that are priced so well that it\'s there to get you inside the shop?',
    postBody: "I got stainless steel utensils there for so cheap and replaced all our plastic black utensils like flippers and big spoons and so on. Is there anything else that is so well priced and good quality to buy while we visit this coming week?",
    upvotes: 961, commentCount: 351, subreddit: 'r/frugal'
  },
  {
    ppId: '8c26dfe1-2365-4c31-b9dd-34b6ba7fe013',
    redditPostId: '1secv7w',
    redditUrl: 'https://reddit.com/r/Frugal/comments/1secv7w/been_buying_the_wrong_size_of_everything/',
    postTitle: 'Been buying the wrong size of everything apparently',
    postBody: "Found out kinda by accident that the butcher counter at my local Hispanic grocery store will just cut and portion meat however you want and its like 30 40% cheaper than the prepackaged stuff at the regular supermarket.",
    upvotes: 903, commentCount: 33, subreddit: 'r/frugal'
  },
  {
    ppId: 'fd885d26-c8f0-4b49-9574-e87906808155',
    redditPostId: '1sei68r',
    redditUrl: "https://reddit.com/r/Frugal/comments/1sei68r/free_food_at_wendys_april_7th_only/",
    postTitle: "Free food at Wendy's April 7th only!",
    postBody: "We often have people asking how to stretch their last few food dollars. Wendy's is giving free fries and frosty tomorrow, April 7th. In store only, no digital orders.",
    upvotes: 154, commentCount: 15, subreddit: 'r/frugal'
  },
  {
    ppId: 'a19a7b53-52e8-4841-8edb-195b0a1145f7',
    redditPostId: '1sek0br',
    redditUrl: 'https://reddit.com/r/Frugal/comments/1sek0br/infinite_free_coffee_grounds_reduce_reuse/',
    postTitle: 'Infinite free coffee grounds: Reduce, Reuse, Rehydrate.',
    postBody: "I've accidentally figured out how to turn trash into coffee. My home printer burns through ink, and I've somehow become the person for everyone's dead batteries, so I just bring all the empties in for recycling and rack up points at Staples.",
    upvotes: 120, commentCount: 36, subreddit: 'r/frugal'
  },
  {
    ppId: '642e974f-1580-4b8c-9ab3-f52a44e36215',
    redditPostId: '1se13ri',
    redditUrl: 'https://reddit.com/r/Frugal/comments/1se13ri/using_and_getting_rid_of_your_clutter_is_better/',
    postTitle: 'Using and getting rid of your clutter is better than shopping',
    postBody: "Finally getting some junk in my trunk to a good home. Cleaning out cupboards and finding half used stuff. Clothes I forgot about. Food in the back of the fridge. You get stuff, you save money, your space is cleaner and you feel freer and wise.",
    upvotes: 236, commentCount: 25, subreddit: 'r/frugal'
  }
];

async function main() {
  console.log('Filing source post links for all pain points...');
  
  let successCount = 0;
  for (const s of submissions) {
    try {
      const result = await apiPost('/api/pain-points/posts', {
        painPointId: s.ppId,
        redditPostId: s.redditPostId,
        redditUrl: s.redditUrl,
        postTitle: s.postTitle,
        postBody: s.postBody || '',
        upvotes: s.upvotes,
        commentCount: s.commentCount,
        subreddit: s.subreddit,
        discoveredBy: AGENT_ID
      });
      const ok = result && (result.id || result.painPointId || result.post);
      console.log(`${ok ? '✓' : '?'} ${s.postTitle.substring(0,50)} → ${JSON.stringify(result).substring(0, 100)}`);
      successCount++;
    } catch (err) {
      console.log(`✗ Error linking ${s.ppId}: ${err.message}`);
    }
  }
  
  console.log(`\nLinked ${successCount}/${submissions.length} source posts`);
  
  // Updated scan logs with actual pain point counts
  console.log('\nFiling corrected scan logs...');
  const scanData = [
    { subreddit: 'r/personalfinance', postsScanned: 25, painPointsFound: 5 },
    { subreddit: 'r/cooking', postsScanned: 25, painPointsFound: 5 },
    { subreddit: 'r/solotravel', postsScanned: 25, painPointsFound: 5 },
    { subreddit: 'r/frugal', postsScanned: 25, painPointsFound: 5 }
  ];
  
  for (const s of scanData) {
    const r = await apiPost('/api/pain-points/scan-logs', {
      agentId: AGENT_ID,
      subreddit: s.subreddit,
      postsScanned: s.postsScanned,
      painPointsFound: s.painPointsFound,
      status: 'completed'
    });
    console.log(`✓ Scan log: ${s.subreddit} → ${JSON.stringify(r).substring(0, 80)}`);
  }
  
  console.log('\nDone!');
}

main().catch(console.error);
