/* ==========================================================================
   لقطة — شريط الوقت
   سحب على الشريط = تنقّل بالوقت. نقرة على مفتاح = انتقال له. سحب المفتاح = تغيير وقته.
   ========================================================================== */

import { clamp, snapTime, KEY_EPS } from './anim.js';

const PAD = 18;
const DRAG_PX = 7;

export class Timeline {
  constructor(el, cb) {
    this.el = el;
    this.cb = cb;
    this.state = { duration: 10, keys: [], bars: [], time: 0 };
    el.innerHTML = `
      <div class="tl-ruler"></div>
      <div class="tl-row tl-cam"><span class="tl-label">كاميرا</span></div>
      <div class="tl-row tl-obj"><span class="tl-label">مجسمات</span></div>
      <div class="tl-head"><i></i></div>`;
    this.ruler = el.querySelector('.tl-ruler');
    this.camRow = el.querySelector('.tl-cam');
    this.objRow = el.querySelector('.tl-obj');
    this.head = el.querySelector('.tl-head');
    this.width = el.clientWidth || 300;
    this.drag = null;

    new ResizeObserver(() => {
      this.width = el.clientWidth || 300;
      this.render(this.state);
    }).observe(el);

    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', (e) => this.onUp(e, true));
  }

  x(t) {
    return PAD + (t / this.state.duration) * (this.width - 2 * PAD);
  }

  timeAt(clientX) {
    const r = this.el.getBoundingClientRect();
    return clamp(((clientX - r.left - PAD) / (r.width - 2 * PAD)) * this.state.duration, 0, this.state.duration);
  }

  /* ---------- الرسم ---------- */

  render(state) {
    this.state = state;
    const { duration } = state;

    // التدريج
    const step = duration <= 10 ? 1 : duration <= 20 ? 2 : 5;
    let html = '';
    for (let s = 0; s <= duration + 1e-6; s += 0.5) {
      const major = Math.abs(s % step) < 1e-6;
      const whole = Math.abs(s % 1) < 1e-6;
      if (!whole && duration > 10) continue;
      html += `<i class="${major ? 'mj' : whole ? 'mn' : 'hf'}" style="left:${this.x(s)}px">${major ? `<b>${s}s</b>` : ''}</i>`;
    }
    this.ruler.innerHTML = html;

    // مفاتيح الكاميرا
    let keys = '<span class="tl-label">كاميرا</span>';
    for (const k of state.keys) {
      const on = Math.abs(k.t - state.time) < KEY_EPS;
      keys += `<button class="tl-key${on ? ' on' : ''}${k.ease === 'linear' ? ' lin' : ''}" data-key="${k.id}" style="left:${this.x(k.t)}px" aria-label="مفتاح ${k.t.toFixed(1)} ثانية"><i></i></button>`;
    }
    this.camRow.innerHTML = keys;

    // حركات المجسمات
    let bars = '<span class="tl-label">مجسمات</span>';
    state.bars.forEach((b, i) => {
      const x0 = this.x(b.start), x1 = this.x(Math.min(b.start + b.dur, duration));
      const lane = state.bars.length > 1 ? (i % 2) * 9 - 4 : 0;
      bars += `<button class="tl-bar${b.selected ? ' sel' : ''}" data-obj="${b.id}" style="left:${x0}px;width:${Math.max(6, x1 - x0)}px;--c:${b.color};transform:translateY(${lane}px)" aria-label="${b.name}"></button>`;
    });
    this.objRow.innerHTML = bars;

    this.setTime(state.time);
  }

  setTime(t) {
    this.state.time = t;
    this.head.style.transform = `translateX(${this.x(t)}px)`;
  }

  /* ---------- اللمس ---------- */

  onDown(e) {
    if (this.drag) return;
    const keyEl = e.target.closest('.tl-key');
    const barEl = e.target.closest('.tl-bar');
    this.el.setPointerCapture(e.pointerId);
    this.drag = { id: e.pointerId, x0: e.clientX, kind: 'scrub' };
    if (keyEl) {
      this.drag.kind = 'key-pending';
      this.drag.key = keyEl.dataset.key;
    } else if (barEl) {
      this.drag.kind = 'bar-pending';
      this.drag.obj = barEl.dataset.obj;
    } else {
      this.cb.scrub(this.timeAt(e.clientX));
    }
  }

  onMove(e) {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    const moved = Math.abs(e.clientX - d.x0) > DRAG_PX;
    if (d.kind === 'key-pending' && moved) d.kind = 'key-drag';
    if (d.kind === 'bar-pending' && moved) d.kind = 'scrub';
    if (d.kind === 'key-drag') this.cb.keyMove(d.key, snapTime(this.timeAt(e.clientX)));
    else if (d.kind === 'scrub') this.cb.scrub(this.timeAt(e.clientX));
  }

  onUp(e, cancelled = false) {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    this.drag = null;
    if (cancelled) return;
    if (d.kind === 'key-pending') this.cb.keyTap(d.key);
    else if (d.kind === 'key-drag') this.cb.keyMoveEnd(d.key);
    else if (d.kind === 'bar-pending') this.cb.barTap(d.obj);
  }
}
