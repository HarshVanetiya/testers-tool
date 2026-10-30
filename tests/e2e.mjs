// End-to-end test: loads the unpacked extension in Chromium, records a scenario
// on the fixture site, and checks the recording, screenshots, dashboard and
// report exports. Run: npm install && npm test   (screenshots land in tests/output)

import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'tests/fixtures');
const OUT = path.join(ROOT, 'tests/output');
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
function check(cond, label) {
  console.log(`${cond ? '  ✔' : '  ✘'} ${label}`);
  if (!cond) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- fixture server
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = path.join(FIXTURES, url.pathname === '/' ? 'index.html' : url.pathname);
  if (url.pathname === '/products') file = path.join(FIXTURES, 'index.html');
  if (!file.startsWith(FIXTURES) || !fs.existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not found');
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// ---------------------------------------------------------------- browser
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testtrail-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 800 },
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
});

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const extId = sw.url().split('/')[2];
  console.log('Extension id:', extId);

  // ------------------------------------------------------------ 1. recorder
  console.log('\n1. Recorder');
  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(8000);
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('Something broke') && !m.text().includes('404') && console.log('   [page]', m.text()));
  await page.goto(`${BASE}/index.html`);
  await page.waitForLoadState('load');
  await sleep(300);

  const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url: url + '/*' }))[0].id, BASE);
  const start = await sw.evaluate(
    ({ tabId }) => self.TestTrail.startRecording({ tabId, name: 'Login flow', testCaseId: 'TC-001' }),
    { tabId },
  );
  check(start.ok, 'recording starts');
  await page.waitForSelector('testtrail-toolbar', { state: 'attached' });
  check(true, 'toolbar injected');
  await sleep(700);

  await page.click('#email');
  await page.keyboard.type('john@test.com', { delay: 15 });
  await page.click('#pw');
  await page.keyboard.type('s3cret!', { delay: 15 });
  await page.check('[data-testid="remember"]');
  await page.selectOption('#country', 'in');
  await page.check('input[value="pro"]');
  await page.click('button[type="submit"]');
  await sleep(700);
  await page.click('#spa');
  await sleep(800);
  await page.click('[data-testid="broken"]');
  await sleep(800);
  await page.click('#search');
  await page.keyboard.type('blue shoes', { delay: 15 });
  await page.keyboard.press('Enter');
  await sleep(500);
  await page.frameLocator('iframe').locator('button').click();
  await sleep(600);

  // Toolbar annotations (shadow DOM is open, Playwright pierces it).
  await page.locator('testtrail-toolbar').locator('button[data-act="note"]').click();
  await page.locator('testtrail-toolbar').locator('#note').fill('Search results took ~3s to appear');
  await page.locator('testtrail-toolbar').locator('#save').click();
  await sleep(300);
  await page.locator('testtrail-toolbar').locator('button[data-act="checkpoint"]').click();
  await page.locator('testtrail-toolbar').locator('#exp').fill('Welcome message is shown after login');
  await page.locator('testtrail-toolbar').locator('button[data-status="pass"]').click();
  await sleep(700);
  await page.locator('testtrail-toolbar').locator('button[data-act="bug"]').click();
  await page.locator('testtrail-toolbar').locator('canvas').waitFor();
  const box = await page.locator('testtrail-toolbar').locator('canvas').boundingBox();
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 90, { steps: 8 });
  await page.mouse.up();
  await page.locator('testtrail-toolbar').locator('#bt').fill('Recommendations fail to load');
  await page.locator('testtrail-toolbar').locator('#sev').selectOption('High');
  await page.locator('testtrail-toolbar').locator('#bd').fill('Clicking "Load recommendations" returns 404.');
  await page.screenshot({ path: path.join(OUT, '01-bug-annotator.png') });
  await page.locator('testtrail-toolbar').locator('#save').click();
  await sleep(600);

  // Pause: actions while paused are not recorded.
  await page.locator('testtrail-toolbar').locator('button[data-act="pause"]').click();
  await sleep(300);
  await page.click('#email');
  await page.keyboard.type('ignored', { delay: 10 });
  await sleep(1300);
  await page.locator('testtrail-toolbar').locator('button[data-act="pause"]').click();
  await sleep(300);

  // Full page navigation + reload keep recording.
  await page.click('a[href="page2.html"]');
  await page.waitForLoadState('load');
  await page.waitForSelector('testtrail-toolbar', { state: 'attached' });
  await sleep(700);
  // Stop the service worker: the session must be restored from storage.
  await sw.evaluate(() => (self.__alive = true));
  const cdp = await context.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await sleep(800);
  await page.click('text=Continue');
  await sleep(900);
  sw = context.serviceWorkers().find((w) => w.url().includes('service-worker')) || (await context.waitForEvent('serviceworker'));
  check((await sw.evaluate(() => self.__alive)) === undefined, 'service worker was restarted');
  check((await sw.evaluate(() => chrome.storage.local.get('session'))).session.active, 'session survives service-worker restart');
  await page.reload();
  await page.waitForSelector('testtrail-toolbar', { state: 'attached' });
  await sleep(900);
  await page.screenshot({ path: path.join(OUT, '02-toolbar.png') });

  const dashboardOpened = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);
  await page.locator('testtrail-toolbar').locator('button[data-act="stop"]').click();
  await sleep(1500);
  check(!(await page.$('testtrail-toolbar')), 'toolbar removed after stop');

  const data = await sw.evaluate(() => chrome.storage.local.get(null));
  const rec = Object.entries(data).find(([k]) => k.startsWith('rec:'))[1];
  console.log('\n   Recorded steps:');
  for (const s of rec.steps) console.log(`   ${String(s.number).padStart(2)}. [${s.type}] ${s.description}${s.selector ? `   ‹${s.selector}›` : ''}`);
  console.log('   Logs:', rec.logs.map((l) => `${l.kind}:${l.status ?? ''} ${l.message.slice(0, 50)} → step ${rec.steps.find((s) => s.id === l.stepId)?.number}`));

  const desc = rec.steps.map((s) => s.description);
  const has = (re) => desc.some((d) => re.test(d));
  check(rec.status === 'completed', 'recording completed');
  check(data.session.active === false, 'session idle');
  check(has(/^Type 'john@test\.com' into 'Email' field$/), "typing step: Type 'john@test.com' into 'Email' field");
  check(has(/^Type '••••••' into 'Password' field$/), 'password masked');
  check(desc.filter((d) => /into 'Email' field/.test(d)).length === 1, 'one typing step per field (pause respected)');
  check(has(/^Check 'Remember me' checkbox$/), 'checkbox step');
  check(has(/^Select 'India' from 'Country' dropdown$/), 'dropdown step');
  check(has(/^Select 'Pro plan' radio button$/), 'radio step');
  check(has(/^Click on 'Login' button$/), 'click step');
  check(!has(/^Submit form/), 'submit deduped after click');
  check(has(/^Navigate to 'Products'/), 'SPA navigation step');
  check(has(/^Press Enter in 'Search products' field$/), 'Enter key step');
  check(has(/^Click on 'Accept cookies' button$/), 'iframe click step');
  check(has(/^Search results took/), 'note step');
  check(rec.steps.some((s) => s.type === 'checkpoint' && s.status === 'pass'), 'checkpoint step');
  check(rec.steps.some((s) => s.type === 'bug' && s.severity === 'High'), 'bug step');
  check(has(/^Page loaded: 'Page Two'/), 'full navigation step');
  check(has(/^Click on 'Continue' button$/), 'click after navigation');
  check(has(/^Reload page/), 'reload step');
  check(rec.logs.some((l) => l.kind === 'network' && l.status === 404), '404 captured');
  check(rec.logs.some((l) => l.kind === 'console' && /Something broke/.test(l.message)), 'console error captured');
  check(rec.environment?.browser && rec.environment?.screen, 'environment detected');
  check(rec.result === 'fail', 'result derived (bug ⇒ fail)');
  check(rec.steps.every((s, i) => s.number === i + 1), 'steps numbered');

  await sleep(1500); // let queued screenshots finish
  const shots = await sw.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('testtrail');
        req.onsuccess = () => {
          const all = req.result.transaction('screenshots').objectStore('screenshots').getAll();
          all.onsuccess = () => resolve(all.result.map((r) => ({ id: r.id, size: r.size, head: r.dataUrl.slice(0, 23) })));
        };
      }),
  );
  check(shots.length >= rec.steps.length - 3, `screenshots stored (${shots.length} for ${rec.steps.length} steps)`);
  check(shots.every((s) => s.head.startsWith('data:image/jpeg')), 'screenshots are JPEG data URLs');

  const shotForClick = rec.steps.find((s) => /^Click on 'Login' button$/.test(s.description));
  const img = await sw.evaluate(
    (id) =>
      new Promise((resolve) => {
        const req = indexedDB.open('testtrail');
        req.onsuccess = () => {
          const g = req.result.transaction('screenshots').objectStore('screenshots').get(id);
          g.onsuccess = () => resolve(g.result?.dataUrl || null);
        };
      }),
    shotForClick.id,
  );
  if (img) fs.writeFileSync(path.join(OUT, '03-step-screenshot.jpg'), Buffer.from(img.split(',')[1], 'base64'));
  check(!!img, 'click step has highlighted screenshot');

  const extra = process.env.E2E_EXTRA;
  if (extra !== '0' && fs.existsSync(path.join(ROOT, 'tests/e2e-dashboard.mjs'))) {
    const { runDashboardTests } = await import('./e2e-dashboard.mjs');
    await runDashboardTests({ context, sw, extId, rec, BASE, OUT, check, dashboardOpened });
  }
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await context.close();
  server.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
