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
  
  console.log('Navigating to profile settings...');
  await page.goto('https://www.reddit.com/settings/profile', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(8000);
  
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'step1-before.png'), fullPage: false });
  
  // Step 1: Click the "Show all" dropdown button to expand the options
  console.log('Step 1: Click "Show all" dropdown to expand...');
  const step1 = await page.evaluate(() => {
    const visSection = document.querySelector('settings-profile-visibility-section');
    if (!visSection || !visSection.shadowRoot) return { error: 'no section' };
    
    const contentActivitySection = visSection.shadowRoot.querySelector('settings-profile-content-and-activity-section');
    if (!contentActivitySection || !contentActivitySection.shadowRoot) return { error: 'no content section' };
    
    // Find the dropdown toggle button (the "Show all" button with the caret)
    const dropdownBtn = contentActivitySection.shadowRoot.querySelector('button[data-testid="content-and-activity-toggle"]');
    if (!dropdownBtn) return { error: 'no dropdown button', html: contentActivitySection.shadowRoot.innerHTML.substring(0, 500) };
    
    dropdownBtn.click();
    return { clicked: true, btnText: dropdownBtn.textContent?.trim() };
  });
  
  console.log('Step 1 result:', JSON.stringify(step1));
  await sleep(1500);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'step2-dropdown-open.png'), fullPage: false });
  
  // Step 2: Now find and click "Hide all" option
  console.log('Step 2: Click "Hide all"...');
  const step2 = await page.evaluate(() => {
    const visSection = document.querySelector('settings-profile-visibility-section');
    if (!visSection || !visSection.shadowRoot) return { error: 'no section' };
    
    const contentActivitySection = visSection.shadowRoot.querySelector('settings-profile-content-and-activity-section');
    if (!contentActivitySection || !contentActivitySection.shadowRoot) return { error: 'no content section' };
    
    // Find all buttons in the dropdown
    const allButtons = contentActivitySection.shadowRoot.querySelectorAll('[role="button"], button');
    const btnInfo = Array.from(allButtons).map(btn => ({
      label: btn.getAttribute('aria-label'),
      text: btn.textContent?.replace(/\s+/g, ' ').trim().substring(0, 80),
      dataTestid: btn.getAttribute('data-testid'),
      visible: btn.offsetParent !== null
    }));
    
    // Find and click "Hide all"
    const hideAllBtn = Array.from(allButtons).find(btn => {
      const label = btn.getAttribute('aria-label') || '';
      const text = btn.textContent?.toLowerCase() || '';
      return label === 'Hide all' || text.includes('hide all');
    });
    
    if (hideAllBtn) {
      hideAllBtn.click();
      return { clicked: true, label: hideAllBtn.getAttribute('aria-label'), text: hideAllBtn.textContent?.trim() };
    }
    
    return { error: 'Hide all button not found', allButtons: btnInfo };
  });
  
  console.log('Step 2 result:', JSON.stringify(step2));
  await sleep(2000);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'step3-after-hide-all.png'), fullPage: false });
  
  // Verify the change was applied
  const verification = await page.evaluate(() => {
    const visSection = document.querySelector('settings-profile-visibility-section');
    if (!visSection || !visSection.shadowRoot) return { error: 'no section' };
    
    const contentActivitySection = visSection.shadowRoot.querySelector('settings-profile-content-and-activity-section');
    if (!contentActivitySection || !contentActivitySection.shadowRoot) return { error: 'no content section' };
    
    // Check the dropdown button text (should now show "Hide all")
    const dropdownBtn = contentActivitySection.shadowRoot.querySelector('button[data-testid="content-and-activity-toggle"]');
    const radioInputs = contentActivitySection.shadowRoot.querySelectorAll('faceplate-radio-input');
    
    return {
      dropdownText: dropdownBtn?.textContent?.replace(/\s+/g, ' ').trim().substring(0, 50),
      radios: Array.from(radioInputs).map(r => ({
        label: r.getAttribute('aria-label'),
        ariaChecked: r.getAttribute('aria-checked'),
        checked: r.checked
      }))
    };
  });
  
  console.log('Verification:', JSON.stringify(verification, null, 2));
  
  // Take final screenshot
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'final-profile-settings.png'), fullPage: false });
  
  console.log('\nDone! Checking if "Hide all" is selected...');
  if (verification.dropdownText?.toLowerCase().includes('hide all')) {
    console.log('SUCCESS: Profile set to "Hide all" - posts and comments are hidden from profile');
  } else {
    console.log('Status unclear, check screenshot: final-profile-settings.png');
  }
  
  await browser.close();
})().catch(async (err) => {
  console.error('Script error:', err.message);
  process.exit(1);
});
