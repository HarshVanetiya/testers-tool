// Export formats: CSV, XLSX, JSON, Playwright and Selenium scripts.

import { zip } from './zip.js';
import { formatDate, formatDuration, envSummary, RESULTS, ACTION_LABELS, stepCounts } from '../shared/util.js';

const STEP_COLUMNS = ['Step', 'Type', 'Action', 'Expected Result', 'Actual Result', 'Status', 'Value', 'Element', 'CSS Selector', 'XPath', 'Page URL', 'Time'];

function stepRow(s) {
  const status = s.status ? { pass: 'Pass', fail: 'Fail', blocked: 'Blocked' }[s.status] : s.type === 'note' ? 'Note' : 'Done';
  const actual = s.type === 'bug' ? s.details || s.bugTitle || '' : s.actual || (s.type === 'checkpoint' && s.status === 'pass' ? 'As expected' : '');
  const value = typeof s.value === 'object' && s.value !== null ? JSON.stringify(s.value) : s.value ?? '';
  return [
    s.number,
    ACTION_LABELS[s.type] || s.type,
    s.description || '',
    s.expected || '',
    actual,
    status,
    String(value),
    s.label || '',
    s.selector || '',
    s.xpath || '',
    s.url || '',
    s.timestamp ? new Date(s.timestamp).toLocaleString() : '',
  ];
}

// ---------------------------------------------------------------- CSV

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rec) {
  const rows = [STEP_COLUMNS, ...rec.steps.map(stepRow)];
  // BOM so Excel opens UTF-8 correctly.
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- XLSX

function xmlEsc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // strip characters that are illegal in XML 1.0
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

function colName(i) {
  let s = '';
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

function sheetXml(rows, widths = [], headerRow = 0) {
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((v, c) => {
          const ref = `${colName(c)}${r + 1}`;
          const style = r === headerRow ? ' s="1"' : ' s="2"';
          if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
          return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  const freeze = headerRow === 0 ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}${cols}<sheetData>${body}</sheetData></worksheet>`;
}

export function toXlsx(rec) {
  const m = rec.meta || {};
  const c = stepCounts(rec);
  const summary = [
    ['Field', 'Value'],
    ['Project', m.project || ''],
    ['Test Case ID', m.testCaseId || ''],
    ['Title', m.title || rec.name],
    ['Module', m.module || ''],
    ['Tester', m.tester || ''],
    ['Build / Version', m.build || ''],
    ['Execution date', formatDate(rec.createdAt)],
    ['Duration', formatDuration(rec.duration)],
    ['Environment', envSummary(rec.environment)],
    ['Start URL', rec.startUrl || ''],
    ['Result', RESULTS[rec.result] || 'Not Run'],
    ['Steps', c.total],
    ['Passed', c.pass],
    ['Failed', c.fail],
    ['Blocked', c.blocked],
    ['Bugs', c.bugs],
    ['Console / network errors', c.errors],
    ['Preconditions', m.preconditions || ''],
    ['Test data', m.testData || ''],
  ];
  const steps = [STEP_COLUMNS, ...rec.steps.map(stepRow)];
  const stepNo = new Map(rec.steps.map((s) => [s.id, s.number]));
  const errors = [
    ['Time', 'Type', 'Method', 'Status', 'URL', 'Message', 'Step'],
    ...(rec.logs || []).map((l) => [
      new Date(l.timestamp).toLocaleString(),
      l.kind === 'network' ? 'Network' : 'Console',
      l.method || '',
      l.status ?? '',
      l.url || '',
      l.message || '',
      stepNo.get(l.stepId) ?? '',
    ]),
  ];

  const sheets = [
    ['Summary', sheetXml(summary, [26, 80])],
    ['Steps', sheetXml(steps, [6, 12, 60, 40, 40, 10, 24, 24, 36, 36, 40, 20])],
    ['Errors', sheetXml(errors, [20, 10, 8, 8, 60, 60, 6])],
  ];

  const files = [
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
</Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets.map(([name], i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/styles.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8E8F0"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`,
    },
    ...sheets.map(([, xml], i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: xml })),
  ];
  return zip(files);
}

// ---------------------------------------------------------------- Scripts

const jsStr = (s) => JSON.stringify(String(s ?? ''));
const pyStr = (s) => JSON.stringify(String(s ?? '')); // JSON strings are valid Python literals

function frameHint(step) {
  if (step.frame !== 'iframe' || !step.frameUrl) return null;
  try {
    const u = new URL(step.frameUrl);
    const file = u.pathname.split('/').filter(Boolean).pop() || u.host;
    return `iframe[src*=${JSON.stringify(file)}]`;
  } catch {
    return 'iframe';
  }
}

function commentLines(text, prefix) {
  return String(text || '')
    .split('\n')
    .map((l) => `${prefix} ${l}`.trimEnd());
}

export function toPlaywright(rec) {
  const lines = [];
  const ind = '  ';
  const scope = (s) => {
    const f = frameHint(s);
    return f ? `page.frameLocator(${jsStr(f)})` : 'page';
  };
  const loc = (s) => `${scope(s)}.locator(${jsStr(s.selector)})`;
  let first = true;

  for (const s of rec.steps) {
    lines.push(`${ind}// ${s.number}. ${s.description.replace(/\n/g, ' ')}`);
    switch (s.type) {
      case 'navigate':
        if (first) lines.push(`${ind}await page.goto(${jsStr(s.url)});`);
        else lines.push(`${ind}await page.waitForURL(${jsStr(s.url)});`);
        break;
      case 'reload':
        lines.push(`${ind}await page.reload();`);
        break;
      case 'click':
        if (s.selector) lines.push(`${ind}await ${loc(s)}.${s.button === 'right' ? "click({ button: 'right' })" : /^Double-click/.test(s.description) ? 'dblclick()' : 'click()'};`);
        break;
      case 'type':
        if (s.masked) lines.push(`${ind}await ${loc(s)}.fill(process.env.TEST_PASSWORD ?? ''); // value was masked`);
        else lines.push(`${ind}await ${loc(s)}.fill(${jsStr(s.value)});`);
        break;
      case 'select':
        lines.push(`${ind}await ${loc(s)}.selectOption(${jsStr(s.optionValue ?? s.value)});`);
        break;
      case 'check':
      case 'radio':
        lines.push(`${ind}await ${loc(s)}.check();`);
        break;
      case 'uncheck':
        lines.push(`${ind}await ${loc(s)}.uncheck();`);
        break;
      case 'upload':
        lines.push(`${ind}await ${loc(s)}.setInputFiles([/* ${s.value} */]);`);
        break;
      case 'keypress':
        if (s.selector) lines.push(`${ind}await ${loc(s)}.press(${jsStr(s.key)});`);
        else lines.push(`${ind}await page.keyboard.press(${jsStr(s.key)});`);
        break;
      case 'submit':
        if (s.selector) lines.push(`${ind}await ${loc(s)}.evaluate((form) => form.requestSubmit());`);
        break;
      case 'scroll':
        lines.push(`${ind}await page.evaluate(() => window.scrollTo(${s.value?.x || 0}, ${s.value?.y || 0}));`);
        break;
      case 'checkpoint':
        lines.push(...commentLines(`Expected: ${s.expected} [${s.status || 'not run'}]`, `${ind}//`));
        lines.push(`${ind}// TODO: add an assertion, e.g. await expect(page.getByText('...')).toBeVisible();`);
        break;
      case 'bug':
        lines.push(...commentLines(`BUG (${s.severity}): ${s.details || ''}`, `${ind}//`));
        break;
      case 'note':
      case 'manual':
      default:
        break;
    }
    lines.push('');
    first = false;
  }

  return `// Generated by TestTrail from recording "${rec.name}" (${formatDate(rec.createdAt)}).
// Selectors come from the recording; review them before adding this to a suite.
import { test, expect } from '@playwright/test';

test(${jsStr(rec.meta?.testCaseId ? `${rec.meta.testCaseId}: ${rec.meta.title || rec.name}` : rec.meta?.title || rec.name)}, async ({ page }) => {
${lines.join('\n').trimEnd()}
});
`;
}

export function toSelenium(rec) {
  const ind = '    ';
  const lines = [];
  let first = true;
  let inFrame = null;

  const enterScope = (s) => {
    const f = frameHint(s);
    if (f === inFrame) return;
    if (inFrame) lines.push(`${ind}driver.switch_to.default_content()`);
    if (f) lines.push(`${ind}driver.switch_to.frame(find(${pyStr(f)}))`);
    inFrame = f;
  };

  for (const s of rec.steps) {
    lines.push(`${ind}# ${s.number}. ${s.description.replace(/\n/g, ' ')}`);
    if (s.selector) enterScope(s);
    const el = `find(${pyStr(s.selector)})`;
    switch (s.type) {
      case 'navigate':
        if (first) lines.push(`${ind}driver.get(${pyStr(s.url)})`);
        else lines.push(`${ind}wait.until(EC.url_to_be(${pyStr(s.url)}))`);
        break;
      case 'reload':
        lines.push(`${ind}driver.refresh()`);
        break;
      case 'click':
        if (s.selector) lines.push(`${ind}${el}.click()`);
        break;
      case 'type':
        lines.push(`${ind}field = ${el}`, `${ind}field.clear()`);
        lines.push(s.masked ? `${ind}field.send_keys(os.environ.get("TEST_PASSWORD", ""))  # value was masked` : `${ind}field.send_keys(${pyStr(s.value)})`);
        break;
      case 'select':
        lines.push(`${ind}Select(${el}).select_by_value(${pyStr(s.optionValue ?? s.value)})`);
        break;
      case 'check':
      case 'radio':
        lines.push(`${ind}box = ${el}`, `${ind}if not box.is_selected():`, `${ind}    box.click()`);
        break;
      case 'uncheck':
        lines.push(`${ind}box = ${el}`, `${ind}if box.is_selected():`, `${ind}    box.click()`);
        break;
      case 'upload':
        lines.push(`${ind}${el}.send_keys("/path/to/${String(s.value || 'file').replace(/"/g, '')}")`);
        break;
      case 'keypress':
        if (s.selector) lines.push(`${ind}${el}.send_keys(Keys.${s.key === 'Enter' ? 'ENTER' : 'ESCAPE'})`);
        else lines.push(`${ind}webdriver.ActionChains(driver).send_keys(Keys.${s.key === 'Enter' ? 'ENTER' : 'ESCAPE'}).perform()`);
        break;
      case 'submit':
        if (s.selector) lines.push(`${ind}${el}.submit()`);
        break;
      case 'scroll':
        lines.push(`${ind}driver.execute_script("window.scrollTo(${s.value?.x || 0}, ${s.value?.y || 0})")`);
        break;
      case 'checkpoint':
        lines.push(...commentLines(`Expected: ${s.expected} [${s.status || 'not run'}]`, `${ind}#`));
        lines.push(`${ind}# TODO: assert the expected result`);
        break;
      case 'bug':
        lines.push(...commentLines(`BUG (${s.severity}): ${s.details || ''}`, `${ind}#`));
        break;
      default:
        break;
    }
    lines.push('');
    first = false;
  }

  return `# Generated by TestTrail from recording "${rec.name.replace(/"/g, "'")}" (${formatDate(rec.createdAt)}).
# Requires: pip install selenium
import os

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select, WebDriverWait

driver = webdriver.Chrome()
wait = WebDriverWait(driver, 10)


def find(css):
    return wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, css)))


try:
${lines.join('\n').trimEnd() || `${ind}pass`}
finally:
    driver.quit()
`;
}

// ---------------------------------------------------------------- download

export function download(filename, data, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
