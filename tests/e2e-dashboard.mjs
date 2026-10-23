// Dashboard + report export checks; called from e2e.mjs after a recording exists.
import fs from 'node:fs';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runDashboardTests({ context, sw, extId, rec, OUT, check, dashboardOpened }) {
  console.log('\n2. Popup');
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 330, height: 460 });
  await popup.goto(`chrome-extension://${extId}/src/popup/popup.html`);
  await popup.waitForSelector('#idle:not([hidden])');
  check((await popup.locator('.recent a').count()) === 1, 'popup lists recent recording');
  await popup.screenshot({ path: path.join(OUT, '04-popup.png') });
  await popup.close();

  console.log('\n3. Dashboard');
  const auto = await dashboardOpened;
  check(!!auto && auto.url().includes(`#/recording/${rec.id}`), 'dashboard opens the recording after stop');
  const page = auto || (await context.newPage());
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.setViewportSize({ width: 1440, height: 1000 });

  // List view
  await page.goto(`chrome-extension://${extId}/src/dashboard/dashboard.html#/recordings`);
  await page.waitForSelector('#rows tr');
  check((await page.locator('#rows tr').count()) === 1, 'recordings table shows the run');
  check((await page.locator('.tile .value').nth(3).textContent()) === '1', 'bugs-found stat');
  await page.screenshot({ path: path.join(OUT, '05-dashboard-list.png') });
  await page.fill('#q', 'nomatch');
  check((await page.locator('#rows').textContent()).includes('No recordings match'), 'search filters list');
  await page.fill('#q', 'login');
  check((await page.locator('#rows tr[data-id]').count()) === 1, 'search matches by name');

  // Detail view
  await page.click('#rows tr[data-id]');
  await page.waitForSelector('#timeline .step');
  await sleep(400);
  const nSteps = await page.locator('#timeline .step').count();
  check(nSteps === rec.steps.length, `timeline shows ${nSteps} steps`);
  check((await page.locator('#timeline .thumb img').count()) > 10, 'timeline shows screenshots');
  await page.screenshot({ path: path.join(OUT, '06-dashboard-detail.png'), fullPage: false });

  // Edit a description, set metadata
  const desc = page.locator('#timeline .step').nth(1).locator('.desc');
  await desc.fill('Enter the email john@test.com');
  await page.fill('#m-testCaseId', 'TC-042');
  await page.fill('#m-build', '2.4.1');
  await page.fill('#m-preconditions', 'User account exists');
  await sleep(700);
  let stored = (await sw.evaluate((id) => chrome.storage.local.get(`rec:${id}`), rec.id))[`rec:${rec.id}`];
  check(stored.steps[1].description === 'Enter the email john@test.com', 'description edit saved');
  check(stored.meta.testCaseId === 'TC-042' && stored.meta.build === '2.4.1', 'metadata saved');

  // Insert manual step after step 1, then delete it
  await page.locator('#timeline .step').nth(0).locator('[data-act="insert"]').click();
  await page.keyboard.type('Verify the login page is shown');
  await sleep(600);
  stored = (await sw.evaluate((id) => chrome.storage.local.get(`rec:${id}`), rec.id))[`rec:${rec.id}`];
  check(stored.steps[1].type === 'manual' && stored.steps[1].description === 'Verify the login page is shown' && stored.steps[2].number === 3, 'manual step inserted + renumbered');

  // Drag step 3 above step 2
  const handle = page.locator('#timeline .step').nth(2).locator('.handle');
  await handle.dragTo(page.locator('#timeline .step').nth(1), { targetPosition: { x: 40, y: 5 } });
  await sleep(600);
  stored = (await sw.evaluate((id) => chrome.storage.local.get(`rec:${id}`), rec.id))[`rec:${rec.id}`];
  check(stored.steps[1].description === 'Enter the email john@test.com' && stored.steps[2].type === 'manual', 'drag & drop reorder saved');

  page.once('dialog', (d) => d.accept());
  await page.locator('#timeline .step').nth(2).locator('[data-act="delete"]').click();
  await sleep(600);
  stored = (await sw.evaluate((id) => chrome.storage.local.get(`rec:${id}`), rec.id))[`rec:${rec.id}`];
  check(stored.steps.length === rec.steps.length && stored.steps.every((s, i) => s.number === i + 1), 'step deleted + renumbered');

  // Result
  await page.click('.segmented button.blocked');
  await sleep(500);
  stored = (await sw.evaluate((id) => chrome.storage.local.get(`rec:${id}`), rec.id))[`rec:${rec.id}`];
  check(stored.result === 'blocked', 'overall result saved');
  await page.click('.segmented button.fail');
  await sleep(400);

  await page.locator('.step.t-note').scrollIntoViewIfNeeded();
  await page.locator('.step.t-note').locator('[data-act="details"]').click();
  await page.screenshot({ path: path.join(OUT, '06b-detail-annotations.png') });

  // Lightbox
  await page.locator('#timeline .thumb').first().click();
  check(await page.locator('#lightbox:not([hidden]) img').isVisible(), 'lightbox opens');
  await page.keyboard.press('Escape');

  // Steps to reproduce (clipboard)
  await page.evaluate(() => {
    navigator.clipboard.writeText = async (t) => void (window.__copied = t);
  });
  await page.click('button[data-menu]:has-text("Copy steps")');
  await page.click('[data-copy="plain"]');
  await sleep(200);
  const clip = await page.evaluate(() => window.__copied || '');
  fs.writeFileSync(path.join(OUT, 'steps-to-reproduce.txt'), clip);
  check(/Steps to Reproduce:\n1\. Navigate to/.test(clip) && /Expected Result:/.test(clip) && /Actual Result:\n- Recommendations fail to load/.test(clip), 'Steps to Reproduce text');

  // Exports from the detail view
  const grab = async (format) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), (async () => {
      await page.click('button[data-menu]:has-text("Export")');
      await page.click(`[data-export="${format}"]`);
    })()]);
    const file = path.join(OUT, dl.suggestedFilename());
    await dl.saveAs(file);
    return file;
  };
  const htmlFile = await grab('html');
  const html = fs.readFileSync(htmlFile, 'utf8');
  check(html.includes('data:image/jpeg;base64') && html.includes('TC-042') && html.includes('Recommendations fail to load'), 'HTML report is self-contained');
  const csv = fs.readFileSync(await grab('csv'), 'utf8');
  check(csv.startsWith('﻿Step,Type,Action') && csv.split('\r\n').length > rec.steps.length, 'CSV export');
  const xlsxFile = await grab('xlsx');
  check(fs.readFileSync(xlsxFile).subarray(0, 2).toString() === 'PK', 'XLSX export is a zip');
  const jsonFile = await grab('json');
  const json = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  check(json.format === 'testtrail' && Object.keys(json.screenshots).length > 10, 'JSON export with screenshots');
  const spec = fs.readFileSync(await grab('playwright'), 'utf8');
  check(spec.includes("await page.locator(\"#email\").fill(\"john@test.com\");") && spec.includes('frameLocator("iframe[src*=\\"frame.html\\"]")'), 'Playwright script');
  const py = fs.readFileSync(await grab('selenium'), 'utf8');
  check(py.includes('driver.get(') && py.includes('Select(find("#country")).select_by_value("in")'), 'Selenium script');

  // Report view
  await page.click('a:has-text("View report")');
  await page.waitForSelector('#report-frame');
  await sleep(800);
  const frame = page.frameLocator('#report-frame');
  check((await frame.locator('h1').textContent()).includes('TC-042'), 'report preview renders');
  check((await frame.locator('.badge').textContent()) === 'Fail', 'report shows result');
  await page.screenshot({ path: path.join(OUT, '07-report.png') });
  const reportPage = await context.newPage();
  await reportPage.setViewportSize({ width: 1200, height: 1400 });
  await reportPage.goto('file://' + htmlFile);
  await reportPage.screenshot({ path: path.join(OUT, '08-report-file.png'), fullPage: true });
  await reportPage.pdf?.({ path: path.join(OUT, 'report.pdf'), format: 'A4' }).catch(() => {});
  await reportPage.close();

  // Reports history
  await page.goto(`chrome-extension://${extId}/src/dashboard/dashboard.html#/reports`);
  await page.waitForSelector('tbody tr');
  check((await page.locator('tbody tr').count()) >= 6, 'export history listed');

  // Settings + import
  await page.goto(`chrome-extension://${extId}/src/dashboard/dashboard.html#/settings`);
  await page.waitForSelector('[data-setting="captureScroll"]');
  await page.click('.switch:has([data-setting="captureScroll"])');
  await page.fill('#s-tester', 'Asha QA');
  await sleep(800);
  const settings = (await sw.evaluate(() => chrome.storage.local.get('settings'))).settings;
  check(settings.captureScroll === true && settings.testerName === 'Asha QA', 'settings saved');
  await page.screenshot({ path: path.join(OUT, '09-settings.png') });

  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#import')]);
  await chooser.setFiles(jsonFile);
  await sleep(1200);
  const recCount = Object.keys(await sw.evaluate(() => chrome.storage.local.get(null))).filter((k) => k.startsWith('rec:')).length;
  check(recCount === 2, 'JSON import creates a copy');

  // Dark mode
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`chrome-extension://${extId}/src/dashboard/dashboard.html#/recordings`);
  await page.waitForSelector('#rows tr');
  await page.screenshot({ path: path.join(OUT, '10-dashboard-dark.png') });
  await page.goto(`chrome-extension://${extId}/src/dashboard/dashboard.html#/recording/${rec.id}`);
  await page.waitForSelector('#timeline .step');
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, '11-detail-dark.png') });

  // Narrow viewport
  await page.setViewportSize({ width: 390, height: 840 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(`chrome-extension://${extId}/src/dashboard/dashboard.html#/recordings`);
  await page.waitForSelector('#rows tr');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, 'no horizontal scroll at phone width');
  await page.screenshot({ path: path.join(OUT, '12-mobile.png') });

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
}
