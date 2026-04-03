// Debug post button
const { chromium } = require('playwright');
const fs = require('fs');

const CDP_URL = 'ws://127.0.0.1:52004/devtools/browser/03f3b259-468c-4868-bb0f-41b97a9ba752';
const screenshotDir = '/Users/owen/.openclaw/workspace/BRAIN/assets';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const page = context.pages()[0];
  
  page.on('dialog', async d => { try { await d.accept(); } catch(e) {} });
  
  // Navigate to what should be the current state
  try {
    await page.goto('https://www.reddit.com/r/FelineDiabetes/submit/?type=TEXT', { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch(e) {}
  await sleep(4000);
  
  // Fill title
  const ta = await page.$('textarea[name="title"]');
  await ta.click();
  await ta.fill('Test Post - Please Ignore');
  await sleep(300);
  
  // Click body and type something
  const bodyEl = await page.$('div[role="textbox"][aria-label="Post body text field"]');
  await bodyEl.click();
  await sleep(300);
  await page.keyboard.type('Test body content here for debugging.', { delay: 15 });
  await sleep(500);
  
  // Get all visible buttons
  const btnInfo = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')];
    return buttons.map(btn => {
      const rect = btn.getBoundingClientRect();
      return {
        text: btn.textContent.trim().substring(0, 30),
        type: btn.type,
        disabled: btn.disabled,
        class: btn.className.substring(0, 60),
        rect: {x:Math.round(rect.x),y:Math.round(rect.y),w:Math.round(rect.width),h:Math.round(rect.height)}
      };
    }).filter(b => b.rect.w > 0 && b.rect.h > 0);
  });
  
  console.log('All visible buttons:', JSON.stringify(btnInfo, null, 2));
  
  await page.screenshot({ path: `${screenshotDir}/elise-postbtn-debug.png` });
  console.log('Screenshot saved');
})().catch(e => console.error('Error:', e.message));
