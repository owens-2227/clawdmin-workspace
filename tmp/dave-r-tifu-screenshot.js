const { chromium } = require('/Users/owen/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const CDP_URL = 'ws://127.0.0.1:53362/devtools/browser/1650c4da-48cd-4c64-a6ac-e483638868a2';
const FINAL_SCREENSHOT = '/Users/owen/.openclaw/workspace/BRAIN/published-content/dave-r/tifu-post-2026-03-21.png';

fs.mkdirSync(path.dirname(FINAL_SCREENSHOT), { recursive: true });

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const contexts = browser.contexts();
  let page;
  for (const ctx of contexts) {
    const pages = ctx.pages();
    if (pages.length > 0 && !page) page = pages[0];
  }

  console.log('Current URL:', page.url());

  // Find the post link on the feed and click it
  // The post is by ofexfrog, title contains "notifies me when my wife"
  const postLink = page.locator('a:has-text("TIFU by building an app that notifies me when my wife")').first();
  const visible = await postLink.isVisible({ timeout: 5000 });
  console.log('Post link visible:', visible);

  if (visible) {
    await postLink.click();
    await sleep(4000);
    console.log('Post URL (permalink):', page.url());

    // Scroll to top
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    // Take the final screenshot
    await page.screenshot({ path: FINAL_SCREENSHOT, fullPage: false });
    console.log('Screenshot saved:', FINAL_SCREENSHOT);
    console.log('\n=== PERMALINK ===');
    console.log(page.url());
  } else {
    // Try navigating to the post directly from profile
    console.log('Post link not found on feed, trying profile...');
    await page.goto('https://www.reddit.com/user/ofexfrog/submitted/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(3000);
    const profileLink = page.locator('a:has-text("TIFU by building an app")').first();
    if (await profileLink.isVisible({ timeout: 5000 })) {
      await profileLink.click();
      await sleep(4000);
      console.log('Post URL:', page.url());
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(1000);
      await page.screenshot({ path: FINAL_SCREENSHOT, fullPage: false });
      console.log('Screenshot saved:', FINAL_SCREENSHOT);
    }
  }

  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
