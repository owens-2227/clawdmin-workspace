const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('ws://127.0.0.1:52004/devtools/browser/03f3b259-468c-4868-bb0f-41b97a9ba752');
  const contexts = browser.contexts();
  const context = contexts[0];
  const pages = context.pages();
  const page = pages[0];
  for (let i=1; i<pages.length; i++) await pages[i].close();
  
  page.on('dialog', async d => { console.log('Dialog:', d.message()); await d.accept(); });
  
  try {
    await page.goto('https://www.reddit.com/r/FelineDiabetes/submit/?type=TEXT', { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch(e) { console.log('nav timeout'); }
  await new Promise(r => setTimeout(r, 4000));
  
  console.log('URL:', page.url());
  
  // Find title textarea
  const ta = await page.$('textarea[name="title"]');
  const taBox = ta ? await ta.boundingBox() : null;
  console.log('Title textarea box:', taBox);
  
  if (taBox && taBox.width > 0) {
    await ta.click();
    await ta.fill('TEST TITLE - IGNORE');
    console.log('Title filled');
  }
  
  await new Promise(r => setTimeout(r, 500));
  
  // Find body CE
  const ceInfo = await page.evaluate(() => {
    const ces = [...document.querySelectorAll('[contenteditable="true"]')];
    return ces.map(ce => {
      const rect = ce.getBoundingClientRect();
      return { class: ce.className.substring(0,60), rect: {x:Math.round(rect.x),y:Math.round(rect.y),w:Math.round(rect.width),h:Math.round(rect.height)} };
    }).filter(c => c.rect.w > 0);
  });
  console.log('Visible CEs:', JSON.stringify(ceInfo));
  
  // Click the body CE
  if (ceInfo.length > 0) {
    const ce = ceInfo[0];
    await page.mouse.click(ce.rect.x + 50, ce.rect.y + 20);
    console.log('Clicked CE body');
    await new Promise(r => setTimeout(r, 500));
    await page.keyboard.type('Test body text hello world! ', { delay: 20 });
    console.log('Typed test text');
  }
  
  await page.screenshot({ path: '/Users/owen/.openclaw/workspace/BRAIN/assets/elise-form-test.png' });
  console.log('Screenshot saved');
  
  // Now test the link insertion - select some text and try Ctrl+K
  // Type "click here" then select it
  await page.keyboard.type('click here', { delay: 30 });
  await new Promise(r => setTimeout(r, 200));
  
  // Select "click here"
  for (let i = 0; i < 10; i++) {
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.up('Shift');
  }
  
  // Try Ctrl+K
  await page.keyboard.press('Control+k');
  await new Promise(r => setTimeout(r, 1500));
  
  await page.screenshot({ path: '/Users/owen/.openclaw/workspace/BRAIN/assets/elise-form-test-link.png' });
  console.log('Link dialog screenshot saved');
  
  // Check for any input that appeared
  const inputs = await page.evaluate(() => {
    return [...document.querySelectorAll('input')].filter(i => {
      const r = i.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }).map(i => ({ placeholder: i.placeholder, type: i.type, value: i.value, rect: { x: Math.round(i.getBoundingClientRect().x), y: Math.round(i.getBoundingClientRect().y) } }));
  });
  console.log('Visible inputs after Ctrl+K:', JSON.stringify(inputs));
  
  // Check buttons
  const btns = await page.evaluate(() => {
    return [...document.querySelectorAll('button')].filter(b => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }).map(b => ({text: b.textContent.trim().substring(0,25), disabled: b.disabled, ariaLabel: b.getAttribute('aria-label') || ''}));
  });
  console.log('Buttons:', JSON.stringify(btns));
})().catch(e => console.error('Error:', e.message));
