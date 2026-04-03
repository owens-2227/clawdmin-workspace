const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const CDP_URL = 'ws://127.0.0.1:52082/devtools/browser/bed919c3-d973-48cf-a14a-fc08cb854b9b';

const POST_TITLE = 'Customisable Breathwork Apps';
const LINK_TEXT = 'Link here!';
const LINK_URL = 'https://wabi.ai/@priya_k_mindful/breathwork-1050360?_v=1';

const PART1 = 'Hi guys, I got really into breathwork to help me with anxiety before school presentations, so I really wanted to share this app I found!';
const PART2 = "I used to use a lot of random websites and tiktok lol, so I really love this because the whole purpose is that you can continuously edit the app with AI to add any feature you want without coding. I feel like there's a lot of cool stuff to add that I'm just not that familiar with. So I wanted to crowdsource some ideas if possible: what do you want from breathwork exercises? What new features matter?";

const SUBREDDITS = ['breathwork', 'Meditation', 'Anxiety'];

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

async function postToSubreddit(page, subreddit) {
  console.log(`\n=== Posting to r/${subreddit} ===`);

  await page.goto(`https://www.reddit.com/r/${subreddit}/submit/?type=TEXT`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(4000);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `v4-${subreddit}-1-loaded.png`) });

  // Switch to Markdown mode
  console.log('Switching to Markdown mode...');
  const mdSwitched = await clickShadowButton(page, 'Switch to Markdown');
  console.log('Markdown switched:', mdSwitched);
  await sleep(1500);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `v4-${subreddit}-2-markdown.png`) });

  // Fill title - now it's textarea[name="title"]
  console.log('Filling title...');
  const titleTA = await page.$('textarea[name="title"]');
  if (!titleTA) throw new Error('Title textarea not found');
  await titleTA.click();
  await titleTA.fill(POST_TITLE);
  console.log('Title filled');
  await sleep(500);

  // Fill body - various placeholder texts possible
  console.log('Filling body...');
  const bodyTA = await page.$('textarea[placeholder="Body text (optional)"], textarea[placeholder="Body text*"], textarea[placeholder="Body text"], textarea:not([name="title"]):not([name="q"]):not([name="g-recaptcha-response"])');
  if (!bodyTA) throw new Error('Body textarea not found');
  
  const fullBody = `${PART1}\n\n[${LINK_TEXT}](${LINK_URL})\n\n${PART2}`;
  await bodyTA.click();
  await bodyTA.fill(fullBody);
  console.log('Body filled');
  await sleep(500);

  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `v4-${subreddit}-3-filled.png`) });

  // Wait for Post button to be enabled
  console.log('Waiting for Post button...');
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
  await sleep(7000);

  const url = page.url();
  console.log(`URL after posting: ${url}`);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `v4-${subreddit}-4-published.png`) });

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

  // Handle dialogs - accept "Leave site?" popups
  page.on('dialog', async dialog => {
    console.log('Dialog:', dialog.type(), dialog.message().substring(0, 80));
    try {
      if (dialog.type() === 'beforeunload') {
        await dialog.accept();
      } else {
        await dialog.dismiss();
      }
    } catch (e) {
      // Dialog may have already been handled
      console.log('Dialog already handled:', e.message);
    }
  });

  const results = {};

  for (let i = 0; i < SUBREDDITS.length; i++) {
    const sub = SUBREDDITS[i];
    try {
      const url = await postToSubreddit(page, sub);
      results[sub] = url;
      console.log(`✅ r/${sub}: ${url}`);
    } catch (err) {
      console.error(`❌ r/${sub} FAILED:`, err.message);
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `v4-${sub}-error.png`) }).catch(() => {});
      results[sub] = `ERROR: ${err.message}`;
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

  // Final verification screenshots
  console.log('\n=== Verification ===');
  for (const [sub, url] of Object.entries(results)) {
    if (url && !url.startsWith('ERROR') && url.includes('reddit.com/r/')) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(3000);
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `v4-${sub}-verify.png`) });
        console.log(`✅ Verified r/${sub}`);
      } catch (e) {
        console.error(`Verify screenshot failed for r/${sub}:`, e.message);
      }
    }
  }

  console.log('\nDone!');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
