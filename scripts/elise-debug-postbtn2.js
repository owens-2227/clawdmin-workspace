// Debug post button - run while main script waits
const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:52004/devtools/browser/03f3b259-468c-4868-bb0f-41b97a9ba752';
const screenshotDir = '/Users/owen/.openclaw/workspace/BRAIN/assets';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const page = context.pages()[0];
  
  page.on('dialog', async d => { try { await d.accept(); } catch(e) {} });
  
  // Navigate fresh to check button
  try {
    await page.goto('https://www.reddit.com/r/FelineDiabetes/submit/?type=TEXT', { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch(e) {}
  await sleep(4000);
  
  // Fill title and body to enable Post button
  const ta = await page.$('textarea[name="title"]');
  await ta.click();
  await ta.fill('Test title debugging post button');
  await sleep(300);
  
  const bodyEl = await page.$('div[role="textbox"][aria-label="Post body text field"]');
  await bodyEl.click();
  await sleep(300);
  await page.keyboard.type('Test body text', { delay: 20 });
  await sleep(500);
  
  await page.screenshot({ path: `${screenshotDir}/elise-btn-debug1.png` });
  
  // Find ALL buttons including in shadow DOM
  const allBtns = await page.evaluate(() => {
    const results = [];
    const walk = (root, depth) => {
      for (const el of root.querySelectorAll('button')) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          results.push({ depth, tag: el.tagName, text: el.textContent.trim().substring(0,20), disabled: el.disabled, rect: {x:Math.round(rect.x),y:Math.round(rect.y),w:Math.round(rect.width),h:Math.round(rect.height)} });
        }
      }
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) walk(el.shadowRoot, depth+1);
      }
    };
    walk(document, 0);
    return results;
  });
  
  console.log('All buttons (including shadow DOM):', JSON.stringify(allBtns, null, 2));
  
  // Also use locator
  const allBtnsLocator = await page.locator('button').all();
  console.log('\nTotal buttons via locator:', allBtnsLocator.length);
  for (let i = 0; i < allBtnsLocator.length; i++) {
    const text = await allBtnsLocator[i].textContent().catch(() => '');
    const bb = await allBtnsLocator[i].boundingBox().catch(() => null);
    if (bb) console.log(`  btn[${i}]: text="${text.trim()}" bb=${JSON.stringify(bb)}`);
  }
})().catch(e => console.error('Error:', e.message));
