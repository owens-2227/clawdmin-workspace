const { chromium } = require('playwright-core');

const CDP_URL = 'ws://127.0.0.1:52784/devtools/browser/c4bfe9e5-fd1d-470b-bdd8-52dd3d841db7';

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const pages = context.pages();
  
  // Close extra tabs, keep one
  for (let i = 1; i < pages.length; i++) {
    await pages[i].close().catch(() => {});
  }
  const page = pages[0] || await context.newPage();
  
  // Navigate to a neutral page first
  await page.goto('about:blank');
  
  // Run automation detection checks
  const checks = await page.evaluate(() => {
    const results = {};
    
    // 1. navigator.webdriver
    results.webdriver = navigator.webdriver;
    
    // 2. HeadlessChrome in UA
    results.userAgent = navigator.userAgent;
    results.hasHeadlessInUA = navigator.userAgent.includes('HeadlessChrome');
    
    // 3. chrome.runtime exists
    results.chromeRuntime = typeof window.chrome !== 'undefined' && typeof window.chrome.runtime !== 'undefined';
    
    // 4. navigator.plugins length
    results.pluginsLength = navigator.plugins.length;
    
    // 5. navigator.languages
    results.languages = navigator.languages;
    
    // 6. window dimensions (zero = headless)
    results.outerWidth = window.outerWidth;
    results.outerHeight = window.outerHeight;
    results.innerWidth = window.innerWidth;
    results.innerHeight = window.innerHeight;
    
    // 7. Selenium artifacts
    results.selenium_cdc = !!document.$cdc_asdjflasutopfhvcZLmcfl_;
    results.selenium_window = !!window._selenium;
    results.selenium_callSelenium = !!window.callSelenium;
    results.selenium_calledSelenium = !!window._WEBDRIVER_ELEM_CACHE;
    
    // 8. navigator.connection.rtt (0 = automation)
    results.connectionRtt = navigator.connection ? navigator.connection.rtt : 'N/A';
    
    // 9. Permissions API check
    results.permissionsAvailable = typeof navigator.permissions !== 'undefined';
    
    // 10. WebGL vendor/renderer
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl');
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      results.webglVendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
      results.webglRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
    } catch (e) {
      results.webglError = e.message;
    }
    
    // 11. Screen properties
    results.screenWidth = screen.width;
    results.screenHeight = screen.height;
    results.colorDepth = screen.colorDepth;
    results.devicePixelRatio = window.devicePixelRatio;
    
    // 12. Automation-specific CDP artifacts
    results.cdc_check = Object.keys(document).filter(k => k.match(/cdc_|selenium|webdriver/i));
    
    return results;
  });
  
  console.log('\n=== AUTOMATION DETECTION CHECKS ===\n');
  
  // Flag issues
  const issues = [];
  
  if (checks.webdriver === true) issues.push('❌ navigator.webdriver = true (CRITICAL)');
  else console.log('✅ navigator.webdriver =', checks.webdriver);
  
  if (checks.hasHeadlessInUA) issues.push('❌ HeadlessChrome in User-Agent');
  else console.log('✅ No HeadlessChrome in UA');
  
  console.log('   UA:', checks.userAgent);
  
  if (!checks.chromeRuntime) issues.push('⚠️  chrome.runtime missing (suspicious)');
  else console.log('✅ chrome.runtime exists');
  
  if (checks.pluginsLength === 0) issues.push('❌ navigator.plugins is empty (bot signal)');
  else console.log('✅ navigator.plugins count:', checks.pluginsLength);
  
  console.log('✅ languages:', JSON.stringify(checks.languages));
  
  if (checks.outerWidth === 0 || checks.outerHeight === 0) issues.push('❌ Zero window dimensions (headless)');
  else console.log('✅ Window dimensions:', checks.outerWidth, 'x', checks.outerHeight);
  
  if (checks.selenium_cdc || checks.selenium_window || checks.selenium_callSelenium || checks.selenium_calledSelenium) {
    issues.push('❌ Selenium artifacts detected');
  } else {
    console.log('✅ No Selenium artifacts');
  }
  
  if (checks.connectionRtt === 0) issues.push('⚠️  connection.rtt = 0 (possible bot signal)');
  else console.log('✅ connection.rtt:', checks.connectionRtt);
  
  console.log('✅ WebGL vendor:', checks.webglVendor);
  console.log('✅ WebGL renderer:', checks.webglRenderer);
  console.log('✅ Screen:', checks.screenWidth, 'x', checks.screenHeight, '@ depth', checks.colorDepth, 'dpr', checks.devicePixelRatio);
  
  if (checks.cdc_check.length > 0) issues.push('❌ CDP artifacts in document: ' + checks.cdc_check.join(', '));
  else console.log('✅ No CDP artifacts in document keys');
  
  console.log('\n=== SUMMARY ===');
  if (issues.length === 0) {
    console.log('✅ ALL CHECKS PASSED — no automation leaks detected');
  } else {
    console.log(`⚠️  ${issues.length} ISSUE(S) FOUND:`);
    issues.forEach(i => console.log('  ', i));
  }
  
  // Don't close browser — we're keeping the session
  await browser.close(); // just disconnects CDP, doesn't close the browser
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
