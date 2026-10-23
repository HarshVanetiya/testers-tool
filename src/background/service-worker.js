// TestTrail background service worker.
//
// It owns the recording session. Everything it needs is persisted in
// chrome.storage.local (session + recordings) and IndexedDB (screenshots), so a
// service-worker restart never loses a recording: every handler re-reads state.

import * as S from '../shared/storage.js';
import * as DB from '../shared/db.js';
import { uid, elapsedOf, deriveResult, ANNOTATION_TYPES, formatDate } from '../shared/util.js';

const DASHBOARD_URL = chrome.runtime.getURL('src/dashboard/dashboard.html');
const CONTENT_FILES = ['src/content/selectors.js', 'src/content/recorder.js', 'src/content/toolbar.js'];
const HOOK_FILE = 'src/content/page-hook.js';
const MAX_LOGS = 500;
const CAPTURE_INTERVAL_MS = 550; // captureVisibleTab is limited to 2 calls / second

// ---------------------------------------------------------------------------
// Serial queue: all read-modify-write operations on the session / recordings
// go through here so concurrent messages can't lose updates.
let chain = Promise.resolve();
function serial(fn) {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isRecordableUrl(url) {
  if (!url) return false;
  if (!/^(https?|file):/i.test(url)) return false;
  return !/^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/i.test(url);
}

// ---------------------------------------------------------------------------
// State broadcast

function publicState(session, settings) {
  if (!session.active) return { recording: false };
  return {
    recording: true,
    recordingId: session.recordingId,
    name: session.name,
    paused: !!session.paused,
    startedAt: session.startedAt,
    pausedAt: session.pausedAt,
    pausedTotal: session.pausedTotal || 0,
    stepCount: session.stepCount || 0,
    settings: {
      captureScroll: settings.captureScroll,
      captureConsole: settings.captureConsole,
      captureNetwork: settings.captureNetwork,
      typingDebounceMs: settings.typingDebounceMs,
    },
  };
}

async function broadcast(session, tabId = session.tabId) {
  const settings = await S.getSettings();
  await updateBadge(session);
  if (tabId == null) return;
  const state = session.active && session.tabId === tabId ? publicState(session, settings) : { recording: false };
  chrome.tabs.sendMessage(tabId, { type: 'bg:state', state }).catch(() => {});
}

async function updateBadge(session) {
  if (!session.active) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  await chrome.action.setBadgeBackgroundColor({ color: session.paused ? '#b7791f' : '#d03b3b' });
  await chrome.action.setBadgeText({ text: session.paused ? 'II' : String(session.stepCount || 0) });
}

// ---------------------------------------------------------------------------
// Injection

async function ensureInjected(tabId) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: 'bg:ping' }, { frameId: 0 });
    if (pong?.ok) return;
  } catch {
    /* no content script yet (tab opened before install / reload) */
  }
  await chrome.scripting
    .executeScript({ target: { tabId, allFrames: true }, files: [HOOK_FILE], world: 'MAIN', injectImmediately: true })
    .catch(() => {});
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: CONTENT_FILES });
}

// ---------------------------------------------------------------------------
// Screenshots

let captureChain = Promise.resolve();
let lastCaptureAt = 0;

/** Captures the visible area of the recording tab (rate-limited, toolbar hidden). */
function captureTab(tabId, { hideToolbar = true } = {}) {
  const p = captureChain.then(async () => {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || !tab.active) return null; // never capture a different tab
    const wait = lastCaptureAt + CAPTURE_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    const settings = await S.getSettings();
    const hide = hideToolbar && settings.hideToolbarInScreenshots;
    if (hide) await withTimeout(chrome.tabs.sendMessage(tabId, { type: 'bg:hideToolbar' }, { frameId: 0 }), 250);
    try {
      return await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 80 });
    } catch (e) {
      console.warn('[TestTrail] capture failed', e?.message);
      return null;
    } finally {
      lastCaptureAt = Date.now();
      if (hide) chrome.tabs.sendMessage(tabId, { type: 'bg:showToolbar' }, { frameId: 0 }).catch(() => {});
    }
  });
  captureChain = p.catch(() => {});
  return p;
}

function withTimeout(promise, ms) {
  return Promise.race([Promise.resolve(promise).catch(() => null), sleep(ms)]);
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return `data:${blob.type};base64,${bytesToBase64(bytes)}`;
}

/** Draws a red outline around the acted-on element on the screenshot. */
async function highlight(dataUrl, step) {
  const r = step.rect;
  if (!r || !(r.width > 0) || !(r.height > 0)) return dataUrl;
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bmp = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const scale = step.viewportWidth ? bmp.width / step.viewportWidth : step.dpr || 1;
    const pad = 3 * scale;
    ctx.lineWidth = Math.max(2, 3 * scale);
    ctx.strokeStyle = '#ff1f1f';
    ctx.shadowColor = 'rgba(255,255,255,0.9)';
    ctx.shadowBlur = 2 * scale;
    ctx.strokeRect(r.x * scale - pad, r.y * scale - pad, r.width * scale + pad * 2, r.height * scale + pad * 2);
    const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
    return await blobToDataUrl(out);
  } catch (e) {
    console.warn('[TestTrail] highlight failed', e?.message);
    return dataUrl;
  }
}

async function screenshotStep(session, step) {
  const settings = await S.getSettings();
  if (!settings.screenshots) return;
  const raw = await captureTab(session.tabId);
  if (!raw) return;
  const finalUrl = step.rect ? await highlight(raw, step) : raw;
  await DB.putShot(step.id, session.recordingId, finalUrl);
}

// ---------------------------------------------------------------------------
// Recording lifecycle

async function startRecording({ tabId, name, testCaseId }) {
  return serial(async () => {
    const current = await S.getSession();
    if (current.active) return { ok: false, error: 'A recording is already in progress.' };
    const tab = await chrome.tabs.get(tabId);
    if (!isRecordableUrl(tab.url)) {
      return { ok: false, error: 'This page cannot be recorded (browser pages, the Web Store and extension pages are off-limits).' };
    }
    const settings = await S.getSettings();
    await ensureInjected(tabId);

    const now = Date.now();
    const title = (name || '').trim() || `Scenario ${formatDate(now)}`;
    const rec = {
      id: uid(),
      name: title,
      status: 'recording',
      result: 'notrun',
      createdAt: now,
      endedAt: null,
      duration: 0,
      startUrl: tab.url,
      meta: {
        testCaseId: testCaseId || '',
        title,
        module: '',
        preconditions: '',
        testData: '',
        tester: settings.testerName || '',
        build: '',
        project: settings.projectName || '',
      },
      environment: {},
      steps: [],
      logs: [],
    };
    const env = await withTimeout(chrome.tabs.sendMessage(tabId, { type: 'bg:env' }, { frameId: 0 }), 1000);
    if (env) rec.environment = env;

    const first = {
      id: uid(),
      number: 1,
      type: 'navigate',
      description: `Navigate to ${tab.url}`,
      url: tab.url,
      title: tab.title || '',
      timestamp: now,
      frame: 'top',
    };
    rec.steps.push(first);
    await S.saveRecording(rec);

    const session = {
      active: true,
      recordingId: rec.id,
      name: rec.name,
      tabId,
      windowId: tab.windowId,
      startedAt: now,
      paused: false,
      pausedAt: null,
      pausedTotal: 0,
      stepCount: 1,
    };
    await S.setSession(session);
    await broadcast(session);
    screenshotStep(session, first);
    return { ok: true, recordingId: rec.id };
  });
}

async function stopRecording(reason = 'user') {
  const result = await serial(async () => {
    const session = await S.getSession();
    if (!session.active) return { ok: false, error: 'Not recording.' };
    const rec = await S.getRecording(session.recordingId);
    if (rec) {
      rec.status = 'completed';
      rec.endedAt = Date.now();
      rec.duration = elapsedOf(session);
      if (!rec.result || rec.result === 'notrun') rec.result = deriveResult(rec);
      if (reason !== 'user') rec.stopReason = reason;
      await S.saveRecording(rec);
    }
    await S.setSession(S.IDLE_SESSION);
    await broadcast(S.IDLE_SESSION, session.tabId);
    return { ok: true, recordingId: session.recordingId };
  });
  if (result.ok && reason === 'user') {
    const settings = await S.getSettings();
    if (settings.openDashboardOnStop) openDashboard(`#/recording/${result.recordingId}`);
  }
  return result;
}

async function setPaused(paused) {
  return serial(async () => {
    const session = await S.getSession();
    if (!session.active || !!session.paused === paused) return { ok: session.active };
    const now = Date.now();
    if (paused) {
      session.paused = true;
      session.pausedAt = now;
    } else {
      session.pausedTotal = (session.pausedTotal || 0) + (now - (session.pausedAt || now));
      session.paused = false;
      session.pausedAt = null;
    }
    await S.setSession(session);
    const rec = await S.getRecording(session.recordingId);
    if (rec) {
      rec.status = paused ? 'paused' : 'recording';
      await S.saveRecording(rec);
    }
    await broadcast(session);
    return { ok: true };
  });
}

/** Adds a step from a content script (or the initial navigation). */
async function addStep(sender, step) {
  const added = await serial(async () => {
    const session = await S.getSession();
    if (!session.active || sender.tab?.id !== session.tabId) return null;
    if (session.paused && !ANNOTATION_TYPES.has(step.type)) return null;
    const rec = await S.getRecording(session.recordingId);
    if (!rec) return null;
    const clean = { ...step };
    delete clean.screenshotData;
    delete clean.capture;
    clean.id = clean.id || uid();
    clean.timestamp = clean.timestamp || Date.now();
    clean.frameId = sender.frameId || 0;
    clean.number = rec.steps.length + 1;
    rec.steps.push(clean);
    // Errors that arrived before any action step belong to the next step.
    for (const log of rec.logs) if (!log.stepId) log.stepId = clean.id;
    await S.saveRecording(rec);
    session.stepCount = rec.steps.length;
    await S.setSession(session);
    await broadcast(session);
    return { session, step: clean };
  });
  if (!added) return { ok: false };
  if (step.screenshotData) {
    await DB.putShot(added.step.id, added.session.recordingId, step.screenshotData);
  } else if (step.capture !== false) {
    screenshotStep(added.session, added.step);
  }
  return { ok: true, id: added.step.id, number: added.step.number };
}

/** Updates a step (used when a tester keeps typing into the same field). */
async function updateStep(sender, stepId, patch) {
  return serial(async () => {
    const session = await S.getSession();
    if (!session.active || sender.tab?.id !== session.tabId) return { ok: false };
    const rec = await S.getRecording(session.recordingId);
    const step = rec?.steps.find((s) => s.id === stepId);
    if (!step) return { ok: false };
    Object.assign(step, patch, { timestamp: Date.now() });
    await S.saveRecording(rec);
    return { ok: true };
  });
}

async function addLog(sender, entry) {
  return serial(async () => {
    const session = await S.getSession();
    if (!session.active || session.paused || sender.tab?.id !== session.tabId) return { ok: false };
    const settings = await S.getSettings();
    if (entry.kind === 'console' && !settings.captureConsole) return { ok: false };
    if (entry.kind === 'network' && !settings.captureNetwork) return { ok: false };
    const rec = await S.getRecording(session.recordingId);
    if (!rec) return { ok: false };
    if (rec.logs.length >= MAX_LOGS) return { ok: false };
    // Attach to the nearest step: the latest step recorded before the error.
    const at = entry.timestamp || Date.now();
    let nearest = null;
    for (const s of rec.steps) if ((s.timestamp || 0) <= at + 50) nearest = s;
    nearest = nearest || rec.steps[rec.steps.length - 1];
    rec.logs.push({
      id: uid(),
      kind: entry.kind,
      level: entry.level || (entry.kind === 'network' ? 'error' : 'error'),
      message: String(entry.message || '').slice(0, 2000),
      url: entry.url || '',
      method: entry.method || '',
      status: entry.status ?? null,
      pageUrl: sender.url || '',
      timestamp: at,
      stepId: nearest?.id || null,
    });
    await S.saveRecording(rec);
    return { ok: true };
  });
}

/** Called by every content script when it loads in a frame. */
async function hello(sender, msg) {
  const session = await S.getSession();
  const settings = await S.getSettings();
  const isRecTab = session.active && sender.tab?.id === session.tabId;
  if (isRecTab && msg.top && msg.pageStartedAt > session.startedAt) {
    // A real page load in the recording tab after recording started.
    const kind = msg.navType === 'reload' ? 'reload' : 'navigate';
    const label = msg.title ? `'${msg.title}' (${msg.url})` : msg.url;
    const description =
      kind === 'reload'
        ? `Reload page ${label}`
        : msg.navType === 'back_forward'
          ? `Navigate back/forward to ${label}`
          : `Page loaded: ${label}`;
    addStep(sender, {
      id: msg.loadId,
      type: kind,
      description,
      url: msg.url,
      title: msg.title,
      timestamp: Date.now(),
      frame: 'top',
    });
  }
  return { state: isRecTab ? publicState(session, settings) : { recording: false } };
}

async function openDashboard(hash = '') {
  const url = DASHBOARD_URL + hash;
  const tabs = await chrome.tabs.query({ url: DASHBOARD_URL + '*' });
  if (tabs.length) {
    await chrome.tabs.update(tabs[0].id, { active: true, url });
    await chrome.windows.update(tabs[0].windowId, { focused: true }).catch(() => {});
  } else {
    await chrome.tabs.create({ url });
  }
}

// ---------------------------------------------------------------------------
// Message router

const handlers = {
  // content script -> background
  'cs:hello': (msg, sender) => hello(sender, msg),
  'cs:step': (msg, sender) => addStep(sender, msg.step),
  'cs:updateStep': (msg, sender) => updateStep(sender, msg.stepId, msg.patch),
  'cs:log': (msg, sender) => addLog(sender, msg.entry),
  'cs:control': (msg, sender) => control(msg.action, sender),
  'cs:captureRaw': async (msg, sender) => {
    const session = await S.getSession();
    if (!session.active || sender.tab?.id !== session.tabId) return { dataUrl: null };
    return { dataUrl: await captureTab(session.tabId) };
  },
  // popup / dashboard -> background
  'ui:getState': async () => {
    const session = await S.getSession();
    return { session, elapsed: elapsedOf(session) };
  },
  'ui:start': (msg) => startRecording(msg),
  'ui:stop': () => stopRecording('user'),
  'ui:pause': () => setPaused(true),
  'ui:resume': () => setPaused(false),
  'ui:openDashboard': (msg) => openDashboard(msg.hash || '').then(() => ({ ok: true })),
};

async function control(action, sender) {
  const session = await S.getSession();
  if (!session.active || sender.tab?.id !== session.tabId) return { ok: false };
  if (action === 'pause') return setPaused(true);
  if (action === 'resume') return setPaused(false);
  if (action === 'stop') return stopRecording('user');
  return { ok: false };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) return false;
  Promise.resolve()
    .then(() => handler(msg, sender))
    .then(sendResponse, (e) => {
      console.error('[TestTrail]', msg.type, e);
      sendResponse({ ok: false, error: e?.message || String(e) });
    });
  return true; // async response
});

// ---------------------------------------------------------------------------
// Browser events

chrome.commands.onCommand.addListener(async (command) => {
  const session = await S.getSession();
  if (command === 'toggle-recording') {
    if (session.active) return stopRecording('user');
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab) startRecording({ tabId: tab.id, name: '' });
  } else if (command === 'toggle-pause' && session.active) {
    setPaused(!session.paused);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const session = await S.getSession();
  if (session.active && session.tabId === tabId) stopRecording('tab-closed');
});

async function recoverSession() {
  // Tab ids do not survive a browser restart; close out any dangling session.
  const session = await S.getSession();
  if (!session.active) return updateBadge(session);
  const tab = await chrome.tabs.get(session.tabId).catch(() => null);
  if (!tab) await stopRecording('interrupted');
  else await updateBadge(session);
}

chrome.runtime.onStartup.addListener(recoverSession);
chrome.runtime.onInstalled.addListener(async () => {
  const settings = await S.getSettings();
  await S.saveSettings(settings); // persist defaults
  await recoverSession();
});

// Handy for debugging from the service-worker console (and for the e2e test).
self.TestTrail = { startRecording, stopRecording, setPaused, openDashboard };
