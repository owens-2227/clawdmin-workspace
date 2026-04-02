const { chromium } = require('/Users/owen/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
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
  
  // ===== TASK 1: Delete comment =====
  // Navigate to old Reddit to get modhash (avoid new Reddit's complex JS)
  console.log('Getting modhash from old Reddit...');
  await page.goto('https://old.reddit.com/', { waitUntil: 'domcontentloaded' });
  await sleep(2000);
  
  const modhash = await page.evaluate(() => {
    try {
      // r.config is set on old Reddit pages
      return window.r?.config?.modhash || null;
    } catch(e) { return null; }
  });
  
  // Also grab cookies from the context
  const cookies = await context.cookies(['https://www.reddit.com', 'https://old.reddit.com']);
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  console.log('Cookies found:', cookies.map(c => c.name).join(', '));
  
  // Find reddit_session or session token
  const sessionCookie = cookies.find(c => c.name === 'reddit_session' || c.name === 'session' || c.name === 'token_v2');
  console.log('Session cookie:', sessionCookie?.name);
  console.log('Modhash:', modhash ? modhash.substring(0, 20) + '...' : 'NOT FOUND');
  
  if (!modhash) {
    console.log('Trying script tag extraction...');
    const modhashFromScript = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        const m = s.textContent.match(/"modhash":\s*"([a-f0-9]+)"/);
        if (m) return m[1];
      }
      return null;
    });
    console.log('Modhash from script:', modhashFromScript ? modhashFromScript.substring(0, 20) + '...' : 'NOT FOUND');
    
    if (modhashFromScript) {
      // Use context.request to avoid CORS
      console.log('Attempting delete via Playwright request API...');
      const response = await context.request.post('https://old.reddit.com/api/del', {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Referer': 'https://old.reddit.com/',
          'Cookie': cookieStr
        },
        data: `id=${THING_ID}&uh=${modhashFromScript}&api_type=json`
      });
      console.log('Delete response status:', response.status());
      const body = await response.text();
      console.log('Delete response body:', body.substring(0, 500));
    }
  } else {
    // Use context.request to avoid CORS
    console.log('Attempting delete via Playwright request API with modhash...');
    const response = await context.request.post('https://old.reddit.com/api/del', {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://old.reddit.com/',
        'Cookie': cookieStr
      },
      data: `id=${THING_ID}&uh=${modhash}&api_type=json`
    });
    console.log('Delete response status:', response.status());
    const body = await response.text();
    console.log('Delete response body:', body.substring(0, 500));
    
    if (response.status() === 200) {
      console.log('SUCCESS! Verifying deletion...');
      await sleep(2000);
      await page.goto('https://www.reddit.com/r/nocode/comments/1rvt02n/', { waitUntil: 'domcontentloaded' });
      await sleep(3000);
      
      const commentCheck = await page.evaluate(() => {
        const comments = document.querySelectorAll('shreddit-comment');
        for (const c of comments) {
          if (c.getAttribute('author') === 'unjuvals') return { found: true, id: c.getAttribute('thingid') };
        }
        return { found: false };
      });
      console.log('Comment after delete check:', JSON.stringify(commentCheck));
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'after-delete-v3.png') });
    }
  }
  
  // ===== TASK 2: Profile settings - disable post visibility =====
  console.log('\n===== TASK 2: Navigate to Privacy Settings =====');
  await page.goto('https://www.reddit.com/settings/privacy', { waitUntil: 'domcontentloaded' });
  await sleep(4000);
  
  const fullHTML = await page.evaluate(() => {
    // Get all elements with their shadow DOM expanded
    const results = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node;
    while (node = walker.nextNode()) {
      if (node.shadowRoot) {
        results.push(`SHADOW: ${node.tagName} id=${node.id} - ${node.shadowRoot.innerHTML.substring(0, 200)}`);
      }
    }
    return results;
  });
  
  console.log('Shadow DOM elements found:', fullHTML.length);
  fullHTML.slice(0, 5).forEach(s => console.log(s));
  
  // Get the full visible text
  const visibleText = await page.evaluate(() => {
    return document.body.innerText;
  });
  console.log('\nFull privacy settings text:');
  console.log(visibleText.substring(0, 8000));
  
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'privacy-full.png'), fullPage: true });
  
  // Try to interact with specific known Reddit privacy toggles
  // Look for "Show active communities" or similar using broader selector approach
  const allCheckboxes = await page.evaluate(() => {
    // Check for any form elements 
    const inputs = document.querySelectorAll('input');
    return Array.from(inputs).map(i => ({
      type: i.type,
      name: i.name,
      id: i.id,
      checked: i.checked,
      value: i.value
    }));
  });
  console.log('All inputs:', JSON.stringify(allCheckboxes, null, 2));
  
  // Navigate to profile page settings
  console.log('\nChecking profile settings page...');
  await page.goto('https://www.reddit.com/settings/profile', { waitUntil: 'domcontentloaded' });
  await sleep(4000);
  
  const profilePageHTML = await page.content();
  // Look for the specific setting  
  const showActiveCommunities = profilePageHTML.includes('active communit') || profilePageHTML.includes('Show active');
  console.log('Show active communities text found:', showActiveCommunities);
  
  // Extract all text
  const profileText = await page.evaluate(() => document.body.innerText);
  console.log('\nProfile settings full text:');
  console.log(profileText.substring(0, 8000));
  
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'profile-settings-full.png'), fullPage: true });
  
  // Look for any switches/toggles
  const allToggles = await page.evaluate(() => {
    const result = [];
    // Check for faceplate-switch (Reddit's web component)
    document.querySelectorAll('faceplate-switch, faceplate-checkbox').forEach(el => {
      result.push({
        tag: el.tagName,
        id: el.id,
        name: el.getAttribute('name'),
        checked: el.checked,
        ariaLabel: el.getAttribute('aria-label'),
        html: el.outerHTML.substring(0, 300)
      });
    });
    // Also look for data-cy attributes
    document.querySelectorAll('[data-cy]').forEach(el => {
      result.push({
        tag: el.tagName, 
        dataCy: el.getAttribute('data-cy'),
        text: el.textContent?.trim()?.substring(0, 100)
      });
    });
    return result;
  });
  console.log('Faceplate toggles & data-cy:', JSON.stringify(allToggles, null, 2));
  
  await browser.close();
})().catch(async (err) => {
  console.error('Script error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
