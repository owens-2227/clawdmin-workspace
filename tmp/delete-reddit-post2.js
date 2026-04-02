const { chromium } = require('playwright');

(async () => {
  const cdpUrl = 'ws://127.0.0.1:54241/devtools/browser/e4563ab1-dc75-4245-a2e3-0d22d37da1f1';
  const targetUrl = 'https://www.reddit.com/r/tifu/comments/1s099j8/tifu_by_building_an_app_that_notifies_me_when_my/';

  console.log('Connecting to browser via CDP...');
  const browser = await chromium.connectOverCDP(cdpUrl);

  const contexts = browser.contexts();
  const context = contexts[0];
  let pages = context.pages();
  console.log(`Found ${pages.length} page(s)`);

  // Close extra tabs, keep one
  for (let i = 1; i < pages.length; i++) {
    await pages[i].close();
  }

  const page = pages[0];

  // Navigate to target URL
  console.log('Navigating to target URL...');
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Take initial screenshot
  await page.screenshot({ path: '/Users/owen/.openclaw/workspace/tmp/delete-step1-loaded.png', fullPage: false });
  console.log('Screenshot taken: step1-loaded');

  // Get all buttons with "More options" aria-label
  const buttons = await page.$$('button[aria-label="More options"]');
  console.log(`Found ${buttons.length} "More options" buttons`);

  // Log info about each button
  for (let i = 0; i < buttons.length; i++) {
    const info = await buttons[i].evaluate(el => ({
      visible: el.offsetParent !== null,
      rect: el.getBoundingClientRect(),
      outerHTML: el.outerHTML.substring(0, 200),
    }));
    console.log(`Button ${i}:`, JSON.stringify(info));
  }

  // Find the first visible one or scroll to it
  let clickedMenu = false;
  for (let i = 0; i < buttons.length; i++) {
    const btn = buttons[i];
    
    // Scroll into view
    await btn.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.waitForTimeout(500);
    
    const info = await btn.evaluate(el => ({
      visible: el.offsetParent !== null,
      rect: el.getBoundingClientRect(),
    }));
    console.log(`After scroll, button ${i}:`, JSON.stringify(info));
    
    if (info.rect.width > 0 && info.rect.height > 0) {
      console.log(`Clicking button ${i} via JS click...`);
      await btn.evaluate(el => el.click());
      await page.waitForTimeout(2000);
      
      await page.screenshot({ path: `/Users/owen/.openclaw/workspace/tmp/delete-step2-menu-${i}.png`, fullPage: false });
      console.log(`Screenshot taken after clicking button ${i}`);
      
      // Check if a menu appeared with Delete option
      const menuItems = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"], li button, .dropdown-content a, .dropdown-content button'));
        return items.map(el => ({ text: el.textContent.trim(), tag: el.tagName }));
      });
      console.log('Menu items found:', JSON.stringify(menuItems));
      
      // Look for Delete button
      const deleteVisible = await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll('button, a, [role="menuitem"]'));
        const del = all.find(el => el.textContent.trim().toLowerCase() === 'delete' || 
                                   el.textContent.trim().toLowerCase() === 'delete post');
        if (del) return { found: true, text: del.textContent.trim(), visible: del.offsetParent !== null };
        return { found: false };
      });
      console.log('Delete button check:', JSON.stringify(deleteVisible));
      
      if (deleteVisible.found) {
        clickedMenu = true;
        break;
      }
    }
  }

  if (!clickedMenu) {
    // Dump page structure for debugging
    console.log('Could not open menu. Taking debug screenshot...');
    await page.screenshot({ path: '/Users/owen/.openclaw/workspace/tmp/delete-debug.png', fullPage: false });
    
    // Try finding the post overflow menu differently
    const postInfo = await page.evaluate(() => {
      const post = document.querySelector('shreddit-post');
      if (post) {
        const shadowRoot = post.shadowRoot;
        if (shadowRoot) {
          const overflowMenu = shadowRoot.querySelector('shreddit-overflow-menu');
          return { hasShadowRoot: true, hasOverflowMenu: !!overflowMenu };
        }
        return { hasShadowRoot: false, innerHTML: post.innerHTML.substring(0, 2000) };
      }
      return { noPost: true };
    });
    console.log('Post structure:', JSON.stringify(postInfo));
    process.exit(1);
  }

  // Click Delete
  console.log('Clicking Delete...');
  await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('button, a, [role="menuitem"]'));
    const del = all.find(el => el.textContent.trim().toLowerCase() === 'delete' || 
                               el.textContent.trim().toLowerCase() === 'delete post');
    if (del) del.click();
  });
  await page.waitForTimeout(2000);

  await page.screenshot({ path: '/Users/owen/.openclaw/workspace/tmp/delete-step3-confirm.png', fullPage: false });
  console.log('Screenshot taken: step3-confirm');

  // Check for confirmation dialog
  const dialogInfo = await page.evaluate(() => {
    const dialogs = document.querySelectorAll('[role="dialog"], .modal, [data-testid*="modal"]');
    const results = [];
    dialogs.forEach(d => results.push({ text: d.textContent.substring(0, 200), buttons: Array.from(d.querySelectorAll('button')).map(b => b.textContent.trim()) }));
    return results;
  });
  console.log('Dialogs:', JSON.stringify(dialogInfo));

  // Click confirm Delete in dialog
  const confirmed = await page.evaluate(() => {
    const dialogs = document.querySelectorAll('[role="dialog"], .modal');
    for (const dialog of dialogs) {
      const buttons = Array.from(dialog.querySelectorAll('button'));
      const confirmBtn = buttons.find(b => b.textContent.trim().toLowerCase().includes('delete') && !b.textContent.trim().toLowerCase().includes('cancel'));
      if (confirmBtn) {
        confirmBtn.click();
        return true;
      }
    }
    // Also try any visible "Delete" button that appeared
    const all = Array.from(document.querySelectorAll('button'));
    const deleteButtons = all.filter(b => b.textContent.trim().toLowerCase() === 'delete');
    if (deleteButtons.length > 0) {
      deleteButtons[deleteButtons.length - 1].click();
      return true;
    }
    return false;
  });
  console.log('Confirmation clicked:', confirmed);
  
  await page.waitForTimeout(3000);

  // Final screenshot
  await page.screenshot({ path: '/Users/owen/.openclaw/workspace/tmp/delete-step4-final.png', fullPage: false });
  console.log('Screenshot taken: step4-final');

  const finalUrl = page.url();
  const pageTitle = await page.title();
  console.log(`Final URL: ${finalUrl}`);
  console.log(`Page title: ${pageTitle}`);

  console.log('DONE');
  await browser.disconnect();
})().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
