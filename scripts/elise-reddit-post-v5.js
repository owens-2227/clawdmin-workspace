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

async function findPostButton(page) {
  // Try various methods to find the Post button
  
  // Method 1: Regular DOM button with text "Post"
  const btns = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')];
    return buttons.map(btn => {
      const rect = btn.getBoundingClientRect();
      return {
        text: btn.textContent.trim(),
        disabled: btn.disabled,
        rect: {x:Math.round(rect.x),y:Math.round(rect.y),w:Math.round(rect.width),h:Math.round(rect.height)}
      };
    }).filter(b => b.rect.w > 0);
  });
  
  for (const btn of btns) {
    if (btn.text === 'Post') {
      console.log('Found Post btn in regular DOM:', btn);
      return { x: btn.rect.x + Math.floor(btn.rect.w/2), y: btn.rect.y + Math.floor(btn.rect.h/2) };
    }
  }
  
  // Method 2: Walk shadow DOM
  const shadowBtn = await page.evaluate(() => {
    const walk = (root) => {
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) {
          const btns = [...el.shadowRoot.querySelectorAll('button')];
          for (const btn of btns) {
            const rect = btn.getBoundingClientRect();
            if (btn.textContent.trim() === 'Post' && rect.width > 0) {
              return { x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2), disabled: btn.disabled };
            }
          }
          const found = walk(el.shadowRoot);
          if (found) return found;
        }
      }
      return null;
    };
    return walk(document);
  });
  
  if (shadowBtn) {
    console.log('Found Post btn in shadow DOM:', shadowBtn);
    return shadowBtn;
  }
  
  // Method 3: Use page.locator (handles shadow DOM piercing)
  try {
    const locator = page.locator('button:text("Post")').last();
    const bb = await locator.boundingBox({ timeout: 3000 });
    if (bb) {
      console.log('Found Post btn via locator:', bb);
      return { x: Math.round(bb.x + bb.width/2), y: Math.round(bb.y + bb.height/2) };
    }
  } catch(e) {
    console.log('Locator failed:', e.message);
  }
  
  // Method 4: All buttons via locator
  const allBtns = await page.locator('button').all();
  for (const btn of allBtns) {
    const text = await btn.textContent().catch(() => '');
    const bb = await btn.boundingBox().catch(() => null);
    if (text.trim() === 'Post' && bb && bb.width > 0) {
      console.log('Found Post btn via all-buttons locator:', bb);
      return { x: Math.round(bb.x + bb.width/2), y: Math.round(bb.y + bb.height/2) };
    }
  }
  
  return null;
}

async function postToSubreddit(page, subreddit) {
  console.log(`\n=== Posting to r/${subreddit} ===`);
  
  const dialogHandler = async d => { try { await d.accept(); } catch(e) {} };
  page.on('dialog', dialogHandler);
  
  try {
    await page.goto(`https://www.reddit.com/r/${subreddit}/submit/?type=TEXT`, { 
      waitUntil: 'domcontentloaded', timeout: 30000 
    });
  } catch(e) { console.log('Nav timeout (ok)'); }
  await sleep(4000);
  
  console.log('URL:', page.url());
  
  // === FILL TITLE ===
  const ta = await page.$('textarea[name="title"]');
  if (!ta) throw new Error('Title textarea not found');
  await ta.click();
  await ta.fill(POST_TITLE);
  console.log('Title filled');
  await sleep(500);
  
  // === CLICK BODY ===
  const bodyEl = await page.$('div[role="textbox"][aria-label="Post body text field"]');
  if (bodyEl) {
    await bodyEl.click();
  } else {
    await page.mouse.click(530, 480);
  }
  await sleep(500);
  
  // === TYPE BODY BEFORE LINK ===
  await page.keyboard.type(BODY_BEFORE, { delay: 15 });
  await sleep(500);
  console.log('Typed body before link');
  
  // === TYPE AND SELECT LINK TEXT ===
  await page.keyboard.type(LINK_TEXT, { delay: 40 });
  await sleep(300);
  
  for (let i = 0; i < LINK_TEXT.length; i++) {
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.up('Shift');
  }
  await sleep(300);
  
  // === CLICK LINK TOOLBAR BUTTON ===
  await page.mouse.click(391, 404);
  await sleep(2000);
  
  await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-2-link-dialog.png` });
  
  // === FILL URL IN DIALOG ===
  const inputs = await page.locator('input').all();
  let urlInput = null;
  
  for (let i = 0; i < inputs.length; i++) {
    const bb = await inputs[i].boundingBox();
    const val = await inputs[i].inputValue().catch(() => null);
    if (bb && bb.width > 100 && bb.x > 300 && bb.y > 400 && bb.y < 600) {
      if (val === '' || val === null) {
        urlInput = inputs[i];
        console.log(`URL input found at index ${i}, y=${Math.round(bb.y)}`);
        break;
      }
    }
  }
  
  if (!urlInput) {
    // Fallback: click at known coordinates
    await page.mouse.click(526, 430);
    await sleep(200);
    await page.keyboard.type(LINK_URL, { delay: 10 });
  } else {
    await urlInput.click();
    await urlInput.fill(LINK_URL);
  }
  console.log('URL entered');
  await sleep(300);
  
  // Click Save button
  const saveBtns = await page.locator('button').all();
  let saveBtnClicked = false;
  for (const btn of saveBtns) {
    const text = await btn.textContent().catch(() => '');
    const bb = await btn.boundingBox().catch(() => null);
    if (text.trim() === 'Save' && bb && bb.width > 0) {
      await btn.click();
      saveBtnClicked = true;
      console.log('Clicked Save button');
      break;
    }
  }
  if (!saveBtnClicked) {
    await page.keyboard.press('Enter');
    console.log('Pressed Enter to save link');
  }
  
  await sleep(800);
  await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-3-after-link.png` });
  
  // === TYPE REST OF BODY ===
  // Move focus to end of the body
  const bodyEl2 = await page.$('div[role="textbox"][aria-label="Post body text field"]');
  if (bodyEl2) {
    const bb = await bodyEl2.boundingBox();
    if (bb) {
      // Click near the end/bottom of the body text area
      await page.mouse.click(bb.x + 50, bb.y + bb.height - 5);
    }
  }
  await sleep(300);
  
  // Press Ctrl+End to go to end
  await page.keyboard.press('Control+End');
  await sleep(200);
  
  await page.keyboard.type(BODY_AFTER, { delay: 15 });
  console.log('Typed rest of body');
  
  await sleep(1000);
  await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-4-body-complete.png` });
  
  // === FIND AND CLICK POST BUTTON ===
  const postBtnPos = await findPostButton(page);
  
  if (!postBtnPos) {
    await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-error-no-post.png` });
    throw new Error('Post button not found');
  }
  
  console.log('Clicking Post button at:', postBtnPos);
  await page.mouse.click(postBtnPos.x, postBtnPos.y);
  
  // Wait for submission
  await sleep(10000);
  
  const postUrl = page.url();
  console.log(`Post URL: ${postUrl}`);
  
  await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-5-posted.png` });
  
  page.removeListener('dialog', dialogHandler);
  
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
      await activePage.screenshot({ path: `${screenshotDir}/elise-${subreddit}-FAIL.png` }).catch(() => {});
    }
    
    if (i < SUBREDDITS.length - 1) {
      console.log(`\nWaiting 2.5 minutes before posting to r/${SUBREDDITS[i+1]}...`);
      await sleep(150000);
    }
  }
  
  console.log('\n=== FINAL RESULTS ===');
  for (const r of results) {
    if (r.success) console.log(`✓ r/${r.subreddit}: ${r.url}`);
    else console.log(`✗ r/${r.subreddit}: FAILED - ${r.error}`);
  }
  
  fs.writeFileSync('/Users/owen/.openclaw/workspace/BRAIN/elise-post-results.json', JSON.stringify(results, null, 2));
  console.log('Results saved.');
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
