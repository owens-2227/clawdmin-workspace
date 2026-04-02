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
  
  // Get content from profile visibility and content sections
  const sections = await page.evaluate(() => {
    const results = {};
    
    ['settings-profile-visibility-section', 'settings-profile-content-and-activity-section'].forEach(selector => {
      const el = document.querySelector(selector);
      if (el && el.shadowRoot) {
        results[selector] = el.shadowRoot.innerHTML;
      } else {
        results[selector] = `NOT FOUND (found: ${document.querySelector(selector) ? 'yes no shadow' : 'no'})`;
      }
    });
    
    return results;
  });
  
  Object.entries(sections).forEach(([key, html]) => {
    console.log(`\n=== ${key} ===`);
    console.log(html.substring(0, 3000));
  });
  
  // Get all interactive elements from these sections
  const interactiveElements = await page.evaluate(() => {
    const results = [];
    
    ['settings-profile-visibility-section', 'settings-profile-content-and-activity-section'].forEach(selector => {
      const el = document.querySelector(selector);
      if (!el || !el.shadowRoot) {
        results.push({ selector, error: 'NOT FOUND' });
        return;
      }
      
      function getInteractive(root, depth=0) {
        if (depth > 8) return [];
        const r = [];
        const all = root.querySelectorAll('*');
        for (const node of all) {
          const isInteractive = ['FACEPLATE-SWITCH-INPUT', 'INPUT', 'BUTTON', 'FACEPLATE-CHECKBOX'].includes(node.tagName) ||
                                ['switch', 'checkbox'].includes(node.getAttribute('role'));
          if (isInteractive) {
            r.push({
              selector,
              tag: node.tagName,
              label: node.getAttribute('aria-label'),
              ariaChecked: node.getAttribute('aria-checked'),
              checked: node.checked,
              nearText: node.closest('label')?.textContent?.replace(/\s+/g, ' ').trim().substring(0, 200)
            });
          }
          if (node.shadowRoot) r.push(...getInteractive(node.shadowRoot, depth+1));
        }
        return r;
      }
      
      results.push(...getInteractive(el.shadowRoot));
    });
    
    return results;
  });
  
  console.log('\n=== Interactive Elements ===');
  console.log(JSON.stringify(interactiveElements, null, 2));
  
  // Now attempt to toggle "active communities" / posts visibility
  // Based on what we found, let's click the relevant switch
  const toggleResult = await page.evaluate(() => {
    const sections = ['settings-profile-visibility-section', 'settings-profile-content-and-activity-section'];
    const results = [];
    
    for (const selector of sections) {
      const el = document.querySelector(selector);
      if (!el || !el.shadowRoot) continue;
      
      // Find all faceplate-switch-input elements
      const switches = el.shadowRoot.querySelectorAll('faceplate-switch-input');
      for (const sw of switches) {
        const label = sw.getAttribute('aria-label') || '';
        const ariaChecked = sw.getAttribute('aria-checked');
        results.push({ selector, label, ariaChecked, checked: sw.checked });
      }
    }
    
    return results;
  });
  
  console.log('\n=== Toggle switches found ===');
  console.log(JSON.stringify(toggleResult, null, 2));
  
  // Take screenshot before any changes
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'profile-before-toggle.png'), fullPage: true });
  
  // Now try to click the switch for "active communities" or related setting
  // First, let's see what labels are available and if there's something to disable
  const activeCommunitiesToggle = await page.evaluate(() => {
    const sections = ['settings-profile-visibility-section', 'settings-profile-content-and-activity-section'];
    
    for (const selector of sections) {
      const el = document.querySelector(selector);
      if (!el || !el.shadowRoot) continue;
      
      const switches = el.shadowRoot.querySelectorAll('faceplate-switch-input');
      for (const sw of switches) {
        const label = sw.getAttribute('aria-label') || '';
        const text = label.toLowerCase();
        // Find any switch that relates to showing posts/activity
        if (text.includes('active') || text.includes('show') || text.includes('post') || text.includes('comment') || text.includes('communit') || text.includes('nsfw') || text.includes('mature')) {
          return { 
            selector, 
            label, 
            ariaChecked: sw.getAttribute('aria-checked'),
            checked: sw.checked,
            found: true
          };
        }
      }
    }
    return { found: false };
  });
  
  console.log('\nActive communities toggle:', JSON.stringify(activeCommunitiesToggle));
  
  await browser.close();
})().catch(async (err) => {
  console.error('Script error:', err.message);
  process.exit(1);
});
