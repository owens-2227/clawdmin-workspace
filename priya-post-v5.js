const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const CDP_URL = 'ws://127.0.0.1:52082/devtools/browser/bed919c3-d973-48cf-a14a-fc08cb854b9b';

const POST_TITLE = 'Customisable Breathwork Apps';
const LINK_TEXT = 'Link here!';
const LINK_URL = 'https://wabi.ai/@priya_k_mindful/breathwork-1050360?_v=1';

const PART1 = 'Hi guys, I got really into breathwork to help me with anxiety before school presentations, so I really wanted to share this app I found!';
const PART2 = "I used to use a lot of random websites and tiktok lol, so I really love this because the whole purpose is that you can continuously edit the app with AI to add any feature you want without coding. I feel like there's a lot of cool stuff to add that I'm just not that familiar with. So I wanted to crowdsource some ideas if possible: what do you want from breathwork exercises? What new features matter?";

// Subreddits with optional flair to select
const SUBREDDITS = [
  { name: 'Meditation', flair: 'Discussion 💬' },
  { name: 'Anxiety', flair: 'Helpful Tips!' },
];

const SCREENSHOTS_DIR = '/Users/owen/.openclaw/workspace/BRAIN/assets';
if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function clickShadowButton(page, buttonText) {
  return await page.evaluate((text) => {
    function searchAndClick(root) {
      for (const btn of root.querySelectorAll('button')) {
        if (btn.textContent.trim() === text && !btn.disabled) { btn.click(); return true; }
      }
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot && searchAndClick(el.shadowRoot)) return true;
      }
      return false;
    }
    return searchAndClick(document.body);
  }, buttonText);
}

async function clickShadowRadio(page, radioText) {
  return await page.evaluate((text) => {
    function searchAndClick(root) {
      for (const radio of root.querySelectorAll('[role="radio"]')) {
        if (radio.textContent.trim() === text) { radio.click(); return true; }
      }
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot && searchAndClick(el.shadowRoot)) return true;
      }
      return false;
    }
    return searchAndClick(document.body);
  }, radioText);
}

async function postToSubreddit(page, subredditName, flairText) {
  console.log(`\n=== Posting to r/${subredditName} ===`);

  await page.goto(`https://www.reddit.com/r/${subredditName}/submit/?type=TEXT`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(4000);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `v5-${subredditName}-1-loaded.png`) });

  // === SELECT FLAIR (if required) ===
  if (flairText) {
    console.log(`Selecting flair: ${flairText}`);
    
    // Click "Add flair and tags" button to open flair picker
    const flairClicked = await clickShadowButton(page, 'Add flair and tags  *');
    if (flairClicked) {
      console.log('Flair button clicked, flair picker should be open');
      await sleep(1000);
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `v5-${subredditName}-2-flair-open.png`) });
      
      // Click the desired flair radio
      const radioClicked = await clickShadowRadio(page, flairText);
      if (radioClicked) {
        console.log(`Flair "${flairText}" selected`);
        await sleep(500);
      } else {
        console.log(`WARNING: Could not find flair "${flairText}", trying partial match...`);
        // Try partial match
        const partialClicked = await page.evaluate((text) => {
          function searchAndClick(root) {
            for (const el of root.querySelectorAll('[role="radio"]')) {
              if (el.textContent.trim().includes(text)) { el.click(); return true; }
            }
            for (const el of root.querySelectorAll('*')) {
              if (el.shadowRoot && searchAndClick(el.shadowRoot)) return true;
            }
            return false;
          }
          // Try just first word
          const firstWord = text.split(' ')[0];
          return searchAndClick(document.body);
        }, flairText);
      }
      
      // Click "Add" to confirm flair
      const addClicked = await clickShadowButton(page, 'Add');
      if (addClicked) {
        console.log('Flair confirmed with Add button');
        await sleep(1000);
      } else {
        // Try Apply
        await clickShadowButton(page, 'Apply');
        console.log('Flair confirmed with Apply button');
        await sleep(1000);
      }
    }
    
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `v5-${subredditName}-3-flair-done.png`) });
  }

  // === SWITCH TO MARKDOWN MODE ===
  console.log('Switching to Markdown mode...');
  const mdSwitched = await clickShadowButton(page, 'Switch to Markdown');
  console.log('Markdown switched:', mdSwitched);
  await sleep(1500);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `v5-${subredditName}-4-markdown.png`) });

  // === FILL TITLE ===
  console.log('Filling title...');
  const titleTA = await page.$('textarea[name="title"]');
  if (!titleTA) throw new Error('Title textarea not found');
  await titleTA.click();
  await titleTA.fill(POST_TITLE);
  console.log('Title filled');
  await sleep(500);

  // === FILL BODY ===
  console.log('Filling body...');
  const bodyTA = await page.$('textarea[placeholder="Body text (optional)"], textarea[placeholder="Body text*"], textarea[placeholder="Body text"]');
  if (!bodyTA) {
    // Try getting all textareas
    const allTAs = await page.$$('textarea');
    console.log(`Found ${allTAs.length} textareas`);
    throw new Error('Body textarea not found');
  }
  
  const fullBody = `${PART1}\n\n[${LINK_TEXT}](${LINK_URL})\n\n${PART2}`;
  await bodyTA.click();
  await bodyTA.fill(fullBody);
  console.log('Body filled');
  await sleep(500);

  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `v5-${subredditName}-5-filled.png`) });

  // === SUBMIT ===
  console.log('Waiting for Post button to be enabled...');
  for (let i = 0; i < 15; i++) {
    const state = await page.evaluate(() => {
      function findPostBtn(root) {
        for (const btn of root.querySelectorAll('button')) {
          if (btn.textContent.trim() === 'Post') return { found: true, disabled: btn.disabled };
        }
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) { const r = findPostBtn(el.shadowRoot); if (r) return r; }
        }
        return null;
      }
      return findPostBtn(document.body);
    });
    console.log(`Attempt ${i+1}: Post button =`, state);
    if (state && !state.disabled) {
      const clicked = await clickShadowButton(page, 'Post');
      console.log('Post clicked:', clicked);
      break;
    }
    await sleep(1000);
  }

  console.log('Waiting for post to publish...');
  await sleep(8000);

  const url = page.url();
  console.log(`URL after posting: ${url}`);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `v5-${subredditName}-6-published.png`) });

  return url;
}

async function main() {
  console.log('Connecting to browser via CDP...');
  const browser = await chromium.connectOverCDP(CDP_URL);
  console.log('Connected!');

  const contexts = browser.contexts();
  let page;
  if (contexts.length > 0) {
    const pages = contexts[0].pages();
    console.log(`Pages: ${pages.length}`);
    for (let i = 1; i < pages.length; i++) await pages[i].close();
    page = pages[0] || await contexts[0].newPage();
  } else {
    const context = await browser.newContext();
    page = await context.newPage();
  }

  page.on('dialog', async dialog => {
    console.log('Dialog:', dialog.type());
    try {
      if (dialog.type() === 'beforeunload') await dialog.accept();
      else await dialog.dismiss();
    } catch(e) { console.log('Dialog already handled'); }
  });

  const results = {
    'breathwork': 'https://www.reddit.com/r/breathwork/comments/1sbshh3/customisable_breathwork_apps/'
  };

  for (let i = 0; i < SUBREDDITS.length; i++) {
    const { name, flair } = SUBREDDITS[i];
    try {
      const url = await postToSubreddit(page, name, flair);
      results[name] = url;
      console.log(`✅ r/${name}: ${url}`);
    } catch (err) {
      console.error(`❌ r/${name} FAILED:`, err.message);
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `v5-${name}-error.png`) }).catch(() => {});
      results[name] = `ERROR: ${err.message}`;
    }

    if (i < SUBREDDITS.length - 1) {
      console.log('\nWaiting 2.5 minutes before next post...');
      await sleep(150000);
    }
  }

  console.log('\n=== FINAL RESULTS ===');
  for (const [sub, url] of Object.entries(results)) {
    console.log(`r/${sub}: ${url}`);
  }

  // Get actual URLs from profile if subreddit home was returned
  console.log('\n=== Checking user profile for actual post URLs ===');
  await page.goto('https://www.reddit.com/user/Perfect_Cricket_9114/submitted/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3000);
  
  const userPosts = await page.evaluate(() => {
    const result = [];
    function searchShadow(root) {
      root.querySelectorAll('a').forEach(a => {
        const text = a.textContent.trim();
        const href = a.href;
        if (href && href.includes('/comments/') && !href.includes('entry_point') && text.length > 5) {
          result.push({ href, text: text.substring(0, 80) });
        }
      });
      root.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) searchShadow(el.shadowRoot);
      });
    }
    searchShadow(document.body);
    const seen = new Set();
    return result.filter(p => { if (seen.has(p.href)) return false; seen.add(p.href); return true; });
  });
  
  console.log('All posts by user:', JSON.stringify(userPosts, null, 2));
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `v5-user-posts.png`) });

  // Verification screenshots
  console.log('\n=== Verification screenshots ===');
  for (const post of userPosts.filter(p => p.text.includes('Customisable') || p.text.includes('Breathwork'))) {
    try {
      await page.goto(post.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(3000);
      const sub = post.href.match(/\/r\/([^\/]+)\//)?.[1] || 'unknown';
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `v5-verify-${sub}.png`) });
      console.log(`✅ Verified: ${post.href}`);
    } catch(e) {
      console.error(`Verify failed:`, e.message);
    }
  }

  console.log('\nScript complete!');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
