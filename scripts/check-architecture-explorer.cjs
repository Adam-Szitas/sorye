// Offline documentation QA. Run: node scripts/check-architecture-explorer.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { chromium } = require('@playwright/test');

const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'docs/SORYE-RODRIGO-EXPLORER.html');
const html = fs.readFileSync(filename, 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script, { filename });
const data = vm.runInNewContext(script.slice(0, script.indexOf('const views=')) + ';({nodes,edges,tours})');
const ids = [...data.nodes, ...data.edges].map(item => item.id);
assert.equal(new Set(ids).size, ids.length, 'Component and connection IDs must be unique');
const nodeIds = new Set(data.nodes.map(node => node.id));
for (const edge of data.edges) {
  assert(nodeIds.has(edge.from) && nodeIds.has(edge.to), `Unknown endpoint: ${edge.id}`);
  assert(edge.protocol && edge.payload && edge.failure, `Incomplete connection: ${edge.id}`);
}
for (const tour of data.tours) for (const [id] of tour.steps) assert(ids.includes(id), `Unknown journey target: ${id}`);
// Sibling Rodrigo checkout is optional for portable documentation QA.
let skippedSiblingLinks = 0;
const staticMarkup = html.slice(0, html.indexOf('<script>'));
const links = [...staticMarkup.matchAll(/href="([^"]+)"/g)].map(match => match[1]).filter(href => !href.startsWith('#'));
for (const source of new Set([...links, ...data.nodes.flatMap(node => node.sources)])) {
  if (source.startsWith('../../rodrigo/') && !fs.existsSync(path.resolve(root, '../rodrigo'))) { skippedSiblingLinks++; continue; }
  assert(fs.existsSync(path.resolve(path.dirname(filename), source)), `Missing source: ${source}`);
}
assert(!/<(?:script|link)[^>]+(?:src|href)="https?:/i.test(html), 'No remote assets');
assert(!/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/.test(script), 'No network/health probing');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const output = path.join(root, '.local/architecture-explorer-qa');
  fs.mkdirSync(output, { recursive: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1536, height: 1060 }, reducedMotion: 'reduce' });
    const errors = [];
    const network = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
    const url = pathToFileURL(filename).href;
    await page.goto(url);
    await page.waitForFunction(() => document.querySelectorAll('.wire').length > 0);
    assert.equal(await page.locator('h1').count(), 1);
    assert.equal(await page.locator('main').count(), 1);
    assert.equal(await page.locator('#inspector-title').textContent(), 'Sorye Hub');
    const contrast = await page.locator('#node-hub').evaluate(el => {
      const s=getComputedStyle(el),text=getComputedStyle(el.querySelector('strong'));
      function luminance(color){const rgb=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;}
      const a=luminance(s.backgroundColor),b=luminance(text.color);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    });
    assert(contrast>=4.5, `Selected component text contrast: ${contrast}`);
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: false });
    await page.locator('#explore').evaluate(el=>el.scrollIntoView());
    await page.screenshot({ path: path.join(output, 'desktop-map.png'), fullPage: false });
    // Every component has a reachable, meaningful inspector and visible map target.
    for (const node of data.nodes) {
      await page.evaluate(id => select(id), node.id);
      assert.equal(await page.locator('#inspector-title').textContent(), node.name);
      assert(await page.locator(`#node-${node.id}`).isVisible());
      assert((await page.locator('#detail').textContent()).includes(node.failure));
    }
    for (const edge of data.edges) {
      await page.evaluate(id => select(id), edge.id);
      assert.equal(await page.locator('#inspector-title').textContent(), edge.name);
      assert(await page.locator(`#node-${edge.from}`).isVisible());
      assert(await page.locator(`#node-${edge.to}`).isVisible());
    }
    // Real UI interactions, not only calls to the renderer.
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.getByRole('button', { name: 'Storage', exact: true }).click();
    await page.locator('#node-objects').click();
    assert.equal(await page.locator('#inspector-title').textContent(), 'S3-compatible bytes');
    await page.locator('[data-edge="default-bytes"]').click();
    assert.equal(await page.locator('#inspector-title').textContent(), 'Default binary content');
    await page.locator('#search').fill('nvidia');
    assert((await page.locator('#map-count').textContent()).includes('Search across'));
    await page.locator('#search').fill('zzzz-no-component');
    assert(await page.locator('#map-empty').isVisible());
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    assert.equal(await page.locator('#search').inputValue(), '');
    await page.locator('#profile').selectOption('sandbox');
    assert.equal(await page.locator('#node-model').count(), 0);
    await page.getByRole('button', { name: 'All components', exact: true }).click();
    const sandboxNames = await page.locator('.node').evaluateAll(items => items.map(item => item.dataset.node));
    assert(sandboxNames.every(id => data.nodes.find(node => node.id === id).sandbox));
    for (const tour of data.tours) {
      await page.locator(`[data-tour="${tour.id}"]`).click();
      for (let i = 0; i < tour.steps.length; i++) {
        assert.equal(await page.locator('#step-title').textContent(), tour.steps[i][1]);
        if (i < tour.steps.length - 1) await page.locator('#next-step').click();
      }
      assert(await page.locator('#next-step').isDisabled());
      assert((await page.locator('#tour-progress').textContent()).includes('Complete'));
      await page.locator('#stop-tour').click();
    }
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.locator('#node-rodrigo').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#inspector-title').textContent(), 'Rodrigo');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'node-rodrigo');
    const deepLink = page.url();
    await page.reload();
    assert.equal(await page.locator('#inspector-title').textContent(), 'Rodrigo');
    await page.locator('#node-postgres').click();
    await page.goBack();
    assert.equal(await page.locator('#inspector-title').textContent(), 'Rodrigo');
    await page.goForward();
    assert.equal(await page.locator('#inspector-title').textContent(), 'Rodrigo PostgreSQL');
    await page.goto(deepLink);
    assert.equal(await page.locator('#inspector-title').textContent(), 'Rodrigo');
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.getByRole('button', { name: 'Reset', exact: true }).click();
      const overflow = await page.evaluate(() => ({ width: innerWidth, actual: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('body *')].filter(el => { const r=el.getBoundingClientRect(); return r.right > innerWidth + 1 && !el.closest('.map-scroll,.table-scroll'); }).slice(0,8).map(el=>({tag:el.tagName,cls:el.className,id:el.id,width:el.getBoundingClientRect().width})) }));
      assert(overflow.actual <= width + 1, `Page overflows at ${width}px: ${JSON.stringify(overflow)}`);
      await page.locator('#node-hub').focus();
      await page.keyboard.press('Space');
      assert.equal(await page.locator('#inspector-title').textContent(), 'Sorye Hub');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, 'mobile-top.png'), fullPage: false });
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
    await page.locator('#explore').evaluate(el=>el.scrollIntoView());
    await page.screenshot({ path: path.join(output, 'mobile-map.png'), fullPage: false });
    await page.emulateMedia({ media: 'print' });
    assert(await page.locator('#print-reference').isVisible());
    assert.equal(await page.locator('#print-content > article').count(), ids.length);
    assert.equal(await page.locator('#print-journeys > article').count(), data.tours.length);
    await page.pdf({ path: path.join(output, 'reference.pdf'), format: 'A4', printBackground: true });
    const offline = await browser.newContext({ javaScriptEnabled: false });
    const staticPage = await offline.newPage();
    await staticPage.goto(url);
    assert(await staticPage.getByRole('heading', { name: 'Static architecture overview' }).isVisible());
    assert(await staticPage.getByRole('table').isVisible());
    await offline.close();
    assert.deepEqual(errors, [], 'Browser JavaScript errors');
    assert.deepEqual(network, [], 'External network requests');
    console.log(`PASS: ${data.nodes.length} components, ${data.edges.length} connections, ${data.tours.length} journeys; source links, UI controls, keyboard, history, mobile, print and no-JS/offline checks.`);
    if (skippedSiblingLinks) console.log(`Sibling Rodrigo checkout unavailable: ${skippedSiblingLinks} source links skipped.`);
    console.log(`Screenshots and PDF: ${output}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
