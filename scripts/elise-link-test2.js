// Test link dialog interaction
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
  await ta.fill('TEST - IGNORE');
  await sleep(300);
  
  // Click body
  const bodyEl = await page.$('div[role="textbox"][aria-label="Post body text field"]');
  await bodyEl.click();
  await sleep(300);
  
  // Type text before link
  await page.keyboard.type('text before ', { delay: 20 });
  await page.keyboard.type('click here', { delay: 40 });
  await sleep(200);
  
  // Select "click here" (10 chars)
  for (let i = 0; i < 10; i++) {
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.up('Shift');
  }
  await sleep(300);
  
  // Click the link button (at ~391, 404)
  await page.mouse.click(391, 404);
  await sleep(2000);
  
  await page.screenshot({ path: `${screenshotDir}/elise-link2-dialog.png` });
  
  // Look for all inputs and their labels
  const allInputInfo = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input')];
    return inputs.map(inp => {
      const rect = inp.getBoundingClientRect();
      // Find associated label
      const label = document.querySelector(`label[for="${inp.id}"]`);
      const labelText = label ? label.textContent.trim() : '';
      // Check nearby text
      const parent = inp.parentElement;
      const parentText = parent ? parent.textContent.trim().substring(0,50) : '';
      return {
        id: inp.id,
        name: inp.name,
        type: inp.type,
        placeholder: inp.placeholder,
        value: inp.value,
        label: labelText,
        parentText,
        visible: rect.width > 0,
        rect: {x:Math.round(rect.x),y:Math.round(rect.y),w:Math.round(rect.width),h:Math.round(rect.height)}
      };
    });
  });
  
  console.log('All inputs:', JSON.stringify(allInputInfo, null, 2));
  
  // Also find all shadow roots
  const shadowInfo = await page.evaluate(() => {
    const withShadow = [];
    const walk = (root) => {
      const els = [...root.querySelectorAll('*')];
      for (const el of els) {
        if (el.shadowRoot) {
          const inputs = [...el.shadowRoot.querySelectorAll('input')];
          if (inputs.length) {
            withShadow.push({ tag: el.tagName, inputCount: inputs.length });
          }
          walk(el.shadowRoot);
        }
      }
    };
    walk(document);
    return withShadow;
  });
  console.log('Shadow DOM elements with inputs:', JSON.stringify(shadowInfo));
  
  // Try using page.locator to find input fields
  const linkInputCount = await page.locator('input').count();
  console.log('Total inputs via locator:', linkInputCount);
  
  for (let i = 0; i < linkInputCount; i++) {
    const inp = page.locator('input').nth(i);
    const bb = await inp.boundingBox();
    const placeholder = await inp.getAttribute('placeholder').catch(() => '');
    const value = await inp.inputValue().catch(() => '');
    console.log(`Input ${i}: placeholder="${placeholder}" value="${value}" bb=${JSON.stringify(bb)}`);
  }
  
  console.log('Done');
})().catch(e => console.error('Error:', e.message));
