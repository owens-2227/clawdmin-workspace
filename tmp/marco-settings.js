const { chromium } = require('/Users/owen/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const path = require('path');

const CDP_URL = 'ws://127.0.0.1:50070/devtools/browser/448938d8-dda1-40cf-b11f-2c11fffe82ae';
const SCREENSHOT_DIR = '/Users/owen/.openclaw/workspace/tmp';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

(async () => {
  console.log('Connecting to browser via CDP...');
  const browser = await chromium.connectOverCDP(CDP_URL);
  
  const contexts = browser.contexts();
  const context = contexts[0] || await browser.newContext();
  const page = await context.newPage();
  
  // Try privacy settings with longer wait
  console.log('Navigating to privacy settings...');
  await page.goto('https://www.reddit.com/settings/privacy', { waitUntil: 'networkidle' });
  await sleep(5000);
  
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'privacy-loaded.png'), fullPage: true });
  
  // Check the shadow DOM of the settings component
  const shadowContent = await page.evaluate(() => {
    // Try to find the settings content in shadow DOMs
    function extractShadowText(root, depth = 0) {
      const results = [];
      if (depth > 5) return results;
      
      const nodes = root.querySelectorAll ? root.querySelectorAll('*') : [];
      for (const node of nodes) {
        if (node.shadowRoot) {
          const text = node.shadowRoot.textContent?.trim();
          if (text && text.length > 10) {
            results.push({ tag: node.tagName, depth, text: text.substring(0, 300) });
            results.push(...extractShadowText(node.shadowRoot, depth + 1));
          }
        }
      }
      return results;
    }
    
    return extractShadowText(document, 0).slice(0, 20);
  });
  
  console.log('Shadow DOM text content:');
  shadowContent.forEach(item => console.log(`  ${item.tag} (depth ${item.depth}): ${item.text.substring(0, 100)}`));
  
  // Try waiting for a specific element that should appear on settings page
  try {
    await page.waitForSelector('form, [data-testid*="setting"], faceplate-switch, shreddit-settings', { timeout: 10000 });
    console.log('Settings form/element appeared!');
  } catch(e) {
    console.log('No settings elements found after waiting');
  }
  
  // Take another screenshot
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'privacy-after-wait.png'), fullPage: true });
  
  // Try the old Reddit prefs page which might be more reliable
  console.log('\nTrying old Reddit prefs...');
  await page.goto('https://www.reddit.com/prefs/', { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'old-prefs.png'), fullPage: true });
  
  const prefsText = await page.evaluate(() => document.body.innerText.substring(0, 5000));
  console.log('Old Reddit prefs text:');
  console.log(prefsText);
  
  // Look for profile privacy setting on old reddit prefs
  const profileVisibility = await page.evaluate(() => {
    // Look for checkbox related to profile/posts visibility
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    return Array.from(checkboxes).map(cb => ({
      id: cb.id,
      name: cb.name,
      checked: cb.checked,
      label: document.querySelector(`label[for="${cb.id}"]`)?.textContent?.trim()
    }));
  });
  console.log('\nOld Reddit prefs checkboxes:', JSON.stringify(profileVisibility, null, 2));
  
  // Try new Reddit settings with a different approach - use URL hash
  console.log('\nTrying new settings approaches...');
  await page.goto('https://new.reddit.com/settings/privacy', { waitUntil: 'networkidle' });
  await sleep(5000);
  
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'new-reddit-privacy.png'), fullPage: true });
  
  const newText = await page.evaluate(() => document.body.innerText.substring(0, 3000));
  console.log('New Reddit privacy text:', newText.substring(0, 1000));
  
  await browser.close();
})().catch(async (err) => {
  console.error('Script error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
