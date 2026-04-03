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
  
  // Handle dialogs (leave page confirmations)
  const dialogHandler = async d => { try { await d.accept(); } catch(e) {} };
  page.on('dialog', dialogHandler);
  
  try {
    await page.goto(`https://www.reddit.com/r/${subreddit}/submit/?type=TEXT`, { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000 
    });
  } catch(e) {
    console.log('Nav timeout (continuing)');
  }
  await sleep(4000);
  
  console.log('URL:', page.url());
  await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-1-loaded.png` });
  
  // === FILL TITLE ===
  const titleTA = await page.$('textarea[name="title"]');
  if (!titleTA) throw new Error('Title textarea not found');
  
  await titleTA.click();
  await titleTA.fill(POST_TITLE);
  console.log('Title filled:', POST_TITLE);
  await sleep(500);
  
  // === CLICK BODY AREA ===
  // The body contenteditable is at approximately x:182, y:424, w:698, h:112
  // We know the aria-label is "Post body text field"
  const bodySelector = 'div[role="textbox"][aria-label="Post body text field"]';
  
  let bodyEl = await page.$(bodySelector);
  if (!bodyEl) {
    // Fallback - click via coordinates
    console.log('Using coordinate click for body');
    await page.mouse.click(530, 480);
  } else {
    await bodyEl.click();
    console.log('Clicked body via aria-label selector');
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
  console.log('Selected link text');
  
  await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-2-selected.png` });
  
  // === CLICK THE LINK TOOLBAR BUTTON ===
  // The link icon is at approximately (391, 404) based on visual inspection
  // But the toolbar position might shift slightly - let's find it precisely
  const linkBtnPos = await page.evaluate(() => {
    // Look for the link toolbar button - it's a custom element or button
    // From screenshots, the toolbar is around y=388-420
    // Try finding any element with 'link' in its tag name or attributes in that area
    const allEls = [...document.querySelectorAll('*')];
    for (const el of allEls) {
      const rect = el.getBoundingClientRect();
      const tagName = el.tagName.toLowerCase();
      if (tagName.includes('link') && rect.width > 0 && rect.height > 0) {
        return { x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2), tag: tagName };
      }
    }
    // Also check aria labels
    const allWithAria = [...document.querySelectorAll('[aria-label]')];
    for (const el of allWithAria) {
      const label = el.getAttribute('aria-label') || '';
      if (label.toLowerCase().includes('link') && !label.toLowerCase().includes('post body')) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0) return { x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2), label };
      }
    }
    return null;
  });
  
  console.log('Link button found:', linkBtnPos);
  
  // Use found position or fallback to visual estimate
  const linkX = linkBtnPos ? linkBtnPos.x : 391;
  const linkY = linkBtnPos ? linkBtnPos.y : 404;
  
  await page.mouse.click(linkX, linkY);
  console.log(`Clicked link button at (${linkX}, ${linkY})`);
  await sleep(1500);
  
  await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-3-link-dialog.png` });
  
  // === ENTER URL IN DIALOG ===
  // Look for any input that appeared
  let linkInserted = false;
  
  const urlInputInfo = await page.evaluate(() => {
    return [...document.querySelectorAll('input')].filter(i => {
      const r = i.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }).map(i => ({
      placeholder: i.placeholder,
      type: i.type,
      id: i.id,
      rect: { x: Math.round(i.getBoundingClientRect().x), y: Math.round(i.getBoundingClientRect().y), w: Math.round(i.getBoundingClientRect().width) }
    }));
  });
  
  console.log('Inputs after link click:', JSON.stringify(urlInputInfo));
  
  if (urlInputInfo.length > 0) {
    // Find the URL input
    for (const inp of urlInputInfo) {
      if (inp.placeholder.toLowerCase().includes('url') || 
          inp.placeholder.toLowerCase().includes('http') ||
          inp.placeholder.toLowerCase().includes('link') ||
          inp.type === 'url') {
        await page.mouse.click(inp.rect.x + 10, inp.rect.y + 10);
        await page.keyboard.type(LINK_URL, { delay: 10 });
        await sleep(300);
        // Look for Apply/Insert/OK button
        const applyBtn = await page.evaluate(() => {
          const btns = [...document.querySelectorAll('button')];
          for (const btn of btns) {
            const text = btn.textContent.trim().toLowerCase();
            const rect = btn.getBoundingClientRect();
            if ((text === 'apply' || text === 'insert' || text === 'ok' || text === 'save') && rect.width > 0) {
              return { x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2), text };
            }
          }
          return null;
        });
        
        if (applyBtn) {
          await page.mouse.click(applyBtn.x, applyBtn.y);
          console.log(`Clicked ${applyBtn.text} button for link`);
        } else {
          await page.keyboard.press('Enter');
          console.log('Pressed Enter to confirm link');
        }
        linkInserted = true;
        await sleep(500);
        break;
      }
    }
    
    if (!linkInserted && urlInputInfo.length > 0) {
      // Try the first visible input anyway
      const inp = urlInputInfo[0];
      await page.mouse.click(inp.rect.x + 10, inp.rect.y + 10);
      await page.keyboard.type(LINK_URL, { delay: 10 });
      await page.keyboard.press('Enter');
      linkInserted = true;
      await sleep(500);
    }
  }
  
  if (!linkInserted) {
    console.log('WARNING: Link dialog not found. Trying alternative approaches...');
    
    // Take a screenshot to see current state
    await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-3b-no-dialog.png` });
    
    // The selection might have been lost when clicking toolbar
    // Try clicking body again to refocus, then retry
    if (bodyEl) await bodyEl.click();
    else await page.mouse.click(530, 480);
    await sleep(300);
    
    // Re-type "this one" and select it
    await page.keyboard.type(LINK_TEXT, { delay: 40 });
    await sleep(200);
    for (let i = 0; i < LINK_TEXT.length; i++) {
      await page.keyboard.down('Shift');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.up('Shift');
    }
    await sleep(200);
    
    // Try clicking toolbar link button again with exact coordinates from screenshot
    // From our image analysis: link button ~391, 404
    await page.mouse.click(391, 404);
    await sleep(1500);
    
    await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-3c-retry.png` });
    
    const urlInputRetry = await page.evaluate(() => {
      return [...document.querySelectorAll('input')].filter(i => {
        const r = i.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }).map(i => ({
        placeholder: i.placeholder,
        rect: { x: Math.round(i.getBoundingClientRect().x), y: Math.round(i.getBoundingClientRect().y) }
      }));
    });
    
    console.log('Inputs on retry:', JSON.stringify(urlInputRetry));
    
    if (urlInputRetry.length > 0) {
      const inp = urlInputRetry[0];
      await page.mouse.click(inp.rect.x + 10, inp.rect.y + 10);
      await page.keyboard.type(LINK_URL, { delay: 10 });
      await page.keyboard.press('Enter');
      linkInserted = true;
      await sleep(500);
    }
  }
  
  await sleep(500);
  
  // === TYPE REST OF BODY ===
  await page.keyboard.type(BODY_AFTER, { delay: 15 });
  console.log('Typed rest of body');
  
  await sleep(1000);
  await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-4-body-complete.png` });
  
  // === CLICK POST BUTTON ===
  // Find the Post button - it's a button with text "Post" that should be enabled now
  const postBtnInfo = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')];
    for (const btn of buttons) {
      if (btn.textContent.trim() === 'Post' && !btn.disabled) {
        const rect = btn.getBoundingClientRect();
        if (rect.width > 0) return { x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2) };
      }
    }
    // Also look for disabled Post button and force click
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
  
  if (postBtnInfo.disabled) {
    console.log('Post button is disabled - checking what might be wrong...');
    await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-post-disabled.png` });
    // The title might not be filling properly in some subreddits
    // Try re-filling title
    const titleTA2 = await page.$('textarea[name="title"]');
    if (titleTA2) {
      const currentVal = await titleTA2.inputValue();
      console.log('Current title value:', currentVal);
    }
  }
  
  await page.mouse.click(postBtnInfo.x, postBtnInfo.y);
  console.log(`Clicked Post button at (${postBtnInfo.x}, ${postBtnInfo.y})`);
  
  // Wait for submission and page navigation
  await sleep(8000);
  
  const postUrl = page.url();
  console.log(`Post URL: ${postUrl}`);
  
  await page.screenshot({ path: `${screenshotDir}/elise-${subreddit}-5-posted.png` });
  
  // Remove dialog handler
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
  console.log('Results saved to BRAIN/elise-post-results.json');
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
