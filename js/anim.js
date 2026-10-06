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

function out(v) {
  return { pos: v.pos.slice(), target: v.target.slice(), lens: Math.exp(v.lens[0]), roll: v.roll[0] };
}

/** استيفاء عام لأي مفاتيح: valuesOf(k, i) بيرجع {اسم: [أرقام]}.
 *  ناعم = منحنى بيمر بالمفاتيح بدون تجاوز. خطي = سرعة ثابتة. */
export function evalKeys(keys, t, valuesOf) {
  const n = keys.length;
  if (!n) return null;
  if (n === 1 || t <= keys[0].t) return valuesOf(keys[0], 0);
  if (t >= keys[n - 1].t) return valuesOf(keys[n - 1], n - 1);

  let i = 0;
  while (i < n - 2 && t >= keys[i + 1].t) i++;
  const k0 = keys[i], k1 = keys[i + 1];
  const dt = k1.t - k0.t;
  if (dt < 1e-6) return valuesOf(k1, i + 1);
  const u = (t - k0.t) / dt;

  const v0 = valuesOf(k0, i), v1 = valuesOf(k1, i + 1);
  const props = Object.keys(v0);
  const res = {};
  if (k0.ease === 'linear') {
    for (const p of props) res[p] = lerpArr(v0[p], v1[p], u);
    return res;
  }
  const vp = i > 0 ? valuesOf(keys[i - 1], i - 1) : null;
  const vn = i + 2 < n ? valuesOf(keys[i + 2], i + 2) : null;
  for (const p of props) {
    const zero = v0[p].map(() => 0);
    const m0 = vp ? tangent(vp[p], v0[p], v1[p], k0.t - keys[i - 1].t, dt) : zero;
    const m1 = vn ? tangent(v0[p], v1[p], vn[p], dt, keys[i + 2].t - k1.t) : zero;
    res[p] = hermite(v0[p], v1[p], m0, m1, dt, u);
  }
  return res;
}

/** وضع الكاميرا بالوقت t.
 *  keys لازم تكون مرتبة. resolveTarget(k) بترجع نقطة الهدف (مثلاً مكان مجسم متحرك بهاللحظة). */
export function evalCamera(keys, t, resolveTarget) {
  const r = evalKeys(keys, t, (k) => keyValues(k, resolveTarget));
  return r && out(r);
}

/* ---------- حركة المجسمات بالمفاتيح ---------- */

// الدوران بيلف من أقصر طريق: لو المفتاح 170° والتاني -170° بيلف 20° مش 340°
function unwrapRotations(keys) {
  const outR = [];
  let prev = null;
  for (const k of keys) {
    const r = k.rot.slice();
    if (prev) {
      for (let i = 0; i < 3; i++) {
        while (r[i] - prev[i] > Math.PI) r[i] -= 2 * Math.PI;
        while (r[i] - prev[i] < -Math.PI) r[i] += 2 * Math.PI;
      }
    }
    outR.push(r);
    prev = r;
  }
  return outR;
}

/** مكان ودوران وحجم المجسم بالوقت t، أو null إذا ما إله مفاتيح. keys مرتبة. */
export function evalObject(keys, t) {
  if (!keys || !keys.length) return null;
  const rots = unwrapRotations(keys);
  return evalKeys(keys, t, (k, i) => ({ pos: k.pos, rot: rots[i], scale: k.scale }));
}

/** نقاط مسار المجسم للرسم. */
export function sampleObjectPath(keys, steps = 80) {
  if (!keys || keys.length < 2) return [];
  const t0 = keys[0].t, t1 = keys[keys.length - 1].t;
  const pts = [];
  for (let s = 0; s <= steps; s++) pts.push(evalObject(keys, t0 + ((t1 - t0) * s) / steps).pos);
  return pts;
}

/** نقاط مسار الكاميرا للرسم بالمشهد. */
export function sampleCameraPath(keys, steps = 120) {
  if (keys.length < 2) return keys.map((k) => k.pos.slice());
  const t0 = keys[0].t, t1 = keys[keys.length - 1].t;
  const pts = [];
  for (let s = 0; s <= steps; s++) pts.push(evalCamera(keys, t0 + ((t1 - t0) * s) / steps).pos);
  return pts;
}

/* ---------- مدة المشهد ---------- */

/** بيرجّع المفاتيح والحركات لجوّا المدة الجديدة بدل ما تضيع. */
export function fitToDuration(project, duration) {
  project.duration = duration;
  const fit = (keys) => {
    const used = new Set();
    for (const k of sortKeys(keys)) {
      let t = clamp(k.t, 0, duration);
      while (used.has(snapTime(t)) && t > 0) t = snapTime(t - 0.1);
      k.t = snapTime(t);
      used.add(k.t);
    }
    keys.sort((a, b) => a.t - b.t);
  };
  fit(project.keys);
  for (const o of project.objects) if (o.keys) fit(o.keys);
}
