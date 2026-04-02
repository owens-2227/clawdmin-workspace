const { chromium } = require('/opt/homebrew/lib/node_modules/openclaw/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');

const CDP_URL = 'ws://127.0.0.1:49690/devtools/browser/ac0202e6-9fcc-4cea-b641-02c075d34ef2';
const SCREENSHOTS_DIR = '/Users/owen/.openclaw/workspace/BRAIN/published-content/marco-v/screenshots';
const LOG_PATH = '/Users/owen/.openclaw/workspace/BRAIN/published-content/marco-v/2026-03-16.md';

fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

async function screenshot(page, name) {
  const filePath = path.join(SCREENSHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: filePath });
  console.log(`📸 Screenshot: ${name}`);
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('🔌 Connecting...');
  const browser = await chromium.connectOverCDP(CDP_URL);
  const contexts = browser.contexts();
  let page;
  if (contexts.length > 0 && contexts[0].pages().length > 0) {
    page = contexts[0].pages()[0];
  } else if (contexts.length > 0) {
    page = await contexts[0].newPage();
  } else {
    const ctx = await browser.newContext();
    page = await ctx.newPage();
  }
  page.setDefaultTimeout(15000);

  const TARGET_POST = 'https://www.reddit.com/r/nocode/comments/1rvt02n/i_built_a_saas_that_solves_a_problem_so_obvious/';
  await page.goto(TARGET_POST, { waitUntil: 'domcontentloaded' });
  await sleep(4000);

  const postData = await page.evaluate(() => ({
    title: document.querySelector('h1')?.innerText?.trim() || '',
    url: window.location.href
  }));
  console.log('Post:', postData.title);

  const comment = `the "waiting for someone else to build it" phase is genuinely the hardest part to shake. i sat on my first make.com workflow idea for like 4 months convinced a real dev would do it better. turns out they just... weren't.`;

  // The "Join the conversation" box is visible but has 0 getBoundingClientRect 
  // because the comment-composer-host is at top=266, height=17 (collapsed container)
  // The actual rendered textarea is inside shadow DOM and painted differently
  
  // Use CDP to get the element's box model directly
  const client = await page.context().newCDPSession(page);
  
  // Get the document to find element via CDP
  const doc = await client.send('DOM.getDocument');
  
  // Find comment-composer-host
  const composerResult = await client.send('DOM.querySelector', {
    nodeId: doc.root.nodeId,
    selector: 'comment-composer-host'
  });
  console.log('comment-composer-host nodeId:', composerResult.nodeId);

  if (composerResult.nodeId) {
    const boxModel = await client.send('DOM.getBoxModel', { nodeId: composerResult.nodeId });
    console.log('Box model:', JSON.stringify(boxModel.model?.content));
  }

  // Find faceplate-textarea-input
  const faceplateResult = await client.send('DOM.querySelector', {
    nodeId: doc.root.nodeId,
    selector: 'faceplate-textarea-input'
  });
  console.log('faceplate nodeId:', faceplateResult.nodeId);

  if (faceplateResult.nodeId) {
    try {
      const boxModel = await client.send('DOM.getBoxModel', { nodeId: faceplateResult.nodeId });
      console.log('Faceplate box model content:', JSON.stringify(boxModel.model?.content));
      console.log('Faceplate box model border:', JSON.stringify(boxModel.model?.border));
    } catch (e) {
      console.log('Box model error:', e.message);
    }
    
    // Get resolved layout
    try {
      const layout = await client.send('DOM.getContentQuads', { nodeId: faceplateResult.nodeId });
      console.log('Faceplate quads:', JSON.stringify(layout.quads));
    } catch (e) {
      console.log('Content quads error:', e.message);
    }
  }

  // Try using Runtime.evaluate to get element position via getBoundingClientRect on shadow root internals
  const posResult = await client.send('Runtime.evaluate', {
    expression: `
      (() => {
        // Try multiple approaches to find the visible input
        
        // 1. comment-composer-host
        const host = document.querySelector('comment-composer-host');
        if (host) {
          const hostRect = host.getBoundingClientRect();
          console.log('host rect:', JSON.stringify(hostRect));
        }
        
        // 2. Walk shadow DOMs
        function findInShadow(root, selector) {
          const found = root.querySelector(selector);
          if (found) return found;
          const all = root.querySelectorAll('*');
          for (const el of all) {
            if (el.shadowRoot) {
              const res = findInShadow(el.shadowRoot, selector);
              if (res) return res;
            }
          }
          return null;
        }
        
        const textarea = findInShadow(document, 'textarea[placeholder="Join the conversation"]');
        if (textarea) {
          const r = textarea.getBoundingClientRect();
          return { found: 'textarea', rect: {t: r.top, l: r.left, w: r.width, h: r.height} };
        }
        
        // 3. Any contenteditable with "Join the conversation" placeholder
        const rte = findInShadow(document, 'div[aria-placeholder="Join the conversation"]');
        if (rte) {
          const r = rte.getBoundingClientRect();
          return { found: 'rte', rect: {t: r.top, l: r.left, w: r.width, h: r.height} };
        }
        
        // 4. Find shreddit-composer shadow
        const composer = document.querySelector('shreddit-composer');
        if (composer && composer.shadowRoot) {
          const inner = composer.shadowRoot.querySelector('faceplate-textarea-input, textarea, div[contenteditable]');
          if (inner) {
            const r = inner.getBoundingClientRect();
            return { found: 'composer-inner:' + inner.tagName, rect: {t: r.top, l: r.left, w: r.width, h: r.height} };
          }
        }
        
        return { found: 'none' };
      })()
    `,
    returnByValue: true
  });
  console.log('Shadow DOM search:', JSON.stringify(posResult.result.value));

  // Based on screenshot: "Join the conversation" box is visible at about y=267 in viewport
  // comment-composer-host is at top=266, width=540, left=296
  // Let's click at approximately center of where it should be
  
  // From screenshot analysis: the box appears to be around center-ish vertically
  // The comment-composer-host rect: top=266, left=296, width=540, height=17
  // But the visual box appears much taller... maybe the host collapses the inner composer
  
  // Let's try clicking at the position where we CAN see "Join the conversation" 
  // From the 03b-debug screenshot, it's approximately:
  // - horizontally centered in main content (around x=566 = 296 + 540/2)
  // - vertically around y=267-280
  
  console.log('\nClicking at comment-composer-host position...');
  await page.mouse.click(566, 275); // center of comment-composer-host
  await sleep(2000);
  await screenshot(page, '04-after-click-275');

  // Check if something expanded
  const afterClick = await page.evaluate(() => {
    const rte = document.querySelector('div[slot="rte"][contenteditable="true"]');
    if (rte) {
      const r = rte.getBoundingClientRect();
      return { rteRect: {t: r.top, l: r.left, w: r.width, h: r.height} };
    }
    const composer = document.querySelector('shreddit-composer');
    if (composer) {
      const r = composer.getBoundingClientRect();
      return { composerRect: {t: r.top, l: r.left, w: r.width, h: r.height} };
    }
    return { nothing: true };
  });
  console.log('After click state:', JSON.stringify(afterClick));

  // Try clicking the exact spot multiple times or try keyboard interaction
  // Reddit's comment box might need a direct click on the placeholder text
  
  // Let's use CDP Runtime to click using JavaScript event
  await client.send('Runtime.evaluate', {
    expression: `
      (() => {
        // Find and click comment-composer-host to expand it
        const host = document.querySelector('comment-composer-host');
        if (host) {
          // Dispatch click at center
          const rect = host.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          console.log('Clicking host at', x, y, 'rect:', JSON.stringify(rect));
          
          // Try dispatching pointer events
          host.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
          host.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
          host.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
          return 'clicked host';
        }
        return 'host not found';
      })()
    `,
    returnByValue: true
  });
  await sleep(1000);

  // Try scrolling the page to see what's there
  await page.evaluate(() => window.scrollTo(0, 300));
  await sleep(500);
  await screenshot(page, '05-scrolled-300');
  
  // Now check composer-host
  const composerInfo = await page.evaluate(() => {
    const host = document.querySelector('comment-composer-host');
    if (!host) return { found: false };
    const r = host.getBoundingClientRect();
    const htmlPreview = host.innerHTML.slice(0, 500);
    return {
      found: true,
      rect: { t: r.top, l: r.left, w: r.width, h: r.height },
      htmlPreview
    };
  });
  console.log('Composer host after scroll:', JSON.stringify(composerInfo).slice(0, 300));

  if (composerInfo.found && composerInfo.rect.w > 0) {
    const cx = composerInfo.rect.l + composerInfo.rect.w / 2;
    const cy = composerInfo.rect.t + Math.max(composerInfo.rect.h / 2, 20);
    console.log(`Clicking composer at (${cx}, ${cy})`);
    await page.mouse.click(cx, cy);
    await sleep(2000);
    await screenshot(page, '06-after-composer-click');

    // Check if shreddit-composer appeared
    const composerExpanded = await page.evaluate(() => {
      const composer = document.querySelector('shreddit-composer');
      if (!composer) return { found: false };
      const r = composer.getBoundingClientRect();
      return { found: true, rect: { t: r.top, l: r.left, w: r.width, h: r.height } };
    });
    console.log('shreddit-composer:', JSON.stringify(composerExpanded));

    if (composerExpanded.found && composerExpanded.rect.w > 0) {
      // Try clicking inside shreddit-composer
      const scx = composerExpanded.rect.l + composerExpanded.rect.w / 2;
      const scy = composerExpanded.rect.t + composerExpanded.rect.h / 2;
      await page.mouse.click(scx, scy);
      await sleep(1000);
    }
  }

  // Final attempt: just type and see if it goes into RTE
  await page.evaluate(() => {
    const rte = document.querySelector('div[slot="rte"][contenteditable="true"]');
    if (rte) {
      rte.focus();
      rte.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  });
  await sleep(500);
  await page.keyboard.type(comment, { delay: 20 });
  await sleep(1000);
  await screenshot(page, '07-after-type');

  const typedText = await page.evaluate(() => {
    return document.querySelector('div[slot="rte"][contenteditable="true"]')?.innerText?.trim() || '';
  });
  console.log('Typed text:', typedText.slice(0, 150));

  if (!typedText) {
    console.error('❌ Still no text entered. Need a different approach.');
    
    // Let's dump the full comment area HTML for debugging
    const htmlDump = await page.evaluate(() => {
      const host = document.querySelector('comment-composer-host');
      return host ? host.outerHTML.slice(0, 1000) : 'not found';
    });
    console.log('HTML dump:', htmlDump);
    
    fs.writeFileSync('/tmp/debug-html.txt', htmlDump);
    process.exit(1);
  }

  // Find and click submit button
  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button')).map(btn => {
      const rect = btn.getBoundingClientRect();
      return {
        text: btn.innerText.trim(),
        disabled: btn.disabled,
        ariaDisabled: btn.getAttribute('aria-disabled'),
        rect: { t: rect.top, l: rect.left, w: rect.width, h: rect.height }
      };
    }).filter(b => b.rect.w > 0 && b.text && b.rect.t > 0).slice(0, 30);
  });
  console.log('Buttons:', buttons.map(b => `"${b.text}" dis=${b.disabled}`).join(', '));

  const commentBtn = buttons.find(b => b.text.toLowerCase() === 'comment' && !b.disabled && b.ariaDisabled !== 'true');
  if (commentBtn) {
    await page.mouse.click(commentBtn.rect.l + commentBtn.rect.w / 2, commentBtn.rect.t + commentBtn.rect.h / 2);
    console.log('✅ Clicked Comment button');
  } else {
    await page.keyboard.press('Control+Enter');
    console.log('Used Ctrl+Enter');
  }

  await sleep(4000);
  await screenshot(page, '08-after-submit');

  const verification = await page.evaluate(() => {
    const els = document.querySelectorAll('shreddit-comment');
    const authors = Array.from(els).map(el => el.getAttribute('author')).filter(Boolean);
    return { found: authors.includes('unjuvals'), authors, count: els.length };
  });
  console.log('Verification:', JSON.stringify(verification));

  // Write log
  const timestamp = new Date().toISOString();
  const logContent = `# Marco V — Engagement Log — 2026-03-16

**Date:** 2026-03-16  
**Agent:** Marco V (u/unjuvals)  
**Status:** ${verification.found ? '✅ Comment confirmed' : '⚠️ Comment submitted, verification uncertain'}

---

## Engagement Entry

**Subreddit:** r/nocode  
**Post Title:** ${postData.title}  
**Post URL:** ${postData.url}  
**Timestamp:** ${timestamp}

### Comment Posted

\`\`\`
${comment}
\`\`\`

### Verification
- Author unjuvals found in DOM: ${verification.found}
- All authors: ${verification.authors.join(', ')}
- Total comments: ${verification.count}

### 10-Step Comment Process
1. Thread: Freelancer SaaS (MileStage), "waited 2 years", tried Zapier — builder sharing their story
2. 3 ideas: (A) Nocode stack practical, (B) Emotional "waiting" relatability, (C) Technical question
3. Ranked: B wins — emotional resonance, most original
4. Winner: Emotional + self-deprecating + make.com specificity
5. Gap: No one spoke to the "waiting" fear personally
6. Voice: lowercase, gen-z, specific tool mention, self-deprecating punchline ✓
7. Specificity: References "waiting for someone else to build it" from title ✓
8. Originality: Real perspective, not generic praise ✓
9. Risk: No medical topics ✓
10. Brevity: 2 sentences + punchline ✓

---
*Generated at ${timestamp}*
`;

  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.writeFileSync(LOG_PATH, logContent);
  console.log('✅ Log written to:', LOG_PATH);
  console.log('\n🎉 DONE');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  console.error(err.stack?.split('\n').slice(0, 5).join('\n'));
  process.exit(1);
});
