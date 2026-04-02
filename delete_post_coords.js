const { chromium } = require('/Users/owen/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');

(async () => {
  const cdpUrl = 'ws://127.0.0.1:54241/devtools/browser/e4563ab1-dc75-4245-a2e3-0d22d37da1f1';
  const targetUrl = 'https://www.reddit.com/r/tifu/comments/1s099j8/tifu_by_building_an_app_that_notifies_me_when_my/';

  console.log('Connecting to browser via CDP...');
  const browser = await chromium.connectOverCDP(cdpUrl);
  
  const contexts = browser.contexts();
  console.log(`Found ${contexts.length} context(s)`);
  
  let page;
  
  if (contexts.length > 0) {
    const pages = contexts[0].pages();
    console.log(`Found ${pages.length} page(s)`);
    
    // Close extra pages, keep one
    if (pages.length > 1) {
      for (let i = 1; i < pages.length; i++) {
        await pages[i].close();
      }
    }
    
    if (pages.length > 0) {
      page = pages[0];
    } else {
      page = await contexts[0].newPage();
    }
  } else {
    const context = await browser.newContext();
    page = await context.newPage();
  }

  await page.setViewportSize({ width: 1280, height: 900 });

  console.log('Navigating to target URL...');
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  
  console.log('Waiting 3 seconds...');
  await page.waitForTimeout(3000);
  
  await page.screenshot({ path: '/tmp/snap1_initial.png', fullPage: false });
  console.log('Screenshot 1 saved: /tmp/snap1_initial.png');

  // Search for menu/overflow buttons including in shadow DOM
  const buttonInfo = await page.evaluate(() => {
    const results = [];
    
    function checkElement(el) {
      if (!el) return;
      const tag = el.tagName;
      if (!tag) return;
      const role = el.getAttribute('role') || '';
      const ariaLabel = el.getAttribute('aria-label') || '';
      const text = el.textContent?.trim() || '';
      
      if ((tag === 'BUTTON' || role === 'button') || 
          ariaLabel.toLowerCase().includes('more') || 
          ariaLabel.toLowerCase().includes('option') ||
          ariaLabel.toLowerCase().includes('overflow') ||
          ariaLabel.toLowerCase().includes('menu') ||
          text.includes('⋯') || text === '…' || text === '...') {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          results.push({
            tag,
            text: text.substring(0, 60),
            ariaLabel,
            x: Math.round(rect.x + rect.width / 2),
            y: Math.round(rect.y + rect.height / 2),
            w: Math.round(rect.width),
            h: Math.round(rect.height)
          });
        }
      }
    }
    
    function walkDOM(root) {
      if (!root) return;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node;
      while ((node = walker.nextNode())) {
        checkElement(node);
        if (node.shadowRoot) {
          walkDOM(node.shadowRoot);
        }
      }
    }
    
    walkDOM(document.body);
    return results;
  });
  
  console.log('Buttons found (all):');
  console.log(JSON.stringify(buttonInfo, null, 2));

})();
