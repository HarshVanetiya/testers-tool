import * as S from '../shared/storage.js';
import * as DB from '../shared/db.js';
import {
  uid,
  escapeHtml as e,
  formatDate,
  formatDuration,
  formatBytes,
  hostOf,
  slugify,
  displayStatus,
  statusLabel,
  deriveResult,
  stepCounts,
  renumber,
  elapsedOf,
  RESULTS,
  ACTION_LABELS,
  SEVERITIES,
} from '../shared/util.js';
import { buildReportHtml, buildStepsText } from './report.js';
import { toCsv, toXlsx, toPlaywright, toSelenium, download } from './exporters.js';
import { bucketByDay, renderResultsChart, legendHtml } from './chart.js';

const view = document.getElementById('view');
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let settings = S.DEFAULT_SETTINGS;
let session = { active: false };
let currentView = null; // { name, id, onStorage?, cleanup? }
const listFilter = { q: '', status: 'all', sort: 'newest' };

// =========================================================================
// Icons

const I = {
  back: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  report: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h8"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 19h16"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  grip: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  details: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3m0 0L8 7m4-4 4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
  sun: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  system: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  record: '<svg viewBox="0 0 64 64" class="big-icon"><circle cx="32" cy="32" r="30" fill="var(--accent-soft)"/><circle cx="32" cy="32" r="12" fill="var(--red)"/></svg>',
};

// =========================================================================
// Utilities

function toast(msg, ms = 2400) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}

function debounce(fn, ms) {
  let t;
  const d = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  d.flush = (...args) => {
    clearTimeout(t);
    fn(...args);
  };
  return d;
}

function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 2 + 'px';
}

function applyTheme() {
  const t = settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const label = { system: 'System theme', light: 'Light theme', dark: 'Dark theme' }[t] || 'System theme';
  $('#theme-toggle').innerHTML = `${I[t === 'light' ? 'sun' : t === 'dark' ? 'moon' : 'system']}<span>${label}</span>`;
}

async function copyText(text, what = 'Copied to clipboard') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(what);
}

function closeMenus(except) {
  $$('.menu').forEach((m) => m !== except && (m.hidden = true));
}

document.addEventListener('click', (ev) => {
  const trigger = ev.target.closest('[data-menu]');
  if (trigger) {
    const menu = trigger.parentElement.querySelector('.menu');
    closeMenus(menu);
    menu.hidden = !menu.hidden;
    ev.stopPropagation();
    return;
  }
  if (!ev.target.closest('.menu')) closeMenus();
});

function exportMenuHtml() {
  return `<div class="menu-wrap">
    <button class="btn" data-menu>${I.download} Export ${I.chevron}</button>
    <div class="menu" hidden>
      <button data-export="html">HTML report <small>.html</small></button>
      <button data-export="pdf">PDF <small>print</small></button>
      <button data-export="xlsx">Excel <small>.xlsx</small></button>
      <button data-export="csv">CSV <small>.csv</small></button>
      <button data-export="json">JSON (re-importable) <small>.json</small></button>
      <hr>
      <button data-export="playwright">Playwright test <small>.spec.ts</small></button>
      <button data-export="selenium">Selenium (Python) <small>.py</small></button>
    </div>
  </div>`;
}

function copyMenuHtml() {
  return `<div class="menu-wrap">
    <button class="btn" data-menu>${I.copy} Copy steps ${I.chevron}</button>
    <div class="menu" hidden>
      <button data-copy="plain">Steps to Reproduce <small>plain text</small></button>
      <button data-copy="jira">Steps to Reproduce <small>Jira markup</small></button>
    </div>
  </div>`;
}

// =========================================================================
// Export / print

async function exportRecording(rec, format, opts = {}) {
  const base = `${slugify(rec.meta?.testCaseId ? `${rec.meta.testCaseId}-${rec.name}` : rec.name)}`;
  const shots = await DB.getShotsForRecording(rec.id);
  switch (format) {
    case 'html':
      download(`${base}-report.html`, buildReportHtml(rec, shots, settings, opts), 'text/html');
      break;
    case 'pdf':
      printHtml(buildReportHtml(rec, shots, settings, opts));
      break;
    case 'xlsx':
      download(`${base}.xlsx`, toXlsx(rec), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      break;
    case 'csv':
      download(`${base}-steps.csv`, toCsv(rec), 'text/csv;charset=utf-8');
      break;
    case 'json':
      download(`${base}.testtrail.json`, JSON.stringify(await S.buildExport([rec]), null, 2), 'application/json');
      break;
    case 'playwright':
      download(`${base}.spec.ts`, toPlaywright(rec), 'text/plain');
      break;
    case 'selenium':
      download(`test_${base.replace(/-/g, '_')}.py`, toSelenium(rec), 'text/x-python');
      break;
    default:
      return;
  }
  await S.addReport({ id: uid(), recordingId: rec.id, recordingName: rec.name, format });
  if (format !== 'pdf') toast(`Exported ${format.toUpperCase()}`);
}

function printHtml(html) {
  const frame = $('#print-frame');
  frame.onload = () => {
    frame.onload = null;
    setTimeout(() => {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    }, 150);
  };
  frame.srcdoc = html;
  toast('Choose “Save as PDF” in the print dialog');
}

function wireExportButtons(root, getRec, getOpts = () => ({})) {
  root.addEventListener('click', async (ev) => {
    const ex = ev.target.closest('[data-export]');
    if (ex) {
      closeMenus();
      await exportRecording(getRec(), ex.dataset.export, getOpts());
      return;
    }
    const cp = ev.target.closest('[data-copy]');
    if (cp) {
      closeMenus();
      const rec = getRec();
      await copyText(buildStepsText(rec, cp.dataset.copy), cp.dataset.copy === 'jira' ? 'Copied Jira-formatted steps' : 'Copied Steps to Reproduce');
    }
  });
}

// =========================================================================
// Router

const routes = {
  recordings: viewRecordings,
  recording: viewRecording,
  reports: viewReports,
  report: viewReport,
  settings: viewSettings,
};

async function route() {
  const [, name = 'recordings', id] = (location.hash || '#/recordings').split('/');
  const fn = routes[name] || viewRecordings;
  currentView?.cleanup?.();
  currentView = { name, id };
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === name || (name === 'recording' && a.dataset.nav === 'recordings') || (name === 'report' && a.dataset.nav === 'reports')));
  closeLightbox();
  await fn(id);
  view.focus({ preventScroll: true });
}

window.addEventListener('hashchange', route);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.settings) {
    settings = { ...S.DEFAULT_SETTINGS, ...changes.settings.newValue };
    applyTheme();
  }
  if (changes.session) {
    session = changes.session.newValue || { active: false };
    renderLive();
  }
  currentView?.onStorage?.(changes);
});

function renderLive() {
  const live = $('#live');
  live.hidden = !session.active;
  if (session.active) {
    live.textContent = `${session.paused ? 'Paused' : 'Recording'} · ${session.name}`;
    live.href = `#/recording/${session.recordingId}`;
  }
}

// =========================================================================
// Recordings list

async function viewRecordings() {
  const recs = await S.listRecordings();
  const done = recs.filter((r) => displayStatus(r) !== 'inprogress');
  const decided = done.filter((r) => ['pass', 'fail', 'blocked'].includes(r.result));
  const passRate = decided.length ? Math.round((decided.filter((r) => r.result === 'pass').length / decided.length) * 100) : null;
  const failed = done.filter((r) => r.result === 'fail').length;
  const bugs = recs.reduce((n, r) => n + r.steps.filter((s) => s.type === 'bug').length, 0);

  view.innerHTML = `
    <div class="page-head">
      <div><h1>Recordings</h1><p>${recs.length} test run${recs.length === 1 ? '' : 's'} recorded</p></div>
      <div class="actions">
        <button class="btn" id="import-btn">${I.upload} Import</button>
      </div>
    </div>
    <section class="stats">
      <div class="card tile"><div class="label">Total runs</div><div class="value">${recs.length}</div><div class="sub">${done.length} completed</div></div>
      <div class="card tile"><div class="label">Pass rate</div><div class="value">${passRate == null ? '—' : passRate + '%'}</div><div class="sub">of ${decided.length} with a result</div></div>
      <div class="card tile"><div class="label">Failed tests</div><div class="value">${failed}</div><div class="sub">result = Fail</div></div>
      <div class="card tile"><div class="label">Bugs found</div><div class="value">${bugs}</div><div class="sub">across all runs</div></div>
      <div class="card chart-card">
        <div class="chart-head"><span class="label">Results, last 14 days</span>${legendHtml()}</div>
        <div id="chart"></div>
      </div>
    </section>
    ${
      recs.length
        ? `<div class="filters">
            <label class="search">${I.search}<input class="input" id="q" type="search" placeholder="Search name, test case ID, module or URL" value="${e(listFilter.q)}" aria-label="Search recordings"></label>
            <select class="input" id="status" aria-label="Filter by status">
              ${[['all', 'All statuses'], ['inprogress', 'In progress'], ['pass', 'Pass'], ['fail', 'Fail'], ['blocked', 'Blocked'], ['notrun', 'Not Run']]
                .map(([v, l]) => `<option value="${v}" ${listFilter.status === v ? 'selected' : ''}>${l}</option>`)
                .join('')}
            </select>
            <select class="input" id="sort" aria-label="Sort">
              ${[['newest', 'Newest first'], ['oldest', 'Oldest first'], ['name', 'Name A–Z'], ['steps', 'Most steps']]
                .map(([v, l]) => `<option value="${v}" ${listFilter.sort === v ? 'selected' : ''}>${l}</option>`)
                .join('')}
            </select>
          </div>
          <div class="card table-card"><table class="list">
            <thead><tr><th>Name</th><th class="hide-sm">Date</th><th>URL</th><th class="num">Steps</th><th class="num hide-sm">Bugs</th><th>Status</th><th></th></tr></thead>
            <tbody id="rows"></tbody>
          </table></div>`
        : `<div class="card empty">${I.record}<h3>No recordings yet</h3>
            <p>Record your first manual test:</p>
            <ol><li>Open the website you want to test.</li><li>Click the TestTrail icon in the toolbar and name the scenario.</li>
            <li>Press <b>Start recording</b> (or <span class="kbd">Alt</span>+<span class="kbd">Shift</span>+<span class="kbd">R</span>) and test as usual.</li>
            <li>Press <b>Stop</b> on the floating toolbar — the recording shows up here.</li></ol></div>`
    }`;

  const chartEl = $('#chart');
  const drawChart = () => renderResultsChart(chartEl, bucketByDay(recs, 14));
  drawChart();
  const ro = new ResizeObserver(debounce(drawChart, 100));
  ro.observe(chartEl);

  $('#import-btn').onclick = () => importFile();

  const rowsEl = $('#rows');
  const renderRows = () => {
    if (!rowsEl) return;
    const q = listFilter.q.trim().toLowerCase();
    let rows = recs.filter((r) => {
      if (listFilter.status !== 'all' && displayStatus(r) !== listFilter.status) return false;
      if (!q) return true;
      return [r.name, r.meta?.testCaseId, r.meta?.module, r.meta?.title, r.startUrl, r.meta?.tester].some((v) => (v || '').toLowerCase().includes(q));
    });
    if (listFilter.sort === 'oldest') rows = rows.reverse();
    if (listFilter.sort === 'name') rows = [...rows].sort((a, b) => a.name.localeCompare(b.name));
    if (listFilter.sort === 'steps') rows = [...rows].sort((a, b) => b.steps.length - a.steps.length);
    rowsEl.innerHTML = rows.length
      ? rows
          .map((r) => {
            const st = displayStatus(r);
            const bugCount = r.steps.filter((s) => s.type === 'bug').length;
            const sub = [r.meta?.testCaseId, r.meta?.module].filter(Boolean).join(' · ');
            return `<tr data-id="${e(r.id)}">
              <td><div class="nm">${e(r.name)}</div>${sub ? `<div class="sub">${e(sub)}</div>` : ''}</td>
              <td class="hide-sm" style="white-space:nowrap">${formatDate(r.createdAt)}</td>
              <td class="url" title="${e(r.startUrl)}">${e(hostOf(r.startUrl))}</td>
              <td class="num">${r.steps.length}</td>
              <td class="num hide-sm">${bugCount || '—'}</td>
              <td><span class="pill ${st}">${statusLabel(st)}</span></td>
              <td class="row-actions">
                <a class="btn sm ghost" href="#/report/${e(r.id)}" title="View report">${I.report}</a>
                <button class="btn sm ghost icon" data-del="${e(r.id)}" title="Delete" aria-label="Delete recording" ${st === 'inprogress' ? 'disabled' : ''}>${I.trash}</button>
              </td>
            </tr>`;
          })
          .join('')
      : `<tr><td colspan="7" class="muted" style="text-align:center;padding:28px">No recordings match these filters.</td></tr>`;
  };
  renderRows();

  if (rowsEl) {
    $('#q').addEventListener('input', (ev) => {
      listFilter.q = ev.target.value;
      renderRows();
    });
    $('#status').addEventListener('change', (ev) => {
      listFilter.status = ev.target.value;
      renderRows();
    });
    $('#sort').addEventListener('change', (ev) => {
      listFilter.sort = ev.target.value;
      renderRows();
    });
    rowsEl.addEventListener('click', async (ev) => {
      const del = ev.target.closest('[data-del]');
      if (del) {
        ev.stopPropagation();
        const rec = recs.find((r) => r.id === del.dataset.del);
        if (!confirm(`Delete “${rec.name}” and its screenshots? This cannot be undone.`)) return;
        await S.deleteRecording(rec.id);
        toast('Recording deleted');
        return route();
      }
      if (ev.target.closest('a')) return;
      const tr = ev.target.closest('tr[data-id]');
      if (tr) location.hash = `#/recording/${tr.dataset.id}`;
    });
  }

  currentView.cleanup = () => ro.disconnect();
  currentView.onStorage = debounce((changes) => {
    if (Object.keys(changes).some((k) => S.isRecKey(k))) route();
  }, 400);
}

// =========================================================================
// Recording detail

async function viewRecording(id) {
  let rec = await S.getRecording(id);
  if (!rec) {
    view.innerHTML = `<a class="back" href="#/recordings">${I.back} Recordings</a><div class="card empty"><h3>Recording not found</h3><p>It may have been deleted.</p></div>`;
    return;
  }
  let shots = await DB.getShotsForRecording(id);
  const expanded = new Set();
  let lastSaved = 0;

  const isLive = () => rec.status === 'recording' || rec.status === 'paused';

  const save = debounce(async () => {
    renumber(rec.steps);
    await S.saveRecording(rec);
    lastSaved = rec.updatedAt;
  }, 350);

  function render() {
    const st = displayStatus(rec);
    view.innerHTML = `
      <a class="back" href="#/recordings">${I.back} Recordings</a>
      <div class="page-head">
        <div style="flex:1;min-width:260px">
          <input class="title-input" id="rec-name" value="${e(rec.name)}" aria-label="Recording name" ${isLive() ? 'readonly' : ''}>
          <div class="head-meta">
            <span class="pill ${st}" id="head-pill">${statusLabel(st)}</span>
            <span>${formatDate(rec.createdAt)}</span><span>·</span>
            <span title="${e(rec.startUrl)}">${e(hostOf(rec.startUrl))}</span><span>·</span>
            <span id="head-count">${rec.steps.length} steps</span>
          </div>
        </div>
        <div class="actions">
          ${copyMenuHtml()}
          ${exportMenuHtml()}
          <a class="btn primary" href="#/report/${e(rec.id)}">${I.report} View report</a>
          <button class="btn danger icon" id="delete-rec" title="Delete recording" aria-label="Delete recording" ${isLive() ? 'disabled' : ''}>${I.trash}</button>
        </div>
      </div>
      ${
        isLive()
          ? `<div class="banner"><span class="pill inprogress">${rec.status === 'paused' ? 'Paused' : 'Recording'}</span>
             This recording is still in progress — steps appear here live. Editing unlocks when you stop recording.
             <button class="btn sm" id="stop-now" style="margin-left:auto">Stop recording</button></div>`
          : ''
      }
      <div class="detail">
        <div>
          <ol class="timeline ${isLive() ? 'readonly' : ''}" id="timeline"></ol>
          ${isLive() ? '' : `<button class="btn add-step" id="add-step">${I.plus} Add manual step</button>`}
        </div>
        <aside class="panel" id="panel"></aside>
      </div>`;
    renderTimeline();
    renderPanel();
    wire();
  }

  // ---------------------------------------------------------------- timeline
  function stepHtml(s) {
    const shot = shots.get(s.id);
    const logs = (rec.logs || []).filter((l) => l.stepId === s.id);
    const offset = s.timestamp && rec.createdAt ? `+${formatDuration(s.timestamp - rec.createdAt)}` : '';
    const ro = isLive() ? 'readonly' : '';
    const showFields = ['checkpoint', 'bug'].includes(s.type) || expanded.has(s.id);
    const statusSelect = `<select class="input" data-field="status" ${isLive() ? 'disabled' : ''} aria-label="Step status">
        ${[['', '—'], ['pass', 'Pass'], ['fail', 'Fail'], ['blocked', 'Blocked']].map(([v, l]) => `<option value="${v}" ${s.status === v || (!s.status && !v) ? 'selected' : ''}>${l}</option>`).join('')}
      </select>`;
    let fields = '';
    if (showFields && s.type === 'bug') {
      fields = `<div class="fields bug">
        <div><label>Details</label><textarea class="input" rows="2" data-field="details" ${ro}>${e(s.details || '')}</textarea></div>
        <div><label>Severity</label><select class="input" data-field="severity" ${isLive() ? 'disabled' : ''}>${SEVERITIES.map((v) => `<option ${s.severity === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      </div>`;
    } else if (showFields && s.type !== 'note') {
      fields = `<div class="fields">
        <div><label>Expected result</label><input class="input" data-field="expected" value="${e(s.expected || '')}" ${ro}></div>
        <div><label>Actual result</label><input class="input" data-field="actual" value="${e(s.actual || '')}" ${ro}></div>
        <div><label>Status</label>${statusSelect}</div>
      </div>`;
    }
    const tech =
      expanded.has(s.id) && (s.selector || s.xpath || s.url)
        ? `<div class="tech">
            ${s.selector ? `<div><span>CSS</span> ${e(s.selector)}</div>` : ''}
            ${s.xpath ? `<div><span>XPath</span> ${e(s.xpath)}</div>` : ''}
            ${s.value !== undefined && s.value !== '' ? `<div><span>Value</span> ${e(typeof s.value === 'object' ? JSON.stringify(s.value) : s.value)}</div>` : ''}
            ${s.url ? `<div><span>Page</span> ${e(s.title ? `${s.title} — ` : '')}${e(s.url)}</div>` : ''}
            ${s.frame === 'iframe' ? `<div><span>Frame</span> ${e(s.frameUrl || 'iframe')}</div>` : ''}
          </div>`
        : '';
    const logsHtml = logs.length
      ? `<div class="logs" ${expanded.has(s.id) ? '' : 'hidden'} data-logs>${logs
          .map((l) => `<div><b>${l.kind === 'network' ? `${e(l.method)} ${l.status || 'failed'}` : 'Console'}</b> ${e(l.kind === 'network' ? l.url : l.message)}</div>`)
          .join('')}</div>`
      : '';
    return `<li class="step t-${e(s.type)}" data-id="${e(s.id)}">
      <div class="handle" title="Drag to reorder" draggable="${isLive() ? 'false' : 'true'}">${I.grip}</div>
      <div class="n">${s.number}</div>
      <div class="step-body">
        <div class="step-top">
          <span class="tag ${e(s.type)}">${e(ACTION_LABELS[s.type] || s.type)}</span>
          ${s.type === 'bug' ? `<span class="pill fail">${e(s.severity || 'Medium')}</span>` : ''}
          ${s.type === 'checkpoint' && s.status ? `<span class="pill ${e(s.status)}">${e(RESULTS[s.status])}</span>` : ''}
          <span>${offset}</span>
          ${s.url ? `<span class="url" title="${e(s.url)}">${e(hostOf(s.url) + (safePath(s.url) || ''))}</span>` : ''}
          ${logs.length ? `<button class="err-badge" data-act="logs">${logs.length} error${logs.length === 1 ? '' : 's'}</button>` : ''}
        </div>
        <textarea class="desc" rows="1" data-field="description" aria-label="Step description" ${ro}>${e(s.description)}</textarea>
        ${fields}${tech}${logsHtml}
      </div>
      <div class="step-side">
        ${shot ? `<button class="thumb" data-act="zoom" aria-label="Open screenshot of step ${s.number}"><img src="${shot}" alt="" loading="lazy"></button>` : ''}
        <div class="step-tools">
          <button class="btn ghost icon sm" data-act="details" title="Details: expected/actual result, selectors" aria-label="Toggle details">${I.details}</button>
          ${
            isLive()
              ? ''
              : `<button class="btn ghost icon sm" data-act="insert" title="Insert step below" aria-label="Insert step below">${I.plus}</button>
                 <button class="btn ghost icon sm" data-act="delete" title="Delete step" aria-label="Delete step">${I.trash}</button>`
          }
        </div>
      </div>
    </li>`;
  }

  function safePath(url) {
    try {
      const u = new URL(url);
      return u.pathname === '/' ? '' : u.pathname;
    } catch {
      return '';
    }
  }

  function renderTimeline() {
    const tl = $('#timeline');
    tl.innerHTML = rec.steps.length ? rec.steps.map(stepHtml).join('') : '<li class="card empty">No steps.</li>';
    $$('.desc', tl).forEach(autosize);
    $('#head-count') && ($('#head-count').textContent = `${rec.steps.length} steps`);
  }

  function rerenderStep(stepId) {
    const li = $(`.step[data-id="${CSS.escape(stepId)}"]`);
    const s = rec.steps.find((x) => x.id === stepId);
    if (!li || !s) return;
    li.outerHTML = stepHtml(s);
    $$(`.step[data-id="${CSS.escape(stepId)}"] .desc`).forEach(autosize);
  }

  // ---------------------------------------------------------------- side panel
  function renderPanel() {
    const m = rec.meta || (rec.meta = {});
    const env = rec.environment || (rec.environment = {});
    const c = stepCounts(rec);
    const suggested = deriveResult(rec);
    const ro = isLive() ? 'readonly' : '';
    const metaField = (key, label, full = false, area = false) =>
      `<div class="field ${full ? 'full' : ''}"><label for="m-${key}">${label}</label>${
        area
          ? `<textarea class="input" id="m-${key}" data-meta="${key}" rows="2" ${ro}>${e(m[key] || '')}</textarea>`
          : `<input class="input" id="m-${key}" data-meta="${key}" value="${e(m[key] || '')}" ${ro}>`
      }</div>`;
    const envField = (key, label) =>
      `<div class="field"><label for="env-${key}">${label}</label><input class="input" id="env-${key}" data-env="${key}" value="${e(env[key] || '')}" ${ro}></div>`;

    $('#panel').innerHTML = `
      <div class="card card-pad">
        <h3>Overall result</h3>
        <div class="segmented" role="radiogroup" aria-label="Overall result">
          ${Object.entries(RESULTS)
            .map(([k, l]) => `<button class="${k} ${rec.result === k ? 'on' : ''}" data-result="${k}" role="radio" aria-checked="${rec.result === k}" ${isLive() ? 'disabled' : ''}>${l}</button>`)
            .join('')}
        </div>
        ${
          suggested !== rec.result && !isLive()
            ? `<div class="suggest">Suggested from checkpoints &amp; bugs: <b>${RESULTS[suggested]}</b> · <button data-result="${suggested}">Apply</button></div>`
            : ''
        }
      </div>
      <div class="card card-pad">
        <h3>Summary</h3>
        <dl class="kv">
          <dt>Duration</dt><dd>${formatDuration(isLive() && session.active ? elapsedOf(session) : rec.duration)}</dd>
          <dt>Steps</dt><dd>${c.total}</dd>
          <dt>Checkpoints</dt><dd>${c.checkpoints}</dd>
          <dt>Pass / fail / blocked</dt><dd>${c.pass} / ${c.fail} / ${c.blocked}</dd>
          <dt>Bugs</dt><dd>${c.bugs}</dd>
          <dt>Console / network errors</dt><dd>${c.errors}</dd>
          <dt>Screenshots</dt><dd>${shots.size}</dd>
        </dl>
      </div>
      <div class="card card-pad">
        <h3>Test details</h3>
        <div class="form-grid">
          ${metaField('testCaseId', 'Test case ID')}
          ${metaField('module', 'Module')}
          ${metaField('title', 'Title', true)}
          ${metaField('tester', 'Tester')}
          ${metaField('build', 'Build / version')}
          ${metaField('project', 'Project', true)}
          ${metaField('preconditions', 'Preconditions', true, true)}
          ${metaField('testData', 'Test data', true, true)}
        </div>
      </div>
      <div class="card card-pad">
        <h3>Environment <span class="muted" style="font-weight:500;font-size:12px">auto-detected</span></h3>
        <div class="form-grid">
          ${envField('browser', 'Browser')}
          ${envField('os', 'OS')}
          ${envField('screen', 'Screen size')}
          ${envField('viewport', 'Viewport')}
        </div>
      </div>`;
  }

  // ---------------------------------------------------------------- events
  function wire() {
    wireExportButtons($('.page-head .actions'), () => rec);

    $('#rec-name').addEventListener('input', (ev) => {
      rec.name = ev.target.value || 'Untitled';
      save();
    });
    $('#delete-rec')?.addEventListener('click', async () => {
      if (!confirm(`Delete “${rec.name}” and its screenshots? This cannot be undone.`)) return;
      await S.deleteRecording(rec.id);
      toast('Recording deleted');
      location.hash = '#/recordings';
    });
    $('#stop-now')?.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'ui:stop' }));
    $('#add-step')?.addEventListener('click', () => insertStep(rec.steps.length));

    const panel = $('#panel');
    panel.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-result]');
      if (!b || isLive()) return;
      rec.result = b.dataset.result;
      save();
      renderPanel();
      const st = displayStatus(rec);
      $('#head-pill').className = `pill ${st}`;
      $('#head-pill').textContent = statusLabel(st);
    });
    panel.addEventListener('input', (ev) => {
      const t = ev.target;
      if (isLive()) return;
      if (t.dataset.meta) rec.meta[t.dataset.meta] = t.value;
      else if (t.dataset.env) rec.environment[t.dataset.env] = t.value;
      else return;
      save();
    });

    const tl = $('#timeline');
    tl.addEventListener('input', (ev) => {
      const t = ev.target;
      const li = t.closest('.step');
      if (!li || !t.dataset.field || isLive()) return;
      const s = rec.steps.find((x) => x.id === li.dataset.id);
      s[t.dataset.field] = t.value;
      if (t.classList.contains('desc')) autosize(t);
      if (s.type === 'bug' && t.dataset.field === 'details') s.details = t.value;
      save();
    });
    tl.addEventListener('change', (ev) => {
      const t = ev.target;
      if (t.tagName !== 'SELECT' || isLive()) return;
      const li = t.closest('.step');
      const s = rec.steps.find((x) => x.id === li.dataset.id);
      s[t.dataset.field] = t.value;
      save();
      rerenderStep(s.id);
      renderPanel();
    });
    tl.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-act]');
      if (!btn) return;
      const li = btn.closest('.step');
      const idx = rec.steps.findIndex((x) => x.id === li.dataset.id);
      const s = rec.steps[idx];
      switch (btn.dataset.act) {
        case 'zoom':
          openLightbox(rec, shots, s.id);
          break;
        case 'details':
          expanded.has(s.id) ? expanded.delete(s.id) : expanded.add(s.id);
          rerenderStep(s.id);
          break;
        case 'logs': {
          const box = li.querySelector('[data-logs]');
          box.hidden = !box.hidden;
          break;
        }
        case 'insert':
          insertStep(idx + 1);
          break;
        case 'delete': {
          if (!confirm(`Delete step ${s.number}?`)) return;
          rec.steps.splice(idx, 1);
          const prev = rec.steps[Math.max(0, idx - 1)];
          for (const l of rec.logs || []) if (l.stepId === s.id) l.stepId = prev?.id || null;
          await DB.deleteShot(s.id);
          shots.delete(s.id);
          renumber(rec.steps);
          save();
          renderTimeline();
          renderPanel();
          break;
        }
      }
    });

    // Drag & drop reorder (drag starts from the handle).
    let dragId = null;
    tl.addEventListener('dragstart', (ev) => {
      const handle = ev.target.closest?.('.handle');
      if (!handle || isLive()) return ev.preventDefault();
      const li = handle.closest('.step');
      dragId = li.dataset.id;
      li.classList.add('dragging');
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', dragId);
      ev.dataTransfer.setDragImage(li, 20, 20);
    });
    tl.addEventListener('dragover', (ev) => {
      if (!dragId) return;
      const li = ev.target.closest('.step');
      if (!li || li.dataset.id === dragId) return;
      ev.preventDefault();
      const r = li.getBoundingClientRect();
      const before = ev.clientY < r.top + r.height / 2;
      $$('.drop-before, .drop-after', tl).forEach((x) => x.classList.remove('drop-before', 'drop-after'));
      li.classList.add(before ? 'drop-before' : 'drop-after');
    });
    tl.addEventListener('drop', (ev) => {
      if (!dragId) return;
      ev.preventDefault();
      const target = $('.drop-before, .drop-after', tl);
      if (target) {
        const from = rec.steps.findIndex((x) => x.id === dragId);
        const [moved] = rec.steps.splice(from, 1);
        let to = rec.steps.findIndex((x) => x.id === target.dataset.id);
        if (target.classList.contains('drop-after')) to++;
        rec.steps.splice(to, 0, moved);
        renumber(rec.steps);
        save();
      }
      dragId = null;
      renderTimeline();
    });
    tl.addEventListener('dragend', () => {
      dragId = null;
      $$('.dragging, .drop-before, .drop-after', tl).forEach((x) => x.classList.remove('dragging', 'drop-before', 'drop-after'));
    });
  }

  function insertStep(index) {
    const prev = rec.steps[index - 1];
    const step = {
      id: uid(),
      type: 'manual',
      description: '',
      url: prev?.url || rec.startUrl,
      timestamp: prev?.timestamp || Date.now(),
      manual: true,
    };
    rec.steps.splice(index, 0, step);
    renumber(rec.steps);
    save();
    renderTimeline();
    renderPanel();
    const ta = $(`.step[data-id="${CSS.escape(step.id)}"] .desc`);
    ta.placeholder = 'Describe the step…';
    ta.focus();
    ta.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  render();

  // Live updates while recording; full refresh when the recording completes.
  const refreshShots = debounce(async () => {
    shots = await DB.getShotsForRecording(id);
    if (currentView?.id === id) {
      renderTimeline();
      renderPanel();
    }
  }, 1200);
  currentView.onStorage = async (changes) => {
    const ch = changes[S.recKey(id)];
    if (!ch) return;
    if (!ch.newValue) {
      location.hash = '#/recordings';
      return;
    }
    if (ch.newValue.updatedAt === lastSaved) return; // our own write
    const wasLive = isLive();
    rec = ch.newValue;
    if (wasLive || isLive()) {
      shots = await DB.getShotsForRecording(id);
      if (wasLive !== isLive()) render();
      else {
        renderTimeline();
        renderPanel();
      }
      refreshShots();
    }
  };
  const ticker = setInterval(() => isLive() && session.active && renderPanelDuration(), 1000);
  function renderPanelDuration() {
    const dd = $('#panel dl.kv dd');
    if (dd) dd.textContent = formatDuration(elapsedOf(session));
  }
  currentView.cleanup = () => {
    save.flush();
    clearInterval(ticker);
  };
}

// =========================================================================
// Lightbox

let lb = null;
function openLightbox(rec, shots, stepId) {
  const withShots = rec.steps.filter((s) => shots.get(s.id));
  let i = withShots.findIndex((s) => s.id === stepId);
  const el = $('#lightbox');
  const show = () => {
    const s = withShots[i];
    el.innerHTML = `<div class="lb-top">
        <span class="cap">Step ${s.number} — ${e(s.description)}</span>
        <span class="muted">${i + 1} / ${withShots.length}</span>
        <button class="btn sm" data-lb="prev" ${i === 0 ? 'disabled' : ''}>Prev</button>
        <button class="btn sm" data-lb="next" ${i === withShots.length - 1 ? 'disabled' : ''}>Next</button>
        <button class="btn sm" data-lb="close">Close</button>
      </div>
      <div class="lb-img"><img src="${shots.get(s.id)}" alt="Screenshot of step ${s.number}"></div>`;
  };
  const onKey = (ev) => {
    if (ev.key === 'Escape') closeLightbox();
    if (ev.key === 'ArrowRight' && i < withShots.length - 1) (i++, show());
    if (ev.key === 'ArrowLeft' && i > 0) (i--, show());
  };
  el.onclick = (ev) => {
    const a = ev.target.closest('[data-lb]')?.dataset.lb;
    if (a === 'close' || ev.target === el || ev.target.classList.contains('lb-img')) closeLightbox();
    if (a === 'prev' && i > 0) (i--, show());
    if (a === 'next' && i < withShots.length - 1) (i++, show());
  };
  document.addEventListener('keydown', onKey);
  lb = { onKey };
  show();
  el.hidden = false;
}

function closeLightbox() {
  if (!lb) return;
  document.removeEventListener('keydown', lb.onKey);
  lb = null;
  $('#lightbox').hidden = true;
}

// =========================================================================
// Reports

async function viewReports() {
  const [recs, history] = await Promise.all([S.listRecordings(), S.getReports()]);
  const byId = new Map(recs.map((r) => [r.id, r]));
  const formatName = { html: 'HTML', pdf: 'PDF', xlsx: 'Excel', csv: 'CSV', json: 'JSON', playwright: 'Playwright', selenium: 'Selenium' };
  const done = recs.filter((r) => displayStatus(r) !== 'inprogress');
  view.innerHTML = `
    <div class="page-head"><div><h1>Reports</h1><p>Generate a test report from any recording and export it.</p></div></div>
    <div class="card card-pad" style="margin-bottom:20px">
      <h3>Generate a report</h3>
      ${
        done.length
          ? `<div class="filters" style="margin:0">
              <select class="input" id="gen-rec" style="flex:1;min-width:240px" aria-label="Recording">
                ${done.map((r) => `<option value="${e(r.id)}">${e(r.name)} — ${formatDate(r.createdAt)} (${statusLabel(displayStatus(r))})</option>`).join('')}
              </select>
              <button class="btn primary" id="gen-go">${I.report} Open report</button>
            </div>`
          : '<p class="muted" style="margin:0">Complete a recording first — reports are generated from recordings.</p>'
      }
    </div>
    <h2 class="section-title">Export history</h2>
    ${
      history.length
        ? `<div class="card table-card"><table class="list">
            <thead><tr><th>Recording</th><th>Format</th><th>Exported</th><th></th></tr></thead>
            <tbody>${history
              .map(
                (h) => `<tr data-rec="${e(h.recordingId)}">
                  <td><div class="nm">${e(byId.get(h.recordingId)?.name || h.recordingName)}</div></td>
                  <td>${e(formatName[h.format] || h.format)}</td>
                  <td>${formatDate(h.createdAt)}</td>
                  <td class="row-actions">${byId.has(h.recordingId) ? `<a class="btn sm" href="#/report/${e(h.recordingId)}">Open report</a>` : '<span class="muted">deleted</span>'}</td>
                </tr>`,
              )
              .join('')}</tbody></table></div>`
        : '<div class="card empty"><p>No reports exported yet. Open a report and use the export buttons — every export is listed here.</p></div>'
    }`;
  $('#gen-go')?.addEventListener('click', () => (location.hash = `#/report/${$('#gen-rec').value}`));
  view.querySelector('tbody')?.addEventListener('click', (ev) => {
    if (ev.target.closest('a')) return;
    const tr = ev.target.closest('tr[data-rec]');
    if (tr && byId.has(tr.dataset.rec)) location.hash = `#/report/${tr.dataset.rec}`;
  });
}

async function viewReport(id) {
  const rec = await S.getRecording(id);
  if (!rec) {
    view.innerHTML = `<a class="back" href="#/reports">${I.back} Reports</a><div class="card empty"><h3>Recording not found</h3></div>`;
    return;
  }
  const shots = await DB.getShotsForRecording(id);
  let withShots = true;
  view.innerHTML = `
    <a class="back" href="#/recording/${e(rec.id)}">${I.back} Back to recording</a>
    <div class="page-head" style="margin-bottom:12px">
      <div><h1>Report: ${e(rec.name)}</h1><p>${formatDate(rec.createdAt)} · ${rec.steps.length} steps · ${statusLabel(displayStatus(rec))}</p></div>
    </div>
    <div class="report-bar">
      <label class="check"><input type="checkbox" id="with-shots" checked> Include screenshots</label>
      <span class="sep"></span>
      <button class="btn primary" data-export="html">${I.download} HTML</button>
      <button class="btn" data-export="pdf">PDF</button>
      <button class="btn" data-export="xlsx">Excel</button>
      <button class="btn" data-export="csv">CSV</button>
      <button class="btn" data-export="json">JSON</button>
      <span class="sep"></span>
      ${copyMenuHtml()}
      <div class="menu-wrap">
        <button class="btn" data-menu>Script ${I.chevron}</button>
        <div class="menu" hidden>
          <button data-export="playwright">Playwright test <small>.spec.ts</small></button>
          <button data-export="selenium">Selenium (Python) <small>.py</small></button>
        </div>
      </div>
    </div>
    <iframe class="report-frame" id="report-frame" title="Report preview"></iframe>`;
  const frame = $('#report-frame');
  const renderFrame = () => (frame.srcdoc = buildReportHtml(rec, shots, settings, { screenshots: withShots }));
  renderFrame();
  $('#with-shots').addEventListener('change', (ev) => {
    withShots = ev.target.checked;
    renderFrame();
  });
  wireExportButtons($('.report-bar'), () => rec, () => ({ screenshots: withShots }));
}

// =========================================================================
// Settings

async function viewSettings() {
  currentView.cleanup?.();
  const usage = await S.storageUsage();
  const recs = await S.listRecordings();
  const toggle = (key, title, desc) => `
    <div class="setting-row">
      <div><div class="t">${title}</div><div class="d">${desc}</div></div>
      <label class="switch"><input type="checkbox" data-setting="${key}" ${settings[key] ? 'checked' : ''} aria-label="${title}"><span></span></label>
    </div>`;
  const total = usage.metaBytes + usage.shotBytes;
  const quota = usage.estimate?.quota || 0;

  view.innerHTML = `
    <div class="page-head"><div><h1>Settings</h1><p>Changes are saved automatically.</p></div></div>
    <div class="settings">
      <div class="card card-pad">
        <h3>Capture</h3>
        ${toggle('screenshots', 'Screenshot every step', 'Captures the visible tab for each step, with the element outlined in red.')}
        ${toggle('hideToolbarInScreenshots', 'Hide toolbar in screenshots', 'Briefly hides the floating toolbar while a screenshot is taken.')}
        ${toggle('captureScroll', 'Record scrolling', 'Adds a step when the page is scrolled (debounced).')}
        ${toggle('captureConsole', 'Capture console errors', 'console.error, uncaught exceptions and unhandled promise rejections.')}
        ${toggle('captureNetwork', 'Capture failed network requests', 'fetch / XHR responses with status 4xx/5xx and failed requests.')}
        ${toggle('openDashboardOnStop', 'Open recording after stop', 'Shows the recording in this dashboard when you stop recording.')}
        <div class="setting-row">
          <div><div class="t">Typing debounce</div><div class="d">How long to wait after the last keystroke before recording a “Type” step.</div></div>
          <select class="input" style="width:auto" data-setting-num="typingDebounceMs">
            ${[500, 1000, 1500, 2500].map((v) => `<option value="${v}" ${settings.typingDebounceMs === v ? 'selected' : ''}>${v / 1000}s</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="card card-pad">
        <h3>Report defaults</h3>
        <div class="form-grid">
          <div class="field"><label for="s-tester">Default tester name</label><input class="input" id="s-tester" data-setting-text="testerName" value="${e(settings.testerName)}"></div>
          <div class="field"><label for="s-project">Project name</label><input class="input" id="s-project" data-setting-text="projectName" value="${e(settings.projectName)}"></div>
          <div class="field full"><label>Report logo</label>
            <div class="logo-preview">
              ${settings.logo ? `<img src="${e(settings.logo)}" alt="Report logo">` : '<span class="muted">No logo</span>'}
              <label class="btn sm">${I.upload} Upload<input type="file" id="logo-file" accept="image/*" hidden></label>
              ${settings.logo ? '<button class="btn sm danger" id="logo-remove">Remove</button>' : ''}
            </div>
          </div>
        </div>
      </div>

      <div class="card card-pad">
        <h3>Appearance</h3>
        <div class="setting-row">
          <div><div class="t">Theme</div><div class="d">Applies to the popup and dashboard. The in-page toolbar follows your system theme.</div></div>
          <select class="input" style="width:auto" id="theme-select">
            ${[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<option value="${v}" ${settings.theme === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="card card-pad">
        <h3>Data</h3>
        <div class="d muted">${recs.length} recordings · ${usage.shotCount} screenshots · ${formatBytes(total)} used${quota ? ` of ${formatBytes(quota)} available` : ''}</div>
        <div class="usage-bar" role="img" aria-label="Storage usage">
          <i style="width:${total ? (usage.metaBytes / total) * 100 : 0}%;background:var(--accent)"></i>
          <i style="width:${total ? (usage.shotBytes / total) * 100 : 0}%;background:var(--status-blocked)"></i>
        </div>
        <div class="usage-legend">
          <span><i style="background:var(--accent)"></i>Recordings &amp; settings: ${formatBytes(usage.metaBytes)}</span>
          <span><i style="background:var(--status-blocked)"></i>Screenshots: ${formatBytes(usage.shotBytes)}</span>
        </div>
        <div class="btn-row">
          <button class="btn" id="export-all" ${recs.length ? '' : 'disabled'}>${I.download} Export all (JSON)</button>
          <button class="btn" id="import">${I.upload} Import JSON</button>
          <button class="btn danger" id="clear-all" ${recs.length ? '' : 'disabled'}>${I.trash} Clear all data</button>
        </div>
      </div>
    </div>`;

  view.addEventListener('change', onSettingsChange);
  view.addEventListener('input', onSettingsInput);
  currentView.cleanup = () => {
    view.removeEventListener('change', onSettingsChange);
    view.removeEventListener('input', onSettingsInput);
  };

  $('#theme-select').addEventListener('change', async (ev) => {
    settings = await S.saveSettings({ theme: ev.target.value });
    applyTheme();
  });
  $('#logo-file').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    settings = await S.saveSettings({ logo: await shrinkImage(file, 480) });
    toast('Logo saved');
    viewSettings();
  });
  $('#logo-remove')?.addEventListener('click', async () => {
    settings = await S.saveSettings({ logo: '' });
    viewSettings();
  });
  $('#export-all').addEventListener('click', async () => {
    const all = await S.listRecordings();
    download(`testtrail-export-${formatDate(Date.now(), false)}.json`, JSON.stringify(await S.buildExport(all), null, 2), 'application/json');
    toast(`Exported ${all.length} recordings`);
  });
  $('#import').addEventListener('click', () => importFile());
  $('#clear-all').addEventListener('click', async () => {
    if (session.active) return toast('Stop the current recording first.');
    if (!confirm('Delete ALL recordings, screenshots and report history? Settings are kept. This cannot be undone.')) return;
    await S.clearAllData();
    toast('All data cleared');
    viewSettings();
  });
}

async function onSettingsChange(ev) {
  const t = ev.target;
  if (t.dataset.setting) {
    settings = await S.saveSettings({ [t.dataset.setting]: t.checked });
    toast('Saved');
  } else if (t.dataset.settingNum) {
    settings = await S.saveSettings({ [t.dataset.settingNum]: Number(t.value) });
    toast('Saved');
  }
}

const saveTextSetting = debounce(async (key, value) => {
  settings = await S.saveSettings({ [key]: value });
  toast('Saved');
}, 500);

function onSettingsInput(ev) {
  const key = ev.target.dataset.settingText;
  if (key) saveTextSetting(key, ev.target.value);
}

function shrinkImage(file, maxW) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// =========================================================================
// Import

function importFile() {
  const input = $('#file-input');
  input.value = '';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const count = await S.importData(JSON.parse(await file.text()));
      toast(`Imported ${count} recording${count === 1 ? '' : 's'}`);
      route();
    } catch (err) {
      toast(`Import failed: ${err.message}`, 4000);
    }
  };
  input.click();
}

// =========================================================================
// Boot

$('#theme-toggle').addEventListener('click', async () => {
  const next = { system: 'light', light: 'dark', dark: 'system' }[settings.theme] || 'system';
  settings = await S.saveSettings({ theme: next });
  applyTheme();
  if (currentView?.name === 'settings') viewSettings();
});

(async function boot() {
  settings = await S.getSettings();
  session = await S.getSession();
  applyTheme();
  renderLive();
  await route();
})();

// Exposed for debugging and the e2e test.
window.TestTrailDashboard = { exportRecording, buildReportHtml, buildStepsText, toXlsx, toCsv, toPlaywright, toSelenium };
