const { chromium } = require('/Users/owen/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const CDP_URL = 'ws://127.0.0.1:53362/devtools/browser/1650c4da-48cd-4c64-a6ac-e483638868a2';

const TITLE = 'TIFU by building an app that notifies me when my wife is on her period';

const BODY = `ok so let me explain before you judge me

my wife and i have been married 6 years. i love this woman. but i am also an idiot who has repeatedly walked into the kitchen at the worst possible time and said things like "hey should we invite your mom over this weekend" or "did you finish those leftovers" and then wondered why i'm sleeping on the couch

after the third month in a row where i accidentally started a fight over literally nothing, i had a thought. what if i just... knew? not in a creepy way. just like a heads up. a weather forecast but for my marriage

so i vibe coded a little wabi app in like 15 minutes. super simple. she opens it, taps a button when her period starts. i get a notification. the app shows me a little dashboard that says stuff like "maybe bring home flowers" or "do not suggest going to home depot today" or "she doesn't want solutions she wants you to listen"

i told her about it. framed it as "i want to be a better husband and i am too dumb to remember things." she laughed, called me an idiot, and actually started using it

here's where i fucked up

it worked. like really well. i started bringing her chocolate on day 1 without being asked. i'd handle bedtime with the kids solo. i stopped suggesting we "go for a run together" during the exact wrong week. she was genuinely impressed. told her friends "dave has been so thoughtful lately"

her friends wanted to know what changed

she told them about the app

their husbands now have it

i am now getting texts from my buddy mike at 11pm saying "bro the app just went off what do i do." my neighbor asked me if the flower recommendation was roses specifically or if carnations count (it's roses mike. always roses.)

there is now a group chat called "the notification boys" with 7 guys in it. someone asked if we could add a feature for "she just had a bad day at work" because and i quote "i need that heads up too"

last week my wife looked at me and said "i created a monster" and honestly she's right. i built an app to not be an oblivious husband and accidentally started a support group for emotionally clueless men

i regret nothing. except the group chat name. that was mike

TL;DR: built an app so my wife could tell me when she's on her period so i could be less of an idiot. worked too well, now half my neighborhood uses it, there's a group chat, and mike won't stop asking about flowers`;

const SNAPSHOTS_DIR = '/Users/owen/.openclaw/workspace/tmp/dave-r-tifu-snapshots';
const FINAL_SCREENSHOT = '/Users/owen/.openclaw/workspace/BRAIN/published-content/dave-r/tifu-post-2026-03-21.png';

fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
fs.mkdirSync(path.dirname(FINAL_SCREENSHOT), { recursive: true });

async function snapshot(page, name) {
  const p = path.join(SNAPSHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: p, fullPage: false });
  console.log(`[snapshot] ${p}`);
  return p;
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

(async () => {
  console.log('Connecting to browser via CDP...');
  const browser = await chromium.connectOverCDP(CDP_URL);

  // Get all contexts and pages
  const contexts = browser.contexts();
  console.log(`Found ${contexts.length} context(s)`);

  let page;

  for (const ctx of contexts) {
    const pages = ctx.pages();
    console.log(`Context has ${pages.length} page(s)`);
    for (let i = 1; i < pages.length; i++) {
      await pages[i].close();
      console.log(`Closed extra tab ${i}`);
    }
    if (pages.length > 0 && !page) {
      page = pages[0];
    }
  }

  if (!page) {
    const ctx = await browser.newContext();
    page = await ctx.newPage();
  }

  console.log('Navigating to r/tifu submit page...');
  await page.goto('https://www.reddit.com/r/tifu/submit', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3000);
  await snapshot(page, '01-submit-page-loaded');
  console.log('Current URL:', page.url());

  // --- Select "Text" post type if a selector is present ---
  try {
    // New shreddit UI uses buttons like "Text", "Link", "Image", etc.
    const textBtn = page.locator('button:has-text("Text")').first();
    if (await textBtn.isVisible({ timeout: 3000 })) {
      await textBtn.click();
      console.log('Clicked Text tab');
      await sleep(1500);
      await snapshot(page, '02-text-tab-selected');
    }
  } catch (e) {
    console.log('No explicit text tab:', e.message);
  }

  // --- Fill Title ---
  // Shreddit: textarea with name="title" or placeholder containing "Title"
  let titleFilled = false;
  const titleSelectors = [
    'textarea[placeholder*="Title"]',
    'textarea[name="title"]',
    'input[placeholder*="Title"]',
    'input[name="title"]',
    '#post-title-input',
  ];
  for (const sel of titleSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 })) {
        await el.click();
        await el.fill(TITLE);
        console.log(`Filled title with selector: ${sel}`);
        titleFilled = true;
        break;
      }
    } catch (_) {}
  }

  if (!titleFilled) {
    // Try any textarea that's visible near the top
    const textareas = page.locator('textarea');
    const count = await textareas.count();
    console.log(`Found ${count} textareas`);
    if (count > 0) {
      await textareas.first().click();
      await textareas.first().fill(TITLE);
      console.log('Filled first textarea as title');
      titleFilled = true;
    }
  }

  await sleep(500);
  await snapshot(page, '03-title-filled');

  // --- Fill Body ---
  // New Reddit: rich text editor uses a contenteditable div; 
  // may also have a "Switch to Markdown" option which gives a textarea
  
  // First, try switching to markdown mode
  let switchedToMarkdown = false;
  try {
    const mdBtn = page.locator('button:has-text("Markdown Mode"), button:has-text("Switch to markdown"), [aria-label="Markdown Mode"]').first();
    if (await mdBtn.isVisible({ timeout: 3000 })) {
      await mdBtn.click();
      console.log('Switched to Markdown mode');
      switchedToMarkdown = true;
      await sleep(1000);
    }
  } catch (e) {
    console.log('No markdown switch button:', e.message);
  }

  let bodyFilled = false;

  if (switchedToMarkdown) {
    // Now there should be a plain textarea
    try {
      const bodyTextarea = page.locator('textarea').nth(1); // second textarea (first is title)
      if (await bodyTextarea.isVisible({ timeout: 3000 })) {
        await bodyTextarea.click();
        await bodyTextarea.fill(BODY);
        console.log('Filled body in markdown textarea');
        bodyFilled = true;
      }
    } catch (e) {
      console.log('Markdown body textarea not found:', e.message);
    }
  }

  if (!bodyFilled) {
    // Try contenteditable
    try {
      const editors = page.locator('[contenteditable="true"]');
      const editorCount = await editors.count();
      console.log(`Found ${editorCount} contenteditable elements`);
      if (editorCount > 0) {
        // Use the last one (title field may also be contenteditable in some UIs)
        const editor = editors.last();
        await editor.click();
        await sleep(300);
        // Select all and type
        await editor.press('Control+a');
        await editor.press('Meta+a');
        await editor.type(BODY, { delay: 0 });
        console.log('Filled body via contenteditable');
        bodyFilled = true;
      }
    } catch (e) {
      console.log('contenteditable fill failed:', e.message);
    }
  }

  if (!bodyFilled) {
    // Try textarea selectors
    const bodySelectors = [
      'textarea[placeholder*="text"]',
      'textarea[placeholder*="body"]',
      'textarea[name="text"]',
      '#text-area',
    ];
    for (const sel of bodySelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 2000 })) {
          await el.click();
          await el.fill(BODY);
          console.log(`Filled body with selector: ${sel}`);
          bodyFilled = true;
          break;
        }
      } catch (_) {}
    }
  }

  await sleep(1000);
  await snapshot(page, '04-body-filled');
  await snapshot(page, '05-pre-submit');

  // --- Submit ---
  console.log('Looking for submit button...');
  let submitted = false;
  const submitSelectors = [
    'button[type="submit"]:has-text("Post")',
    'button:has-text("Post")',
    'button[type="submit"]',
    'input[type="submit"]',
  ];
  for (const sel of submitSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        console.log(`Clicking submit button: ${sel}`);
        await btn.click();
        submitted = true;
        break;
      }
    } catch (_) {}
  }

  if (!submitted) {
    console.log('WARNING: Could not find submit button!');
  }

  // Wait for navigation / confirmation
  await sleep(6000);
  await snapshot(page, '06-post-submit');

  const finalUrl = page.url();
  console.log('Final URL after submit:', finalUrl);

  // If we're on the post page, take the final screenshot
  if (finalUrl.includes('/comments/') || finalUrl.includes('/r/tifu')) {
    // Scroll to top to show the post
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);
    await page.screenshot({ path: FINAL_SCREENSHOT, fullPage: false });
    console.log(`[FINAL SCREENSHOT] Saved to: ${FINAL_SCREENSHOT}`);
  }

  await snapshot(page, '07-final');

  console.log('\n=== RESULT ===');
  console.log('Post URL:', finalUrl);
  console.log('Title filled:', titleFilled);
  console.log('Body filled:', bodyFilled);
  console.log('Submitted:', submitted);
  console.log('Final screenshot:', FINAL_SCREENSHOT);

  await browser.close();
})().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
