const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const CDP_URL = 'ws://127.0.0.1:52082/devtools/browser/bed919c3-d973-48cf-a14a-fc08cb854b9b';

const POST_TITLE = 'Customisable Breathwork Apps';
const LINK_TEXT = 'Link here!';
const LINK_URL = 'https://wabi.ai/@priya_k_mindful/breathwork-1050360?_v=1';

// Post body parts
const PART1 = 'Hi guys, I got really into breathwork to help me with anxiety before school presentations, so I really wanted to share this app I found!';
const PART2 = 'I used to use a lot of random websites and tiktok lol, so I really love this because the whole purpose is that you can continuously edit the app with AI to add any feature you want without coding. I feel like there\'s a lot of cool stuff to add that I\'m just not that familiar with. So I wanted to crowdsource some ideas if possible: what do you want from breathwork exercises? What new features matter?';

const SUBREDDITS = ['breathwork', 'Meditation', 'Anxiety'];

const SCREENSHOTS_DIR = '/Users/owen/.openclaw/workspace/BRAIN/assets';
if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function postToSubreddit(page, subreddit) {
  console.log(`\n=== Posting to r/${subreddit} ===`);
  
  // Navigate directly to text submit page
  await page.goto(`https://www.reddit.com/r/${subreddit}/submit/?type=TEXT`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(4000);
  
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `priya3-${subreddit}-1-loaded.png`) });
  
  // === FILL TITLE ===
  // The title is a contenteditable div with no aria-label (first contenteditable on page)
  // But we'll try to be specific
  console.log('Filling title...');
  
  // Find the title contenteditable - it's the one without aria-label for "Post body"  
  const titleEditable = await page.$('[contenteditable="true"]:not([aria-label])');
  if (titleEditable) {
    await titleEditable.click();
    await sleep(300);
    // Clear any existing content
    await page.keyboard.press('Control+a');
    await page.keyboard.type(POST_TITLE);
    console.log('Title typed');
  } else {
    console.log('ERROR: Cannot find title field!');
    throw new Error('Title field not found');
  }
  
  await sleep(500);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `priya3-${subreddit}-2-title.png`) });
  
  // === TRY MARKDOWN MODE ===
  // Look for the markdown toggle in the toolbar
  console.log('Looking for markdown toggle...');
  
  // The markdown toggle in new Reddit is usually an icon button
  // Let's look for it via various means
  let markdownMode = false;
  
  // Try by aria-label or title containing "markdown"
  const markdownBtn = await page.$('[aria-label*="arkdown" i], [title*="arkdown" i], button[title*="Markdown"], rte-markdown-toggle');
  if (markdownBtn) {
    await markdownBtn.click();
    await sleep(1000);
    markdownMode = true;
    console.log('Switched to markdown mode');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `priya3-${subreddit}-3-markdown.png`) });
  } else {
    // Try clicking body area first to activate toolbar, then look
    const bodyEl = await page.$('[aria-label="Post body text field"]');
    if (bodyEl) {
      await bodyEl.click();
      await sleep(500);
      
      // Now look for markdown toggle again
      const mdBtn2 = await page.$('[aria-label*="arkdown" i], [title*="arkdown" i]');
      if (mdBtn2) {
        await mdBtn2.click();
        await sleep(1000);
        markdownMode = true;
        console.log('Switched to markdown mode (attempt 2)');
      }
    }
  }
  
  if (!markdownMode) {
    console.log('Markdown mode not found, will use rich text editor');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `priya3-${subreddit}-3-no-markdown.png`) });
  }
  
  // === FILL BODY ===
  if (markdownMode) {
    // In markdown mode, find textarea and type the full markdown body
    const textarea = await page.$('textarea[aria-label="Post body text field"], textarea[placeholder*="body"], textarea[placeholder*="text"]');
    if (textarea) {
      await textarea.click();
      const fullBody = `${PART1}\n\n[${LINK_TEXT}](${LINK_URL})\n\n${PART2}`;
      await textarea.fill(fullBody);
      console.log('Body filled in markdown mode');
    } else {
      // Maybe it's a contenteditable even in markdown mode
      const bodyEl = await page.$('[aria-label="Post body text field"]');
      if (bodyEl) {
        await bodyEl.click();
        const fullBody = `${PART1}\n\n[${LINK_TEXT}](${LINK_URL})\n\n${PART2}`;
        await page.keyboard.type(fullBody);
        console.log('Body typed in markdown mode');
      }
    }
  } else {
    // Rich text mode - need to use the link button
    const bodyEl = await page.$('[aria-label="Post body text field"]');
    if (!bodyEl) {
      throw new Error('Body field not found');
    }
    
    await bodyEl.click();
    await sleep(300);
    
    // Type PART1
    await page.keyboard.type(PART1);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await sleep(300);
    
    // Now type the link text that we'll turn into a hyperlink
    await page.keyboard.type(LINK_TEXT);
    await sleep(300);
    
    // Select the link text
    for (let i = 0; i < LINK_TEXT.length; i++) {
      await page.keyboard.press('Shift+ArrowLeft');
    }
    await sleep(300);
    
    console.log('Link text selected, looking for link button...');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `priya3-${subreddit}-4-selected.png`) });
    
    // Find the link button in toolbar (🔗)
    // Try various selectors
    let linkButtonClicked = false;
    
    // Try aria-label
    const linkBtnSelectors = [
      '[aria-label="Link"]',
      '[aria-label="Insert Link"]',
      '[aria-label="link"]',
      'button[title="Link"]',
      '[data-lexical-decorator="true"] button',
    ];
    
    for (const sel of linkBtnSelectors) {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click();
        linkButtonClicked = true;
        console.log(`Link button clicked: ${sel}`);
        break;
      }
    }
    
    if (!linkButtonClicked) {
      // Try to find by looking at all buttons and checking their inner HTML for link icon
      console.log('Looking for link button by evaluating all buttons...');
      const clicked = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          const html = btn.innerHTML.toLowerCase();
          const label = (btn.getAttribute('aria-label') || '').toLowerCase();
          const title = (btn.getAttribute('title') || '').toLowerCase();
          if (label.includes('link') || title.includes('link') || html.includes('link')) {
            btn.click();
            return true;
          }
        }
        return false;
      });
      if (clicked) {
        linkButtonClicked = true;
        console.log('Link button clicked via evaluate');
      }
    }
    
    await sleep(1000);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `priya3-${subreddit}-5-link-dialog.png`) });
    
    if (linkButtonClicked) {
      // Enter URL in the dialog
      const urlInput = await page.$('input[type="url"], input[placeholder*="URL"], input[placeholder*="url"], input[placeholder*="http"], input[placeholder*="paste"]');
      if (urlInput) {
        await urlInput.click();
        await urlInput.fill(LINK_URL);
        await sleep(300);
        
        // Click Save/Apply/Insert button
        const saveBtn = await page.$('button:has-text("Save"), button:has-text("Apply"), button:has-text("Insert"), button:has-text("Done"), button[type="submit"]');
        if (saveBtn) {
          await saveBtn.click();
          console.log('Link saved');
        } else {
          await page.keyboard.press('Enter');
          console.log('Link saved via Enter');
        }
        await sleep(500);
      } else {
        console.log('URL input not found in dialog');
        await page.keyboard.press('Escape');
      }
    } else {
      console.log('WARNING: Could not find link button, link will not be hyperlinked');
    }
    
    // Move cursor to end and type PART2
    await bodyEl.click();
    // Go to end
    await page.keyboard.press('End');
    await page.keyboard.press('End');
    await sleep(200);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type(PART2);
    console.log('Body text complete');
  }
  
  await sleep(1000);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `priya3-${subreddit}-6-filled.png`) });
  
  // === SUBMIT ===
  console.log('Clicking Post button...');
  await sleep(1000);
  
  // Find enabled Post button
  let postClicked = false;
  
  // Wait for Post button to become enabled
  for (let attempt = 0; attempt < 5; attempt++) {
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await btn.textContent().catch(() => '');
      const disabled = await btn.evaluate(b => b.disabled).catch(() => true);
      if (text && text.trim() === 'Post' && !disabled) {
        await btn.click();
        postClicked = true;
        console.log('Post button clicked!');
        break;
      }
    }
    if (postClicked) break;
    console.log(`Attempt ${attempt+1}: Post button not ready, waiting...`);
    await sleep(1000);
  }
  
  if (!postClicked) {
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `priya3-${subreddit}-7-no-post-btn.png`) });
    throw new Error('Could not click Post button');
  }
  
  // Wait for post to go live
  console.log('Waiting for post to publish...');
  await sleep(6000);
  
  const currentUrl = page.url();
  console.log(`URL after posting: ${currentUrl}`);
  
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `priya3-${subreddit}-8-published.png`) });
  
  return currentUrl;
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
  
  const results = {};
  
  for (let i = 0; i < SUBREDDITS.length; i++) {
    const subreddit = SUBREDDITS[i];
    
    try {
      const url = await postToSubreddit(page, subreddit);
      results[subreddit] = url;
      console.log(`✅ r/${subreddit}: ${url}`);
    } catch (err) {
      console.error(`❌ r/${subreddit} FAILED:`, err.message);
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `priya3-${subreddit}-error.png`) }).catch(() => {});
      results[subreddit] = `ERROR: ${err.message}`;
    }
    
    // Wait 2.5 minutes between posts
    if (i < SUBREDDITS.length - 1) {
      console.log(`\nWaiting 2.5 minutes before next post...`);
      await sleep(150000);
    }
  }
  
  console.log('\n=== FINAL RESULTS ===');
  for (const [sub, url] of Object.entries(results)) {
    console.log(`r/${sub}: ${url}`);
  }
  
  // Verify final screenshots
  console.log('\n=== Verification screenshots ===');
  for (const [sub, url] of Object.entries(results)) {
    if (url && !url.startsWith('ERROR') && url.includes('reddit.com/r/')) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(3000);
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `priya3-${sub}-final.png`) });
        console.log(`✅ Final screenshot saved for r/${sub}`);
      } catch (e) {
        console.error(`Failed screenshot for r/${sub}:`, e.message);
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
