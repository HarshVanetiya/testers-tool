// Small helpers shared by the service worker, popup and dashboard (ES module).

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function formatDuration(ms) {
  ms = Math.max(0, Math.round(ms || 0));
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}

export function formatDate(ts, withTime = true) {
  if (!ts) return '';
  const d = new Date(ts);
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  return withTime ? `${date} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` : date;
}

export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url || '';
  }
}

export function slugify(s) {
  return String(s || 'recording')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'recording';
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i ? 1 : 0)} ${units[i]}`;
}

/** Active (un-paused) time of a session or recording, in ms. */
export function elapsedOf(session, now = Date.now()) {
  if (!session?.startedAt) return 0;
  const pausedNow = session.paused && session.pausedAt ? now - session.pausedAt : 0;
  return now - session.startedAt - (session.pausedTotal || 0) - pausedNow;
}

export const RESULTS = {
  pass: 'Pass',
  fail: 'Fail',
  blocked: 'Blocked',
  notrun: 'Not Run',
};

export const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];

export const ACTION_LABELS = {
  navigate: 'Navigate',
  reload: 'Reload',
  click: 'Click',
  type: 'Type',
  select: 'Select',
  check: 'Check',
  uncheck: 'Uncheck',
  radio: 'Choose',
  upload: 'Upload',
  submit: 'Submit',
  keypress: 'Key press',
  scroll: 'Scroll',
  note: 'Note',
  checkpoint: 'Checkpoint',
  bug: 'Bug',
  manual: 'Manual step',
};

export const ANNOTATION_TYPES = new Set(['note', 'checkpoint', 'bug']);

/** Status displayed for a recording in lists: 'inprogress' while recording. */
export function displayStatus(rec) {
  if (rec.status === 'recording' || rec.status === 'paused') return 'inprogress';
  return rec.result || 'notrun';
}

export function statusLabel(key) {
  return key === 'inprogress' ? 'In progress' : RESULTS[key] || 'Not Run';
}

/** Overall result suggested from checkpoints / step statuses / bugs. */
export function deriveResult(rec) {
  const statuses = (rec.steps || []).map((s) => s.status).filter(Boolean);
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('blocked')) return 'blocked';
  if ((rec.steps || []).some((s) => s.type === 'bug')) return 'fail';
  if (statuses.includes('pass')) return 'pass';
  return 'notrun';
}

export function stepCounts(rec) {
  const steps = rec.steps || [];
  const c = { total: steps.length, actions: 0, checkpoints: 0, pass: 0, fail: 0, blocked: 0, bugs: 0, notes: 0 };
  for (const s of steps) {
    if (s.type === 'checkpoint') c.checkpoints++;
    else if (s.type === 'bug') c.bugs++;
    else if (s.type === 'note') c.notes++;
    else c.actions++;
    if (s.status === 'pass') c.pass++;
    else if (s.status === 'fail') c.fail++;
    else if (s.status === 'blocked') c.blocked++;
  }
  c.errors = (rec.logs || []).length;
  return c;
}

export function renumber(steps) {
  steps.forEach((s, i) => (s.number = i + 1));
  return steps;
}

/** Text describing the recorded environment in one line. */
export function envSummary(env = {}) {
  return [env.browser, env.os, env.screen && `screen ${env.screen}`, env.viewport && `viewport ${env.viewport}`]
    .filter(Boolean)
    .join(' · ');
}
