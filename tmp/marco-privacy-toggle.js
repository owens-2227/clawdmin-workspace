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
  
  console.log('Navigating to privacy settings...');
  await page.goto('https://www.reddit.com/settings/privacy', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(8000);
  
  // Deep dive into the settings-privacy-section shadow DOM
  const shadowDetails = await page.evaluate(() => {
    function deepShadow(root, path = '', depth = 0) {
      if (depth > 10) return [];
      const results = [];
      
      const processRoot = (r, p) => {
        if (!r) return;
        const all = r.querySelectorAll('*');
        for (const el of all) {
          const text = el.textContent?.replace(/\s+/g, ' ').trim().substring(0, 100);
          const interactive = el.tagName.match(/^(INPUT|BUTTON|A|FACEPLATE-SWITCH|FACEPLATE-CHECKBOX)$/) ||
                              el.getAttribute('role') === 'switch' ||
                              el.getAttribute('role') === 'checkbox';
          
          if (interactive || (text && text.length > 5 && text.length < 200)) {
            results.push({
              path: `${p}>${el.tagName}`,
              id: el.id,
              name: el.getAttribute('name'),
              type: el.getAttribute('type'),
              checked: el.checked,
              ariaChecked: el.getAttribute('aria-checked'),
              ariaLabel: el.getAttribute('aria-label'),
              role: el.getAttribute('role'),
              text: text.substring(0, 100),
              interactive
            });
          }
          
          if (el.shadowRoot) {
            results.push(...deepShadow(el.shadowRoot, `${p}>${el.tagName}#${el.id}`, depth + 1));
          }
        }
      };
      
      processRoot(root, path);
      return results;
    }
    
    // Focus on the settings-privacy-section element
    const settingsSection = document.querySelector('settings-privacy-section');
    if (!settingsSection) return { error: 'No settings-privacy-section found', available: Array.from(document.querySelectorAll('*')).filter(el => el.tagName.includes('SETTING')).map(el => el.tagName) };
    
    return deepShadow(settingsSection.shadowRoot, 'settings-privacy-section', 0);
  });
  
  if (Array.isArray(shadowDetails)) {
    console.log(`Found ${shadowDetails.length} elements in shadow DOM`);
    shadowDetails.filter(el => el.interactive || el.text.toLowerCase().includes('active') || el.text.toLowerCase().includes('visible') || el.text.toLowerCase().includes('post') || el.text.toLowerCase().includes('show')).forEach(el => {
      console.log(`  ${el.path}: checked=${el.checked} ariaChecked=${el.ariaChecked} text="${el.text}"`);
    });
    
    // Also show all interactive elements
    console.log('\nAll interactive elements:');
    shadowDetails.filter(el => el.interactive).forEach(el => {
      console.log(`  ${el.path} type=${el.type} name=${el.name} id=${el.id} checked=${el.checked} ariaChecked=${el.ariaChecked} label="${el.ariaLabel}" text="${el.text}"`);
    });
  } else {
    console.log('Shadow details:', JSON.stringify(shadowDetails));
  }
  
  // Also check all settings-related custom elements
  const allSettings = await page.evaluate(() => {
    const settingsEls = document.querySelectorAll('settings-privacy-section, settings-profile-section, settings-account-section, [id*="privacy"]');
    return Array.from(settingsEls).map(el => ({
      tag: el.tagName,
      id: el.id,
      hasShadow: !!el.shadowRoot,
      innerHTML: el.innerHTML.substring(0, 300),
      shadowHTML: el.shadowRoot ? el.shadowRoot.innerHTML.substring(0, 2000) : null
    }));
  });
  
  console.log('\nSettings elements found:', allSettings.length);
  allSettings.forEach(el => {
    console.log(`\n${el.tag}#${el.id}:`);
    console.log('  innerHTML:', el.innerHTML.substring(0, 200));
    if (el.shadowHTML) console.log('  shadowHTML:', el.shadowHTML.substring(0, 500));
  });
  
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'privacy-deep.png'), fullPage: true });
  
  await browser.close();
})().catch(async (err) => {
  console.error('Script error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
