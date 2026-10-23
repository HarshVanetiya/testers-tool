// Stacked bar chart of test results per day (SVG), with a hover tooltip.
// Colors use the status palette tokens (pass/fail/blocked/not run) and always
// ship with a text label (legend + tooltip), never color alone.

import { escapeHtml } from '../shared/util.js';

export const SERIES = [
  { key: 'pass', label: 'Pass', color: 'var(--status-pass)' },
  { key: 'fail', label: 'Fail', color: 'var(--status-fail)' },
  { key: 'blocked', label: 'Blocked', color: 'var(--status-blocked)' },
  { key: 'notrun', label: 'Not run', color: 'var(--status-notrun)' },
];

/** Buckets recordings into the last `days` calendar days. */
export function bucketByDay(recordings, days = 14) {
  const out = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    out.push({ date: d, pass: 0, fail: 0, blocked: 0, notrun: 0 });
  }
  const start = out[0].date.getTime();
  for (const r of recordings) {
    if (r.status === 'recording' || r.status === 'paused') continue;
    const t = new Date(r.createdAt);
    t.setHours(0, 0, 0, 0);
    const idx = Math.round((t.getTime() - start) / 86400000);
    if (idx < 0 || idx >= out.length) continue;
    out[idx][r.result || 'notrun'] = (out[idx][r.result || 'notrun'] || 0) + 1;
  }
  return out;
}

/** Path for a rect with only the top corners rounded. */
function topRounded(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function renderResultsChart(container, buckets) {
  const W = Math.max(280, Math.floor(container.clientWidth || 560));
  const H = 120;
  const padL = 22;
  const padB = 18;
  const padT = 6;
  const plotH = H - padB - padT;
  const max = Math.max(1, ...buckets.map((b) => SERIES.reduce((n, s) => n + b[s.key], 0)));
  const niceMax = max <= 4 ? max : Math.ceil(max / 2) * 2;
  const slot = (W - padL) / buckets.length;
  const barW = Math.min(22, slot * 0.62);
  const y = (v) => padT + plotH - (v / niceMax) * plotH;

  const ticks = niceMax <= 4 ? [...Array(niceMax + 1).keys()] : [0, niceMax / 2, niceMax];
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Test results per day, last ${buckets.length} days">`;
  for (const t of ticks) {
    svg += `<line class="${t === 0 ? 'baseline' : 'gridline'}" x1="${padL}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/>`;
    svg += `<text class="axis" x="${padL - 6}" y="${y(t) + 3}" text-anchor="end">${t}</text>`;
  }

  buckets.forEach((b, i) => {
    const cx = padL + slot * i + slot / 2;
    const x = cx - barW / 2;
    const total = SERIES.reduce((n, s) => n + b[s.key], 0);
    let acc = 0;
    const segs = SERIES.filter((s) => b[s.key] > 0);
    segs.forEach((s, j) => {
      const y0 = y(acc);
      const y1 = y(acc + b[s.key]);
      const isTop = j === segs.length - 1;
      const gap = j > 0 ? 2 : 0; // 2px surface gap between stacked segments
      const h = Math.max(0, y0 - y1 - gap);
      svg += isTop
        ? `<path d="${topRounded(x, y1, barW, h, 4)}" fill="${s.color}"/>`
        : `<rect x="${x}" y="${y1}" width="${barW}" height="${h}" fill="${s.color}"/>`;
      acc += b[s.key];
    });
    if (i % 2 === (buckets.length - 1) % 2) {
      const label = `${b.date.getDate()}/${b.date.getMonth() + 1}`;
      svg += `<text class="axis" x="${cx}" y="${H - 4}" text-anchor="middle">${label}</text>`;
    }
    svg += `<rect class="hit" data-i="${i}" x="${padL + slot * i}" y="${padT}" width="${slot}" height="${plotH}" rx="4"><title>${total} run${total === 1 ? '' : 's'}</title></rect>`;
  });
  svg += '</svg>';

  container.innerHTML = `<div class="chart">${svg}</div><div class="chart-tip" hidden></div>`;
  // Hit rects sit above the bars; send them behind so bars stay visible on hover.
  const svgEl = container.querySelector('svg');
  svgEl.querySelectorAll('.hit').forEach((h) => svgEl.insertBefore(h, svgEl.querySelector('line')));
  const tip = container.querySelector('.chart-tip');
  svgEl.addEventListener('mousemove', (e) => {
    const hit = e.target.closest('.hit');
    if (!hit) return (tip.hidden = true);
    const b = buckets[+hit.dataset.i];
    const total = SERIES.reduce((n, s) => n + b[s.key], 0);
    tip.innerHTML =
      `<b>${escapeHtml(b.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }))} · ${total} run${total === 1 ? '' : 's'}</b>` +
      SERIES.map((s) => `<div><span><i style="background:${s.color}"></i>${s.label}</span><span>${b[s.key]}</span></div>`).join('');
    tip.hidden = false;
    const box = container.getBoundingClientRect();
    const hb = hit.getBoundingClientRect();
    const left = Math.min(box.width - tip.offsetWidth - 4, Math.max(4, hb.left - box.left + hb.width / 2 - tip.offsetWidth / 2));
    tip.style.left = `${left}px`;
    tip.style.top = `${hb.top - box.top - tip.offsetHeight + 10}px`;
  });
  svgEl.addEventListener('mouseleave', () => (tip.hidden = true));
}

export function legendHtml() {
  return `<div class="legend">${SERIES.map((s) => `<span><i style="background:${s.color}"></i>${s.label}</span>`).join('')}</div>`;
}
