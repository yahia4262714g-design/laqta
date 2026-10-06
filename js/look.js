/* ==========================================================================
   لقطة — وضع "التفاف" للكاميرا (Pan / Tilt في مكانها)
   إصبع واحد: الكاميرا بتلف حول نفسها (بدل ما تدور حول الهدف).
   إصبعين: سحب = Truck / Pedestal، قرص = Dolly لقدام وورا.
   ========================================================================== */

const MAX_PITCH = (85 * Math.PI) / 180;

export class LookControls {
  /**
   * @param {HTMLElement} el
   * @param {{ get(): {pos:number[], target:number[]}, set(pos:number[], target:number[]):void, radPerPx():number, worldPerPx():number }} api
   */
  constructor(el, api) {
    this.el = el;
    this.api = api;
    this.enabled = false;
    this.pointers = new Map();
    this.prev = null;
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.up(e));
  }

  down(e) {
    if (!this.enabled) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.prev = this.snapshot();
  }

  up(e) {
    if (!this.pointers.delete(e.pointerId)) return;
    this.prev = this.pointers.size ? this.snapshot() : null;
  }

  snapshot() {
    const pts = [...this.pointers.values()];
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    return { n: pts.length, cx, cy, dist };
  }

  move(e) {
    if (!this.enabled || !this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const cur = this.snapshot();
    const prev = this.prev;
    this.prev = cur;
    if (!prev || prev.n !== cur.n) return;

    const { pos, target } = this.api.get();
    const dir = [target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]];
    const dist = Math.hypot(...dir) || 1;
    const dx = cur.cx - prev.cx, dy = cur.cy - prev.cy;

    // ماوس: زر يمين أو Shift = Pan بدل اللف
    const mousePan = e.pointerType === 'mouse' && ((e.buttons & 2) || e.shiftKey);
    if (cur.n === 1 && !mousePan) {
      const k = this.api.radPerPx();
      let yaw = Math.atan2(dir[0], dir[2]) + dx * k;
      let pitch = Math.asin(Math.max(-1, Math.min(1, dir[1] / dist))) + dy * k;
      pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch));
      const nt = [
        pos[0] + Math.sin(yaw) * Math.cos(pitch) * dist,
        pos[1] + Math.sin(pitch) * dist,
        pos[2] + Math.cos(yaw) * Math.cos(pitch) * dist,
      ];
      this.api.set(pos, nt);
      return;
    }

    // إصبعين
    const f = dir.map((v) => v / dist);
    const right = [-f[2], 0, f[0]];
    const rl = Math.hypot(right[0], right[2]) || 1;
    right[0] /= rl; right[2] /= rl;
    const w = this.api.worldPerPx();
    const fwd = cur.n > 1 ? (cur.dist - prev.dist) * w * 1.5 : 0;
    const move = [
      -right[0] * dx * w + f[0] * fwd,
      dy * w + f[1] * fwd,
      -right[2] * dx * w + f[2] * fwd,
    ];
    this.api.set(pos.map((v, i) => v + move[i]), target.map((v, i) => v + move[i]));
  }
}
