import { getSettings, listRecordings } from '../shared/storage.js';
import { elapsedOf, formatDuration, displayStatus, statusLabel, escapeHtml } from '../shared/util.js';

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L8.5 4.64A1 1 0 0 0 7 5.5z"/></svg>';

let session = { active: false };
let ticker = null;

async function applyTheme() {
  const { theme } = await getSettings();
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
}

function render() {
  $('idle').hidden = session.active;
  $('recording').hidden = !session.active;
  clearInterval(ticker);
  if (!session.active) {
    renderRecent();
    return;
  }
  $('live-name').textContent = session.name;
  $('step-count').textContent = session.stepCount || 0;
  $('live-status').textContent = session.paused ? 'Paused' : 'Recording';
  $('live-status').className = `pill ${session.paused ? 'blocked' : 'inprogress'}`;
  $('pause').innerHTML = session.paused ? `${ICON_PLAY} Resume` : `${ICON_PAUSE} Pause`;
  const tick = () => ($('timer').textContent = formatDuration(elapsedOf(session)));
  tick();
  ticker = setInterval(tick, 1000);
}

async function renderRecent() {
  const recs = (await listRecordings()).slice(0, 3);
  if (!recs.length) {
    $('recent').innerHTML = '';
    return;
  }
  $('recent').innerHTML =
    '<h4>Recent</h4>' +
    recs
      .map((r) => {
        const st = displayStatus(r);
        return `<a href="#" data-id="${escapeHtml(r.id)}"><span class="nm">${escapeHtml(r.name)}</span><span class="pill ${st}">${statusLabel(st)}</span></a>`;
      })
      .join('');
}

function showError(text) {
  $('error').textContent = text;
  $('error').hidden = !text;
}

async function refresh() {
  const res = await send({ type: 'ui:getState' });
  session = res?.session || { active: false };
  render();
}

$('start-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return showError('No active tab found.');
  $('start').disabled = true;
  const res = await send({ type: 'ui:start', tabId: tab.id, name: $('name').value, testCaseId: $('tcid').value.trim() });
  $('start').disabled = false;
  if (!res?.ok) return showError(res?.error || 'Could not start recording on this page.');
  window.close();
});

$('pause').addEventListener('click', () => send({ type: session.paused ? 'ui:resume' : 'ui:pause' }));
$('stop').addEventListener('click', async () => {
  await send({ type: 'ui:stop' });
  window.close();
});
$('goto-tab').addEventListener('click', async () => {
  if (!session.tabId) return;
  const tab = await chrome.tabs.update(session.tabId, { active: true }).catch(() => null);
  if (tab) chrome.windows.update(tab.windowId, { focused: true });
  window.close();
});

function openDashboard(hash = '') {
  send({ type: 'ui:openDashboard', hash });
  window.close();
}
$('open-dashboard').addEventListener('click', () => openDashboard());
$('open-dashboard-icon').addEventListener('click', () => openDashboard());
$('recent').addEventListener('click', (e) => {
  const a = e.target.closest('a[data-id]');
  if (!a) return;
  e.preventDefault();
  openDashboard(`#/recording/${a.dataset.id}`);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.session) {
    session = changes.session.newValue || { active: false };
    render();
  }
});

applyTheme();
refresh();
