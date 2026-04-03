const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const CDP_URL = 'ws://127.0.0.1:52082/devtools/browser/bed919c3-d973-48cf-a14a-fc08cb854b9b';

const POST_TITLE = 'Customisable Breathwork Apps';
const POST_BODY = `Hi guys, I got really into breathwork to help me with anxiety before school presentations, so I really wanted to share this app I found!

[Link here!](https://wabi.ai/@priya_k_mindful/breathwork-1050360?_v=1)

I used to use a lot of random websites and tiktok lol, so I really love this because the whole purpose is that you can continuously edit the app with AI to add any feature you want without coding. I feel like there's a lot of cool stuff to add that I'm just not that familiar with. So I wanted to crowdsource some ideas if possible: what do you want from breathwork exercises? What new features matter?`;

const SUBREDDITS = ['breathwork', 'Meditation', 'Anxiety'];

const SCREENSHOTS_DIR = '/Users/owen/.openclaw/workspace/BRAIN/assets';
if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function postToSubreddit(page, subreddit) {
  console.log(`\n=== Posting to r/${subreddit} ===`);
  
  // Navigate to subreddit
  await page.goto(`https://www.reddit.com/r/${subreddit}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3000);
  
  // Take screenshot of subreddit page
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `priya-${subreddit}-before.png`) });
  
  // Look for Create Post button
  console.log('Looking for Create Post button...');
  
  // Try multiple selectors for the create post button
  const createPostSelectors = [
    'a[href*="submit"]',
    '[data-testid="create-post-button"]',
    'button:has-text("Create Post")',
    'a:has-text("Create Post")',
    'button:has-text("Create a post")',
    'a:has-text("Create a post")',
  ];
  
  let clicked = false;
  for (const selector of createPostSelectors) {
    try {
      const el = await page.$(selector);
      if (el) {
        console.log(`Found create post button with selector: ${selector}`);
        await el.click();
        clicked = true;
        break;
      }
    } catch (e) {
      // continue
    }
  }
  
  if (!clicked) {
    // Navigate directly to submit page
    console.log('No create post button found, navigating directly to submit page...');
    await page.goto(`https://www.reddit.com/r/${subreddit}/submit`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
  
  await sleep(3000);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `priya-${subreddit}-submit.png`) });
  console.log('On submit page...');
  
  // Wait for title field
  await page.waitForSelector('[name="title"], [placeholder*="Title"], textarea[name="title"]', { timeout: 15000 });
  
  // Enter title
  const titleField = await page.$('[name="title"], [placeholder*="Title"], textarea[name="title"]');
  if (titleField) {
    await titleField.click();
    await titleField.fill(POST_TITLE);
    console.log('Title filled');
  }
  
  await sleep(1000);
  
  // Try to switch to markdown mode
  console.log('Looking for markdown mode toggle...');
  const markdownSelectors = [
    'button:has-text("Markdown Mode")',
    'a:has-text("Markdown Mode")',
    '[aria-label="Markdown Mode"]',
    'button:has-text("markdown")',
    '.markdown-mode-button',
  ];
  
  for (const selector of markdownSelectors) {
    try {
      const el = await page.$(selector);
      if (el) {
        console.log(`Found markdown toggle: ${selector}`);
        await el.click();
        await sleep(1000);
        break;
      }
    } catch (e) {
      // continue
    }
  }
  
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `priya-${subreddit}-after-markdown.png`) });
  
  // Find the body/text field
  const bodySelectors = [
    '[placeholder*="Text (optional)"]',
    '[placeholder*="text"]',
    '[name="text"]',
    '.public-DraftEditor-content',
    '[data-testid="post-content-text-area"]',
    'textarea[name="body"]',
    '.notranslate',
    '[contenteditable="true"]',
    'div[role="textbox"]',
  ];
  
  let bodyField = null;
  for (const selector of bodySelectors) {
    try {
      const el = await page.$(selector);
      if (el) {
        console.log(`Found body field with selector: ${selector}`);
        bodyField = el;
        break;
      }
    } catch (e) {
      // continue
    }
  }
  
  if (bodyField) {
    await bodyField.click();
    await sleep(500);
    
    // Check if we're in markdown mode by seeing if field accepts plain text
    const tagName = await bodyField.evaluate(el => el.tagName);
    console.log(`Body field tag: ${tagName}`);
    
    if (tagName === 'TEXTAREA') {
      await bodyField.fill(POST_BODY);
    } else {
      // Rich text editor - need to type carefully
      await page.keyboard.type(POST_BODY, { delay: 10 });
    }
    console.log('Body filled');
  } else {
    console.log('Could not find body field!');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `priya-${subreddit}-no-body.png`) });
  }
  
  await sleep(1000);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `priya-${subreddit}-filled.png`) });
  
  // Click Submit/Post button
  console.log('Clicking submit button...');
  const submitSelectors = [
    'button:has-text("Post")',
    'button[type="submit"]',
    'button:has-text("Submit")',
    '[data-testid="post-submit-button"]',
  ];
  
  let submitted = false;
  for (const selector of submitSelectors) {
    try {
      const el = await page.$(selector);
      if (el) {
        const isDisabled = await el.evaluate(btn => btn.disabled);
        if (!isDisabled) {
          console.log(`Clicking submit with selector: ${selector}`);
          await el.click();
          submitted = true;
          break;
        }
      }
    } catch (e) {
      // continue
    }
  }
  
  if (!submitted) {
    console.log('Could not find submit button!');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `priya-${subreddit}-no-submit.png`) });
    return null;
  }
  
  // Wait for post to go live
  console.log('Waiting for post to go live...');
  await sleep(5000);
  
  const url = page.url();
  console.log(`Post URL: ${url}`);
  
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `priya-${subreddit}-posted.png`) });
  
  return url;
}

async function main() {
  console.log('Connecting to browser via CDP...');
  
  const browser = await chromium.connectOverCDP(CDP_URL);
  console.log('Connected!');
  
  const contexts = browser.contexts();
  console.log(`Contexts: ${contexts.length}`);
  
  let page;
  if (contexts.length > 0) {
    const pages = contexts[0].pages();
    console.log(`Pages: ${pages.length}`);
    
    // Close extra tabs, keep one
    if (pages.length > 1) {
      for (let i = 1; i < pages.length; i++) {
        await pages[i].close();
      }
    }
    page = pages[0] || await contexts[0].newPage();
  } else {
    const context = await browser.newContext();
    page = await context.newPage();
  }
  
  const results = {};
  
  for (let i = 0; i < SUBREDDITS.length; i++) {
    const subreddit = SUBREDDITS[i];
    
    try {
      const url = await postToSubreddit(page, subreddit);
      results[subreddit] = url;
      console.log(`✅ r/${subreddit}: ${url}`);
    } catch (err) {
      console.error(`❌ r/${subreddit} failed:`, err.message);
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `priya-${subreddit}-error.png`) }).catch(() => {});
      results[subreddit] = `ERROR: ${err.message}`;
    }
    
    // Wait 2-3 minutes between posts (skip after last one)
    if (i < SUBREDDITS.length - 1) {
      console.log('\nWaiting 2.5 minutes before next post...');
      await sleep(150000); // 2.5 minutes
    }
  }
  
  console.log('\n=== RESULTS ===');
  for (const [sub, url] of Object.entries(results)) {
    console.log(`r/${sub}: ${url}`);
  }
  
  // Final verification screenshots
  console.log('\n=== Taking final verification screenshots ===');
  for (const [sub, url] of Object.entries(results)) {
    if (url && !url.startsWith('ERROR')) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(3000);
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `priya-${sub}-final.png`) });
        console.log(`Final screenshot saved for r/${sub}`);
      } catch (e) {
        console.error(`Failed to get final screenshot for r/${sub}:`, e.message);
      }
    }
  }
  
  console.log('\nDone!');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
