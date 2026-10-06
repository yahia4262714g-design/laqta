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
    this.state = { duration: 10, keys: [], objKeys: [], time: 0 };
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

    // التدريج: خط لكل ثانية (ونص ثانية بالمدد القصيرة)، والأرقام بمسافة مريحة حسب العرض
    const pxPerSec = (this.width - 2 * PAD) / duration;
    const label = [1, 2, 5, 10, 15, 30, 60].find((n) => n * pxPerSec >= 34) || 60;
    const tick = pxPerSec >= 24 ? 0.5 : pxPerSec >= 4 ? 1 : 5;
    let html = '';
    const n = Math.round(duration / tick);
    for (let i = 0; i <= n; i++) {
      const s = +(i * tick).toFixed(2);
      const whole = Math.abs(s - Math.round(s)) < 1e-6;
      const major = whole && Math.round(s) % label === 0;
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

    // مفاتيح حركة المجسمات: خط بلون العنصر بين مفاتيحه، والمحدد أوضح
    let objs = '<span class="tl-label">مجسمات</span>';
    for (const o of state.objKeys) {
      const cls = o.selected ? ' sel' : '';
      for (let i = 1; i < o.keys.length; i++) {
        const x0 = this.x(o.keys[i - 1].t), x1 = this.x(o.keys[i].t);
        objs += `<i class="tl-oseg${cls}" style="left:${x0}px;width:${x1 - x0}px;--c:${o.color}"></i>`;
      }
      for (const k of o.keys) {
        const on = o.selected && Math.abs(k.t - state.time) < KEY_EPS;
        objs += `<button class="tl-okey${cls}${on ? ' on' : ''}${k.ease === 'linear' ? ' lin' : ''}" data-obj="${o.id}" data-okey="${k.id}" style="left:${this.x(k.t)}px;--c:${o.color}" aria-label="${o.name} ${k.t.toFixed(1)}"><i></i></button>`;
      }
    }
    this.objRow.innerHTML = objs;

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
    const okeyEl = e.target.closest('.tl-okey');
    this.el.setPointerCapture(e.pointerId);
    this.drag = { id: e.pointerId, x0: e.clientX, kind: 'scrub' };
    if (keyEl) {
      this.drag.kind = 'key-pending';
      this.drag.key = keyEl.dataset.key;
    } else if (okeyEl) {
      this.drag.kind = 'okey-pending';
      this.drag.obj = okeyEl.dataset.obj;
      this.drag.key = okeyEl.dataset.okey;
    } else {
      this.cb.scrub(this.timeAt(e.clientX));
    }
  }

  onMove(e) {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    const moved = Math.abs(e.clientX - d.x0) > DRAG_PX;
    if (d.kind === 'key-pending' && moved) d.kind = 'key-drag';
    if (d.kind === 'okey-pending' && moved) d.kind = 'okey-drag';
    if (d.kind === 'key-drag') this.cb.keyMove(d.key, snapTime(this.timeAt(e.clientX)));
    else if (d.kind === 'okey-drag') this.cb.objKeyMove(d.obj, d.key, snapTime(this.timeAt(e.clientX)));
    else if (d.kind === 'scrub') this.cb.scrub(this.timeAt(e.clientX));
  }

  onUp(e, cancelled = false) {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    this.drag = null;
    if (cancelled) return;
    if (d.kind === 'key-pending') this.cb.keyTap(d.key);
    else if (d.kind === 'key-drag') this.cb.keyMoveEnd(d.key);
    else if (d.kind === 'okey-pending') this.cb.objKeyTap(d.obj, d.key);
    else if (d.kind === 'okey-drag') this.cb.keyMoveEnd();
  }
}
