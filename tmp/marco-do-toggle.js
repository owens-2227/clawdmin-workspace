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
  
  // Check profile settings shadow DOM
  console.log('Checking profile settings shadow DOM...');
  await page.goto('https://www.reddit.com/settings/profile', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(8000);
  
  const profileShadow = await page.evaluate(() => {
    // Find all custom elements with shadow roots
    function findShadowElements(root, path='', depth=0) {
      if (depth > 8) return [];
      const results = [];
      const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
      for (const el of all) {
        if (el.shadowRoot) {
          const text = el.shadowRoot.textContent?.replace(/\s+/g, ' ').trim();
          if (text && text.length > 10) {
            results.push({ tag: el.tagName, id: el.id, path: `${path}>${el.tagName}`, text: text.substring(0, 300) });
            results.push(...findShadowElements(el.shadowRoot, `${path}>${el.tagName}#${el.id}`, depth+1));
          }
        }
      }
      return results;
    }
    return findShadowElements(document.body);
  });
  
  const profileSettingEl = profileShadow.find(el => el.tag.includes('PROFILE') || el.tag.includes('SETTING'));
  console.log('Profile shadow elements:', profileShadow.map(el => `${el.tag}: ${el.text.substring(0, 80)}`).slice(0, 10));
  
  // Look for "settings-profile-section" specifically
  const profileSection = await page.evaluate(() => {
    const el = document.querySelector('settings-profile-section');
    if (!el) return { found: false, available: Array.from(document.querySelectorAll('[class*="setting"], [id*="setting"], settings-*')).map(e => e.tagName) };
    
    function getInteractive(root, depth=0) {
      if (depth > 6) return [];
      const results = [];
      if (!root) return results;
      const all = root.querySelectorAll('*');
      for (const el of all) {
        const isInteractive = el.tagName.match(/^(INPUT|BUTTON|FACEPLATE-SWITCH|FACEPLATE-CHECKBOX|FACEPLATE-SWITCH-INPUT)$/) ||
                              ['switch', 'checkbox'].includes(el.getAttribute('role'));
        const label = el.getAttribute('aria-label') || '';
        const nearText = el.closest('label')?.textContent?.replace(/\s+/g, ' ').trim().substring(0, 150) || '';
        
        if (isInteractive) {
          results.push({
            tag: el.tagName,
            label,
            nearText,
            checked: el.checked,
            ariaChecked: el.getAttribute('aria-checked')
          });
        }
        if (el.shadowRoot) {
          results.push(...getInteractive(el.shadowRoot, depth+1));
        }
      }
      return results;
    }
    
    return { found: true, interactive: getInteractive(el.shadowRoot) };
  });
  
  console.log('\nProfile section:', JSON.stringify(profileSection, null, 2));
  
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'profile-settings-check.png'), fullPage: true });
  
  // Now let's go back to privacy and look for "active communities" setting
  // which might be called differently - let me get ALL text from the privacy section
  console.log('\nGetting full privacy section text...');
  await page.goto('https://www.reddit.com/settings/privacy', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(8000);
  
  const fullPrivacyHTML = await page.evaluate(() => {
    const el = document.querySelector('settings-privacy-section');
    return el?.shadowRoot?.innerHTML || 'NOT FOUND';
  });
  
  console.log('Full privacy shadow HTML (first 5000 chars):');
  console.log(fullPrivacyHTML.substring(0, 5000));
  
  await browser.close();
})().catch(async (err) => {
  console.error('Script error:', err.message);
  process.exit(1);
});
