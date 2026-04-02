const { chromium } = require('/Users/owen/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const CDP_URL = 'ws://127.0.0.1:50070/devtools/browser/448938d8-dda1-40cf-b11f-2c11fffe82ae';
const THING_ID = 't1_oaveyq9';
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
  
  // ===== TASK 1: Delete comment using modhash =====
  console.log('Task 1: Navigate to old Reddit to get modhash...');
  await page.goto('https://old.reddit.com/r/nocode/comments/1rvt02n/', { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  
  // Extract modhash from page config
  const modhash = await page.evaluate(() => {
    const configScript = document.querySelector('script#config');
    if (configScript) {
      const match = configScript.textContent.match(/"modhash":\s*"([^"]+)"/);
      return match ? match[1] : null;
    }
    // Try r.config
    try { return r.config.modhash; } catch(e) {}
    return null;
  });
  
  console.log('Modhash extracted:', modhash ? modhash.substring(0, 20) + '...' : 'NOT FOUND');
  
  if (!modhash) {
    console.error('No modhash found! Cannot delete.');
  } else {
    console.log(`Deleting comment ${THING_ID} with modhash...`);
    
    const deleteResult = await page.evaluate(async ({ thingId, uh }) => {
      const response = await fetch('https://www.reddit.com/api/del', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Modhash': uh,
        },
        body: `id=${thingId}&uh=${uh}&api_type=json`,
        credentials: 'include'
      });
      const text = await response.text();
      return { status: response.status, text: text.substring(0, 500) };
    }, { thingId: THING_ID, uh: modhash });
    
    console.log('Delete result:', JSON.stringify(deleteResult));
    
    // Also try via old reddit's direct form submission approach
    if (deleteResult.status !== 200 || deleteResult.text.includes('error')) {
      console.log('Trying alternative: old.reddit.com/api/del...');
      const deleteResult2 = await page.evaluate(async ({ thingId, uh }) => {
        const response = await fetch('https://old.reddit.com/api/del', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: `id=${thingId}&uh=${uh}&api_type=json`,
          credentials: 'include'
        });
        const text = await response.text();
        return { status: response.status, text: text.substring(0, 500) };
      }, { thingId: THING_ID, uh: modhash });
      console.log('Alt delete result:', JSON.stringify(deleteResult2));
    }
  }
  
  // Try UI approach: navigate to comment on new Reddit and find delete button
  console.log('\nTrying UI approach - navigate to comment permalink on new Reddit...');
  await page.goto('https://www.reddit.com/r/nocode/comments/1rvt02n/', { waitUntil: 'domcontentloaded' });
  await sleep(4000);
  
  // Look for the comment and the overflow menu
  const commentInfo = await page.evaluate(() => {
    const comments = document.querySelectorAll('shreddit-comment');
    const results = [];
    for (const c of comments) {
      results.push({
        author: c.getAttribute('author'),
        thingid: c.getAttribute('thingid'),
        id: c.id,
        depth: c.getAttribute('depth')
      });
    }
    return results;
  });
  console.log('Comments found:', JSON.stringify(commentInfo, null, 2));
  
  // Find the unjuvals comment and try to click overflow/delete
  const targetComment = commentInfo.find(c => c.author === 'unjuvals');
  if (targetComment) {
    console.log('Found target comment, looking for overflow menu...');
    
    // Try to find and click the overflow button on the specific comment
    const overflowSelector = `shreddit-comment[thingid="${targetComment.thingid}"] overflow-menu, shreddit-comment[thingid="${targetComment.thingid}"] [aria-label*="more"], shreddit-comment[thingid="${targetComment.thingid}"] button[aria-haspopup]`;
    
    try {
      await page.locator(`shreddit-comment[thingid="${targetComment.thingid}"]`).scrollIntoViewIfNeeded();
      await sleep(1000);
      
      const overflowBtn = await page.evaluate((thingid) => {
        const comment = document.querySelector(`shreddit-comment[thingid="${thingid}"]`);
        if (!comment) return 'no comment element';
        
        // Look for overflow menu button within shadow DOM or regular DOM
        const btns = comment.querySelectorAll('button, [role="button"]');
        const btnInfo = [];
        for (const btn of btns) {
          btnInfo.push({
            label: btn.getAttribute('aria-label'),
            text: btn.textContent?.trim()?.substring(0, 50),
            class: btn.className?.substring(0, 80)
          });
        }
        return btnInfo;
      }, targetComment.thingid);
      
      console.log('Buttons in comment:', JSON.stringify(overflowBtn, null, 2));
      
      // Take screenshot to see current state
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'comment-visible.png') });
      
      // Try hovering the comment to reveal action buttons
      await page.hover(`shreddit-comment[thingid="${targetComment.thingid}"]`);
      await sleep(1000);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'comment-hover.png') });
      
    } catch(e) {
      console.log('Hover error:', e.message);
    }
  }
  
  // ===== TASK 2: Profile settings =====
  console.log('\n===== TASK 2: Profile Settings =====');
  await page.goto('https://www.reddit.com/settings/privacy', { waitUntil: 'domcontentloaded' });
  await sleep(4000);
  
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'privacy-settings.png'), fullPage: true });
  
  const privacyText = await page.evaluate(() => document.body.innerText.substring(0, 5000));
  console.log('Privacy settings text:\n', privacyText);
  
  // Look for all interactive elements 
  const interactiveElements = await page.evaluate(() => {
    const elements = document.querySelectorAll('input[type="checkbox"], [role="switch"], button, faceplate-switch, shreddit-switch');
    return Array.from(elements).map(el => ({
      tag: el.tagName,
      type: el.getAttribute('type'),
      id: el.id,
      name: el.getAttribute('name'),
      label: el.getAttribute('aria-label'),
      checked: el.checked,
      ariaChecked: el.getAttribute('aria-checked'),
      text: el.closest('label')?.textContent?.trim()?.substring(0, 100) || el.textContent?.trim()?.substring(0, 80)
    })).filter(e => e.tag !== 'BUTTON' || e.label || e.text);
  });
  console.log('Interactive elements on privacy page:', JSON.stringify(interactiveElements, null, 2));
  
  // Also check the profile settings page
  await page.goto('https://www.reddit.com/settings/profile', { waitUntil: 'domcontentloaded' });
  await sleep(4000);
  
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'profile-settings.png'), fullPage: true });
  
  const profileSettingsText = await page.evaluate(() => document.body.innerText.substring(0, 5000));
  console.log('Profile settings text:\n', profileSettingsText);
  
  const profileInteractive = await page.evaluate(() => {
    const elements = document.querySelectorAll('input[type="checkbox"], [role="switch"], faceplate-switch, shreddit-switch, button[aria-checked]');
    return Array.from(elements).map(el => ({
      tag: el.tagName,
      type: el.getAttribute('type'),
      id: el.id,
      name: el.getAttribute('name'),
      label: el.getAttribute('aria-label'),
      checked: el.checked,
      ariaChecked: el.getAttribute('aria-checked'),
      value: el.value,
      text: el.closest('label')?.textContent?.trim()?.substring(0, 150) || 
            el.closest('div')?.textContent?.trim()?.substring(0, 150)
    }));
  });
  console.log('Profile settings interactive:', JSON.stringify(profileInteractive, null, 2));
  
  console.log('\nAll screenshots saved to:', SCREENSHOT_DIR);
  await browser.close();
})().catch(async (err) => {
  console.error('Script error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
