const { chromium } = require('playwright-core');

const CDP_URL = 'ws://127.0.0.1:53631/devtools/browser/3bafda47-2994-438b-a752-a46ffe886f26';

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const pages = context.pages();
  
  // Close extra tabs, keep one
  for (let i = 1; i < pages.length; i++) {
    await pages[i].close().catch(() => {});
  }
  const page = pages[0] || await context.newPage();
  
  // Navigate to Reddit
  console.log('Navigating to Reddit...');
  await page.goto('https://www.reddit.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  
  // Check current state
  const url = page.url();
  const title = await page.title();
  console.log(`URL: ${url}`);
  console.log(`Title: ${title}`);
  
  // Check if logged in or on login page
  const pageContent = await page.content();
  const hasLoginButton = pageContent.includes('Log In') || pageContent.includes('login');
  const hasUserMenu = pageContent.includes('user-drawer') || pageContent.includes('header-user-actions');
  
  console.log(`Has login prompt: ${hasLoginButton}`);
  console.log(`Has user menu: ${hasUserMenu}`);
  
  // Take a screenshot
  await page.screenshot({ path: '/Users/owen/.openclaw/workspace/BRAIN/scripts/skill-builder/reddit-landing.png', fullPage: false });
  console.log('Screenshot saved to reddit-landing.png');
  
  await browser.close();
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
