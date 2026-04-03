const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CDP_URL = 'ws://127.0.0.1:52004/devtools/browser/03f3b259-468c-4868-bb0f-41b97a9ba752';

const POST_TITLE = 'Gifts for a Diabetic Cat Parent??';
const POST_BODY = `I moved in with my long-distance boyfriend and his cat a while ago. I love seeing how much effort he puts into tracking and making sure Sugar (I know, ironic!) gets the best quality of care possible.

His birthday is coming up in a few weeks and I want to find a way to include Sugar in the gift. He works a super busy schedule so I saw a few diabetes trackers (like [this one](https://wabi.ai/@Elise_c_1979/kitty-cat-diabetes-tracker-1050356?_v=1)) and I'd love to know if anyone has tested it out??

We have plenty of treats, so I was more thinking of something to help him optimise time, or just ease his mind from worrying about Sugar, only all the good stuff!!

Thank you guys : )`;

const SUBREDDITS = ['FelineDiabetes', 'CatAdvice', 'SeniorCats'];

const screenshotDir = '/Users/owen/.openclaw/workspace/BRAIN/assets';
if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function postToSubreddit(page, subreddit) {
  console.log(`\n=== Posting to r/${subreddit} ===`);
  
  // Navigate to the subreddit's submit page
  await page.goto(`https://www.reddit.com/r/${subreddit}/submit`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3000);
  
  // Take screenshot to see current state
  await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-start.png`, fullPage: false });
  console.log(`Screenshot taken: elise-${subreddit}-start.png`);
  
  // Check if we need to handle any redirects or login prompts
  const currentUrl = page.url();
  console.log(`Current URL: ${currentUrl}`);
  
  // Wait for the post form to appear
  await sleep(2000);
  
  // Look for title input
  let titleInput = null;
  
  // Try various selectors for the title field
  const titleSelectors = [
    'textarea[placeholder="Title"]',
    'input[placeholder="Title"]',
    '[data-testid="post-title-input"]',
    'textarea[name="title"]',
    '#title',
    '.post-submit-title textarea',
  ];
  
  for (const sel of titleSelectors) {
    try {
      titleInput = await page.waitForSelector(sel, { timeout: 5000 });
      if (titleInput) {
        console.log(`Found title input with selector: ${sel}`);
        break;
      }
    } catch (e) {
      // continue
    }
  }
  
  if (!titleInput) {
    // Try to find submit button or "Create Post" link
    console.log('Title input not found directly, looking for create post button...');
    const createSelectors = [
      'a[href*="submit"]',
      'button:has-text("Create Post")',
      'a:has-text("Create Post")',
      '[data-click-id="create_post"]',
    ];
    for (const sel of createSelectors) {
      try {
        const btn = await page.$(sel);
        if (btn) {
          await btn.click();
          await sleep(2000);
          break;
        }
      } catch (e) {}
    }
    
    // Try again
    for (const sel of titleSelectors) {
      try {
        titleInput = await page.waitForSelector(sel, { timeout: 5000 });
        if (titleInput) break;
      } catch (e) {}
    }
  }
  
  if (!titleInput) {
    await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-error.png` });
    throw new Error(`Could not find title input for r/${subreddit}`);
  }
  
  // Click on title and type
  await titleInput.click();
  await page.keyboard.type(POST_TITLE, { delay: 50 });
  console.log('Typed post title');
  await sleep(1000);
  
  // Look for markdown mode toggle
  const markdownSelectors = [
    'button:has-text("Markdown Mode")',
    '[data-testid="markdown-mode-button"]',
    'button:has-text("markdown")',
    '.markdownButton',
  ];
  
  for (const sel of markdownSelectors) {
    try {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click();
        console.log('Switched to markdown mode');
        await sleep(1000);
        break;
      }
    } catch (e) {}
  }
  
  // Find body textarea
  const bodySelectors = [
    '.public-DraftEditor-content',
    '[data-testid="post-body-input"]',
    'textarea[placeholder*="text"]',
    'textarea[placeholder*="body"]',
    '.md textarea',
    '[contenteditable="true"]',
    '.notranslate',
  ];
  
  let bodyInput = null;
  for (const sel of bodySelectors) {
    try {
      bodyInput = await page.$(sel);
      if (bodyInput) {
        console.log(`Found body input with selector: ${sel}`);
        break;
      }
    } catch (e) {}
  }
  
  if (!bodyInput) {
    await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-nobody.png` });
    throw new Error(`Could not find body input for r/${subreddit}`);
  }
  
  await bodyInput.click();
  await sleep(500);
  
  // Try to type the body
  // For markdown mode, just type the text including markdown
  await page.keyboard.type(POST_BODY, { delay: 30 });
  console.log('Typed post body');
  await sleep(1000);
  
  await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-before-submit.png` });
  
  // Find and click submit button
  const submitSelectors = [
    'button[type="submit"]:has-text("Post")',
    'button:has-text("Post")',
    'button:has-text("Submit")',
    '[data-testid="post-submit-button"]',
    'button.submit',
  ];
  
  let submitted = false;
  for (const sel of submitSelectors) {
    try {
      const btn = await page.$(sel);
      if (btn) {
        const isDisabled = await btn.isDisabled();
        if (!isDisabled) {
          await btn.click();
          console.log(`Clicked submit with selector: ${sel}`);
          submitted = true;
          break;
        }
      }
    } catch (e) {}
  }
  
  if (!submitted) {
    await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-nosubmit.png` });
    throw new Error(`Could not find/click submit button for r/${subreddit}`);
  }
  
  // Wait for navigation after submit
  await sleep(5000);
  
  const postUrl = page.url();
  console.log(`Post URL: ${postUrl}`);
  
  await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-posted.png` });
  console.log(`Final screenshot: elise-${subreddit}-posted.png`);
  
  return postUrl;
}

async function main() {
  console.log('Connecting to browser via CDP...');
  const browser = await chromium.connectOverCDP(CDP_URL);
  
  const contexts = browser.contexts();
  const context = contexts[0];
  const pages = context.pages();
  
  console.log(`Found ${pages.length} pages`);
  
  // Close extra tabs, keep only one
  let activePage = pages[0];
  for (let i = 1; i < pages.length; i++) {
    await pages[i].close();
  }
  
  console.log('Kept 1 page, closed extras');
  
  const results = [];
  
  for (let i = 0; i < SUBREDDITS.length; i++) {
    const subreddit = SUBREDDITS[i];
    try {
      const postUrl = await postToSubreddit(activePage, subreddit);
      results.push({ subreddit, url: postUrl, success: true });
    } catch (err) {
      console.error(`Failed to post to r/${subreddit}: ${err.message}`);
      results.push({ subreddit, url: null, success: false, error: err.message });
    }
    
    // Wait 2-3 minutes between posts (except after last one)
    if (i < SUBREDDITS.length - 1) {
      console.log('\nWaiting 2.5 minutes before next post...');
      await sleep(150000); // 2.5 minutes
    }
  }
  
  console.log('\n=== RESULTS ===');
  for (const r of results) {
    console.log(`r/${r.subreddit}: ${r.success ? r.url : 'FAILED - ' + r.error}`);
  }
  
  // Save results to file
  fs.writeFileSync('/Users/owen/.openclaw/workspace/BRAIN/elise-post-results.json', JSON.stringify(results, null, 2));
  
  await browser.disconnect();
  console.log('Done!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
