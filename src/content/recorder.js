// TestTrail recorder (isolated-world content script, runs in every frame).
// Listens to user actions while the tab is being recorded and sends steps to
// the service worker. All recording state comes from the service worker, so a
// page reload or navigation simply re-runs this script and asks again.

(() => {
  if (globalThis.__ttRecorder) return;
  const Sel = globalThis.TTSelectors;
  const isTop = window === window.top;
  const R = (globalThis.__ttRecorder = { state: { recording: false } });

  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const MASK = '••••••';

  let state = { recording: false };
  let lastHref = location.href;
  let lastStepId = null;
  let lastRecord = { type: null, time: 0, form: null };
  const pendingTyping = new Map(); // element -> timer
  const committedValue = new WeakMap(); // element -> last recorded value
  let lastTyping = null; // { el, stepId }

  const active = () => state.recording && !state.paused;

  function send(msg) {
    try {
      return chrome.runtime.sendMessage(msg).catch(() => null);
    } catch {
      // Extension was reloaded / updated: this script is orphaned.
      return Promise.resolve(null);
    }
  }

  function applyState(next) {
    const wasRecording = state.recording;
    state = next || { recording: false };
    R.state = state;
    if (wasRecording && !state.recording) flushTyping();
    if (isTop) globalThis.TTToolbar?.update(state);
  }

  // ---------------------------------------------------------------- helpers

  function isOwnUi(e) {
    return !!globalThis.TTToolbar?.isOwnEvent(e);
  }

  function eventTarget(e) {
    const path = e.composedPath ? e.composedPath() : [];
    return path[0] && path[0].nodeType ? path[0] : e.target;
  }

  /** Bounding rect in top-viewport CSS pixels (null if a cross-origin frame hides the offset). */
  function rectInTop(el) {
    try {
      const r = el.getBoundingClientRect();
      let x = r.left;
      let y = r.top;
      let win = window;
      while (win !== win.top) {
        const frame = win.frameElement; // throws / null when cross-origin
        if (!frame) return null;
        const fr = frame.getBoundingClientRect();
        x += fr.left + frame.clientLeft;
        y += fr.top + frame.clientTop;
        win = win.parent;
      }
      return { x, y, width: r.width, height: r.height };
    } catch {
      return null;
    }
  }

  function topViewportWidth() {
    try {
      return window.top.innerWidth;
    } catch {
      return 0;
    }
  }

  function elementInfo(el) {
    if (!el || el.nodeType !== 1) return {};
    return {
      selector: Sel.buildSelector(el),
      xpath: Sel.buildXPath(el),
      tag: el.tagName.toLowerCase(),
      elementKind: Sel.kind(el),
      label: Sel.getLabel(el),
      elementText: Sel.textOf(el),
      rect: rectInTop(el),
      viewportWidth: topViewportWidth(),
      dpr: window.devicePixelRatio || 1,
    };
  }

  function record(type, el, extra = {}) {
    const step = {
      id: uid(),
      type,
      timestamp: Date.now(),
      url: location.href,
      title: document.title,
      frame: isTop ? 'top' : 'iframe',
      ...(isTop ? {} : { frameUrl: location.href }),
      ...elementInfo(el),
      ...extra,
    };
    lastStepId = step.id;
    lastRecord = { type, time: step.timestamp, form: el?.form || el?.closest?.('form') || null, el };
    send({ type: 'cs:step', step });
    return step;
  }

  // ---------------------------------------------------------------- typing

  function fieldValue(el) {
    if (el.isContentEditable) return Sel.clean(el.innerText, 500);
    return el.value ?? '';
  }

  function commitTyping(el) {
    const timer = pendingTyping.get(el);
    if (timer) clearTimeout(timer);
    pendingTyping.delete(el);
    if (!state.recording) return;
    const raw = fieldValue(el);
    if (committedValue.get(el) === raw) return;
    committedValue.set(el, raw);
    const masked = Sel.isPassword(el);
    const value = masked ? MASK : raw;
    const target = Sel.describeTarget(el);
    const description = value === '' ? `Clear ${target}` : `Type '${value}' into ${target}`;
    // Keep one step per field: update the previous step if nothing happened since.
    if (lastTyping && lastTyping.el === el && lastTyping.stepId === lastStepId) {
      send({ type: 'cs:updateStep', stepId: lastTyping.stepId, patch: { value, description, masked } });
      return;
    }
    const step = record('type', el, { value, masked, description });
    lastTyping = { el, stepId: step.id };
  }

  function flushTyping(except) {
    for (const el of [...pendingTyping.keys()]) if (el !== except) commitTyping(el);
  }

  function onInput(e) {
    if (!active() || !e.isTrusted || isOwnUi(e)) return;
    const el = eventTarget(e);
    const field = el?.isContentEditable ? el.closest('[contenteditable]') || el : el;
    if (!Sel.isTextInput(field)) return;
    flushTyping(field);
    clearTimeout(pendingTyping.get(field));
    pendingTyping.set(field, setTimeout(() => commitTyping(field), state.settings?.typingDebounceMs || 1000));
  }

  // ---------------------------------------------------------------- events

  function onClick(e) {
    if (!active() || !e.isTrusted || isOwnUi(e)) return;
    const el = Sel.interactiveTarget(eventTarget(e));
    if (!el) return;
    const tag = el.tagName;
    const type = (el.getAttribute('type') || '').toLowerCase();
    // These are recorded through change / input events instead.
    if (tag === 'SELECT' || tag === 'OPTION' || el.closest('select')) return;
    if (tag === 'INPUT' && ['checkbox', 'radio', 'file', 'range', 'color'].includes(type)) return;
    if (Sel.isTextInput(el)) return;
    if (tag === 'LABEL' && el.control && ['checkbox', 'radio', 'file'].includes(el.control.type)) return;
    flushTyping();
    const target = Sel.describeTarget(el);
    const verb = e.detail === 2 ? 'Double-click on' : 'Click on';
    record('click', el, { description: `${verb} ${target}`, href: el.href || undefined });
  }

  function onContextMenu(e) {
    if (!active() || !e.isTrusted || isOwnUi(e)) return;
    const el = Sel.interactiveTarget(eventTarget(e));
    if (!el) return;
    flushTyping();
    record('click', el, { description: `Right-click on ${Sel.describeTarget(el)}`, button: 'right' });
  }

  function onChange(e) {
    if (!active() || isOwnUi(e)) return;
    const el = eventTarget(e);
    if (!el || el.nodeType !== 1) return;
    // <select> changes may be dispatched by automation / custom widgets; others must be real.
    if (!e.isTrusted && el.tagName !== 'SELECT') return;
    const tag = el.tagName;
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (Sel.isTextInput(el) && !['date', 'time', 'datetime-local', 'month', 'week'].includes(type)) {
      commitTyping(el); // change fires on blur: flush pending text right away
      return;
    }
    flushTyping();
    const target = Sel.describeTarget(el);
    if (tag === 'SELECT') {
      const chosen = [...el.selectedOptions].map((o) => Sel.clean(o.text));
      const value = el.multiple ? chosen.join(', ') : chosen[0] || el.value;
      record('select', el, { value, optionValue: el.value, description: `Select '${value}' from ${target}` });
    } else if (type === 'checkbox') {
      record(el.checked ? 'check' : 'uncheck', el, {
        value: el.checked,
        description: `${el.checked ? 'Check' : 'Uncheck'} ${target}`,
      });
    } else if (type === 'radio') {
      record('radio', el, { value: el.value, description: `Select ${target}` });
    } else if (type === 'file') {
      const names = [...(el.files || [])].map((f) => f.name).join(', ');
      record('upload', el, { value: names, description: `Upload '${names}' to ${target}` });
    } else if (tag === 'INPUT') {
      record('type', el, { value: el.value, description: `Set ${target} to '${el.value}'` });
    }
  }

  function onKeyDown(e) {
    if (!active() || !e.isTrusted || isOwnUi(e)) return;
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    const el = eventTarget(e);
    const isField = Sel.isTextInput(el);
    if (e.key === 'Enter') {
      // Enter on buttons/links produces a click event; on textareas a newline.
      if (!isField || el.tagName === 'TEXTAREA' || el.isContentEditable) return;
      commitTyping(el);
      flushTyping();
      record('keypress', el, { key: 'Enter', description: `Press Enter in ${Sel.describeTarget(el)}` });
    } else {
      flushTyping();
      const where = isField ? ` in ${Sel.describeTarget(el)}` : '';
      record('keypress', isField ? el : null, { key: 'Escape', description: `Press Escape${where}` });
    }
  }

  function onSubmit(e) {
    if (!active() || isOwnUi(e)) return;
    const form = eventTarget(e);
    flushTyping();
    const recent = Date.now() - lastRecord.time < 1500;
    if (recent && lastRecord.form === form && ['click', 'keypress'].includes(lastRecord.type)) return;
    const name = form.getAttribute('name') || form.getAttribute('aria-label') || form.id || '';
    record('submit', form, { description: name ? `Submit '${Sel.clean(name)}' form` : 'Submit form' });
  }

  let scrollTimer = null;
  function onScroll(e) {
    if (!active() || !state.settings?.captureScroll) return;
    if (e.target !== document && e.target !== document.documentElement && e.target !== document.body) return;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      if (!active()) return;
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const pct = Math.round((window.scrollY / max) * 100);
      flushTyping();
      record('scroll', null, {
        value: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
        description: `Scroll to ${pct}% of the page (y=${Math.round(window.scrollY)})`,
      });
    }, 700);
  }

  // ---------------------------------------------------------------- SPA navigation

  function onLocationChange() {
    if (!isTop || location.href === lastHref) return;
    const previous = lastHref;
    lastHref = location.href;
    if (!active()) return;
    const onlyHash = previous.split('#')[0] === location.href.split('#')[0];
    flushTyping();
    const href = location.href;
    // Give the app a moment to update document.title.
    setTimeout(() => {
      if (!active() || location.href !== href) return;
      const label = document.title ? `'${document.title}' (${href})` : href;
      record('navigate', null, {
        description: `${onlyHash ? 'Go to section' : 'Navigate to'} ${label}`,
        spa: true,
      });
    }, 400);
  }

  function onHookEvent(e) {
    if (!state.recording) return;
    let data;
    try {
      data = JSON.parse(e.detail);
    } catch {
      return;
    }
    if (data.kind === 'nav') return onLocationChange();
    if (data.kind === 'console' && state.settings?.captureConsole) send({ type: 'cs:log', entry: data });
    if (data.kind === 'network' && state.settings?.captureNetwork) send({ type: 'cs:log', entry: data });
  }

  // ---------------------------------------------------------------- environment

  function environment() {
    const ua = navigator.userAgent;
    const brands = navigator.userAgentData?.brands || [];
    const brand =
      brands.find((b) => /Edge|Opera|Brave/i.test(b.brand)) ||
      brands.find((b) => /Chrome|Chromium/i.test(b.brand) && !/Not/i.test(b.brand));
    const chromeVersion = (ua.match(/Chrome\/([\d.]+)/) || [])[1];
    const browser = brand ? `${brand.brand} ${chromeVersion || brand.version}` : `Chrome ${chromeVersion || ''}`.trim();
    let os = navigator.userAgentData?.platform || '';
    if (!os) {
      if (/Windows/.test(ua)) os = 'Windows';
      else if (/Mac OS X/.test(ua)) os = 'macOS';
      else if (/Android/.test(ua)) os = 'Android';
      else if (/CrOS/.test(ua)) os = 'ChromeOS';
      else if (/Linux/.test(ua)) os = 'Linux';
    }
    return {
      browser,
      os,
      screen: `${screen.width}×${screen.height}`,
      viewport: `${window.innerWidth}×${window.innerHeight}`,
      pixelRatio: window.devicePixelRatio || 1,
      language: navigator.language,
      userAgent: ua,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }

  // ---------------------------------------------------------------- wiring

  const opts = { capture: true, passive: true };
  window.addEventListener('click', onClick, opts);
  window.addEventListener('contextmenu', onContextMenu, opts);
  window.addEventListener('input', onInput, opts);
  window.addEventListener('change', onChange, opts);
  window.addEventListener('keydown', onKeyDown, opts);
  window.addEventListener('submit', onSubmit, opts);
  window.addEventListener('scroll', onScroll, opts);
  window.addEventListener('popstate', onLocationChange);
  window.addEventListener('hashchange', onLocationChange);
  window.addEventListener('pagehide', () => flushTyping());
  document.addEventListener('__testtrail_evt', onHookEvent);
  window.addEventListener('pageshow', (e) => {
    // Restored from the back/forward cache: the script didn't re-run.
    if (e.persisted) hello({ navType: 'back_forward', pageStartedAt: Date.now() });
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg?.type) {
      case 'bg:ping':
        sendResponse({ ok: true });
        return;
      case 'bg:state':
        applyState(msg.state);
        return;
      case 'bg:env':
        if (isTop) sendResponse(environment());
        return;
      case 'bg:hideToolbar':
        if (!isTop) return;
        globalThis.TTToolbar?.hideForCapture().then(() => sendResponse({ ok: true }));
        return true;
      case 'bg:showToolbar':
        if (isTop) globalThis.TTToolbar?.showAfterCapture();
        return;
    }
  });

  async function hello(extra = {}) {
    const nav = performance.getEntriesByType?.('navigation')?.[0];
    const res = await send({
      type: 'cs:hello',
      top: isTop,
      url: location.href,
      title: document.title,
      navType: nav?.type || 'navigate',
      pageStartedAt: performance.timeOrigin,
      loadId: uid(),
      ...extra,
    });
    lastHref = location.href;
    applyState(res?.state);
  }

  // Re-sync if storage says the session changed (e.g. SW restarted mid-broadcast).
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.session) return;
      const s = changes.session.newValue;
      if (!s?.active) {
        if (state.recording) applyState({ recording: false });
      } else if (!state.recording || s.paused !== state.paused) {
        send({ type: 'cs:hello', top: false, pageStartedAt: 0 }).then((r) => r && applyState(r.state));
      }
    });
  } catch {
    /* orphaned */
  }

  R.flushTyping = flushTyping;
  R.send = send;
  R.uid = uid;
  hello();
})();
