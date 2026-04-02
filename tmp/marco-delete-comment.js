const { chromium } = require('/Users/owen/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const CDP_URL = 'ws://127.0.0.1:50070/devtools/browser/448938d8-dda1-40cf-b11f-2c11fffe82ae';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

(async () => {
  console.log('Connecting to browser via CDP...');
  const browser = await chromium.connectOverCDP(CDP_URL);
  
  const contexts = browser.contexts();
  const context = contexts[0] || await browser.newContext();
  const page = await context.newPage();
  
  // Task 1: Find and delete the comment
  console.log('Navigating to the post JSON to find comment...');
  await page.goto('https://www.reddit.com/r/nocode/comments/1rvt02n/.json', { waitUntil: 'load' });
  await sleep(2000);
  
  const jsonContent = await page.evaluate(() => document.body.innerText);
  console.log('Got JSON, searching for unjuvals comment...');
  
  let thingId = null;
  try {
    const data = JSON.parse(jsonContent);
    // data[1] contains comments
    const comments = data[1]?.data?.children || [];
    
    function findComment(children) {
      for (const child of children) {
        const d = child.data;
        if (!d) continue;
        if (d.author === 'unjuvals') {
          console.log(`Found comment by unjuvals: ${d.name} - "${d.body?.substring(0, 100)}"`);
          return d.name;
        }
        // Check replies
        if (d.replies && d.replies.data && d.replies.data.children) {
          const found = findComment(d.replies.data.children);
          if (found) return found;
        }
      }
      return null;
    }
    
    thingId = findComment(comments);
  } catch(e) {
    console.error('JSON parse error:', e.message);
  }
  
  if (!thingId) {
    console.log('Not found in JSON, trying the actual page...');
    await page.goto('https://www.reddit.com/r/nocode/comments/1rvt02n/', { waitUntil: 'domcontentloaded' });
    await sleep(3000);
    
    // Try to find comment in DOM
    thingId = await page.evaluate(() => {
      // Look for shreddit-comment elements with author unjuvals
      const comments = document.querySelectorAll('shreddit-comment');
      for (const comment of comments) {
        const author = comment.getAttribute('author');
        if (author === 'unjuvals') {
          return comment.getAttribute('thingid') || comment.getAttribute('thing-id') || comment.id;
        }
      }
      // Try data attributes
      const allElements = document.querySelectorAll('[data-fullname]');
      for (const el of allElements) {
        const parent = el.closest('[data-author="unjuvals"]');
        if (parent) {
          return parent.getAttribute('data-fullname');
        }
      }
      return null;
    });
  }
  
  if (!thingId) {
    console.log('Could not find comment. Checking user profile...');
    await page.goto('https://www.reddit.com/user/unjuvals/comments/', { waitUntil: 'domcontentloaded' });
    await sleep(3000);
    
    thingId = await page.evaluate(() => {
      const comments = document.querySelectorAll('shreddit-comment');
      for (const comment of comments) {
        const permalink = comment.getAttribute('permalink') || '';
        if (permalink.includes('1rvt02n')) {
          return comment.getAttribute('thingid') || comment.getAttribute('thing-id');
        }
      }
      // Try article elements
      const articles = document.querySelectorAll('[data-fullname^="t1_"]');
      for (const a of articles) {
        const link = a.querySelector('a[href*="1rvt02n"]');
        if (link) return a.getAttribute('data-fullname');
      }
      return null;
    });
    console.log('Found from profile:', thingId);
  }
  
  if (thingId) {
    console.log(`Found thing_id: ${thingId}`);
    
    // Navigate to reddit.com first so we're on the right origin for cookies
    await page.goto('https://www.reddit.com/r/nocode/comments/1rvt02n/', { waitUntil: 'domcontentloaded' });
    await sleep(2000);
    
    // Try delete via API from browser context (uses cookies)
    console.log('Attempting delete via Reddit API...');
    const result = await page.evaluate(async (id) => {
      // Try without CSRF first
      const r1 = await fetch('https://www.reddit.com/api/del', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `id=${id}`,
        credentials: 'include'
      });
      const text1 = await r1.text();
      
      if (r1.status === 200) {
        return { status: r1.status, text: text1, method: 'no-csrf' };
      }
      
      // Try with CSRF token
      const token = document.querySelector('input[name="csrf_token"]')?.value
        || document.cookie.match(/csrf_token=([^;]+)/)?.[1]
        || '';
      
      const r2 = await fetch('https://www.reddit.com/api/del', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `id=${id}&csrf_token=${token}`,
        credentials: 'include'
      });
      const text2 = await r2.text();
      return { status: r2.status, text: text2, method: 'with-csrf', token: token.substring(0, 20) };
    }, thingId);
    
    console.log('Delete result:', JSON.stringify(result));
    
    // Verify deletion
    await sleep(2000);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(2000);
    
    const commentStillExists = await page.evaluate(() => {
      const comments = document.querySelectorAll('shreddit-comment');
      for (const c of comments) {
        if (c.getAttribute('author') === 'unjuvals') return true;
      }
      return false;
    });
    
    console.log('Comment still exists after delete:', commentStillExists);
    
    // Screenshot
    const screenshotDir = '/Users/owen/.openclaw/workspace/tmp';
    await page.screenshot({ path: path.join(screenshotDir, 'after-delete.png'), fullPage: false });
    console.log('Screenshot saved: after-delete.png');
  } else {
    console.log('ERROR: Could not find comment thing_id');
  }
  
  // Task 2: Disable profile post visibility
  console.log('\nTask 2: Navigating to profile settings...');
  await page.goto('https://www.reddit.com/settings/profile', { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  
  const settingsScreenshot = '/Users/owen/.openclaw/workspace/tmp/settings-before.png';
  await page.screenshot({ path: settingsScreenshot, fullPage: true });
  console.log('Settings screenshot saved: settings-before.png');
  
  // Look for and disable "Show active communities" or "Posts visible on profile"
  const toggleResult = await page.evaluate(() => {
    // Common patterns for visibility toggles
    const labels = Array.from(document.querySelectorAll('label, [role="switch"], input[type="checkbox"]'));
    const results = [];
    
    for (const el of labels) {
      const text = el.textContent?.toLowerCase() || el.getAttribute('aria-label')?.toLowerCase() || '';
      if (text.includes('active communit') || text.includes('post') && text.includes('visible') || 
          text.includes('show post') || text.includes('content visibility') ||
          text.includes('profile visibility') || text.includes('show active')) {
        results.push({
          tag: el.tagName,
          text: el.textContent?.substring(0, 100),
          id: el.id,
          classes: el.className?.substring(0, 100)
        });
      }
    }
    
    // Also look at all toggle/switch elements
    const switches = Array.from(document.querySelectorAll('[data-testid*="toggle"], [data-testid*="switch"], faceplate-switch, shreddit-toggle'));
    switches.forEach(s => {
      results.push({
        tag: s.tagName,
        text: s.textContent?.substring(0, 100),
        'aria-label': s.getAttribute('aria-label'),
        'aria-checked': s.getAttribute('aria-checked'),
        id: s.id
      });
    });
    
    return results;
  });
  
  console.log('Toggle elements found:', JSON.stringify(toggleResult, null, 2));
  
  // Try to find and click the relevant toggle
  const disabled = await page.evaluate(() => {
    // Reddit new UI uses specific elements
    // Look for "Content visibility" or "Show up in search results" etc.
    const allText = document.body.innerHTML;
    
    // Find checkboxes/switches near relevant text
    const sections = document.querySelectorAll('section, div[data-testid]');
    const relevantSections = [];
    
    for (const section of sections) {
      const text = section.textContent?.toLowerCase() || '';
      if (text.includes('show active') || text.includes('active communit') || 
          text.includes('posts visible') || (text.includes('profile') && text.includes('visible'))) {
        relevantSections.push(section.textContent?.substring(0, 200));
      }
    }
    
    return { relevantSections: relevantSections.slice(0, 5) };
  });
  
  console.log('Relevant sections:', JSON.stringify(disabled, null, 2));
  
  // Try direct interaction - look for the toggle near "Show active communities"
  try {
    // Reddit's new UI often has faceplate-switch or similar
    const switched = await page.evaluate(() => {
      // Try all possible toggle selectors
      const selectors = [
        'input[name*="show_active"]',
        'input[name*="profile_opt_out"]', 
        '[data-testid*="show-active"]',
        'faceplate-switch',
        '[aria-label*="active communit"]',
        '[aria-label*="Show active"]'
      ];
      
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          return { found: sel, checked: el.checked, ariaChecked: el.getAttribute('aria-checked') };
        }
      }
      return { found: null };
    });
    console.log('Toggle check:', JSON.stringify(switched));
  } catch(e) {
    console.log('Toggle search error:', e.message);
  }
  
  // Scroll through settings looking for the right section
  await page.evaluate(() => window.scrollTo(0, 0));
  
  // Get all page text to understand what's there
  const pageText = await page.evaluate(() => document.body.innerText.substring(0, 3000));
  console.log('Settings page text (first 3000 chars):\n', pageText);
  
  // Try to find and disable the setting
  const settingToggled = await page.evaluate(() => {
    // Search for toggle buttons in the page
    const allButtons = document.querySelectorAll('button, input[type="checkbox"], [role="switch"]');
    const found = [];
    
    for (const btn of allButtons) {
      const nearbyText = btn.closest('div')?.textContent?.toLowerCase() || '';
      if (nearbyText.includes('active communit') || nearbyText.includes('show post') || 
          nearbyText.includes('content visib') || nearbyText.includes('posts visible')) {
        found.push({
          tag: btn.tagName,
          type: btn.type,
          checked: btn.checked,
          ariaChecked: btn.getAttribute('aria-checked'),
          text: btn.closest('div')?.textContent?.substring(0, 150),
          id: btn.id
        });
      }
    }
    return found;
  });
  
  console.log('Setting toggles found:', JSON.stringify(settingToggled, null, 2));
  
  await page.screenshot({ path: '/Users/owen/.openclaw/workspace/tmp/settings-page.png', fullPage: true });
  
  console.log('\nDone! Check screenshots in /Users/owen/.openclaw/workspace/tmp/');
  
  await browser.close();
})().catch(async (err) => {
  console.error('Script error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
