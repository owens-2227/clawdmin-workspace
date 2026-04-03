const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const CDP_URL = 'ws://127.0.0.1:52082/devtools/browser/bed919c3-d973-48cf-a14a-fc08cb854b9b';

const POST_TITLE = 'Customisable Breathwork Apps';

// Post body WITHOUT the markdown link — we'll add the link via rich text editor
const POST_BODY_BEFORE_LINK = `Hi guys, I got really into breathwork to help me with anxiety before school presentations, so I really wanted to share this app I found!

`;
const LINK_TEXT = 'Link here!';
const LINK_URL = 'https://wabi.ai/@priya_k_mindful/breathwork-1050360?_v=1';
const POST_BODY_AFTER_LINK = `

I used to use a lot of random websites and tiktok lol, so I really love this because the whole purpose is that you can continuously edit the app with AI to add any feature you want without coding. I feel like there's a lot of cool stuff to add that I'm just not that familiar with. So I wanted to crowdsource some ideas if possible: what do you want from breathwork exercises? What new features matter?`;

const SUBREDDITS = ['breathwork', 'Meditation', 'Anxiety'];

const SCREENSHOTS_DIR = '/Users/owen/.openclaw/workspace/BRAIN/assets';
if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function postToSubreddit(page, subreddit) {
  console.log(`\n=== Posting to r/${subreddit} ===`);
  
  // Navigate directly to submit page
  await page.goto(`https://www.reddit.com/r/${subreddit}/submit`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3000);
  
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `priya2-${subreddit}-submit.png`) });
  console.log('On submit page, looking for title field...');
  
  // The title field in new Reddit UI
  // It's usually a div with placeholder or a special input
  // Try to find and click on the title area
  
  // First check if we need to click "Text" tab
  try {
    const textTab = await page.$('button:has-text("Text"), [role="tab"]:has-text("Text")');
    if (textTab) {
      await textTab.click();
      await sleep(1000);
      console.log('Clicked Text tab');
    }
  } catch(e) {}
  
  // Find title field - new Reddit uses a div/textarea for title
  let titleFilled = false;
  
  // Try textarea first
  const titleTextarea = await page.$('textarea[placeholder*="Title"]');
  if (titleTextarea) {
    await titleTextarea.click();
    await titleTextarea.fill(POST_TITLE);
    titleFilled = true;
    console.log('Title filled via textarea');
  }
  
  if (!titleFilled) {
    // Try div with role textbox
    const titleDivs = await page.$$('[placeholder*="Title"], [aria-label*="Title"], [data-placeholder*="Title"]');
    for (const div of titleDivs) {
      try {
        await div.click();
        await div.fill(POST_TITLE).catch(async () => {
          // If fill doesn't work, type it
          await page.keyboard.selectAll();
          await page.keyboard.type(POST_TITLE);
        });
        titleFilled = true;
        console.log('Title filled via div');
        break;
      } catch(e) { console.log('div fill failed:', e.message); }
    }
  }
  
  if (!titleFilled) {
    // Find by looking at all inputs/textareas on page
    console.log('Trying to find title field by tab navigation...');
    await page.keyboard.press('Tab');
    await sleep(500);
    // Type the title and see
    await page.keyboard.type(POST_TITLE);
    titleFilled = true;
    console.log('Title typed via keyboard');
  }
  
  await sleep(1000);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `priya2-${subreddit}-title.png`) });
  
  // Now find the body editor
  console.log('Finding body editor...');
  
  // New Reddit rich text editor - usually a div with contenteditable
  const bodyEditor = await page.$('[contenteditable="true"]');
  
  if (bodyEditor) {
    await bodyEditor.click();
    await sleep(500);
    
    // Type the text before the link
    await page.keyboard.type(POST_BODY_BEFORE_LINK);
    await sleep(500);
    
    // Now we need to insert the link using the link button in toolbar
    // First, let's type the link text, select it, then apply the link
    const linkStart = await page.evaluate(() => {
      const sel = window.getSelection();
      return sel ? sel.anchorOffset : 0;
    });
    
    // Type the link text
    await page.keyboard.type(LINK_TEXT);
    await sleep(300);
    
    // Select the link text we just typed
    for (let i = 0; i < LINK_TEXT.length; i++) {
      await page.keyboard.press('Shift+ArrowLeft');
    }
    await sleep(300);
    
    // Click the link button in the toolbar
    console.log('Looking for link button in toolbar...');
    const linkButton = await page.$('[aria-label="Link"], button[title="Link"], button:has-text("Link")');
    if (linkButton) {
      await linkButton.click();
      await sleep(1000);
      console.log('Clicked link button');
      
      // A dialog should appear to enter the URL
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `priya2-${subreddit}-link-dialog.png`) });
      
      // Find URL input field in dialog
      const urlInput = await page.$('input[placeholder*="URL"], input[placeholder*="url"], input[type="url"], input[placeholder*="http"]');
      if (urlInput) {
        await urlInput.click();
        await urlInput.fill(LINK_URL);
        await sleep(500);
        
        // Press Enter or click Save/Apply
        const saveButton = await page.$('button:has-text("Save"), button:has-text("Apply"), button:has-text("Insert"), button:has-text("Add link"), button[type="submit"]');
        if (saveButton) {
          await saveButton.click();
        } else {
          await page.keyboard.press('Enter');
        }
        await sleep(500);
        console.log('Link inserted');
      } else {
        console.log('Could not find URL input in link dialog');
        // Just press Escape and continue
        await page.keyboard.press('Escape');
      }
    } else {
      console.log('Link button not found in toolbar, will try markdown approach');
      // Deselect and move to end
      await page.keyboard.press('End');
    }
    
    // Type the rest of the body
    await sleep(300);
    await page.keyboard.type(POST_BODY_AFTER_LINK);
    console.log('Body text complete');
    
  } else {
    // Maybe it's a textarea (markdown mode)
    const bodyTextarea = await page.$('textarea[placeholder*="text"], textarea[name="text"], textarea[placeholder*="body"]');
    if (bodyTextarea) {
      await bodyTextarea.click();
      const fullBody = POST_BODY_BEFORE_LINK + `[${LINK_TEXT}](${LINK_URL})` + POST_BODY_AFTER_LINK;
      await bodyTextarea.fill(fullBody);
      console.log('Body filled in textarea');
    } else {
      console.log('ERROR: Could not find body field at all!');
    }
  }
  
  await sleep(1000);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `priya2-${subreddit}-filled.png`) });
  
  // Click the Post button
  console.log('Clicking Post button...');
  
  // Wait a moment for the button to become enabled
  await sleep(1000);
  
  // Find Post button that's not disabled
  const postButton = await page.$('button:has-text("Post"):not([disabled])');
  if (postButton) {
    await postButton.click();
    console.log('Clicked Post button');
  } else {
    // Try to find any submit-like button
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await btn.textContent();
      const disabled = await btn.evaluate(b => b.disabled);
      if (text && text.trim() === 'Post' && !disabled) {
        await btn.click();
        console.log('Clicked Post button (fallback)');
        break;
      }
    }
  }
  
  // Wait for post to go live
  console.log('Waiting for post to go live...');
  await sleep(6000);
  
  const url = page.url();
  console.log(`Current URL after post: ${url}`);
  
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `priya2-${subreddit}-posted.png`) });
  
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
    for (let i = 1; i < pages.length; i++) {
      await pages[i].close();
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
      console.error(err.stack);
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `priya2-${subreddit}-error.png`) }).catch(() => {});
      results[subreddit] = `ERROR: ${err.message}`;
    }
    
    // Wait 2.5 minutes between posts (skip after last one)
    if (i < SUBREDDITS.length - 1) {
      console.log('\nWaiting 2.5 minutes before next post...');
      await sleep(150000); // 2.5 minutes
    }
  }
  
  console.log('\n=== FINAL RESULTS ===');
  for (const [sub, url] of Object.entries(results)) {
    console.log(`r/${sub}: ${url}`);
  }
  
  // Final verification screenshots
  console.log('\n=== Taking final verification screenshots ===');
  for (const [sub, url] of Object.entries(results)) {
    if (url && !url.startsWith('ERROR') && url.includes('reddit.com/r/')) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(3000);
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `priya2-${sub}-final.png`) });
        console.log(`Final screenshot saved for r/${sub}`);
      } catch (e) {
        console.error(`Failed to get final screenshot for r/${sub}:`, e.message);
      }
    }
  }
  
  console.log('\nScript complete!');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
