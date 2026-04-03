const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CDP_URL = 'ws://127.0.0.1:52004/devtools/browser/03f3b259-468c-4868-bb0f-41b97a9ba752';

const POST_TITLE = 'Gifts for a Diabetic Cat Parent??';
const LINK_URL = 'https://wabi.ai/@Elise_c_1979/kitty-cat-diabetes-tracker-1050356?_v=1';
const LINK_TEXT = 'this one';

// Body split around the link
const BODY_BEFORE = `I moved in with my long-distance boyfriend and his cat a while ago. I love seeing how much effort he puts into tracking and making sure Sugar (I know, ironic!) gets the best quality of care possible.

His birthday is coming up in a few weeks and I want to find a way to include Sugar in the gift. He works a super busy schedule so I saw a few diabetes trackers (like `;
const BODY_AFTER = `) and I'd love to know if anyone has tested it out??

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
  
  await page.goto(`https://www.reddit.com/r/${subreddit}/submit/?type=TEXT`, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(3000);
  
  await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-loaded.png` });
  console.log(`Page loaded. URL: ${page.url()}`);
  
  // Fill in title
  const titleSel = 'textarea[name="title"], textarea[placeholder="Title"], #title';
  await page.waitForSelector(titleSel, { timeout: 10000 });
  await page.click(titleSel);
  await page.fill(titleSel, POST_TITLE);
  console.log('Title entered');
  await sleep(500);
  
  // Click body area - try multiple approaches
  let bodyClicked = false;
  
  // Try clicking the placeholder text area
  const bodyAreaSelectors = [
    '.public-DraftEditor-content',
    '[data-contents="true"]',
    '.DraftEditor-editorContainer',
    '.notranslate[contenteditable="true"]',
    'div[contenteditable="true"]',
    '.RichTextJSON-root',
    '[placeholder="Body text (optional)"]',
  ];
  
  for (const sel of bodyAreaSelectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        const box = await el.boundingBox();
        if (box && box.width > 0 && box.height > 0) {
          await page.click(sel);
          console.log(`Clicked body with selector: ${sel}`);
          bodyClicked = true;
          break;
        }
      }
    } catch (e) {
      console.log(`Selector ${sel} failed: ${e.message}`);
    }
  }
  
  if (!bodyClicked) {
    // Try clicking by coordinates - look for the body text area by text
    try {
      const bodyEl = page.locator('text=Body text (optional)').first();
      await bodyEl.click({ timeout: 5000 });
      console.log('Clicked body via placeholder text');
      bodyClicked = true;
    } catch (e) {
      console.log(`Placeholder click failed: ${e.message}`);
    }
  }
  
  if (!bodyClicked) {
    // Try JavaScript click on contenteditable
    await page.evaluate(() => {
      const els = document.querySelectorAll('[contenteditable="true"]');
      for (const el of els) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 100 && rect.height > 20) {
          el.click();
          el.focus();
          return;
        }
      }
    });
    console.log('Tried JS click on contenteditable');
    bodyClicked = true;
  }
  
  await sleep(1000);
  await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-body-click.png` });
  
  // Type the text before the link
  await page.keyboard.type(BODY_BEFORE, { delay: 20 });
  await sleep(500);
  
  // Now we need to insert "this one" as a hyperlink
  // First, type the link text
  await page.keyboard.type(LINK_TEXT, { delay: 50 });
  await sleep(300);
  
  // Select the link text we just typed (go back and select LINK_TEXT.length chars)
  for (let i = 0; i < LINK_TEXT.length; i++) {
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.up('Shift');
  }
  await sleep(300);
  
  // Try Ctrl+K for link (common rich text editor shortcut)
  await page.keyboard.press('Control+k');
  await sleep(1000);
  
  await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-link-dialog.png` });
  
  // Check if a link dialog appeared
  let linkDialogVisible = false;
  const linkInputSelectors = [
    'input[placeholder*="URL"]',
    'input[placeholder*="url"]',
    'input[placeholder*="link"]',
    'input[placeholder*="http"]',
    'input[type="url"]',
    '[data-testid="link-input"]',
  ];
  
  for (const sel of linkInputSelectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        const visible = await el.isVisible();
        if (visible) {
          await el.fill(LINK_URL);
          console.log(`Entered URL in dialog with selector: ${sel}`);
          linkDialogVisible = true;
          
          // Press Enter or find Apply/OK button
          await page.keyboard.press('Enter');
          await sleep(500);
          break;
        }
      }
    } catch (e) {}
  }
  
  if (!linkDialogVisible) {
    console.log('Link dialog did not appear with Ctrl+K, trying toolbar link button...');
    
    // First click somewhere else to deselect, then re-select
    // Actually, let's try clicking the link button in the toolbar
    const linkBtnSelectors = [
      'button[aria-label*="link" i]',
      'button[title*="link" i]',
      'button[aria-label*="Link" i]',
      'button[title*="Link" i]',
      '[data-testid="link-button"]',
    ];
    
    // First re-select the text
    for (let i = 0; i < LINK_TEXT.length; i++) {
      await page.keyboard.down('Shift');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.up('Shift');
    }
    await sleep(200);
    
    for (const sel of linkBtnSelectors) {
      try {
        const btn = await page.$(sel);
        if (btn) {
          const visible = await btn.isVisible();
          if (visible) {
            await btn.click();
            console.log(`Clicked link button: ${sel}`);
            await sleep(1000);
            
            // Try to fill URL
            for (const inputSel of linkInputSelectors) {
              try {
                const input = await page.$(inputSel);
                if (input && await input.isVisible()) {
                  await input.fill(LINK_URL);
                  await page.keyboard.press('Enter');
                  linkDialogVisible = true;
                  console.log(`URL entered via toolbar button`);
                  break;
                }
              } catch (e) {}
            }
            break;
          }
        }
      } catch (e) {}
    }
  }
  
  if (!linkDialogVisible) {
    console.log('WARNING: Could not insert link via dialog. The link might not be clickable.');
    // Just move cursor to end and continue
    await page.keyboard.press('End');
  }
  
  await sleep(500);
  
  // Type the rest of the body
  await page.keyboard.type(BODY_AFTER, { delay: 20 });
  console.log('Typed body text');
  
  await sleep(1000);
  await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-before-post.png` });
  
  // Click Post button
  let posted = false;
  const postBtnSelectors = [
    'button:has-text("Post"):not([disabled])',
    'button[data-testid="post-submit-button"]',
    'button.button-brand:has-text("Post")',
  ];
  
  for (const sel of postBtnSelectors) {
    try {
      const btn = await page.locator(sel).last();
      if (await btn.isVisible()) {
        await btn.click();
        console.log(`Clicked Post button: ${sel}`);
        posted = true;
        break;
      }
    } catch (e) {}
  }
  
  if (!posted) {
    // Try finding button by text
    try {
      await page.getByRole('button', { name: 'Post' }).last().click();
      console.log('Clicked Post button via role');
      posted = true;
    } catch (e) {
      console.log(`Role-based click failed: ${e.message}`);
    }
  }
  
  if (!posted) {
    await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-nopost-btn.png` });
    throw new Error(`Could not find Post button for r/${subreddit}`);
  }
  
  // Wait for navigation
  await sleep(8000);
  
  const postUrl = page.url();
  console.log(`Posted! URL: ${postUrl}`);
  
  await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-done.png` });
  
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
      console.log(`✓ Posted to r/${subreddit}: ${postUrl}`);
    } catch (err) {
      console.error(`✗ Failed to post to r/${subreddit}: ${err.message}`);
      results.push({ subreddit, url: null, success: false, error: err.message });
    }
    
    // Wait 2.5 minutes between posts (except after last one)
    if (i < SUBREDDITS.length - 1) {
      console.log('\nWaiting 2.5 minutes before next post...');
      await sleep(150000);
    }
  }
  
  console.log('\n=== FINAL RESULTS ===');
  for (const r of results) {
    if (r.success) {
      console.log(`✓ r/${r.subreddit}: ${r.url}`);
    } else {
      console.log(`✗ r/${r.subreddit}: FAILED - ${r.error}`);
    }
  }
  
  fs.writeFileSync('/Users/owen/.openclaw/workspace/BRAIN/elise-post-results.json', JSON.stringify(results, null, 2));
  
  await browser.disconnect();
  console.log('Done!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
