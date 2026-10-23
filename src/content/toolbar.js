// Floating on-page recording toolbar (top frame only). Rendered in a
// Shadow DOM so the site's CSS can't touch it, and vice versa.
// Exposes globalThis.TTToolbar for recorder.js.

(() => {
  if (globalThis.TTToolbar || window !== window.top) return;

  const R = () => globalThis.__ttRecorder;
  const send = (msg) => R().send(msg);
  const pad2 = (n) => String(n).padStart(2, '0');

  const ICONS = {
    grip: '<svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M7 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L8.5 4.64A1 1 0 0 0 7 5.5z"/></svg>',
    note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>',
    bug: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="6" width="8" height="14" rx="4"/><path d="M12 20v-9M8 10H4M8 14H3M8 18H4M16 10h4M16 14h5M16 18h4M9 6 7.5 3.5M15 6l1.5-2.5"/></svg>',
    stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  };

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    .wrap {
      --bg: rgba(24, 24, 27, 0.94); --fg: #f4f4f5; --muted: #a1a1aa; --line: rgba(255,255,255,0.12);
      --btn: rgba(255,255,255,0.08); --btn-h: rgba(255,255,255,0.16); --accent: #6366f1; --red: #ef4444;
      --card: #18181b; --input: #27272a;
    }
    @media (prefers-color-scheme: light) {
      .wrap { --bg: rgba(255,255,255,0.97); --fg: #18181b; --muted: #52525b; --line: rgba(0,0,0,0.12);
        --btn: rgba(0,0,0,0.05); --btn-h: rgba(0,0,0,0.1); --card: #ffffff; --input: #f4f4f5; }
    }
    .bar {
      position: fixed; z-index: 1; display: flex; align-items: center; gap: 4px; padding: 6px 8px 6px 4px;
      background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.28); font-size: 13px; line-height: 1; user-select: none;
      backdrop-filter: blur(8px);
    }
    .bar.hidden, .layer.hidden { opacity: 0 !important; pointer-events: none !important; }
    .grip { width: 20px; height: 28px; display: grid; place-items: center; cursor: grab; color: var(--muted); }
    .grip:active { cursor: grabbing; }
    .grip svg { width: 14px; height: 14px; fill: currentColor; }
    .status { display: flex; align-items: center; gap: 7px; padding: 0 8px 0 2px; border-right: 1px solid var(--line); margin-right: 2px; height: 24px; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--red); animation: pulse 1.4s infinite; }
    .paused .dot { background: #f59e0b; animation: none; }
    @keyframes pulse { 50% { opacity: .35; } }
    .count { font-weight: 600; font-variant-numeric: tabular-nums; }
    .timer { color: var(--muted); font-variant-numeric: tabular-nums; min-width: 38px; }
    button {
      all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 9px;
      border-radius: 8px; background: var(--btn); color: var(--fg); font-size: 12.5px; font-weight: 500; white-space: nowrap;
    }
    button:hover { background: var(--btn-h); }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    button svg { width: 15px; height: 15px; fill: currentColor; flex: none; }
    button svg[fill="none"] { fill: none; }
    button.icon { padding: 0 7px; }
    button.stop { background: var(--red); color: #fff; }
    button.stop:hover { background: #dc2626; }
    .bar.compact .lbl { display: none; }

    .layer { position: fixed; inset: 0; z-index: 2; display: grid; place-items: center; background: rgba(0,0,0,0.45); }
    .card {
      width: min(440px, calc(100vw - 32px)); background: var(--card); color: var(--fg); border-radius: 14px;
      border: 1px solid var(--line); box-shadow: 0 24px 60px rgba(0,0,0,0.35); padding: 18px; font-size: 13.5px;
    }
    .card h3 { margin: 0 0 4px; font-size: 16px; }
    .card p.sub { margin: 0 0 14px; color: var(--muted); font-size: 12.5px; }
    label.f { display: block; font-size: 12px; font-weight: 600; color: var(--muted); margin: 10px 0 5px; }
    textarea, input[type=text], select {
      all: unset; box-sizing: border-box; display: block; width: 100%; padding: 9px 10px; border-radius: 8px; background: var(--input);
      border: 1px solid var(--line); color: var(--fg); font-size: 13.5px; line-height: 1.4; white-space: pre-wrap;
    }
    textarea { min-height: 70px; resize: vertical; }
    textarea:focus, input[type=text]:focus, select:focus { border-color: var(--accent); }
    select { appearance: auto; }
    .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; flex-wrap: wrap; }
    .actions button { height: 34px; padding: 0 14px; }
    .primary { background: var(--accent); color: #fff; }
    .primary:hover { background: #4f46e5; }
    .pass { background: #15803d; color: #fff; } .pass:hover { background: #166534; }
    .fail { background: #dc2626; color: #fff; } .fail:hover { background: #b91c1c; }
    .blocked { background: #b45309; color: #fff; } .blocked:hover { background: #92400e; }
    .hint { color: var(--muted); font-size: 11.5px; margin-top: 10px; }

    .annot { width: min(1200px, calc(100vw - 24px)); height: min(820px, calc(100vh - 24px)); display: grid;
      grid-template-columns: 1fr 300px; gap: 0; padding: 0; overflow: hidden; }
    .stage { position: relative; background: #0b0b0c; display: flex; flex-direction: column; min-width: 0; }
    .tools { display: flex; gap: 6px; padding: 8px; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); flex-wrap: wrap; }
    .tools button { background: rgba(255,255,255,0.08); color: #f4f4f5; height: 28px; }
    .tools button.on { background: #6366f1; }
    .swatch { width: 20px; height: 20px; padding: 0; border-radius: 50%; border: 2px solid transparent; }
    .swatch.on { border-color: #fff; }
    .canvas-box { flex: 1; display: grid; place-items: center; overflow: hidden; padding: 10px; }
    canvas { max-width: 100%; max-height: 100%; cursor: crosshair; box-shadow: 0 0 0 1px rgba(255,255,255,0.15); touch-action: none; }
    .side { padding: 16px; overflow: auto; display: flex; flex-direction: column; }
    .side .actions { margin-top: auto; padding-top: 16px; }
    .noshot { color: #a1a1aa; font-size: 13px; }
  `;

  // ------------------------------------------------------------------ DOM
  const host = document.createElement('testtrail-toolbar');
  host.setAttribute('style', 'all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>${CSS}</style>
    <div class="wrap">
      <div class="bar" part="bar">
        <div class="grip" title="Drag to move">${ICONS.grip}</div>
        <div class="status"><span class="dot"></span><span class="count">0 steps</span><span class="timer">00:00</span></div>
        <button data-act="pause" title="Pause recording (Alt+Shift+P)">${ICONS.pause}<span class="lbl">Pause</span></button>
        <button data-act="note" title="Add a note">${ICONS.note}<span class="lbl">Note</span></button>
        <button data-act="checkpoint" title="Mark a checkpoint / expected result">${ICONS.check}<span class="lbl">Checkpoint</span></button>
        <button data-act="bug" title="Report a bug with an annotated screenshot">${ICONS.bug}<span class="lbl">Bug</span></button>
        <button data-act="stop" class="stop" title="Stop recording (Alt+Shift+R)">${ICONS.stop}<span class="lbl">Stop</span></button>
      </div>
      <div class="layer hidden"></div>
    </div>`;

  const bar = root.querySelector('.bar');
  const layer = root.querySelector('.layer');
  const countEl = root.querySelector('.count');
  const timerEl = root.querySelector('.timer');
  const pauseBtn = root.querySelector('[data-act="pause"]');

  let state = { recording: false };
  let mounted = false;
  let timer = null;
  let pos = null;
  let modalOpen = false;

  // Keep the site from reacting to clicks / keys inside our UI.
  for (const type of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'keydown', 'keyup', 'keypress', 'input', 'change', 'focusin', 'wheel']) {
    host.addEventListener(type, (e) => e.stopPropagation());
  }

  function mount() {
    if (mounted) return;
    (document.documentElement || document.body).appendChild(host);
    mounted = true;
    placeBar();
    window.addEventListener('resize', placeBar);
  }

  function unmount() {
    if (!mounted) return;
    closeLayer();
    host.remove();
    mounted = false;
    window.removeEventListener('resize', placeBar);
  }

  function placeBar() {
    const w = bar.offsetWidth || 470;
    const h = bar.offsetHeight || 42;
    bar.classList.toggle('compact', window.innerWidth < 640);
    let x = pos ? pos.x : window.innerWidth - w - 20;
    let y = pos ? pos.y : window.innerHeight - h - 20;
    x = Math.min(Math.max(4, x), Math.max(4, window.innerWidth - w - 4));
    y = Math.min(Math.max(4, y), Math.max(4, window.innerHeight - h - 4));
    bar.style.left = x + 'px';
    bar.style.top = y + 'px';
  }

  try {
    chrome.storage.local.get('toolbarPos').then(({ toolbarPos }) => {
      if (toolbarPos) pos = toolbarPos;
      if (mounted) placeBar();
    });
  } catch {
    /* orphaned */
  }

  // ------------------------------------------------------------------ drag
  const grip = root.querySelector('.grip');
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY, left: bar.offsetLeft, top: bar.offsetTop };
    const move = (ev) => {
      pos = { x: start.left + ev.clientX - start.x, y: start.top + ev.clientY - start.y };
      placeBar();
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      pos = { x: bar.offsetLeft, y: bar.offsetTop };
      try {
        chrome.storage.local.set({ toolbarPos: pos });
      } catch {
        /* orphaned */
      }
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });

  // ------------------------------------------------------------------ state
  function elapsed() {
    if (!state.startedAt) return 0;
    const now = Date.now();
    const pausedNow = state.paused && state.pausedAt ? now - state.pausedAt : 0;
    return Math.max(0, now - state.startedAt - (state.pausedTotal || 0) - pausedNow);
  }

  function render() {
    const n = state.stepCount || 0;
    countEl.textContent = `${n} step${n === 1 ? '' : 's'}`;
    const s = Math.floor(elapsed() / 1000);
    const h = Math.floor(s / 3600);
    timerEl.textContent = (h ? `${h}:` : '') + `${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
    bar.classList.toggle('paused', !!state.paused);
    pauseBtn.innerHTML = state.paused ? `${ICONS.play}<span class="lbl">Resume</span>` : `${ICONS.pause}<span class="lbl">Pause</span>`;
    pauseBtn.title = state.paused ? 'Resume recording (Alt+Shift+P)' : 'Pause recording (Alt+Shift+P)';
  }

  function update(next) {
    state = next || { recording: false };
    if (!state.recording) {
      clearInterval(timer);
      timer = null;
      unmount();
      return;
    }
    mount();
    render();
    if (!timer) timer = setInterval(render, 1000);
  }

  // ------------------------------------------------------------------ actions
  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'pause') send({ type: 'cs:control', action: state.paused ? 'resume' : 'pause' });
    else if (act === 'stop') {
      R().flushTyping();
      send({ type: 'cs:control', action: 'stop' });
    } else if (act === 'note') openNote();
    else if (act === 'checkpoint') openCheckpoint();
    else if (act === 'bug') openBug();
  });

  function addStep(step) {
    R().flushTyping();
    return send({ type: 'cs:step', step: { id: R().uid(), timestamp: Date.now(), url: location.href, title: document.title, frame: 'top', ...step } });
  }

  function openLayer(html, onReady) {
    R().flushTyping();
    layer.innerHTML = html;
    layer.classList.remove('hidden');
    modalOpen = true;
    const first = layer.querySelector('textarea, input, select');
    setTimeout(() => first?.focus(), 30);
    layer.onkeydown = (e) => {
      if (e.key === 'Escape') closeLayer();
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) layer.querySelector('[data-default]')?.click();
    };
    layer.onclick = (e) => {
      if (e.target === layer) closeLayer();
      if (e.target.closest('[data-close]')) closeLayer();
    };
    onReady?.(layer);
  }

  function closeLayer() {
    layer.classList.add('hidden');
    layer.innerHTML = '';
    modalOpen = false;
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  function openNote() {
    openLayer(
      `<div class="card" role="dialog" aria-label="Add note">
        <h3>Add note</h3><p class="sub">Inserted as a step at this point in the recording.</p>
        <textarea id="note" placeholder="e.g. Waited ~5s for the dashboard to load"></textarea>
        <div class="actions"><button data-close>Cancel</button><button class="primary" data-default id="save">Add note</button></div>
        <div class="hint">Ctrl/⌘ + Enter to save · Esc to cancel</div>
      </div>`,
      (l) => {
        l.querySelector('#save').onclick = () => {
          const text = l.querySelector('#note').value.trim();
          if (!text) return l.querySelector('#note').focus();
          addStep({ type: 'note', description: text, note: text, capture: false });
          closeLayer();
        };
      },
    );
  }

  function openCheckpoint() {
    openLayer(
      `<div class="card" role="dialog" aria-label="Checkpoint">
        <h3>Checkpoint</h3><p class="sub">Record what should happen and whether it did.</p>
        <label class="f" for="exp">Expected result</label>
        <textarea id="exp" placeholder="e.g. User is redirected to the dashboard and sees a welcome message"></textarea>
        <label class="f" for="act">Actual result (optional)</label>
        <textarea id="act" style="min-height:50px" placeholder="What actually happened"></textarea>
        <div class="actions">
          <button data-close>Cancel</button>
          <button class="blocked" data-status="blocked">Blocked</button>
          <button class="fail" data-status="fail">Fail</button>
          <button class="pass" data-status="pass" data-default>Pass</button>
        </div>
        <div class="hint">Ctrl/⌘ + Enter = Pass · Esc to cancel</div>
      </div>`,
      (l) => {
        l.querySelectorAll('[data-status]').forEach((b) => {
          b.onclick = () => {
            const expected = l.querySelector('#exp').value.trim();
            if (!expected) return l.querySelector('#exp').focus();
            const actual = l.querySelector('#act').value.trim();
            const status = b.dataset.status;
            const word = { pass: 'Pass', fail: 'Fail', blocked: 'Blocked' }[status];
            closeLayer();
            addStep({ type: 'checkpoint', description: `Verify: ${expected}`, expected, actual, status, statusLabel: word });
          };
        });
      },
    );
  }

  // ------------------------------------------------------------------ bug + annotator
  function dataUrlToBlob(dataUrl) {
    const [head, b64] = dataUrl.split(',');
    const mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  async function openBug() {
    R().flushTyping();
    const res = await send({ type: 'cs:captureRaw' });
    const shot = res?.dataUrl || null;
    let bitmap = null;
    if (shot) {
      try {
        bitmap = await createImageBitmap(dataUrlToBlob(shot));
      } catch {
        bitmap = null;
      }
    }
    openLayer(
      `<div class="card annot" role="dialog" aria-label="Report bug">
        <div class="stage">
          <div class="tools">
            <button data-tool="pen" class="on">Pen</button>
            <button data-tool="box">Box</button>
            <button data-tool="highlight">Highlight</button>
            <span style="width:8px"></span>
            <button class="swatch on" data-color="#ef4444" style="background:#ef4444" title="Red"></button>
            <button class="swatch" data-color="#facc15" style="background:#facc15" title="Yellow"></button>
            <button class="swatch" data-color="#3b82f6" style="background:#3b82f6" title="Blue"></button>
            <span style="flex:1"></span>
            <button data-op="undo">Undo</button><button data-op="clear">Clear</button>
          </div>
          <div class="canvas-box">${bitmap ? '<canvas></canvas>' : '<div class="noshot">Screenshot unavailable for this page.</div>'}</div>
        </div>
        <div class="side">
          <h3>Report bug</h3><p class="sub">Draw on the screenshot to point out the problem.</p>
          <label class="f" for="bt">Title</label><input type="text" id="bt" placeholder="Short summary of the bug">
          <label class="f" for="sev">Severity</label>
          <select id="sev"><option>Critical</option><option>High</option><option selected>Medium</option><option>Low</option></select>
          <label class="f" for="bd">Description</label>
          <textarea id="bd" placeholder="What went wrong? What did you expect?"></textarea>
          <div class="actions"><button data-close>Cancel</button><button class="fail" data-default id="save">Save bug</button></div>
        </div>
      </div>`,
      (l) => setupAnnotator(l, bitmap),
    );
  }

  function setupAnnotator(l, bitmap) {
    const canvas = l.querySelector('canvas');
    const ctx = canvas?.getContext('2d');
    const shapes = [];
    let tool = 'pen';
    let color = '#ef4444';
    let drawing = null;

    if (canvas) {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
    }
    const lineW = () => Math.max(3, Math.round((canvas?.width || 1000) / 350));

    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0);
      for (const s of drawing ? [...shapes, drawing] : shapes) {
        ctx.lineJoin = ctx.lineCap = 'round';
        if (s.tool === 'pen') {
          ctx.strokeStyle = s.color;
          ctx.lineWidth = lineW();
          ctx.beginPath();
          s.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.stroke();
        } else {
          const x = Math.min(s.x0, s.x1);
          const y = Math.min(s.y0, s.y1);
          const w = Math.abs(s.x1 - s.x0);
          const h = Math.abs(s.y1 - s.y0);
          if (s.tool === 'box') {
            ctx.strokeStyle = s.color;
            ctx.lineWidth = lineW();
            ctx.strokeRect(x, y, w, h);
          } else {
            ctx.globalAlpha = 0.3;
            ctx.fillStyle = s.color;
            ctx.fillRect(x, y, w, h);
            ctx.globalAlpha = 1;
          }
        }
      }
    }

    function point(e) {
      const r = canvas.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * canvas.width, ((e.clientY - r.top) / r.height) * canvas.height];
    }

    if (canvas) {
      draw();
      canvas.addEventListener('pointerdown', (e) => {
        canvas.setPointerCapture(e.pointerId);
        const [x, y] = point(e);
        drawing = tool === 'pen' ? { tool, color, points: [[x, y]] } : { tool, color, x0: x, y0: y, x1: x, y1: y };
      });
      canvas.addEventListener('pointermove', (e) => {
        if (!drawing) return;
        const [x, y] = point(e);
        if (drawing.tool === 'pen') drawing.points.push([x, y]);
        else Object.assign(drawing, { x1: x, y1: y });
        draw();
      });
      const end = () => {
        if (drawing) shapes.push(drawing);
        drawing = null;
        draw();
      };
      canvas.addEventListener('pointerup', end);
      canvas.addEventListener('pointercancel', end);
    }

    l.querySelectorAll('[data-tool]').forEach((b) =>
      b.addEventListener('click', () => {
        tool = b.dataset.tool;
        l.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('on', x === b));
      }),
    );
    l.querySelectorAll('[data-color]').forEach((b) =>
      b.addEventListener('click', () => {
        color = b.dataset.color;
        l.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x === b));
      }),
    );
    l.querySelector('[data-op="undo"]').onclick = () => {
      shapes.pop();
      draw();
    };
    l.querySelector('[data-op="clear"]').onclick = () => {
      shapes.length = 0;
      draw();
    };
    l.querySelector('#save').onclick = () => {
      const title = l.querySelector('#bt').value.trim();
      const details = l.querySelector('#bd').value.trim();
      if (!title && !details) return l.querySelector('#bt').focus();
      const severity = l.querySelector('#sev').value;
      const screenshotData = canvas ? canvas.toDataURL('image/jpeg', 0.85) : undefined;
      closeLayer();
      addStep({
        type: 'bug',
        description: `Bug (${severity}): ${title || details.slice(0, 80)}`,
        bugTitle: title || details.slice(0, 80),
        severity,
        details,
        status: 'fail',
        capture: false,
        screenshotData,
      });
    };
  }

  // ------------------------------------------------------------------ capture hooks
  function frames(n) {
    return new Promise((resolve) => {
      const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
      requestAnimationFrame(step);
    });
  }

  globalThis.TTToolbar = {
    update,
    isOwnEvent(e) {
      if (!mounted) return false;
      if (e.target === host) return true;
      return e.composedPath ? e.composedPath().includes(host) : false;
    },
    async hideForCapture() {
      if (!mounted) return;
      bar.classList.add('hidden');
      layer.classList.add('hidden');
      await Promise.race([frames(2), new Promise((r) => setTimeout(r, 120))]);
    },
    showAfterCapture() {
      bar.classList.remove('hidden');
      if (modalOpen) layer.classList.remove('hidden');
    },
  };

  // The recorder may have received its state before this script loaded.
  if (R()?.state?.recording) update(R().state);
})();
