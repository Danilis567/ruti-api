import puppeteer from 'puppeteer';

(async () => {
  try {
    const browser = await puppeteer.launch({headless: 'new'});
    const page = await browser.newPage();
    
    // Log network requests to see API calls
    page.on('request', request => {
      if (request.url().includes('api') || request.url().includes('dataset')) {
        console.log('Request:', request.url());
      }
    });

    await page.goto('https://veri.kocaeli.bel.tr/datasets/09079315-1e63-42c5-8dc6-c7e4b2f96f40', {waitUntil: 'networkidle2'});
    
    const links = await page.evaluate(() => {
      const items = document.querySelectorAll('button, a');
      let results = [];
      items.forEach(el => {
        if (el.innerText && el.innerText.includes('İndir')) {
          results.push(el.href || el.getAttribute('onclick') || el.outerHTML);
        }
      });
      return results;
    });
    
    console.log('--- FOUND LINKS ---');
    console.log(links);
    await browser.close();
  } catch (err) {
    console.error(err);
  }
})();
