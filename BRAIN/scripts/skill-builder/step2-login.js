const { chromium } = require('playwright-core');

const CDP_URL = 'ws://127.0.0.1:53631/devtools/browser/3bafda47-2994-438b-a752-a46ffe886f26';
const USERNAME = 'SpecialConference842';
const PASSWORD = 'cb5sryc19i';

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min) + min);
}

// Type like a human — variable speed, occasional pauses
async function humanType(page, selector, text) {
  await page.click(selector);
  await page.waitForTimeout(randomDelay(200, 500));
  
  for (const char of text) {
    await page.keyboard.type(char, { delay: randomDelay(50, 150) });
    // Occasional longer pause (simulating thinking)
    if (Math.random() < 0.1) {
      await page.waitForTimeout(randomDelay(200, 400));
    }
  }
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const pages = context.pages();
  const page = pages[0] || await context.newPage();
  
  // Step 1: Click "Log In" button
  console.log('Step 1: Clicking Log In button...');
  await page.goto('https://www.reddit.com/login/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  
  // Screenshot the login page
  await page.screenshot({ path: '/Users/owen/.openclaw/workspace/BRAIN/scripts/skill-builder/login-page.png' });
  console.log('Login page loaded. Screenshot saved.');
  
  const url = page.url();
  console.log(`Current URL: ${url}`);
  
  // Step 2: Find and fill username field
  console.log('Step 2: Entering username...');
  
  // Try different possible selectors for the login form
  const usernameSelectors = [
    'input[name="username"]',
    '#loginUsername', 
    'input[id="loginUsername"]',
    'input[type="text"]',
    '#login-username',
  ];
  
  let usernameField = null;
  for (const sel of usernameSelectors) {
    try {
      usernameField = await page.waitForSelector(sel, { timeout: 3000 });
      if (usernameField) {
        console.log(`  Found username field: ${sel}`);
        break;
      }
    } catch {}
  }
  
  if (!usernameField) {
    // Maybe it's in an iframe or shadow DOM — let's check
    const frames = page.frames();
    console.log(`  Page has ${frames.length} frames`);
    
    // Screenshot for debugging
    await page.screenshot({ path: '/Users/owen/.openclaw/workspace/BRAIN/scripts/skill-builder/login-debug.png' });
    console.log('  Could not find username field. Debug screenshot saved.');
    
    // Dump visible input fields
    const inputs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('input')).map(i => ({
        type: i.type,
        name: i.name,
        id: i.id,
        placeholder: i.placeholder,
        visible: i.offsetParent !== null
      }));
    });
    console.log('  Visible inputs:', JSON.stringify(inputs, null, 2));
    
    await browser.close();
    return;
  }
  
  await humanType(page, usernameSelectors.find(s => usernameField) || 'input[name="username"]', USERNAME);
  await page.waitForTimeout(randomDelay(500, 1000));
  
  // Step 3: Fill password
  console.log('Step 3: Entering password...');
  const passwordSelectors = [
    'input[name="password"]',
    '#loginPassword',
    'input[id="loginPassword"]',
    'input[type="password"]',
    '#login-password',
  ];
  
  for (const sel of passwordSelectors) {
    try {
      const el = await page.waitForSelector(sel, { timeout: 2000 });
      if (el) {
        await humanType(page, sel, PASSWORD);
        console.log(`  Found password field: ${sel}`);
        break;
      }
    } catch {}
  }
  
  await page.waitForTimeout(randomDelay(500, 1000));
  
  // Screenshot before submitting
  await page.screenshot({ path: '/Users/owen/.openclaw/workspace/BRAIN/scripts/skill-builder/login-filled.png' });
  console.log('Form filled. Screenshot saved.');
  
  // Step 4: Submit
  console.log('Step 4: Submitting login...');
  const submitSelectors = [
    'button[type="submit"]',
    'button:has-text("Log In")',
    'button:has-text("Sign In")',
    '.login button',
  ];
  
  for (const sel of submitSelectors) {
    try {
      const btn = await page.waitForSelector(sel, { timeout: 2000 });
      if (btn) {
        await btn.click();
        console.log(`  Clicked submit: ${sel}`);
        break;
      }
    } catch {}
  }
  
  // Wait for navigation
  console.log('Waiting for login to complete...');
  await page.waitForTimeout(5000);
  
  const finalUrl = page.url();
  const finalTitle = await page.title();
  console.log(`Final URL: ${finalUrl}`);
  console.log(`Final title: ${finalTitle}`);
  
  // Screenshot result
  await page.screenshot({ path: '/Users/owen/.openclaw/workspace/BRAIN/scripts/skill-builder/login-result.png' });
  console.log('Post-login screenshot saved.');
  
  await browser.close();
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
