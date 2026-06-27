import puppeteer from 'puppeteer';

(async () => {
  try {
    const browser = await puppeteer.launch({headless: 'new'});
    const page = await browser.newPage();
    
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('api') && !url.includes('google')) {
        console.log('Response URL:', url);
        console.log('Status:', response.status());
        const headers = response.headers();
        if (headers['content-disposition'] || headers['content-type'].includes('excel') || headers['content-type'].includes('spreadsheet') || headers['content-type'].includes('application/octet-stream')) {
           console.log('>>> THIS IS A FILE DOWNLOAD! <<<');
        }
      }
    });

    page.on('request', request => {
      const url = request.url();
      if (url.includes('download') || url.includes('file') || url.includes('attachment')) {
        console.log('Request URL:', url);
      }
    });

    await page.goto('https://veri.kocaeli.bel.tr/datasets/09079315-1e63-42c5-8dc6-c7e4b2f96f40', {waitUntil: 'networkidle2'});
    
    // Click the first download button
    const buttons = await page.$$('button');
    for (let btn of buttons) {
      const text = await page.evaluate(el => el.innerText, btn);
      if (text && text.includes('İndir')) {
        console.log('Clicking download button...');
        await btn.click();
        await new Promise(r => setTimeout(r, 5000)); // wait for download to trigger
        break;
      }
    }
    
    await browser.close();
  } catch (err) {
    console.error(err);
  }
})();
