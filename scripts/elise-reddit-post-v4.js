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
  
  const dialogHandler = async d => { try { await d.accept(); } catch(e) {} };
  page.on('dialog', dialogHandler);
  
  try {
    await page.goto(`https://www.reddit.com/r/${subreddit}/submit/?type=TEXT`, { 
      waitUntil: 'domcontentloaded', timeout: 30000 
    });
  } catch(e) { console.log('Nav timeout (ok)'); }
  await sleep(4000);
  
  console.log('URL:', page.url());
  await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-1-loaded.png` });
  
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
  
  // === TYPE LINK TEXT ===
  await page.keyboard.type(LINK_TEXT, { delay: 40 });
  await sleep(300);
  
  // === SELECT LINK TEXT ===
  for (let i = 0; i < LINK_TEXT.length; i++) {
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.up('Shift');
  }
  await sleep(300);
  console.log(`Selected "${LINK_TEXT}"`);
  
  // === CLICK LINK TOOLBAR BUTTON ===
  // Link button is at approximately (391, 404) based on visual inspection
  await page.mouse.click(391, 404);
  await sleep(2000);
  
  await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-2-link-dialog.png` });
  
  // === FIND AND FILL URL INPUT IN DIALOG ===
  // The dialog uses shadow DOM - inputs at indices ~28 and 29
  // Input with value = LINK_TEXT is the "Text" field
  // The next empty visible input is the "Link" URL field
  
  let linkInserted = false;
  
  // Strategy: click on the URL input by approximate coordinates
  // From our test: Link field is at approximately x:525.5, y:430.5
  // But this could shift - let's find the link input via locator
  const inputs = await page.locator('input').all();
  let urlInputIdx = -1;
  
  for (let i = 0; i < inputs.length; i++) {
    const bb = await inputs[i].boundingBox();
    const val = await inputs[i].inputValue().catch(() => null);
    if (bb && bb.width > 100 && bb.x > 300) {
      console.log(`Input ${i}: val="${val}" bb=${JSON.stringify(bb)}`);
      // The URL input will be visible and empty (not filled with link text)
      if (val === '' && bb.y > 400) {
        urlInputIdx = i;
        break;
      }
    }
  }
  
  console.log('URL input index:', urlInputIdx);
  
  if (urlInputIdx >= 0) {
    const urlInput = inputs[urlInputIdx];
    await urlInput.click();
    await urlInput.fill(LINK_URL);
    console.log('Filled URL input');
    await sleep(300);
    
    // Click "Save" button in the dialog
    // Find Save button that's visible 
    const saveBtn = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      for (const btn of btns) {
        const rect = btn.getBoundingClientRect();
        const text = btn.textContent.trim();
        if (text === 'Save' && rect.width > 0) {
          return { x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2) };
        }
      }
      return null;
    });
    
    // Also look in shadow DOM for Save button
    const saveBtnShadow = await page.evaluate(() => {
      const walk = (root) => {
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) {
            const btns = [...el.shadowRoot.querySelectorAll('button')];
            for (const btn of btns) {
              const rect = btn.getBoundingClientRect();
              const text = btn.textContent.trim();
              if ((text === 'Save' || text === 'Insert' || text === 'Apply') && rect.width > 0) {
                return { x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2), text };
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
    
    console.log('Save btn (normal DOM):', saveBtn);
    console.log('Save btn (shadow DOM):', saveBtnShadow);
    
    const btnToClick = saveBtn || saveBtnShadow;
    if (btnToClick) {
      await page.mouse.click(btnToClick.x, btnToClick.y);
      console.log('Clicked Save button');
    } else {
      await page.keyboard.press('Enter');
      console.log('Pressed Enter to save link');
    }
    
    linkInserted = true;
    await sleep(500);
  } else {
    // Fallback: use coordinate-based click for URL input
    // From test: URL input at approx x:526, y:430
    console.log('Trying coordinate-based URL input click...');
    await page.mouse.click(526, 430);
    await sleep(300);
    
    // Check if something is focused
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? { tag: el.tagName, placeholder: el.placeholder || '' } : null;
    });
    console.log('Focused element:', focused);
    
    await page.keyboard.type(LINK_URL, { delay: 10 });
    await sleep(300);
    await page.keyboard.press('Enter');
    linkInserted = true;
  }
  
  await sleep(800);
  await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-3-after-link.png` });
  
  // === TYPE REST OF BODY ===
  // Click body area to ensure focus
  const bodyEl2 = await page.$('div[role="textbox"][aria-label="Post body text field"]');
  if (bodyEl2) {
    const bb = await bodyEl2.boundingBox();
    if (bb) await page.mouse.click(bb.x + 10, bb.y + bb.height - 10);
  }
  await sleep(300);
  
  // Move to end
  await page.keyboard.press('End');
  await sleep(200);
  
  await page.keyboard.type(BODY_AFTER, { delay: 15 });
  console.log('Typed rest of body');
  
  await sleep(1000);
  await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-4-body-complete.png` });
  
  // === CLICK POST BUTTON ===
  const postBtnInfo = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')];
    // First try enabled Post button
    for (const btn of buttons) {
      if (btn.textContent.trim() === 'Post' && !btn.disabled) {
        const rect = btn.getBoundingClientRect();
        if (rect.width > 0) return { x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2), disabled: false };
      }
    }
    // Then try any Post button
    for (const btn of buttons) {
      if (btn.textContent.trim() === 'Post') {
        const rect = btn.getBoundingClientRect();
        if (rect.width > 0) return { x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2), disabled: btn.disabled };
      }
    }
    return null;
  });
  
  console.log('Post button:', postBtnInfo);
  
  if (!postBtnInfo) {
    await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-error-no-post.png` });
    throw new Error('Post button not found');
  }
  
  await page.mouse.click(postBtnInfo.x, postBtnInfo.y);
  console.log(`Clicked Post button`);
  
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
      // Take error screenshot
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
