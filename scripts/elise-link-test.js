// Test just the link insertion
const { chromium } = require('playwright');

const CDP_URL = 'ws://127.0.0.1:52004/devtools/browser/03f3b259-468c-4868-bb0f-41b97a9ba752';
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
  await ta.fill('TEST - IGNORE THIS POST');
  await sleep(300);
  
  // Click body
  const bodyEl = await page.$('div[role="textbox"][aria-label="Post body text field"]');
  if (bodyEl) {
    await bodyEl.click();
    console.log('Clicked body via aria-label');
  } else {
    await page.mouse.click(530, 480);
    console.log('Clicked body via coordinates');
  }
  await sleep(500);
  
  // Type some text before link
  await page.keyboard.type('Test text ', { delay: 20 });
  
  // Type link text
  await page.keyboard.type('click here', { delay: 40 });
  await sleep(200);
  
  // Select "click here" (10 chars)
  for (let i = 0; i < 10; i++) {
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.up('Shift');
  }
  await sleep(300);
  
  // Get all custom elements in the toolbar
  const customEls = await page.evaluate(() => {
    return [...document.querySelectorAll('*')].filter(el => {
      const rect = el.getBoundingClientRect();
      return el.tagName.includes('-') && rect.width > 0 && rect.height > 0 && rect.y > 370 && rect.y < 430;
    }).map(el => ({
      tag: el.tagName,
      rect: {x: Math.round(el.getBoundingClientRect().x), y: Math.round(el.getBoundingClientRect().y), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height)}
    }));
  });
  console.log('Custom toolbar elements:', JSON.stringify(customEls));
  
  await page.screenshot({ path: `${screenshotDir}/elise-link-test-before.png` });
  
  // Click the link button - from our analysis it's at ~391, 404
  await page.mouse.click(391, 404);
  await sleep(1500);
  
  await page.screenshot({ path: `${screenshotDir}/elise-link-test-after-click.png` });
  
  // Check what appeared
  const allVisible = await page.evaluate(() => {
    return [...document.querySelectorAll('input, [contenteditable]')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }).map(el => ({
      tag: el.tagName,
      ce: el.getAttribute('contenteditable'),
      placeholder: el.placeholder || '',
      type: el.type || '',
      value: el.value || el.textContent.substring(0,30),
      rect: {x:Math.round(el.getBoundingClientRect().x), y:Math.round(el.getBoundingClientRect().y), w:Math.round(el.getBoundingClientRect().width)}
    }));
  });
  console.log('Visible inputs/CEs after link click:', JSON.stringify(allVisible));
  
  // Check if a new popover or dialog appeared
  const newEls = await page.evaluate(() => {
    // Look for anything that might be a dialog/popover
    return [...document.querySelectorAll('[role="dialog"], [role="tooltip"], [popover], .popover, dialog')].map(el => {
      const rect = el.getBoundingClientRect();
      return {tag: el.tagName, role: el.getAttribute('role'), rect:{x:Math.round(rect.x),y:Math.round(rect.y),w:Math.round(rect.width),h:Math.round(rect.height)}, visible: rect.width > 0 };
    });
  });
  console.log('Dialogs/popovers:', JSON.stringify(newEls));
  
  console.log('Done with link test');
})().catch(e => console.error('Error:', e.message));
