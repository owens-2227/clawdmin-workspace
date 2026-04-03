const { chromium } = require('playwright');
const fs = require('fs');

const CDP_URL = 'ws://127.0.0.1:52004/devtools/browser/03f3b259-468c-4868-bb0f-41b97a9ba752';

const POST_TITLE = 'Gifts for a Diabetic Cat Parent??';
const LINK_URL = 'https://wabi.ai/@Elise_c_1979/kitty-cat-diabetes-tracker-1050356?_v=1';
const LINK_TEXT = 'this one';

const BODY_BEFORE = `I moved in with my long-distance boyfriend and his cat a while ago. I love seeing how much effort he puts into tracking and making sure Sugar (I know, ironic!) gets the best quality of care possible.

His birthday is coming up in a few weeks and I want to find a way to include Sugar in the gift. He works a super busy schedule so I saw a few diabetes trackers (like `;
const BODY_AFTER = `) and I'd love to know if anyone has tested it out??

We have plenty of treats, so I was more thinking of something to help him optimise time, or just ease his mind from worrying about Sugar, only all the good stuff!!

Thank you guys : )`;

const SUBREDDITS = ['FelineDiabetes', 'CatAdvice', 'SeniorCats'];
const screenshotDir = '/Users/owen/.openclaw/workspace/BRAIN/assets';
if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function postToSubreddit(page, subreddit) {
  console.log(`\n=== Posting to r/${subreddit} ===`);
  
  // Accept dialogs (leave page confirmations)
  page.on('dialog', async d => {
    console.log(`Dialog: ${d.type()} - ${d.message()}`);
    await d.accept();
  });
  
  try {
    await page.goto(`https://www.reddit.com/r/${subreddit}/submit/?type=TEXT`, { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000 
    });
  } catch(e) {
    console.log('Nav timeout (continuing):', e.message.substring(0,80));
  }
  await sleep(5000);
  
  console.log('URL:', page.url());
  await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-1-loaded.png` });
  
  // Find all input-like elements to locate the title
  const elements = await page.evaluate(() => {
    const result = {};
    // Title area - find textarea or input for title
    const inputs = [...document.querySelectorAll('textarea, input[type="text"]')];
    result.inputs = inputs.map(el => {
      const rect = el.getBoundingClientRect();
      return { tag: el.tagName, name: el.name, placeholder: el.placeholder, id: el.id, rect: {x:Math.round(rect.x),y:Math.round(rect.y),w:Math.round(rect.width),h:Math.round(rect.height)} };
    });
    // All contenteditable
    const ces = [...document.querySelectorAll('[contenteditable="true"]')];
    result.ces = ces.map(el => {
      const rect = el.getBoundingClientRect();
      return { tag: el.tagName, class: el.className.substring(0,60), rect: {x:Math.round(rect.x),y:Math.round(rect.y),w:Math.round(rect.width),h:Math.round(rect.height)} };
    });
    return result;
  });
  console.log('Form elements:', JSON.stringify(elements));
  
  // Click the title area - look for a text input/textarea that's visible
  // Based on the screenshot, title is at the top of the form
  // Try to find by position or by placeholder
  let titleFilled = false;
  
  // Try common selectors for title
  const titleTried = [
    'textarea[name="title"]',
    'input[name="title"]',
    '[aria-label="Title"]',
    'textarea[placeholder="Title"]',
    'input[placeholder="Title"]',
  ];
  
  for (const sel of titleTried) {
    try {
      const el = await page.$(sel);
      if (el) {
        const box = await el.boundingBox();
        if (box && box.width > 0) {
          await el.click();
          await el.fill(POST_TITLE);
          console.log(`Title filled using: ${sel}`);
          titleFilled = true;
          break;
        }
      }
    } catch(e) {}
  }
  
  if (!titleFilled) {
    // Try by textarea with visible dimensions
    const titleEl = await page.evaluate(() => {
      const tas = [...document.querySelectorAll('textarea')];
      for (const ta of tas) {
        const rect = ta.getBoundingClientRect();
        if (rect.width > 100 && rect.height > 0 && ta.name !== 'g-recaptcha-response') {
          return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
        }
      }
      return null;
    });
    
    if (titleEl) {
      await page.mouse.click(titleEl.x, titleEl.y);
      await sleep(300);
      await page.keyboard.type(POST_TITLE, { delay: 30 });
      console.log('Title typed via coordinates');
      titleFilled = true;
    }
  }
  
  if (!titleFilled) {
    // Use page locator approach
    try {
      const titleField = page.locator('div[data-testid="post-title"], textarea').first();
      await titleField.click();
      await titleField.fill(POST_TITLE);
      titleFilled = true;
      console.log('Title filled via locator');
    } catch(e) {
      console.log('Title locator failed:', e.message);
    }
  }
  
  await sleep(1000);
  await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-2-title.png` });
  
  // Click the body content editable
  // From our debug, the visible CE is at ~182,424 with 698x112 dimensions
  // Let's find it again
  const bodyInfo = await page.evaluate(() => {
    const ces = [...document.querySelectorAll('[contenteditable="true"]')];
    for (const ce of ces) {
      const rect = ce.getBoundingClientRect();
      if (rect.width > 100 && rect.height > 0) {
        return { x: rect.x + 10, y: rect.y + 10, cx: rect.x + rect.width/2, cy: rect.y + rect.height/2 };
      }
    }
    return null;
  });
  
  console.log('Body element info:', bodyInfo);
  
  if (bodyInfo) {
    await page.mouse.click(bodyInfo.cx, bodyInfo.cy);
    console.log(`Clicked body at ${bodyInfo.cx}, ${bodyInfo.cy}`);
  } else {
    // Fallback - click below the title area
    await page.mouse.click(530, 450);
    console.log('Clicked body at fallback coordinates');
  }
  
  await sleep(1000);
  
  // Type body before link
  await page.keyboard.type(BODY_BEFORE, { delay: 15 });
  await sleep(500);
  
  console.log('Typed body before link');
  await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-3-body-before.png` });
  
  // Type the link text
  await page.keyboard.type(LINK_TEXT, { delay: 50 });
  await sleep(300);
  
  // Select the link text we just typed
  for (let i = 0; i < LINK_TEXT.length; i++) {
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.up('Shift');
  }
  await sleep(300);
  
  await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-4-selected.png` });
  console.log('Selected link text');
  
  // Try Ctrl+K to open link dialog
  await page.keyboard.press('Control+k');
  await sleep(1500);
  
  await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-5-link-dialog.png` });
  
  // Check if link dialog appeared
  const linkInputInfo = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input')];
    for (const inp of inputs) {
      const rect = inp.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return { placeholder: inp.placeholder, type: inp.type, rect: {x: Math.round(rect.x), y: Math.round(rect.y)} };
      }
    }
    return null;
  });
  console.log('Link input info:', linkInputInfo);
  
  let linkInserted = false;
  
  if (linkInputInfo && (linkInputInfo.placeholder.toLowerCase().includes('url') || linkInputInfo.placeholder.toLowerCase().includes('link') || linkInputInfo.placeholder.toLowerCase().includes('http'))) {
    // Type the URL
    await page.keyboard.type(LINK_URL, { delay: 10 });
    await sleep(300);
    await page.keyboard.press('Enter');
    console.log('URL entered via Ctrl+K dialog');
    linkInserted = true;
    await sleep(500);
  } else {
    // Try to find and click the link button in toolbar
    console.log('Ctrl+K did not open dialog, trying toolbar link button...');
    
    // Re-select the text first (move to end of link text and select backwards)
    // First move to end of selection (cursor might have moved)
    // Use a different approach: click at a position after the text and select back
    
    // Let's try clicking the link button in the toolbar
    // From the screenshot, we can see there's a link icon in the rich text toolbar
    const linkBtnInfo = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button')];
      for (const btn of buttons) {
        const text = btn.textContent.trim();
        const title = btn.title || '';
        const ariaLabel = btn.getAttribute('aria-label') || '';
        if (ariaLabel.toLowerCase().includes('link') || title.toLowerCase().includes('link')) {
          const rect = btn.getBoundingClientRect();
          return { x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2), text, ariaLabel };
        }
      }
      // Check SVG buttons / icon buttons in toolbar area
      const svgBtns = [...document.querySelectorAll('button[class*="toolbar"], button[data-testid]')];
      for (const btn of svgBtns) {
        const rect = btn.getBoundingClientRect();
        if (rect.width > 0) return { x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2), text: btn.textContent.trim(), dataTestId: btn.getAttribute('data-testid') };
      }
      return null;
    });
    
    console.log('Link button info:', linkBtnInfo);
    
    if (linkBtnInfo) {
      // First re-select the text
      // We need to navigate back and reselect
      // Let's use keyboard: End key to go to end, then shift-select backward
      // But first let's just try clicking where we know the cursor should be
      
      // Re-type and re-select approach
      // Delete selected text (if any) and retype
      await page.keyboard.press('Delete'); // or Backspace
      await sleep(200);
      
      // Type and select "this one" again
      await page.keyboard.type(LINK_TEXT, { delay: 50 });
      await sleep(200);
      
      for (let i = 0; i < LINK_TEXT.length; i++) {
        await page.keyboard.down('Shift');
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.up('Shift');
      }
      await sleep(200);
      
      // Click the link button
      await page.mouse.click(linkBtnInfo.x, linkBtnInfo.y);
      await sleep(1500);
      
      await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-5b-link-btn.png` });
      
      // Now try to find URL input
      const urlInput = await page.evaluate(() => {
        const inputs = [...document.querySelectorAll('input')];
        for (const inp of inputs) {
          const rect = inp.getBoundingClientRect();
          if (rect.width > 0) return { x: Math.round(rect.x), y: Math.round(rect.y), placeholder: inp.placeholder };
        }
        return null;
      });
      
      console.log('URL input after link btn:', urlInput);
      
      if (urlInput) {
        await page.mouse.click(urlInput.x + 10, urlInput.y + 10);
        await page.keyboard.type(LINK_URL, { delay: 10 });
        await page.keyboard.press('Enter');
        linkInserted = true;
        console.log('URL entered via toolbar button');
        await sleep(500);
      }
    }
  }
  
  if (!linkInserted) {
    console.log('WARNING: Link dialog approach failed. Trying direct text with markdown...');
    // As a fallback, delete what we typed and use plain markdown
    // This might not render as clickable but at least the URL will be visible
    
    // Press End to deselect and move to end
    await page.keyboard.press('End');
    await sleep(200);
    
    // We've already typed BODY_BEFORE + LINK_TEXT (possibly with selection issues)
    // Let's just continue typing the rest
  }
  
  await sleep(500);
  
  // Type the rest of the body
  await page.keyboard.type(BODY_AFTER, { delay: 15 });
  console.log('Typed body after link');
  
  await sleep(1000);
  await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-6-body-complete.png` });
  
  // Click the Post button
  // Find it by text "Post" that is not disabled
  let postBtnClicked = false;
  
  const postBtnInfo = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')];
    for (const btn of buttons) {
      if (btn.textContent.trim() === 'Post' && !btn.disabled) {
        const rect = btn.getBoundingClientRect();
        return { x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2) };
      }
    }
    return null;
  });
  
  console.log('Post button:', postBtnInfo);
  
  if (postBtnInfo) {
    await page.mouse.click(postBtnInfo.x, postBtnInfo.y);
    console.log('Clicked Post button');
    postBtnClicked = true;
  } else {
    // Try locator approach
    try {
      await page.locator('button:text("Post")').last().click({ timeout: 5000 });
      postBtnClicked = true;
    } catch(e) {
      console.log('Locator click failed:', e.message);
    }
  }
  
  if (!postBtnClicked) {
    await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-error-no-post-btn.png` });
    throw new Error(`Could not click Post button for r/${subreddit}`);
  }
  
  // Wait for navigation to the posted content
  await sleep(8000);
  
  const postUrl = page.url();
  console.log(`Post URL: ${postUrl}`);
  
  await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-7-posted.png` });
  
  return postUrl;
}

async function main() {
  console.log('Connecting to browser via CDP...');
  const browser = await chromium.connectOverCDP(CDP_URL);
  
  const contexts = browser.contexts();
  const context = contexts[0];
  const pages = context.pages();
  
  console.log(`Found ${pages.length} page(s)`);
  const activePage = pages[0];
  for (let i = 1; i < pages.length; i++) await pages[i].close();
  
  const results = [];
  
  for (let i = 0; i < SUBREDDITS.length; i++) {
    const subreddit = SUBREDDITS[i];
    try {
      const postUrl = await postToSubreddit(activePage, subreddit);
      results.push({ subreddit, url: postUrl, success: true });
      console.log(`\n✓ r/${subreddit}: ${postUrl}`);
    } catch (err) {
      console.error(`\n✗ r/${subreddit}: FAILED - ${err.message}`);
      results.push({ subreddit, url: null, success: false, error: err.message });
    }
    
    if (i < SUBREDDITS.length - 1) {
      console.log('\nWaiting 2.5 minutes before next post...');
      await sleep(150000);
    }
  }
  
  console.log('\n=== FINAL RESULTS ===');
  for (const r of results) {
    if (r.success) console.log(`✓ r/${r.subreddit}: ${r.url}`);
    else console.log(`✗ r/${r.subreddit}: FAILED - ${r.error}`);
  }
  
  fs.writeFileSync('/Users/owen/.openclaw/workspace/BRAIN/elise-post-results.json', JSON.stringify(results, null, 2));
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
