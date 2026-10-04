import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 2560, height: 1233 });
  await page.goto('http://localhost:5173');
  await page.waitForTimeout(1000);
  
  // type testing
  await page.type('input', 'Testing');
  await page.click('button');
  await page.waitForTimeout(1000);

  const heights = await page.evaluate(() => {
    return {
      window: window.innerHeight,
      body: document.body.clientHeight,
      workspace: document.querySelector('.workspace')?.clientHeight,
      chatPanel: document.querySelector('.chat-panel')?.clientHeight,
      previewPanel: document.querySelector('.preview-panel')?.clientHeight,
      workspaceCss: window.getComputedStyle(document.querySelector('.workspace') || document.body).height,
      chatCss: window.getComputedStyle(document.querySelector('.chat-panel') || document.body).height,
      workspaceFlex: window.getComputedStyle(document.querySelector('.workspace') || document.body).display
    };
  });
  
  console.log(JSON.stringify(heights, null, 2));
  await browser.close();
})();
