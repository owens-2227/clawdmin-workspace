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
  
  // Use domcontentloaded to avoid timeout
  console.log('Navigating to privacy settings...');
  await page.goto('https://www.reddit.com/settings/privacy', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(8000); // wait extra for React/SPA to load content
  
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'privacy-loaded.png'), fullPage: true });
  
  // Check if the page has loaded its settings content
  const pageContent = await page.evaluate(() => {
    return {
      bodyText: document.body.innerText.substring(0, 3000),
      hasForm: !!document.querySelector('form'),
      hasFaceplate: !!document.querySelector('faceplate-switch, faceplate-checkbox'),
      hasSettings: !!document.querySelector('[data-testid*="setting"]'),
      title: document.title,
      // Get shadow DOM text from specific components
      settingsContent: Array.from(document.querySelectorAll('shreddit-settings-section, [id*="setting"]')).map(el => el.innerHTML.substring(0, 200))
    };
  });
  
  console.log('Page content check:');
  console.log('Title:', pageContent.title);
  console.log('Has form:', pageContent.hasForm);
  console.log('Has faceplate:', pageContent.hasFaceplate);
  console.log('Body text:', pageContent.bodyText.substring(0, 500));
  
  // The settings page uses shadow DOM heavily - try to pierce it
  const shadowContent = await page.evaluate(() => {
    function getAllShadowText(root, depth = 0, maxDepth = 8) {
      if (depth > maxDepth) return [];
      const results = [];
      const selector = root.querySelectorAll ? root.querySelectorAll('*') : [];
      
      for (const el of selector) {
        if (el.shadowRoot) {
          // Check shadow root text
          const innerText = el.shadowRoot.textContent?.replace(/\s+/g, ' ').trim();
          if (innerText && innerText.length > 20 && innerText.length < 2000) {
            results.push({ tag: el.tagName, id: el.id, depth, text: innerText.substring(0, 200) });
          }
          // Recurse
          results.push(...getAllShadowText(el.shadowRoot, depth + 1, maxDepth));
        }
      }
      return results;
    }
    return getAllShadowText(document.body, 0);
  });
  
  console.log(`\nFound ${shadowContent.length} shadow DOM nodes with text`);
  shadowContent.slice(0, 20).forEach(item => {
    console.log(`  [${item.depth}] ${item.tag}${item.id ? '#'+item.id : ''}: "${item.text.substring(0, 120)}"`);
  });
  
  // Try old Reddit prefs - more reliable
  console.log('\n=== Old Reddit prefs ===');
  await page.goto('https://old.reddit.com/prefs/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3000);
  
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'old-prefs.png'), fullPage: true });
  
  // Get all tabs/sections
  const prefsTabs = await page.evaluate(() => {
    const tabs = document.querySelectorAll('.preferences-group');
    return Array.from(tabs).map(t => ({ id: t.id, text: t.querySelector('h1, h2')?.textContent?.trim() }));
  });
  console.log('Prefs sections:', prefsTabs);
  
  // Look specifically for the profile/privacy related checkboxes
  const relevantPrefs = await page.evaluate(() => {
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    return Array.from(checkboxes).map(cb => {
      const label = document.querySelector(`label[for="${cb.id}"]`)?.textContent?.trim() || '';
      return {
        name: cb.name,
        id: cb.id, 
        checked: cb.checked,
        label
      };
    }).filter(cb => 
      cb.label.toLowerCase().includes('profile') || 
      cb.label.toLowerCase().includes('post') ||
      cb.label.toLowerCase().includes('comment') ||
      cb.label.toLowerCase().includes('visible') ||
      cb.label.toLowerCase().includes('show') ||
      cb.name.includes('profile') ||
      cb.name.includes('optout')
    );
  });
  console.log('Relevant prefs:', JSON.stringify(relevantPrefs, null, 2));
  
  // Get ALL checkboxes to see what's available
  const allPrefs = await page.evaluate(() => {
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    return Array.from(checkboxes).map(cb => {
      const label = document.querySelector(`label[for="${cb.id}"]`)?.textContent?.trim() || '';
      return { name: cb.name, id: cb.id, checked: cb.checked, label };
    });
  });
  console.log('ALL prefs checkboxes:', JSON.stringify(allPrefs, null, 2));
  
  // Click the Privacy tab if it exists
  try {
    const privacyTab = await page.$('a[href*="privacy"], a:has-text("privacy")');
    if (privacyTab) {
      await privacyTab.click();
      await sleep(2000);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'old-prefs-privacy.png'), fullPage: true });
      console.log('Clicked privacy tab!');
    }
  } catch(e) {
    console.log('No privacy tab:', e.message);
  }
  
  // Navigate directly to account privacy tab
  await page.goto('https://old.reddit.com/prefs/privacy/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(2000);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'old-prefs-privacy2.png'), fullPage: true });
  const privacyPageText = await page.evaluate(() => document.body.innerText.substring(0, 5000));
  console.log('Privacy prefs page text:', privacyPageText.substring(0, 2000));
  
  await browser.close();
})().catch(async (err) => {
  console.error('Script error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
