// Builds the self-contained HTML test report and the plain-text / Jira
// "Steps to Reproduce" variants from a recording.

import { escapeHtml as e, formatDate, formatDuration, stepCounts, envSummary, RESULTS, ACTION_LABELS } from '../shared/util.js';

const STATUS_TEXT = { pass: 'Pass', fail: 'Fail', blocked: 'Blocked' };

/** Steps that describe tester actions (not annotations). */
export function actionSteps(rec) {
  return rec.steps.filter((s) => !['note', 'checkpoint', 'bug'].includes(s.type));
}

function expectedOf(step) {
  return step.expected || '';
}

function actualOf(step) {
  if (step.type === 'bug') return step.details || step.bugTitle || '';
  if (step.actual) return step.actual;
  if (step.type === 'checkpoint' && step.status === 'pass') return 'As expected';
  return '';
}

function stepStatus(step) {
  if (step.status) return step.status;
  if (step.type === 'note') return 'info';
  return 'done';
}

function stepStatusText(step) {
  const st = stepStatus(step);
  return STATUS_TEXT[st] || (st === 'info' ? 'Note' : 'Done');
}

const REPORT_CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; background: #f4f4f6; color: #18181b; font: 13.5px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
  .page { max-width: 1080px; margin: 24px auto; background: #fff; border: 1px solid #e4e4e7; border-radius: 12px; padding: 36px 40px; }
  header.top { display: flex; align-items: flex-start; gap: 20px; border-bottom: 2px solid #18181b; padding-bottom: 18px; }
  header.top img.logo { max-height: 56px; max-width: 180px; object-fit: contain; }
  .eyebrow { font-size: 11.5px; letter-spacing: .08em; text-transform: uppercase; color: #71717a; font-weight: 700; }
  h1 { margin: 2px 0 0; font-size: 24px; line-height: 1.25; letter-spacing: -.01em; }
  h2 { font-size: 16px; margin: 30px 0 12px; padding-bottom: 6px; border-bottom: 1px solid #e4e4e7; }
  .result { margin-left: auto; text-align: right; }
  .badge { display: inline-block; padding: 6px 16px; border-radius: 999px; font-weight: 800; font-size: 15px; letter-spacing: .02em; color: #fff; }
  .badge.pass { background: #0a8a0a; } .badge.fail { background: #c62f2f; } .badge.blocked { background: #b26b00; } .badge.notrun { background: #71717a; }
  .meta { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px 24px; margin-top: 18px; }
  .meta div span { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #71717a; font-weight: 650; }
  .meta div b { font-weight: 550; overflow-wrap: anywhere; }
  .stats { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; }
  .stat { border: 1px solid #e4e4e7; border-radius: 10px; padding: 10px 12px; }
  .stat b { display: block; font-size: 22px; line-height: 1.2; font-variant-numeric: tabular-nums; }
  .stat span { font-size: 11.5px; color: #52525b; }
  .pre { white-space: pre-wrap; background: #fafafa; border: 1px solid #e4e4e7; border-radius: 8px; padding: 10px 12px; margin: 0; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th { text-align: left; background: #f4f4f5; color: #3f3f46; font-weight: 650; padding: 7px 8px; border-bottom: 1px solid #d4d4d8; }
  td { padding: 7px 8px; border-bottom: 1px solid #ececef; vertical-align: top; overflow-wrap: anywhere; }
  tr.checkpoint td { background: #f8f8ff; } tr.bug td { background: #fff6f6; } tr.note td { background: #fbfbf4; }
  .num { width: 34px; color: #71717a; font-variant-numeric: tabular-nums; }
  .type { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #71717a; font-weight: 650; display: block; }
  .sel { font: 11px ui-monospace, Menlo, Consolas, monospace; color: #71717a; display: block; margin-top: 2px; }
  .st { font-weight: 700; white-space: nowrap; }
  .st.pass { color: #0a8a0a; } .st.fail { color: #c62f2f; } .st.blocked { color: #b26b00; } .st.done, .st.info { color: #71717a; font-weight: 550; }
  td.shot { width: 132px; }
  td.shot img { width: 120px; border: 1px solid #d4d4d8; border-radius: 4px; display: block; }
  .bug { border: 1px solid #f3c4c4; border-left: 4px solid #c62f2f; border-radius: 8px; padding: 12px 14px; margin-bottom: 14px; break-inside: avoid; }
  .bug h3 { margin: 0 0 4px; font-size: 14.5px; }
  .sev { display: inline-block; font-size: 11px; font-weight: 750; padding: 1px 8px; border-radius: 999px; margin-right: 6px; color: #fff; }
  .sev.Critical { background: #7f1d1d; } .sev.High { background: #c62f2f; } .sev.Medium { background: #b26b00; } .sev.Low { background: #52525b; }
  .bug img { max-width: 100%; border: 1px solid #e4e4e7; border-radius: 6px; margin-top: 10px; }
  .small { font-size: 12px; color: #52525b; }
  ul.notes { margin: 0; padding-left: 18px; } ul.notes li { margin: 4px 0; }
  .shots figure { margin: 0 0 22px; break-inside: avoid; }
  .shots img { max-width: 100%; border: 1px solid #d4d4d8; border-radius: 6px; }
  .shots figcaption { font-size: 12.5px; color: #3f3f46; margin-bottom: 6px; font-weight: 600; }
  footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #e4e4e7; font-size: 11.5px; color: #71717a; display: flex; justify-content: space-between; }
  .empty { color: #71717a; font-style: italic; }
  @media (max-width: 760px) { .page { padding: 20px; margin: 0; border-radius: 0; } .meta { grid-template-columns: 1fr 1fr; } .stats { grid-template-columns: repeat(3, 1fr); } }
  @page { size: A4; margin: 12mm; }
  @media print {
    body { background: #fff; font-size: 11.5px; }
    .page { margin: 0; border: 0; padding: 0; max-width: none; }
    h2 { break-after: avoid; }
    tr { break-inside: avoid; }
    .shots { break-before: page; }
    a { color: inherit; text-decoration: none; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`;

/**
 * @param rec recording
 * @param shots Map stepId -> dataUrl
 * @param settings extension settings (logo, project)
 * @param opts { screenshots: boolean }
 */
export function buildReportHtml(rec, shots, settings = {}, opts = {}) {
  const withShots = opts.screenshots !== false;
  const m = rec.meta || {};
  const c = stepCounts(rec);
  const result = rec.result || 'notrun';
  const project = m.project || settings.projectName || '';
  const generated = formatDate(Date.now());
  const stepNumber = new Map(rec.steps.map((s) => [s.id, s.number]));

  const metaItems = [
    ['Test case ID', m.testCaseId || '—'],
    ['Module', m.module || '—'],
    ['Tester', m.tester || '—'],
    ['Execution date', formatDate(rec.createdAt)],
    ['Build / version', m.build || '—'],
    ['Duration', formatDuration(rec.duration)],
    ['Environment', envSummary(rec.environment) || '—'],
    ['Start URL', rec.startUrl || '—'],
    ['Project', project || '—'],
  ];

  const rows = rec.steps
    .map((s) => {
      const shot = withShots && shots.get(s.id);
      const st = stepStatus(s);
      return `<tr class="${e(s.type)}">
        <td class="num">${s.number}</td>
        <td><span class="type">${e(ACTION_LABELS[s.type] || s.type)}</span>${e(s.description)}
          ${s.selector ? `<span class="sel">${e(s.selector)}</span>` : ''}
          ${s.frame === 'iframe' ? '<span class="sel">in iframe</span>' : ''}</td>
        <td>${e(expectedOf(s))}</td>
        <td>${e(actualOf(s))}</td>
        <td><span class="st ${e(st)}">${e(stepStatusText(s))}</span></td>
        ${withShots ? `<td class="shot">${shot ? `<a href="#shot-${s.number}"><img src="${shot}" alt="Step ${s.number} screenshot"></a>` : ''}</td>` : ''}
      </tr>`;
    })
    .join('');

  const bugs = rec.steps.filter((s) => s.type === 'bug');
  const bugsHtml = bugs.length
    ? bugs
        .map(
          (b) => `<div class="bug">
            <h3><span class="sev ${e(b.severity)}">${e(b.severity || 'Medium')}</span>${e(b.bugTitle || b.description)}</h3>
            <div class="small">Step ${b.number} · ${e(b.url || '')} · ${formatDate(b.timestamp)}</div>
            ${b.details ? `<p style="margin:8px 0 0;white-space:pre-wrap">${e(b.details)}</p>` : ''}
            ${withShots && shots.get(b.id) ? `<img src="${shots.get(b.id)}" alt="Bug screenshot">` : ''}
          </div>`,
        )
        .join('')
    : '<p class="empty">No bugs reported.</p>';

  const logs = rec.logs || [];
  const logsHtml = logs.length
    ? `<table><thead><tr><th>Time</th><th>Type</th><th>Details</th><th>Step</th></tr></thead><tbody>${logs
        .map(
          (l) => `<tr><td style="white-space:nowrap">${e(new Date(l.timestamp).toLocaleTimeString())}</td>
          <td>${l.kind === 'network' ? `Network ${l.status || 'failed'}` : 'Console error'}</td>
          <td>${l.kind === 'network' ? `<b>${e(l.method)}</b> ${e(l.url)}<br><span class="small">${e(l.message)}</span>` : e(l.message)}</td>
          <td>${stepNumber.get(l.stepId) ?? '—'}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : '<p class="empty">No console errors or failed requests captured.</p>';

  const notes = rec.steps.filter((s) => s.type === 'note');
  const notesHtml = notes.length
    ? `<ul class="notes">${notes.map((n) => `<li><b>Step ${n.number}:</b> ${e(n.note || n.description)}</li>`).join('')}</ul>`
    : '<p class="empty">No tester notes.</p>';

  const shotsHtml = withShots
    ? rec.steps
        .filter((s) => shots.get(s.id))
        .map((s) => `<figure id="shot-${s.number}"><figcaption>Step ${s.number} — ${e(s.description)}</figcaption><img src="${shots.get(s.id)}" alt=""></figure>`)
        .join('')
    : '';

  const statBox = (n, label) => `<div class="stat"><b>${n}</b><span>${label}</span></div>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(m.testCaseId ? `${m.testCaseId} – ` : '')}${e(m.title || rec.name)} – Test report</title>
<style>${REPORT_CSS}</style></head>
<body><div class="page">
  <header class="top">
    ${settings.logo ? `<img class="logo" src="${e(settings.logo)}" alt="">` : ''}
    <div>
      <div class="eyebrow">${e(project ? `${project} · ` : '')}Test execution report</div>
      <h1>${e(m.testCaseId ? `${m.testCaseId}: ` : '')}${e(m.title || rec.name)}</h1>
    </div>
    <div class="result"><div class="eyebrow" style="margin-bottom:6px">Result</div><span class="badge ${e(result)}">${e(RESULTS[result] || result)}</span></div>
  </header>
  <section class="meta">${metaItems.map(([k, v]) => `<div><span>${e(k)}</span><b>${e(v)}</b></div>`).join('')}</section>

  <h2>Summary</h2>
  <div class="stats">
    ${statBox(c.total, 'Steps')}
    ${statBox(c.pass, 'Passed')}
    ${statBox(c.fail, 'Failed')}
    ${statBox(c.blocked, 'Blocked')}
    ${statBox(c.bugs, 'Bugs')}
    ${statBox(c.errors, 'Console / network errors')}
  </div>

  ${m.preconditions ? `<h2>Preconditions</h2><pre class="pre">${e(m.preconditions)}</pre>` : ''}
  ${m.testData ? `<h2>Test data</h2><pre class="pre">${e(m.testData)}</pre>` : ''}

  <h2>Test steps</h2>
  <table><thead><tr><th>#</th><th>Action</th><th>Expected result</th><th>Actual result</th><th>Status</th>${withShots ? '<th>Screenshot</th>' : ''}</tr></thead>
  <tbody>${rows || `<tr><td colspan="6" class="empty">No steps recorded.</td></tr>`}</tbody></table>

  <h2>Bugs (${bugs.length})</h2>
  ${bugsHtml}

  <h2>Console &amp; network errors (${logs.length})</h2>
  ${logsHtml}

  <h2>Tester notes</h2>
  ${notesHtml}

  ${shotsHtml ? `<div class="shots"><h2>Screenshots</h2>${shotsHtml}</div>` : ''}

  <footer><span>Generated by TestTrail · ${e(generated)}</span><span>${e(rec.name)}</span></footer>
</div></body></html>`;
}

// ---------------------------------------------------------------------------
// Steps to Reproduce (bug tickets)

export function buildStepsText(rec, format = 'plain') {
  const m = rec.meta || {};
  const jira = format === 'jira';
  const steps = actionSteps(rec);
  const checkpoints = rec.steps.filter((s) => s.type === 'checkpoint');
  const failed = checkpoints.filter((s) => s.status && s.status !== 'pass');
  const bugs = rec.steps.filter((s) => s.type === 'bug');
  const expected = (failed.length ? failed : checkpoints).map((s) => s.expected).filter(Boolean);
  const actual = [
    ...failed.map((s) => s.actual || `Not as expected (${STATUS_TEXT[s.status] || s.status}).`),
    ...bugs.map((b) => [b.bugTitle, b.details].filter(Boolean).join(' — ')),
  ].filter(Boolean);
  const errors = (rec.logs || []).map((l) =>
    l.kind === 'network' ? `${l.method} ${l.url} → ${l.status || 'failed'}` : `Console: ${l.message.slice(0, 200)}`,
  );

  const lines = [];
  const heading = (t) => lines.push('', jira ? `h3. ${t}` : `${t}:`);
  const list = (items, numbered) =>
    items.forEach((t, i) => lines.push(jira ? `${numbered ? '#' : '*'} ${t}` : `${numbered ? `${i + 1}.` : '-'} ${t}`));

  lines.push(jira ? `*Summary:* ${m.title || rec.name}` : `Summary: ${m.title || rec.name}`);
  if (m.testCaseId) lines.push(jira ? `*Test case:* ${m.testCaseId}` : `Test case: ${m.testCaseId}`);
  const env = envSummary(rec.environment);
  if (env) lines.push(jira ? `*Environment:* ${env}` : `Environment: ${env}`);
  if (m.build) lines.push(jira ? `*Build:* ${m.build}` : `Build: ${m.build}`);
  if (rec.startUrl) lines.push(jira ? `*URL:* ${rec.startUrl}` : `URL: ${rec.startUrl}`);

  if (m.preconditions) {
    heading('Preconditions');
    lines.push(m.preconditions);
  }
  heading('Steps to Reproduce');
  list(steps.map((s) => s.description), true);
  heading('Expected Result');
  list(expected.length ? expected : ['(not specified)'], false);
  heading('Actual Result');
  list(actual.length ? actual : ['(not specified)'], false);
  if (errors.length) {
    heading('Console / Network errors');
    if (jira) lines.push('{noformat}', ...errors, '{noformat}');
    else list(errors, false);
  }
  return lines.join('\n').trim() + '\n';
}
