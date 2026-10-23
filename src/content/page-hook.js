// Runs in the page's MAIN world at document_start. It reports SPA route
// changes (history API), console errors and failed network requests to the
// isolated-world recorder via a DOM CustomEvent. It only emits; the recorder
// decides whether a recording is active and drops events otherwise.

(() => {
  if (window.__testtrailHook) return;
  Object.defineProperty(window, '__testtrailHook', { value: true });

  const EVENT = '__testtrail_evt';
  const emit = (detail) => {
    try {
      detail.timestamp = Date.now();
      document.dispatchEvent(new CustomEvent(EVENT, { detail: JSON.stringify(detail) }));
    } catch {
      /* never break the page */
    }
  };

  const fmt = (v) => {
    if (v instanceof Error) return `${v.name}: ${v.message}`;
    if (typeof v === 'string') return v;
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  };

  // --- SPA navigation ---
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    if (typeof original !== 'function') continue;
    history[method] = function (...args) {
      const result = original.apply(this, args);
      emit({ kind: 'nav', method });
      return result;
    };
  }

  // --- Console errors ---
  const originalError = console.error;
  console.error = function (...args) {
    emit({ kind: 'console', level: 'error', message: args.map(fmt).join(' ') });
    return originalError.apply(this, args);
  };

  window.addEventListener(
    'error',
    (e) => {
      const t = e.target;
      if (t && t !== window && t.tagName) {
        const url = t.currentSrc || t.src || t.href || '';
        emit({ kind: 'network', method: 'GET', url, status: 0, message: `Failed to load <${t.tagName.toLowerCase()}> resource` });
      } else {
        const where = e.filename ? ` (${e.filename}:${e.lineno}:${e.colno})` : '';
        emit({ kind: 'console', level: 'error', message: `Uncaught ${e.message || 'error'}${where}` });
      }
    },
    true,
  );

  window.addEventListener('unhandledrejection', (e) => {
    emit({ kind: 'console', level: 'error', message: `Unhandled promise rejection: ${fmt(e.reason)}` });
  });

  // --- fetch ---
  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function (input, init) {
      const method = String(init?.method || input?.method || 'GET').toUpperCase();
      const url = typeof input === 'string' ? input : input?.url || String(input);
      return originalFetch.apply(this, arguments).then(
        (res) => {
          if (res.status >= 400) {
            emit({ kind: 'network', method, url: res.url || url, status: res.status, message: `${res.status} ${res.statusText || ''}`.trim() });
          }
          return res;
        },
        (err) => {
          if (err?.name !== 'AbortError') {
            emit({ kind: 'network', method, url, status: 0, message: `Request failed: ${err?.message || err}` });
          }
          throw err;
        },
      );
    };
  }

  // --- XMLHttpRequest ---
  const XHR = window.XMLHttpRequest;
  if (XHR) {
    const open = XHR.prototype.open;
    const send = XHR.prototype.send;
    XHR.prototype.open = function (method, url) {
      this.__tt = { method: String(method || 'GET').toUpperCase(), url: String(url) };
      return open.apply(this, arguments);
    };
    XHR.prototype.send = function () {
      const info = this.__tt;
      if (info) {
        let aborted = false;
        this.addEventListener('abort', () => (aborted = true));
        this.addEventListener('loadend', () => {
          if (aborted) return;
          if (this.status >= 400 || this.status === 0) {
            emit({
              kind: 'network',
              method: info.method,
              url: this.responseURL || info.url,
              status: this.status,
              message: this.status ? `${this.status} ${this.statusText || ''}`.trim() : 'Request failed',
            });
          }
        });
      }
      return send.apply(this, arguments);
    };
  }
})();
