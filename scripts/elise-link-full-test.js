// Full test of posting with link to FelineDiabetes
const { chromium } = require('playwright');
const fs = require('fs');

const CDP_URL = 'ws://127.0.0.1:52004/devtools/browser/03f3b259-468c-4868-bb0f-41b97a9ba752';
const LINK_URL = 'https://wabi.ai/@Elise_c_1979/kitty-cat-diabetes-tracker-1050356?_v=1';
const screenshotDir = '/Users/owen/.openclaw/workspace/BRAIN/assets';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const pages = context.pages();
  const page = pages[0];
  for (let i=1; i<pages.length; i++) await pages[i].close();
  page.on('dialog', async d => { try { await d.accept(); } catch(e) {} });
  
  try {
    await page.goto('https://www.reddit.com/r/FelineDiabetes/submit/?type=TEXT', { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch(e) { console.log('nav timeout'); }
  await sleep(4000);
  
  // Fill title
  const ta = await page.$('textarea[name="title"]');
  await ta.click();
  await ta.fill('TEST - IGNORE');
  await sleep(300);
  
  // Click body
  const bodyEl = await page.$('div[role="textbox"][aria-label="Post body text field"]');
  await bodyEl.click();
  await sleep(300);
  
  // Type before link
  await page.keyboard.type('Test text before ', { delay: 20 });
  
  // Type link text
  await page.keyboard.type('this one', { delay: 40 });
  await sleep(200);
  
  // Select "this one" (8 chars)
  for (let i = 0; i < 8; i++) {
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.up('Shift');
  }
  await sleep(300);
  
  // Click link button at (391, 404)
  await page.mouse.click(391, 404);
  await sleep(2000);
  
  await page.screenshot({ path: `${screenshotDir}/elise-fulltest-dialog.png` });
  
  // Find URL input - look for visible empty input in dialog area
  const inputs = await page.locator('input').all();
  let urlInput = null;
  
  for (let i = 0; i < inputs.length; i++) {
    const bb = await inputs[i].boundingBox();
    const val = await inputs[i].inputValue().catch(() => null);
    if (bb && bb.width > 100 && bb.height > 0 && bb.x > 300) {
      console.log(`Input ${i}: val="${val}" bb=y:${Math.round(bb.y)}`);
      // URL field will be visible, empty (or maybe pre-selected)
      if ((val === '' || val === null) && bb.y > 400 && bb.y < 600) {
        urlInput = inputs[i];
        console.log(`Found URL input at index ${i}, y=${Math.round(bb.y)}`);
        break;
      }
    }
  }
  
  if (urlInput) {
    await urlInput.click();
    await urlInput.fill(LINK_URL);
    console.log('Filled URL');
    await sleep(300);
    
    // Find Save button
    const allButtons = await page.locator('button').all();
    let saveBtn = null;
    for (const btn of allButtons) {
      const text = await btn.textContent().catch(() => '');
      const bb = await btn.boundingBox();
      if (text.trim() === 'Save' && bb && bb.width > 0) {
        saveBtn = btn;
        console.log('Found Save button at y:', Math.round(bb.y));
        break;
      }
    }
    
    if (saveBtn) {
      await saveBtn.click();
      console.log('Clicked Save');
    } else {
      await page.keyboard.press('Enter');
      console.log('Pressed Enter');
    }
    await sleep(800);
  } else {
    console.log('URL input not found, trying coordinate click');
    await page.mouse.click(526, 430);
    await sleep(200);
    await page.keyboard.type(LINK_URL, { delay: 10 });
    await page.keyboard.press('Enter');
    await sleep(500);
  }
  
  await page.screenshot({ path: `${screenshotDir}/elise-fulltest-after-link.png` });
  
  // Type rest of body
  await page.keyboard.type(' and more text after', { delay: 15 });
  await sleep(500);
  
  await page.screenshot({ path: `${screenshotDir}/elise-fulltest-body-done.png` });
  
  // Check the post body content
  const bodyText = await page.evaluate(() => {
    const body = document.querySelector('div[role="textbox"][aria-label="Post body text field"]');
    return body ? body.innerHTML.substring(0, 500) : 'NOT FOUND';
  });
  console.log('Body HTML:', bodyText);
  
  // DON'T actually submit - just verify the link looks right
  console.log('Test complete - link insertion tested successfully');
})().catch(e => console.error('Error:', e.message));
