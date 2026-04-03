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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Click a button inside shadow DOM by text match
async function clickShadowButton(page, buttonText) {
  return await page.evaluate((text) => {
    function searchAndClick(root) {
      const buttons = root.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent.trim() === text && !btn.disabled) {
          btn.click();
          return true;
        }
      }
      const allEls = root.querySelectorAll('*');
      for (const el of allEls) {
        if (el.shadowRoot) {
          if (searchAndClick(el.shadowRoot)) return true;
        }
      }
      return false;
    }
    return searchAndClick(document.body);
  }, buttonText);
}

// Click a button inside shadow DOM by aria-label match
async function clickShadowButtonByAriaLabel(page, ariaLabel) {
  return await page.evaluate((label) => {
    function searchAndClick(root) {
      const buttons = root.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.getAttribute('aria-label') === label && !btn.disabled) {
          btn.click();
          return true;
        }
      }
      const allEls = root.querySelectorAll('*');
      for (const el of allEls) {
        if (el.shadowRoot) {
          if (searchAndClick(el.shadowRoot)) return true;
        }
      }
      return false;
    }
    return searchAndClick(document.body);
  }, ariaLabel);
}

// Find element in shadow DOM
async function findShadowElement(page, selector) {
  return await page.evaluateHandle((sel) => {
    function findEl(root) {
      const el = root.querySelector(sel);
      if (el) return el;
      const allEls = root.querySelectorAll('*');
      for (const e of allEls) {
        if (e.shadowRoot) {
          const found = findEl(e.shadowRoot);
          if (found) return found;
        }
      }
      return null;
    }
    return findEl(document.body);
  }, selector);
}

// Click element in shadow DOM found by selector
async function clickShadowElement(page, selector) {
  return await page.evaluate((sel) => {
    function findAndClick(root) {
      const el = root.querySelector(sel);
      if (el) { el.click(); return true; }
      const allEls = root.querySelectorAll('*');
      for (const e of allEls) {
        if (e.shadowRoot) {
          if (findAndClick(e.shadowRoot)) return true;
        }
      }
      return false;
    }
    return findAndClick(document.body);
  }, selector);
}

async function postToSubreddit(page, subreddit) {
  console.log(`\n=== Posting to r/${subreddit} ===`);
  
  await page.goto(`https://www.reddit.com/r/${subreddit}/submit/?type=TEXT`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(4000);
  
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `final-${subreddit}-1-loaded.png`) });
  
  // === SWITCH TO MARKDOWN MODE FIRST ===
  console.log('Switching to markdown mode...');
  const mdSwitched = await clickShadowButton(page, 'Switch to Markdown');
  if (mdSwitched) {
    console.log('Switched to Markdown mode');
    await sleep(1500);
  } else {
    console.log('WARNING: Could not switch to markdown mode');
  }
  
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `final-${subreddit}-2-markdown.png`) });
  
  // === FILL TITLE ===
  console.log('Filling title...');
  
  // In new Reddit, title is a contenteditable div
  // Playwright's >> css selector pierces shadow DOM
  // Let's try the shadow piercing selector
  const titleEl = await page.$('[contenteditable="true"]:not([aria-label])');
  if (titleEl) {
    await titleEl.click();
    await sleep(200);
    await page.keyboard.press('Control+a');
    await page.keyboard.type(POST_TITLE);
    console.log('Title entered');
  } else {
    console.log('Title field not found via normal selector, trying shadow...');
    const clicked = await clickShadowElement(page, '[contenteditable="true"]:not([aria-label])');
    if (clicked) {
      await sleep(200);
      await page.keyboard.press('Control+a');
      await page.keyboard.type(POST_TITLE);
      console.log('Title entered via shadow click');
    } else {
      throw new Error('Cannot find title field');
    }
  }
  
  await sleep(500);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `final-${subreddit}-3-title.png`) });
  
  // === FILL BODY ===
  console.log('Filling body...');
  
  // In markdown mode, the body should be a textarea
  // Try finding it
  let bodyFilled = false;
  
  // After markdown switch, look for textarea
  const textareas = await page.$$('textarea');
  console.log(`Found ${textareas.length} textareas`);
  
  // Check shadow DOM textareas
  const shadowTextareas = await page.evaluate(() => {
    const result = [];
    function findTextareas(root) {
      root.querySelectorAll('textarea').forEach(ta => {
        result.push({
          placeholder: ta.placeholder || '',
          ariaLabel: ta.getAttribute('aria-label') || '',
          name: ta.name || ''
        });
      });
      root.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) findTextareas(el.shadowRoot);
      });
    }
    findTextareas(document.body);
    return result;
  });
  console.log('Shadow textareas:', JSON.stringify(shadowTextareas));
  
  // Try to click on the body area
  const fullMarkdownBody = `${PART1}\n\n[${LINK_TEXT}](${LINK_URL})\n\n${PART2}`;
  
  // The body textarea in markdown mode
  const bodyTA = await page.$('textarea[aria-label="Post body text field"], textarea[placeholder*="body"], textarea[placeholder*="text"]');
  if (bodyTA) {
    await bodyTA.click();
    await bodyTA.fill(fullMarkdownBody);
    console.log('Body filled via textarea');
    bodyFilled = true;
  }
  
  if (!bodyFilled) {
    // Try shadow DOM
    const taFilled = await page.evaluate((body) => {
      function findAndFillTextarea(root) {
        const textareas = root.querySelectorAll('textarea');
        for (const ta of textareas) {
          const label = ta.getAttribute('aria-label') || '';
          const placeholder = ta.placeholder || '';
          if (label.includes('body') || label.includes('Body') || placeholder.includes('body') || placeholder.includes('text')) {
            ta.focus();
            ta.value = body;
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            ta.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
        }
        root.querySelectorAll('*').forEach(el => {
          if (el.shadowRoot) findAndFillTextarea(el.shadowRoot);
        });
        return false;
      }
      return findAndFillTextarea(document.body);
    }, fullMarkdownBody);
    
    if (taFilled) {
      console.log('Body filled via shadow textarea');
      bodyFilled = true;
    }
  }
  
  if (!bodyFilled) {
    // Maybe not in markdown mode - find the contenteditable body
    console.log('Trying contenteditable body...');
    const bodyEl = await page.$('[aria-label="Post body text field"]');
    if (bodyEl) {
      await bodyEl.click();
      await sleep(300);
      
      // Type PART1
      await page.keyboard.type(PART1);
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      
      // Type link text, select it, apply link
      await page.keyboard.type(LINK_TEXT);
      
      // Select the text
      for (let i = 0; i < LINK_TEXT.length; i++) {
        await page.keyboard.press('Shift+ArrowLeft');
      }
      await sleep(300);
      
      // Click Link button
      const linkClicked = await clickShadowButton(page, 'Link');
      if (linkClicked) {
        console.log('Link button clicked');
        await sleep(800);
        
        // Find URL input in dialog
        const urlInputFilled = await page.evaluate((url) => {
          function findAndFillUrl(root) {
            const inputs = root.querySelectorAll('input[type="url"], input[placeholder*="URL"], input[placeholder*="http"]');
            for (const inp of inputs) {
              inp.focus();
              inp.value = url;
              inp.dispatchEvent(new Event('input', { bubbles: true }));
              return true;
            }
            for (const el of root.querySelectorAll('*')) {
              if (el.shadowRoot && findAndFillUrl(el.shadowRoot)) return true;
            }
            return false;
          }
          return findAndFillUrl(document.body);
        }, LINK_URL);
        
        if (urlInputFilled) {
          await sleep(300);
          // Click Save
          const saved = await clickShadowButton(page, 'Save');
          if (!saved) {
            await page.keyboard.press('Enter');
          }
          await sleep(300);
        }
      }
      
      // Move to end and type rest
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await page.keyboard.type(PART2);
      bodyFilled = true;
      console.log('Body filled via rich text editor');
    }
  }
  
  if (!bodyFilled) {
    throw new Error('Could not fill body text');
  }
  
  await sleep(1000);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `final-${subreddit}-4-filled.png`) });
  
  // === SUBMIT ===
  console.log('Waiting for Post button to be enabled...');
  
  for (let attempt = 0; attempt < 10; attempt++) {
    const isEnabled = await page.evaluate(() => {
      function findPostBtn(root) {
        const buttons = root.querySelectorAll('button');
        for (const btn of buttons) {
          if (btn.textContent.trim() === 'Post') {
            return { found: true, disabled: btn.disabled };
          }
        }
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) {
            const result = findPostBtn(el.shadowRoot);
            if (result) return result;
          }
        }
        return null;
      }
      return findPostBtn(document.body);
    });
    
    console.log(`Attempt ${attempt+1} - Post button:`, isEnabled);
    
    if (isEnabled && !isEnabled.disabled) {
      const clicked = await clickShadowButton(page, 'Post');
      if (clicked) {
        console.log('Post button clicked!');
        break;
      }
    }
    
    await sleep(1000);
  }
  
  console.log('Waiting for navigation after posting...');
  await sleep(6000);
  
  const url = page.url();
  console.log(`URL after posting: ${url}`);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `final-${subreddit}-5-published.png`) });
  
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
  
  const results = {};
  
  for (let i = 0; i < SUBREDDITS.length; i++) {
    const sub = SUBREDDITS[i];
    try {
      const url = await postToSubreddit(page, sub);
      results[sub] = url;
      console.log(`✅ r/${sub}: ${url}`);
    } catch (err) {
      console.error(`❌ r/${sub} FAILED:`, err.message);
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `final-${sub}-error.png`) }).catch(() => {});
      results[sub] = `ERROR: ${err.message}`;
    }
    
    if (i < SUBREDDITS.length - 1) {
      console.log('\nWaiting 2.5 minutes...');
      await sleep(150000);
    }
  }
  
  console.log('\n=== RESULTS ===');
  for (const [sub, url] of Object.entries(results)) {
    console.log(`r/${sub}: ${url}`);
  }
  
  // Final verification
  for (const [sub, url] of Object.entries(results)) {
    if (url && !url.startsWith('ERROR') && url.includes('reddit.com/r/')) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(3000);
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `final-${sub}-verify.png`) });
        console.log(`✅ Verification screenshot: r/${sub}`);
      } catch(e) {
        console.error(`Screenshot failed for r/${sub}:`, e.message);
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
