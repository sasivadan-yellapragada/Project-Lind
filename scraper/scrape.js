const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  // Set a standard viewport
  await page.setViewport({ width: 1280, height: 800 });
  
  const url = 'https://lovable.dev/preview/ChaP7Cv3GFlCoBeh9ccV7oDS8xlCweX2';
  console.log(`Navigating to ${url}...`);
  
  await page.goto(url, { waitUntil: 'networkidle2' });
  
  // Give it an extra few seconds to load the iframe and react components
  await new Promise(r => setTimeout(r, 5000));
  
  // Capture a screenshot of the whole page
  await page.screenshot({ path: 'screenshot.png', fullPage: true });
  console.log('Saved screenshot.png');
  
  // Try to find the iframe which usually contains the preview
  const iframes = await page.$$('iframe');
  console.log(`Found ${iframes.length} iframes.`);
  
  let frame = page.mainFrame();
  if (iframes.length > 0) {
    console.log('Switching to the first iframe context...');
    frame = await iframes[0].contentFrame();
  }
  
  // Extract text and structure
  const content = await frame.evaluate(() => {
    // Collect all text from the body, keeping a little bit of structure
    function walk(node, depth = 0) {
      if (node.nodeType === Node.TEXT_NODE) {
        let text = node.textContent.trim();
        return text ? '  '.repeat(depth) + text : '';
      }
      
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      
      // Skip scripts and styles
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH'].includes(node.tagName)) return '';
      
      let tagInfo = node.tagName.toLowerCase();
      if (node.className && typeof node.className === 'string') {
        tagInfo += '.' + node.className.split(' ').join('.');
      }
      
      let res = [];
      res.push('  '.repeat(depth) + '<' + tagInfo + '>');
      
      for (let child of node.childNodes) {
        let childText = walk(child, depth + 1);
        if (childText) res.push(childText);
      }
      
      return res.join('\n');
    }
    
    return walk(document.body);
  });
  
  fs.writeFileSync('dom_structure.txt', content);
  console.log('Saved dom_structure.txt');
  
  // Also get the outer HTML of the body just in case
  const html = await frame.evaluate(() => document.body.innerHTML);
  fs.writeFileSync('body.html', html);
  console.log('Saved body.html');
  
  await browser.close();
})();
