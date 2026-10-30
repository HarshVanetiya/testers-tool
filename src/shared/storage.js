// chrome.storage.local wrapper: settings, recording session state, recordings
// (metadata + steps) and report history. Screenshots live in IndexedDB (db.js).

import * as DB from './db.js';

export const DEFAULT_SETTINGS = {
  screenshots: true,
  captureScroll: false,
  captureConsole: true,
  captureNetwork: true,
  hideToolbarInScreenshots: true,
  openDashboardOnStop: true,
  typingDebounceMs: 1000,
  testerName: '',
  projectName: '',
  logo: '',
  theme: 'system',
};

const REC_PREFIX = 'rec:';
const SESSION_KEY = 'session';
const SETTINGS_KEY = 'settings';
const REPORTS_KEY = 'reports';

export const IDLE_SESSION = { active: false };

export async function getSettings() {
  const { [SETTINGS_KEY]: s } = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(s || {}) };
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function getSession() {
  const { [SESSION_KEY]: s } = await chrome.storage.local.get(SESSION_KEY);
  return s || IDLE_SESSION;
}

export function setSession(session) {
  return chrome.storage.local.set({ [SESSION_KEY]: session });
}

export const recKey = (id) => REC_PREFIX + id;
export const isRecKey = (key) => key.startsWith(REC_PREFIX);

export async function getRecording(id) {
  const key = recKey(id);
  const { [key]: rec } = await chrome.storage.local.get(key);
  return rec || null;
}

export function saveRecording(rec) {
  rec.updatedAt = Date.now();
  return chrome.storage.local.set({ [recKey(rec.id)]: rec });
}

export async function listRecordings() {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([k]) => isRecKey(k))
    .map(([, v]) => v)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export async function deleteRecording(id) {
  await chrome.storage.local.remove(recKey(id));
  await DB.deleteShotsForRecording(id);
  const reports = await getReports();
  await chrome.storage.local.set({ [REPORTS_KEY]: reports.filter((r) => r.recordingId !== id) });
}

export async function getReports() {
  const { [REPORTS_KEY]: r } = await chrome.storage.local.get(REPORTS_KEY);
  return r || [];
}

export async function addReport(entry) {
  const reports = await getReports();
  reports.unshift({ createdAt: Date.now(), ...entry });
  await chrome.storage.local.set({ [REPORTS_KEY]: reports.slice(0, 200) });
}

export async function clearAllData() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => isRecKey(k) || k === REPORTS_KEY);
  await chrome.storage.local.remove(keys);
  await DB.clearShots();
}

export async function storageUsage() {
  const metaBytes = await chrome.storage.local.getBytesInUse(null);
  const shots = await DB.shotStats();
  let estimate = null;
  try {
    estimate = await navigator.storage.estimate();
  } catch {
    /* not available */
  }
  return { metaBytes, shotCount: shots.count, shotBytes: shots.bytes, estimate };
}

// ---- Export / import (JSON, re-importable) ----

export const EXPORT_FORMAT = 'testtrail';
export const EXPORT_VERSION = 1;

export async function buildExport(recordings) {
  const screenshots = {};
  for (const rec of recordings) {
    const shots = await DB.getShotsForRecording(rec.id);
    for (const [id, dataUrl] of shots) screenshots[id] = dataUrl;
  }
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    recordings,
    screenshots,
  };
}

/** Imports a TestTrail JSON export. Recordings with an existing id get a new id. */
export async function importData(data) {
  if (!data || data.format !== EXPORT_FORMAT || !Array.isArray(data.recordings)) {
    throw new Error('Not a TestTrail export file.');
  }
  const existing = new Set((await listRecordings()).map((r) => r.id));
  const screenshots = data.screenshots || {};
  let count = 0;
  for (const original of data.recordings) {
    const rec = structuredClone(original);
    const clash = existing.has(rec.id);
    if (clash) rec.id = crypto.randomUUID();
    if (rec.status === 'recording' || rec.status === 'paused') rec.status = 'completed';
    const idMap = new Map();
    for (const step of rec.steps || []) {
      const oldId = step.id;
      if (clash) step.id = crypto.randomUUID();
      idMap.set(oldId, step.id);
      if (screenshots[oldId]) await DB.putShot(step.id, rec.id, screenshots[oldId]);
    }
    for (const log of rec.logs || []) if (log.stepId) log.stepId = idMap.get(log.stepId) || log.stepId;
    await saveRecording(rec);
    existing.add(rec.id);
    count++;
  }
  return count;
}
