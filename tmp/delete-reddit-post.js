const { chromium } = require('playwright');

(async () => {
  const cdpUrl = 'ws://127.0.0.1:54241/devtools/browser/e4563ab1-dc75-4245-a2e3-0d22d37da1f1';
  const targetUrl = 'https://www.reddit.com/r/tifu/comments/1s099j8/tifu_by_building_an_app_that_notifies_me_when_my/';

  console.log('Connecting to browser via CDP...');
  const browser = await chromium.connectOverCDP(cdpUrl);

  const contexts = browser.contexts();
  console.log(`Found ${contexts.length} context(s)`);

  const context = contexts[0];
  let pages = context.pages();
  console.log(`Found ${pages.length} page(s)`);

  // Close extra tabs, keep one
  for (let i = 1; i < pages.length; i++) {
    console.log(`Closing extra tab: ${pages[i].url()}`);
    await pages[i].close();
  }

  const page = pages[0];
  console.log(`Using page: ${page.url()}`);

  // Navigate to target URL
  console.log('Navigating to target URL...');
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  console.log(`Current URL: ${page.url()}`);

  // Take initial screenshot
  await page.screenshot({ path: '/Users/owen/.openclaw/workspace/tmp/delete-step1-loaded.png', fullPage: false });
  console.log('Screenshot taken: step1-loaded');

  // Try to find the overflow/more menu on the post
  // Reddit new UI uses various selectors for the "..." menu
  // Look for the post's action bar overflow button

  // Try multiple approaches
  // First, scroll to top to see the post header
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);

  // Try to find overflow menu button - various selectors for Reddit's UI
  const overflowSelectors = [
    // New Reddit shreddit UI
    'shreddit-overflow-menu',
    'button[aria-label="More"]',
    'button[aria-label="more options"]', 
    'button[aria-label="More options"]',
    // Look for ... button near the post
    '[data-testid="post-overflow-menu"]',
    'div[data-click-id="share"] ~ div button',
    // Generic overflow with title
    'button[title="More"]',
    'button[title="more options"]',
    // SVG icon buttons
    'button svg[icon-name="overflow-horizontal-outline"]',
    'button:has(svg[icon-name="overflow-horizontal-outline"])',
    // Reddit share-like buttons area
    '[slot="post-cta-bar"] button[aria-label="more options"]',
  ];

  let overflowBtn = null;
  for (const sel of overflowSelectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        console.log(`Found overflow button with selector: ${sel}`);
        overflowBtn = el;
        break;
      }
    } catch (e) {
      // continue
    }
  }

  if (!overflowBtn) {
    // Try finding by text content or aria attributes more broadly
    console.log('Trying broader search for overflow menu...');
    
    // Look for any button with "more" in aria-label (case insensitive)
    overflowBtn = await page.evaluateHandle(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.find(b => {
        const label = (b.getAttribute('aria-label') || '').toLowerCase();
        const title = (b.getAttribute('title') || '').toLowerCase();
        return label.includes('more') || title.includes('more') || label.includes('overflow') || title.includes('overflow');
      });
    });
    
    if (overflowBtn && await overflowBtn.evaluate(el => el && el.tagName)) {
      console.log('Found overflow button via broad search');
    } else {
      overflowBtn = null;
    }
  }

  if (!overflowBtn) {
    // Try shreddit-overflow-menu as a web component
    console.log('Looking for shreddit-overflow-menu web component...');
    const shredditOverflow = await page.$('shreddit-overflow-menu');
    if (shredditOverflow) {
      console.log('Found shreddit-overflow-menu');
      // Find the button inside it
      overflowBtn = await shredditOverflow.$('button');
      if (overflowBtn) {
        console.log('Found button inside shreddit-overflow-menu');
      }
    }
  }

  if (!overflowBtn) {
    // Dump some HTML to understand the page structure
    const postActions = await page.evaluate(() => {
      // Try to find the post's action area
      const postEl = document.querySelector('[data-testid="post-container"]') || 
                     document.querySelector('shreddit-post') ||
                     document.querySelector('[data-type="link"]');
      if (postEl) {
        return postEl.innerHTML.substring(0, 5000);
      }
      return document.body.innerHTML.substring(0, 5000);
    });
    console.log('Post HTML snippet:', postActions);
    
    await page.screenshot({ path: '/Users/owen/.openclaw/workspace/tmp/delete-step2-error.png', fullPage: false });
    console.log('ERROR: Could not find overflow menu button');
    process.exit(1);
  }

  // Click the overflow button
  console.log('Clicking overflow menu button...');
  await overflowBtn.click();
  await page.waitForTimeout(2000);

  // Take screenshot of open menu
  await page.screenshot({ path: '/Users/owen/.openclaw/workspace/tmp/delete-step2-menu-open.png', fullPage: false });
  console.log('Screenshot taken: step2-menu-open');

  // Look for Delete option in the menu
  const deleteSelectors = [
    'button:has-text("Delete")',
    'a:has-text("Delete")',
    '[role="menuitem"]:has-text("Delete")',
    'li:has-text("Delete") button',
    'button[data-testid="delete"]',
  ];

  let deleteBtn = null;
  for (const sel of deleteSelectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        console.log(`Found delete button with selector: ${sel}`);
        deleteBtn = el;
        break;
      }
    } catch (e) {
      // continue
    }
  }

  if (!deleteBtn) {
    // Try broader text search
    deleteBtn = await page.evaluateHandle(() => {
      const allClickable = Array.from(document.querySelectorAll('button, a, [role="menuitem"]'));
      return allClickable.find(el => el.textContent.trim().toLowerCase() === 'delete' || 
                                     el.textContent.trim().toLowerCase() === 'delete post');
    });
    
    if (deleteBtn && await deleteBtn.evaluate(el => el && el.tagName)) {
      console.log('Found delete button via text search');
    } else {
      deleteBtn = null;
    }
  }

  if (!deleteBtn) {
    console.log('ERROR: Could not find Delete option in menu');
    // Log what's visible in the dropdown
    const menuContent = await page.evaluate(() => {
      const menus = document.querySelectorAll('[role="menu"], [role="listbox"], ul.dropdown, .dropdown-menu');
      const results = [];
      menus.forEach(m => results.push(m.textContent));
      return results;
    });
    console.log('Menu content:', menuContent);
    await page.screenshot({ path: '/Users/owen/.openclaw/workspace/tmp/delete-step2-error.png', fullPage: false });
    process.exit(1);
  }

  // Click Delete
  console.log('Clicking Delete button...');
  await deleteBtn.click();
  await page.waitForTimeout(2000);

  // Take screenshot of confirmation dialog
  await page.screenshot({ path: '/Users/owen/.openclaw/workspace/tmp/delete-step3-confirm.png', fullPage: false });
  console.log('Screenshot taken: step3-confirm');

  // Look for confirmation button
  const confirmSelectors = [
    'button:has-text("Delete")',
    'button:has-text("Yes")',
    'button:has-text("Confirm")',
    'button[data-testid="confirm-button"]',
    '[role="dialog"] button:has-text("Delete")',
    'div[role="dialog"] button:last-child',
  ];

  let confirmBtn = null;
  for (const sel of confirmSelectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        const text = await el.textContent();
        console.log(`Found confirm button with selector: ${sel}, text: ${text}`);
        // Make sure it's actually a confirm (not cancel)
        if (!text.toLowerCase().includes('cancel')) {
          confirmBtn = el;
          break;
        }
      }
    } catch (e) {
      // continue
    }
  }

  if (confirmBtn) {
    console.log('Clicking confirm button...');
    await confirmBtn.click();
    await page.waitForTimeout(3000);
  } else {
    console.log('No confirmation dialog found — deletion may have gone through directly');
  }

  // Take final screenshot
  await page.screenshot({ path: '/Users/owen/.openclaw/workspace/tmp/delete-step4-final.png', fullPage: false });
  console.log('Screenshot taken: step4-final');

  // Check if we're redirected or post shows as deleted
  const finalUrl = page.url();
  console.log(`Final URL: ${finalUrl}`);

  const pageTitle = await page.title();
  console.log(`Page title: ${pageTitle}`);

  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
  console.log('Page content snippet:', bodyText);

  console.log('DONE');
  await browser.disconnect();
})().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
