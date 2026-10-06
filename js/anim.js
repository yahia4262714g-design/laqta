/* ==========================================================================
   لقطة — منطق الحركة
   حسابات صافية بدون Three.js عشان تنختبر لحالها بـ node.
   ========================================================================== */

export const KEY_EPS = 0.05;        // مفتاحين أقرب من هيك = نفس المفتاح
export const SENSOR = 36;           // الضلع الطويل للحساس بالمليمتر (Full Frame)
export const DURATIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120];   // اختيارات سريعة
export const MIN_DURATION = 1;
export const MAX_DURATION = 120;
export const ASPECTS = { '9:16': 9 / 16, '16:9': 16 / 9, '1:1': 1 };

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const snapTime = (t) => Math.round(t * 10) / 10;
export const easeInOut = (u) => u * u * (3 - 2 * u);

/** زاوية الرؤية العمودية (درجات) لعدسة بالمليمتر حسب نسبة الإطار.
 *  الضلع الطويل للإطار دايمًا = 36mm، فالعدسة بتعطي نفس الإحساس بكل النسب. */
export function fovFromLens(lens, aspect) {
  const h = aspect >= 1 ? SENSOR / aspect : SENSOR;
  return (2 * Math.atan(h / (2 * lens)) * 180) / Math.PI;
}

export function sortKeys(keys) {
  return keys.slice().sort((a, b) => a.t - b.t);
}

export function keyAt(keys, t, eps = KEY_EPS) {
  return keys.find((k) => Math.abs(k.t - t) < eps) || null;
}

/* ---------- الاستيفاء ---------- */

// ميل عند مفتاح وسطي، مع منع التجاوز (Fritsch–Carlson لكل محور):
// إذا الحركة بتغيّر اتجاهها أو بتوقف عند المفتاح، الميل صفر فما في اهتزاز ولا تجاوز.
function tangent(prev, cur, next, dt0, dt1) {
  const m = new Array(cur.length);
  for (let i = 0; i < cur.length; i++) {
    const d0 = (cur[i] - prev[i]) / dt0;
    const d1 = (next[i] - cur[i]) / dt1;
    if (d0 * d1 <= 0) { m[i] = 0; continue; }
    let v = (d0 + d1) / 2;
    const lim = 3 * Math.min(Math.abs(d0), Math.abs(d1));
    if (Math.abs(v) > lim) v = Math.sign(v) * lim;
    m[i] = v;
  }
  return m;
}

function hermite(p0, p1, m0, m1, dt, u) {
  const u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  return p0.map((_, i) => h00 * p0[i] + h10 * dt * m0[i] + h01 * p1[i] + h11 * dt * m1[i]);
}

const lerpArr = (a, b, u) => a.map((v, i) => v + (b[i] - v) * u);

/** قيم المفتاح بصيغة رقمية قابلة للاستيفاء.
 *  العدسة بتنحسب باللوغاريتم عشان الزوم يطلع ناعم ومتساوي الإحساس. */
function keyValues(k, resolveTarget) {
  return {
    pos: k.pos,
    target: resolveTarget ? resolveTarget(k) : k.target,
    lens: [Math.log(k.lens)],
    roll: [k.roll || 0],
  };
}

const PROPS = ['pos', 'target', 'lens', 'roll'];

function out(v) {
  return { pos: v.pos.slice(), target: v.target.slice(), lens: Math.exp(v.lens[0]), roll: v.roll[0] };
}

/** وضع الكاميرا بالوقت t.
 *  keys لازم تكون مرتبة. resolveTarget(k) بترجع نقطة الهدف (مثلاً مكان مجسم متحرك بهاللحظة). */
export function evalCamera(keys, t, resolveTarget) {
  const n = keys.length;
  if (!n) return null;
  if (n === 1 || t <= keys[0].t) return out(keyValues(keys[0], resolveTarget));
  if (t >= keys[n - 1].t) return out(keyValues(keys[n - 1], resolveTarget));

  let i = 0;
  while (i < n - 2 && t >= keys[i + 1].t) i++;
  const k0 = keys[i], k1 = keys[i + 1];
  const dt = k1.t - k0.t;
  if (dt < 1e-6) return out(keyValues(k1, resolveTarget));
  const u = (t - k0.t) / dt;

  const v0 = keyValues(k0, resolveTarget), v1 = keyValues(k1, resolveTarget);
  const res = {};

  if (k0.ease === 'linear') {
    for (const p of PROPS) res[p] = lerpArr(v0[p], v1[p], u);
    return out(res);
  }

  const vp = i > 0 ? keyValues(keys[i - 1], resolveTarget) : null;
  const vn = i + 2 < n ? keyValues(keys[i + 2], resolveTarget) : null;
  for (const p of PROPS) {
    const zero = v0[p].map(() => 0);
    const m0 = vp ? tangent(vp[p], v0[p], v1[p], k0.t - keys[i - 1].t, dt) : zero;
    const m1 = vn ? tangent(v0[p], v1[p], vn[p], dt, keys[i + 2].t - k1.t) : zero;
    res[p] = hermite(v0[p], v1[p], m0, m1, dt, u);
  }
  return out(res);
}

/** نقاط مسار الكاميرا للرسم بالمشهد. */
export function sampleCameraPath(keys, steps = 120) {
  if (keys.length < 2) return keys.map((k) => k.pos.slice());
  const t0 = keys[0].t, t1 = keys[keys.length - 1].t;
  const pts = [];
  for (let s = 0; s <= steps; s++) pts.push(evalCamera(keys, t0 + ((t1 - t0) * s) / steps).pos);
  return pts;
}

/* ---------- حركة المجسمات A → B ---------- */

/** نسبة التقدم (0..1) بعد التنعيم، أو null إذا الحركة مش جاهزة. */
export function motionProgress(m, t) {
  if (!m || !m.a || !m.b) return null;
  const u = clamp((t - m.start) / Math.max(m.dur, 1e-3), 0, 1);
  return m.ease === 'linear' ? u : easeInOut(u);
}

/** أي طرف من الحركة بينعدّل لما المستخدم يحرك المجسم بهاللحظة. */
export function motionEditTarget(m, t) {
  if (!m || !m.a || !m.b) return 'base';
  if (t <= m.start + 1e-3) return 'a';
  if (t >= m.start + m.dur - 1e-3) return 'b';
  return 'both';
}

/* ---------- مدة المشهد ---------- */

/** بيرجّع المفاتيح والحركات لجوّا المدة الجديدة بدل ما تضيع. */
export function fitToDuration(project, duration) {
  project.duration = duration;
  const used = new Set();
  for (const k of sortKeys(project.keys)) {
    let t = clamp(k.t, 0, duration);
    while (used.has(snapTime(t)) && t > 0) t = snapTime(t - 0.1);
    k.t = snapTime(t);
    used.add(k.t);
  }
  for (const o of project.objects) {
    const m = o.motion;
    if (!m) continue;
    m.start = clamp(m.start, 0, Math.max(0, duration - 0.1));
    m.dur = clamp(m.dur, 0.1, duration - m.start);
  }
}
