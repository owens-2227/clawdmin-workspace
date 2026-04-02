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
  
  // Deep-dive into the visibility section's shadow DOM to find the nested component
  const contentSection = await page.evaluate(() => {
    const visSection = document.querySelector('settings-profile-visibility-section');
    if (!visSection || !visSection.shadowRoot) return { error: 'No visibility section' };
    
    // Find the content-and-activity section inside the shadow DOM
    const contentActivityEl = visSection.shadowRoot.querySelector('settings-profile-content-and-activity-section');
    if (!contentActivityEl) return { 
      error: 'No content-activity section in shadow', 
      html: visSection.shadowRoot.innerHTML.substring(0, 1000)
    };
    
    if (!contentActivityEl.shadowRoot) return {
      error: 'No shadow root on content-activity',
      outerHTML: contentActivityEl.outerHTML.substring(0, 500)
    };
    
    return { 
      found: true,
      html: contentActivityEl.shadowRoot.innerHTML.substring(0, 3000)
    };
  });
  
  console.log('Content section:', JSON.stringify(contentSection, null, 2));
  
  // Now find all elements nested in the visibility section's shadow DOM
  const allNestedElements = await page.evaluate(() => {
    const visSection = document.querySelector('settings-profile-visibility-section');
    if (!visSection || !visSection.shadowRoot) return [];
    
    function getAll(root, depth = 0, path = '') {
      if (depth > 10) return [];
      const results = [];
      const all = root.querySelectorAll('*');
      for (const el of all) {
        const isInteresting = el.shadowRoot || 
                              ['FACEPLATE-SWITCH-INPUT', 'BUTTON', 'INPUT'].includes(el.tagName) ||
                              el.getAttribute('role') === 'switch';
        if (isInteresting) {
          const info = {
            tag: el.tagName,
            id: el.id,
            label: el.getAttribute('aria-label'),
            ariaChecked: el.getAttribute('aria-checked'),
            checked: el.checked,
            role: el.getAttribute('role'),
            path: `${path}>${el.tagName}`,
            text: (el.textContent || '').replace(/\s+/g, ' ').trim().substring(0, 100),
            hasShadow: !!el.shadowRoot
          };
          results.push(info);
          if (el.shadowRoot) {
            results.push(...getAll(el.shadowRoot, depth + 1, `${path}/${el.tagName}#${el.id}`));
          }
        }
      }
      return results;
    }
    
    return getAll(visSection.shadowRoot, 0, 'visibility-section');
  });
  
  console.log('\nAll nested elements in visibility section:');
  allNestedElements.forEach(el => {
    console.log(`  [${el.path}] ${el.tag} label="${el.label}" ariaChecked=${el.ariaChecked} checked=${el.checked} text="${el.text.substring(0, 80)}"`);
  });
  
  // Find and click the button near "Content and activity"
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'before-content-click.png'), fullPage: false });
  
  // Try clicking the "Show all" button / button near "Content and activity"
  const clickResult = await page.evaluate(() => {
    const visSection = document.querySelector('settings-profile-visibility-section');
    if (!visSection || !visSection.shadowRoot) return { error: 'no section' };
    
    // Find all buttons in the shadow DOM (including nested shadow DOMs)
    function findButtons(root, depth = 0) {
      if (depth > 10) return [];
      const results = [];
      const buttons = root.querySelectorAll('button, [role="button"]');
      for (const btn of buttons) {
        results.push({
          label: btn.getAttribute('aria-label'),
          text: btn.textContent?.replace(/\s+/g, ' ').trim().substring(0, 100),
          nearText: btn.closest('div')?.textContent?.replace(/\s+/g, ' ').trim().substring(0, 200)
        });
      }
      const all = root.querySelectorAll('*');
      for (const el of all) {
        if (el.shadowRoot) results.push(...findButtons(el.shadowRoot, depth + 1));
      }
      return results;
    }
    
    return findButtons(visSection.shadowRoot);
  });
  
  console.log('\nAll buttons in visibility section shadow DOM:');
  console.log(JSON.stringify(clickResult, null, 2));
  
  // Now actually click the content/activity visibility button
  // Use CDP to click into shadow DOM elements
  const clicked = await page.evaluate(() => {
    const visSection = document.querySelector('settings-profile-visibility-section');
    if (!visSection || !visSection.shadowRoot) return { error: 'no section' };
    
    // Find the button that opens the posts/comments visibility modal
    function findAndClickPostsVisibilityButton(root, depth = 0) {
      if (depth > 10) return null;
      
      const all = root.querySelectorAll('*');
      for (const el of all) {
        if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') {
          const nearText = el.closest('div, label')?.textContent?.replace(/\s+/g, ' ').trim() || '';
          const label = el.getAttribute('aria-label') || '';
          if (nearText.toLowerCase().includes('content and activity') || 
              nearText.toLowerCase().includes('posts, comments') ||
              label.toLowerCase().includes('post') ||
              label.toLowerCase().includes('content')) {
            el.click();
            return { clicked: true, label, nearText: nearText.substring(0, 150) };
          }
        }
        if (el.shadowRoot) {
          const result = findAndClickPostsVisibilityButton(el.shadowRoot, depth + 1);
          if (result) return result;
        }
      }
      return null;
    }
    
    return findAndClickPostsVisibilityButton(visSection.shadowRoot);
  });
  
  console.log('\nClick result:', JSON.stringify(clicked));
  await sleep(2000);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'after-content-click.png'), fullPage: false });
  
  // Check if a modal opened
  const modal = await page.evaluate(() => {
    // Check for modals
    const modals = document.querySelectorAll('[role="dialog"], [data-testid*="modal"], shreddit-dialog, rpl-dialog-sheet');
    return Array.from(modals).map(m => ({
      tag: m.tagName,
      role: m.getAttribute('role'),
      visible: m.offsetParent !== null || m.getAttribute('open') !== null,
      text: m.textContent?.replace(/\s+/g, ' ').trim().substring(0, 300)
    }));
  });
  
  console.log('\nModals found:', JSON.stringify(modal, null, 2));
  
  // Try to use the API directly to change the setting
  // Based on Reddit's API, the relevant preference is "profile_opt_out" or similar
  // Let's try via the preferences API
  const cookies = await context.cookies();
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  
  // First, get current preferences to understand what we're working with
  console.log('\nFetching current preferences via API...');
  const prefsResponse = await context.request.get('https://old.reddit.com/api/v1/me/prefs', {
    headers: {
      'Cookie': cookieStr,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    }
  });
  console.log('Prefs API status:', prefsResponse.status());
  if (prefsResponse.status() === 200) {
    const prefs = await prefsResponse.json();
    console.log('Current preferences (subset):');
    // Show keys that are boolean/relevant
    const relevantKeys = Object.entries(prefs).filter(([k, v]) => 
      k.includes('profile') || k.includes('opt_out') || k.includes('active') || k.includes('public') || k.includes('visible') || k.includes('show') || k.includes('post')
    );
    console.log(JSON.stringify(Object.fromEntries(relevantKeys), null, 2));
  }
  
  await browser.close();
})().catch(async (err) => {
  console.error('Script error:', err.message);
  process.exit(1);
});
