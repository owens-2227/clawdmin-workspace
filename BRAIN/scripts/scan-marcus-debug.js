const { chromium } = require('playwright');
const CDP_URL = 'ws://127.0.0.1:61786/devtools/browser/a7512840-8b27-4c62-8194-62db63e423a1';

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const pages = context.pages();
  for (let i = 1; i < pages.length; i++) await pages[i].close();
  const page = pages[0] || await context.newPage();

  console.log('Navigating to homerecording...');
  await page.goto('https://www.reddit.com/r/homerecording/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);
  
  const title = await page.title();
  const url = page.url();
  console.log('Title:', title);
  console.log('URL:', url);
  
  const bodyText = await page.evaluate(() => document.body.innerText?.slice(0, 500));
  console.log('Body text:', bodyText);
  
  const isLoggedIn = await page.evaluate(() => {
    return document.querySelector('[data-testid="subreddit-name"]') !== null ||
           document.querySelector('shreddit-post') !== null ||
           document.title.includes('homerecording');
  });
  console.log('Has subreddit content:', isLoggedIn);
  
  // Check if there's a gate
  const gateText = await page.evaluate(() => {
    const gate = document.querySelector('[data-testid="gate"]') || 
                 document.querySelector('.login-gate') ||
                 document.querySelector('auth-flow-modal');
    return gate?.textContent?.slice(0, 200) || null;
  });
  console.log('Gate element:', gateText);
}

main().catch(e => console.error(e));
