const { chromium } = require('playwright');

(async () => {
  const cdpUrl = 'ws://127.0.0.1:53683/devtools/browser/5aaa5095-79ed-4595-a7e9-ec92573a04b4';
  const targetUrl = 'https://www.reddit.com/r/tifu/comments/1s099j8/tifu_by_building_an_app_that_notifies_me_when_my/';

  const browser = await chromium.connectOverCDP(cdpUrl);
  const contexts = browser.contexts();
  const context = contexts[0];

  // Get all pages, close extras, keep one
  let pages = context.pages();
  console.log(`Found ${pages.length} tab(s)`);

  let page;
  if (pages.length === 0) {
    page = await context.newPage();
  } else {
    page = pages[0];
    for (let i = 1; i < pages.length; i++) {
      await pages[i].close();
    }
  }

  console.log('Navigating to target URL...');
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Wait for JS hydration
  await page.waitForTimeout(3000);
  console.log('Page loaded, looking for upvote button...');

  // Find upvote button
  const upvoteBtn = page.getByRole('button', { name: /^upvote$/i }).first();
  
  let btnExists = false;
  try {
    await upvoteBtn.waitFor({ timeout: 10000 });
    btnExists = true;
  } catch (e) {
    console.log('Upvote button not found via role, trying alternative selectors...');
  }

  if (!btnExists) {
    // Try alternative
    const altBtn = page.locator('[aria-label="upvote"]').first();
    try {
      await altBtn.waitFor({ timeout: 5000 });
      const ariaPressed = await altBtn.getAttribute('aria-pressed');
      console.log(`Alt button found, aria-pressed: ${ariaPressed}`);
      if (ariaPressed === 'true') {
        console.log('RESULT: Already upvoted');
        await browser.close();
        return;
      }
      await altBtn.click();
      await page.waitForTimeout(1500);
      const newAriaPressed = await altBtn.getAttribute('aria-pressed');
      console.log(`After click, aria-pressed: ${newAriaPressed}`);
      if (newAriaPressed === 'true') {
        console.log('RESULT: SUCCESS - upvote confirmed');
      } else {
        console.log('RESULT: FAILED - aria-pressed did not change to true');
      }
      return;
    } catch (e2) {
      console.log('Alternative selector also failed:', e2.message);
      process.exit(1);
    }
  }

  const ariaPressed = await upvoteBtn.getAttribute('aria-pressed');
  console.log(`Upvote button found, aria-pressed: ${ariaPressed}`);

  if (ariaPressed === 'true') {
    console.log('RESULT: Already upvoted — no action taken');
    return;
  }

  console.log('Clicking upvote button...');
  await upvoteBtn.click();
  await page.waitForTimeout(1500);

  const newAriaPressed = await upvoteBtn.getAttribute('aria-pressed');
  console.log(`After click, aria-pressed: ${newAriaPressed}`);

  if (newAriaPressed === 'true') {
    console.log('RESULT: SUCCESS - upvote confirmed');
  } else {
    console.log(`RESULT: FAILED - aria-pressed is "${newAriaPressed}" after click`);
  }
})().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
