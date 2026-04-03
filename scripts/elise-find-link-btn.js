const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('ws://127.0.0.1:52004/devtools/browser/03f3b259-468c-4868-bb0f-41b97a9ba752');
  const contexts = browser.contexts();
  const context = contexts[0];
  const pages = context.pages();
  const page = pages[0];
  for (let i=1; i<pages.length; i++) await pages[i].close();
  
  page.on('dialog', async d => { try { await d.accept(); } catch(e) {} });
  
  try {
    await page.goto('https://www.reddit.com/r/FelineDiabetes/submit/?type=TEXT', { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch(e) {}
  await new Promise(r => setTimeout(r, 4000));
  
  // Fill title
  const ta = await page.$('textarea[name="title"]');
  await ta.click();
  await ta.fill('TEST TITLE - IGNORE');
  
  // Click body
  await page.mouse.click(530, 480);
  await new Promise(r => setTimeout(r, 300));
  await page.keyboard.type('Hello ', { delay: 20 });
  await page.keyboard.type('link text', { delay: 30 });
  
  // Select "link text" (9 chars)
  for (let i = 0; i < 9; i++) {
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.up('Shift');
  }
  await new Promise(r => setTimeout(r, 300));
  
  // Find all clickable elements in the toolbar area (y < 500 typically)
  const toolbarElements = await page.evaluate(() => {
    // Get all elements that might be toolbar buttons
    const all = [...document.querySelectorAll('*')];
    const result = [];
    for (const el of all) {
      const rect = el.getBoundingClientRect();
      // Look for small elements in the toolbar area (roughly y: 380-420 based on the screenshot)
      if (rect.width > 5 && rect.width < 60 && rect.height > 5 && rect.height < 60 
          && rect.y > 350 && rect.y < 430) {
        const role = el.getAttribute('role');
        const ariaLabel = el.getAttribute('aria-label') || '';
        const title = el.title || '';
        const tagName = el.tagName;
        result.push({
          tag: tagName,
          role,
          ariaLabel,
          title,
          class: el.className.substring(0,40),
          rect: {x:Math.round(rect.x),y:Math.round(rect.y),w:Math.round(rect.width),h:Math.round(rect.height)}
        });
      }
    }
    return result;
  });
  
  console.log('Toolbar-area elements:', JSON.stringify(toolbarElements, null, 2));
  
  await page.screenshot({ path: '/Users/owen/.openclaw/workspace/BRAIN/assets/elise-toolbar-test.png' });
  
  // Try to find buttons with role="button" anywhere
  const allButtons = await page.evaluate(() => {
    const result = [];
    const els = [...document.querySelectorAll('[role="button"], button, [tabindex]')];
    for (const el of els) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        result.push({
          tag: el.tagName,
          role: el.getAttribute('role') || '',
          ariaLabel: el.getAttribute('aria-label') || '',
          title: el.title || '',
          class: el.className.substring(0,50),
          tabindex: el.tabIndex,
          rect: {x:Math.round(rect.x),y:Math.round(rect.y),w:Math.round(rect.width),h:Math.round(rect.height)}
        });
      }
    }
    return result;
  });
  
  console.log('All interactive elements:', JSON.stringify(allButtons, null, 2));
})().catch(e => console.error('Error:', e.message));
