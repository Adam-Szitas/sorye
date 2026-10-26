// Run with the OCR dev server on port 3011. All Hub requests are mocked.
const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
fs.mkdirSync('.data/ocr-ui', { recursive: true });
(async () => {
 const browser = await chromium.launch({channel:'msedge',headless:true});
 try {
  const page = await browser.newPage({viewport:{width:1440,height:1100},acceptDownloads:true});
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  const analysis={id:'ocr-ui-preview',workspaceId:'private',createdBy:'private',fileName:'Service invoice.pdf',model:'qwen3:8b',status:'ready',createdAt:'2026-10-25T12:00:00Z',error:null,
   pages:[{page:1,rows:['SERVICE INVOICE','Invoice number: INV-2026-042','Customer: Northwind Services','Description\tQuantity\tAmount','Inspection\t2\t216,00 EUR','Total due: 216,00 EUR']},{page:2,rows:['TECHNICAL NOTES','Pressure: 12  bar','x_y = 2 m²','FINAL-LINE-7391']}],
   lines:[],vector:{version:1,pageStarts:[0,6],lineCount:10,notes:[]},
   pattern:{documentKind:'Invoice',summary:'An inspection invoice for Northwind Services, with a total of EUR 216.00. Technical notes are included on the second page.',fields:{'Invoice number':'INV-2026-042',Customer:'Northwind Services','Total due':'216,00 EUR'},records:[{Description:'Inspection',Quantity:'2',Amount:'216,00 EUR'}],patterns:[],math:[],images:[]}};
  analysis.lines=analysis.pages.flatMap(p=>p.rows);
  await page.route('**/api/**', route=>{
   const url=route.request().url();
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(url.endsWith('/api/files')?{file:{id:'test-drive-file',displayName:'Service invoice.pdf',mime:'application/pdf',sourceAppId:'ocr'}}:url.endsWith('/api/ocr/analyze')?{analysis}:url.includes('/analyses/query')?{hits:[]}:{} )});
  });
  await page.goto('http://localhost:3011');
  await page.getByRole('button',{name:'Upload PDF',exact:true}).waitFor();
  await page.screenshot({path:'.data/ocr-ui/empty-desktop.png',fullPage:true});
  await page.locator('input[type=file]').setInputFiles(path.resolve('test-documents/sorye-ocr-qwen-test.pdf'));
  await page.getByRole('button',{name:'Analyze with Qwen',exact:true}).waitFor({timeout:60000});
  await page.getByRole('button',{name:'Analyze with Qwen',exact:true}).click();
  await page.getByRole('button',{name:'Show AI-aligned JSON',exact:true}).waitFor();
  const reading=page.locator('.ocr-reading');
  assert.equal(await reading.locator('.sorye-transcript-page').count(),2);
  assert.equal(await reading.getByText('FINAL-LINE-7391',{exact:true}).count(),1);
  await reading.scrollIntoViewIfNeeded();
  await page.screenshot({path:'.data/ocr-ui/reading-desktop.png',fullPage:true});
  const show=page.getByRole('button',{name:'Show AI-aligned JSON',exact:true});
  await show.focus(); await page.keyboard.press('Enter');
  const json=JSON.parse(await reading.locator('pre code').textContent());
  assert.deepEqual(json.transcript,analysis.pages);
  assert.equal('workspaceId' in json,false);
  assert.equal(JSON.stringify(json).includes('fontSize'),false);
  await reading.getByRole('button',{name:'Copy JSON',exact:true}).click();
  assert.deepEqual(JSON.parse(await page.evaluate(()=>navigator.clipboard.readText())),json);
  const downloadPromise=page.waitForEvent('download');
  await reading.getByRole('button',{name:'Download JSON',exact:true}).click();
  const download=await downloadPromise;
  assert.equal(download.suggestedFilename(),'Service invoice.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(await download.path(),'utf8')),json);
  await page.getByRole('button',{name:'Hide AI-aligned JSON',exact:true}).click();
  assert.equal(await reading.locator('pre').count(),0);
  await page.setViewportSize({width:390,height:844});
  await reading.scrollIntoViewIfNeeded();
  await page.screenshot({path:'.data/ocr-ui/reading-mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'mobile must not overflow horizontally');
  assert.deepEqual(errors,[]);
  console.log('PASS: upload, reading, complete transcript, keyboard disclosure, JSON download, mobile width; screenshots in .data/ocr-ui');
 } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
