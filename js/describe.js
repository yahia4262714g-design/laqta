/* ==========================================================================
   لقطة — وصف الحركة كنص للبرومبت
   بيقرأ مفاتيح الكاميرا والمجسمات وبيكتب وصف إنجليزي متل مدير التصوير:
   حجم اللقطة، زاوية الكاميرا، نوع الحركة، السرعة، والعدسة — لكل مقطع بالثواني.
   ========================================================================== */

import { evalCamera, evalObject, sortKeys, ASPECTS } from './anim.js';

const DEG = 180 / Math.PI;
const sub = (a, b) => a.map((v, i) => v - b[i]);
const len = (v) => Math.hypot(...v);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const fmt = (t) => (Math.round(t * 10) / 10).toFixed(1);
const r0 = (v) => Math.round(v);

// ارتفاع المجسم الحقيقي (للحكم على حجم اللقطة)
const HEIGHT = { cube: 1, rect: 1.4, sphere: 1, cylinder: 1, person: 1.8, wall: 2.5, image: 1 };
const KIND = { person: 'person', rect: 'car', image: 'product' };

function objectAt(o, t) {
  return evalObject(o.keys, t) || o;
}

/** حجم اللقطة حسب قديش الموضوع مالي ارتفاع الكادر. */
function shotSize(subjectH, dist, lens, aspect, isPerson) {
  const sensorH = aspect >= 1 ? 36 / aspect : 36;
  const visible = (dist * sensorH) / lens;
  const r = subjectH / visible;
  if (isPerson) {
    if (r >= 2.2) return 'extreme close-up';
    if (r >= 1.3) return 'close-up';
    if (r >= 0.95) return 'medium close-up';
    if (r >= 0.7) return 'medium shot';
    if (r >= 0.45) return 'full shot';
    if (r >= 0.18) return 'wide shot';
    return 'extreme wide shot';
  }
  if (r >= 1.6) return 'extreme close-up detail';
  if (r >= 0.9) return 'close-up';
  if (r >= 0.5) return 'medium shot';
  if (r >= 0.2) return 'wide shot';
  return 'extreme wide shot';
}

function angleOf(pos, target) {
  const f = sub(target, pos);
  const pitch = Math.asin(Math.max(-1, Math.min(1, f[1] / (len(f) || 1)))) * DEG;
  if (pitch < -65) return 'top-down overhead';
  if (pitch < -25) return 'high angle';
  if (pos[1] < 0.6 && pitch > 2) return 'ground-level low angle';
  if (pitch > 12) return 'low angle';
  if (pos[1] < 0.6) return 'ground-level';
  return 'eye level';
}

function speedWord(mps) {
  if (mps < 0.35) return 'very slow';
  if (mps < 1) return 'slow';
  if (mps < 2.5) return 'steady';
  if (mps < 5) return 'fast';
  return 'very fast';
}

/** أسماء المجسمات القريبة من نقطة (لما الكاميرا تنظر لنقطة مش لعنصر). */
function nearNames(p, point, t) {
  const near = p.objects
    .filter((o) => o.type !== 'wall')
    .map((o) => ({ o, d: len(sub(objectAt(o, t).pos, point)) }))
    .filter((x) => x.d < 2.5)
    .sort((a, b) => a.d - b.d);
  if (!near.length) {
    const nearest = p.objects.filter((o) => o.type !== 'wall').map((o) => ({ o, d: len(sub(objectAt(o, t).pos, point)) })).sort((a, b) => a.d - b.d)[0];
    return nearest && nearest.d < 10 ? `the open area near ${nearest.o.name}` : 'the open space';
  }
  if (near.length === 1) return near[0].o.name;
  return `the group (${near.slice(0, 4).map((x) => x.o.name).sort().join(', ')})`;
}

const yawOf = (v) => Math.atan2(v[0], v[2]) * DEG;
const wrap = (d) => { while (d > 180) d -= 360; while (d < -180) d += 360; return d; };

/** وصف مقطع واحد من الكاميرا بين مفتاحين. */
function describeSegment(p, k0, k1, ctx) {
  const t0 = k0.t, t1 = k1.t, dt = Math.max(t1 - t0, 1e-3);
  const at = (t) => evalCamera(ctx.keys, t, ctx.resolve(t));
  const N = 24;
  const S = Array.from({ length: N + 1 }, (_, i) => { const t = t0 + (dt * i) / N; return { t, c: at(t) }; });
  const c0 = S[0].c, c1 = S[N].c;
  const subj0 = k0.targetObj && ctx.byId.get(k0.targetObj);
  const subj1 = k1.targetObj && ctx.byId.get(k1.targetObj);
  const sameSubject = subj0 && subj0 === subj1;
  const pointTarget = !subj0 && !subj1 && len(sub(c0.target, c1.target)) < 0.4;
  const parts = [];

  const f = sub(c0.target, c0.pos);
  const fl = Math.hypot(f[0], f[2]) || 1;
  const F = [f[0] / fl, 0, f[2] / fl];
  const R = [-F[2], 0, F[0]];
  const move = sub(c1.pos, c0.pos);
  const dist = len(move);
  const dy = move[1], fwd = dot(move, F), side = dot(move, R);
  const camSpeed = dist / dt;
  const d0 = len(sub(c0.target, c0.pos)), d1 = len(sub(c1.target, c1.pos));

  // حركة الموضوع خلال المقطع
  const sPos = (t) => (subj0 ? objectAt(subj0, t).pos : null);
  const sMove = subj0 ? sub(sPos(t1), sPos(t0)) : [0, 0, 0];
  const sDist = len(sMove);
  const subjMoves = sDist > 0.3;

  // Orbit حقيقي: الزاوية حوالين الهدف بتتغير ونصف القطر شبه ثابت
  let orbit = 0, rMin = Infinity, rMax = 0;
  if (sameSubject || pointTarget) {
    let prev = null;
    for (const { c } of S) {
      const rel = sub(c.pos, c.target);
      const r = Math.hypot(rel[0], rel[2]);
      rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
      const a = Math.atan2(rel[0], rel[2]);
      if (prev !== null) orbit += wrap((a - prev) * DEG);
      prev = a;
    }
  }
  const arc = (Math.abs(orbit) / DEG) * ((rMin + rMax) / 2);
  const isOrbit = dist > 0.15 && Math.abs(orbit) > 25 && rMin > 0.8 && rMin / rMax > 0.55 && arc > 1.5 * sDist;
  const isArc = !isOrbit && dist > 0.15 && Math.abs(orbit) > 30 && rMin > 0.6 && arc > sDist;

  // الكاميرا ماشية مع الموضوع (لحاق أو قيادة)
  const along = subjMoves ? dot(move, sMove) / sDist : 0;
  const parallel = subjMoves && dist > 0.15 && along > 0.3 * sDist && along < 2.5 * sDist && Math.abs(d1 - d0) < Math.max(0.6, 0.35 * d0);

  // مرور فوق أو جنب مجسم
  const passes = [];
  for (const o of p.objects) {
    if (o.type === 'wall') continue;
    const top = (HEIGHT[o.type] || 1) * (objectAt(o, t0).scale?.[1] || 1);
    let over = false, beside = false;
    for (const { t, c } of S) {
      const op = objectAt(o, t).pos;
      const hd = Math.hypot(c.pos[0] - op[0], c.pos[2] - op[2]);
      if (hd < 1.0 && c.pos[1] > op[1] + top / 2 + 0.25) over = true;
      else if (hd < 1.0) beside = true;
    }
    if (over) passes.push({ o, kind: 'over' });
    else if (beside && o !== subj0) passes.push({ o, kind: 'beside' });
  }
  const overList = passes.filter((x) => x.kind === 'over').map((x) => x.o);
  const overSubject = subj0 && overList.includes(subj0);
  const overOthers = overList.filter((o) => o !== subj0);

  // الكاميرا بتسبق الموضوع (من وراه لقدامه)
  const facing = subj0 ? objectAt(subj0, t0).rot?.[1] ?? 0 : 0;
  const fv = [Math.sin(facing), 0, Math.cos(facing)];
  const side0 = subj0 ? dot(sub(c0.pos, sPos(t0)), fv) : 0;
  const side1 = subj0 ? dot(sub(c1.pos, sPos(t1)), fv) : 0;
  const overtakes = sameSubject && subj0.type === 'person' && side0 < 0.05 && side1 > 0.3;

  // الاتجاه العام للنظر اتغيّر كتير؟
  const swing = wrap(yawOf(sub(c1.target, c1.pos)) - yawOf(f));

  if (dist < 0.15) {
    const g1 = sub(c1.target, c1.pos);
    const yaw = swing;
    const pitch = (Math.asin(g1[1] / (len(g1) || 1)) - Math.asin(f[1] / (len(f) || 1))) * DEG;
    const fast = Math.abs(yaw) / dt > 150;
    if (Math.abs(yaw) > 8) parts.push(`${fast ? 'whip-pans' : 'pans'} ${yaw > 0 ? 'left' : 'right'} ${r0(Math.abs(yaw))}°`);
    if (Math.abs(pitch) > 6) parts.push(`tilts ${pitch > 0 ? 'up' : 'down'} ${r0(Math.abs(pitch))}°`);
    if (subjMoves && sameSubject) {
      const minD = Math.min(...S.map(({ t, c }) => len(sub(objectAt(subj0, t).pos, c.pos))));
      parts.push(minD < 4 ? `following ${subj0.name} as it rushes past the lens` : `following ${subj0.name}`);
    }
    if (!parts.length) parts.push('holds completely still (locked-off)');
    parts.unshift('stays fixed in place,');
  } else if (overtakes) {
    const how = dy > 0.6 ? ', craning up and over their shoulder' : dy < -0.6 ? ', dropping down from above their shoulder' : '';
    parts.push(`overtakes ${subj0.name}${how} to end up in front of them, facing them`);
  } else if (overSubject && sameSubject) {
    parts.push(`rises up and over ${subj0.name}'s shoulder`);
  } else if (parallel && sameSubject && !isOrbit) {
    const sp0 = sPos(t0);
    const front = dot(sub(c0.pos, sp0), fv) > 0;
    const lead = front && subj0.type === 'person';
    parts.push(lead ? `leads ${subj0.name}, moving backwards in front of them` : `tracks with ${subj0.name}${front ? ' from the front' : ' from behind'}`);
    const lateral = dot(move, R) - dot(sMove, R);
    if (Math.abs(lateral) > 0.4) parts.push(`drifting ${lateral > 0 ? 'right' : 'left'}`);
    if (Math.abs(d1 - d0) > Math.max(0.4, d0 * 0.2)) parts.push(lead ? (d1 > d0 ? 'pulling further ahead' : 'letting them close in') : (d1 > d0 ? 'falling back' : 'closing in'));
    if (Math.abs(dy) > 0.6) parts.push(dy > 0 ? `craning up ${dy.toFixed(1)} m` : `craning down ${(-dy).toFixed(1)} m`);
  } else if (isOrbit || isArc) {
    parts.push(`${isOrbit ? 'orbits' : 'arcs'} ${orbit > 0 ? 'right' : 'left'} ${r0(Math.abs(orbit))}° around ${subj0 ? subj0.name : nearNames(p, c0.target, t0)}`);
    if (Math.abs(d1 - d0) > Math.max(0.3, d0 * 0.15)) parts.push(d1 < d0 ? 'tightening in' : 'widening out');
    if (Math.abs(dy) > 0.4) parts.push(dy > 0 ? `rising ${dy.toFixed(1)} m` : `descending ${(-dy).toFixed(1)} m`);
  } else {
    if (Math.abs(dy) > 0.4) parts.push(Math.abs(dy) > 1.2 ? `cranes ${dy > 0 ? 'up' : 'down'} ${Math.abs(dy).toFixed(1)} m` : `pedestals ${dy > 0 ? 'up' : 'down'} ${Math.abs(dy).toFixed(1)} m`);
    if (Math.abs(fwd) > 0.2) parts.push(Math.abs(fwd) < 0.6 ? (fwd > 0 ? `slowly pushes in ${fwd.toFixed(1)} m` : `slowly eases back ${(-fwd).toFixed(1)} m`) : `${fwd > 0 ? 'dollies in' : 'dollies out'} ${Math.abs(fwd).toFixed(1)} m`);
    if (Math.abs(side) > 0.3) parts.push(`trucks ${side > 0 ? 'right' : 'left'} ${Math.abs(side).toFixed(1)} m`);
    if (!parts.length) parts.push('barely moves (subtle breathing drift)');
    if (subjMoves && sameSubject) parts.push(`while ${subj0.name} moves ${sDist.toFixed(1)} m`);
  }

  if (overOthers.length) parts.push(`flying over ${overOthers.length > 1 ? `the group (${overOthers.map((o) => o.name).sort().join(', ')})` : overOthers[0].name}`);
  const besides = passes.filter((x) => x.kind === 'beside').map((x) => x.o.name);
  if (besides.length) parts.push(`passing close beside ${besides.join(', ')}`);
  if (Math.abs(swing) > 100 && dist >= 0.15) parts.push(`swinging around ${r0(Math.abs(swing))}°`);

  // تغيير الهدف
  const name0 = subj0 ? subj0.name : nearNames(p, c0.target, t0);
  const name1 = subj1 ? subj1.name : nearNames(p, c1.target, t1);
  if (!sameSubject && !pointTarget && name0 !== name1) parts.push(`re-framing from ${name0} to ${name1}`);
  else if (!subj0 && !subj1 && dist >= 0.15 && !isOrbit) parts.push(`framed on ${name1}`);
  // العدسة والميلان
  if (Math.abs(c1.lens - c0.lens) > 2) parts.push(`${c1.lens > c0.lens ? 'zooming in' : 'zooming out'} ${r0(c0.lens)}→${r0(c1.lens)} mm`);
  if (Math.abs((c1.roll || 0) - (c0.roll || 0)) > 2) parts.push(Math.abs(c1.roll) < 1 ? 'levelling out the dutch angle' : `rolling into a ${r0(Math.abs(c1.roll))}° dutch angle`);

  const pace = dist < 0.15 ? '' : `, ${speedWord(camSpeed)}`;
  const ease = k0.ease === 'linear' ? ', constant speed' : ', smooth ease in/out';
  const cut = camSpeed > 7 ? ' (very fast reposition — consider a cut here)' : '';

  const frameAt = (c, t, subj) => {
    const sp = subj ? objectAt(subj, t) : null;
    const h = sp ? (HEIGHT[subj.type] || 1) * (sp.scale?.[1] || 1) : 1.7;
    const d = sp ? len(sub(sp.pos, c.pos)) : len(sub(c.target, c.pos));
    return `${shotSize(h, d, c.lens, ctx.aspect, subj?.type === 'person')}, ${angleOf(c.pos, c.target)}, ${r0(c.lens)} mm`;
  };
  const f0 = frameAt(c0, t0, subj0), f1 = frameAt(c1, t1, subj1 || subj0);
  const frames = f0 === f1 ? f0 : `${f0} → ${f1}`;
  return `${fmt(t0)}–${fmt(t1)} s: ${frames}. Camera ${parts.join(', ').replace(/,,/g, ',')}${pace}${ease}${cut}.`;
}

/** وصف حركة المجسمات (مشي، سواقة، لف، انقلاب…) مع كشف الـ Slow Motion. */
function describeObjects(p) {
  const lines = [];
  for (const o of p.objects) {
    const ks = o.keys || [];
    if (ks.length < 2) continue;
    const segs = [];
    let prevSpeed = null;
    for (let i = 0; i < ks.length - 1; i++) {
      const a = ks[i], b = ks[i + 1];
      const dt = Math.max(b.t - a.t, 1e-3);
      const d = len(sub(b.pos, a.pos));
      const speed = d / dt;
      const turn = (b.rot[1] - a.rot[1]) * DEG;
      const tilt = Math.max(Math.abs(b.rot[0] - a.rot[0]), Math.abs(b.rot[2] - a.rot[2])) * DEG;
      const scale = b.scale[1] / (a.scale[1] || 1);
      const bits = [];
      if (d < 0.05 && Math.abs(turn) < 3 && tilt < 3 && Math.abs(scale - 1) < 0.03) bits.push('holds still');
      else {
        if (d >= 0.05) {
          const verb = o.type === 'person' ? (speed > 2.5 ? 'runs' : 'walks') : o.type === 'rect' ? 'drives' : 'moves';
          bits.push(`${verb} ${d.toFixed(1)} m${d > 0.3 ? ` at ${speedWord(speed)} pace` : ''}`);
        }
        if (Math.abs(turn) >= 3) bits.push(`turns ${r0(Math.abs(turn))}° ${turn > 0 ? 'left' : 'right'}`);
        if (tilt >= 3) bits.push(tilt > 60 ? `rolls over ${r0(tilt)}°` : `tilts ${r0(tilt)}°`);
        if (Math.abs(scale - 1) >= 0.03) bits.push(scale > 1 ? 'grows' : 'shrinks');
        if (prevSpeed && speed > 0.05 && prevSpeed / speed > 4) bits.push('in slow motion (speed ramp)');
        if (prevSpeed !== null && prevSpeed > 0.05 && speed / prevSpeed > 4) bits.push('snapping back to real time');
      }
      if (b === ks[ks.length - 1] && d >= 0.05 && a.ease !== 'linear') bits.push('and eases to a stop');
      segs.push(`${fmt(a.t)}–${fmt(b.t)} s ${bits.join(', ')}`);
      prevSpeed = d >= 0.05 ? speed : 0;
    }
    lines.push(`- ${o.name} (${KIND[o.type] || o.type}): ${segs.join('; ')}.`);
  }
  return lines;
}

// الأسماء العربية بتتحول لأسماء إنجليزية واضحة، لأن البرومبت إنجليزي
const BY_WORD = [[/سيار|عربي|car/i, 'Car'], [/شخص|رجل|مار|ماشي|بنت|امرأة|ولد|man|woman|person/i, 'Person'], [/منتج|علبة|قنينة|product/i, 'Product'], [/بناي|مبنى|building/i, 'Building'], [/جدار|حيط|wall/i, 'Wall'], [/إشارة|عمود|pole/i, 'Pole'], [/طاول|table/i, 'Table'], [/كرة|ball/i, 'Ball']];
const BY_TYPE = { cube: 'Cube', rect: 'Block', sphere: 'Ball', cylinder: 'Cylinder', person: 'Person', wall: 'Wall', image: 'Product' };

function englishNames(objects) {
  const arabic = /[\u0600-\u06FF]/;
  const base = objects.map((o) => (arabic.test(o.name) ? (BY_WORD.find(([re]) => re.test(o.name))?.[1] || BY_TYPE[o.type] || 'Object') : o.name));
  const count = {};
  for (const b of base) count[b] = (count[b] || 0) + 1;
  const seen = {};
  return objects.map((o, i) => {
    if (!arabic.test(o.name)) return o;
    const b = base[i];
    seen[b] = (seen[b] || 0) + 1;
    return { ...o, name: count[b] > 1 ? `${b} ${seen[b]}` : b };
  });
}

/** النص الكامل: لائحة لقطات بالثواني + فقرة جاهزة للبرومبت. */
export function describeProject(project) {
  const p = { ...project, objects: englishNames(project.objects), name: /[\u0600-\u06FF]/.test(project.name) ? 'Shot' : project.name };
  const aspect = ASPECTS[p.aspect] || 9 / 16;
  const keys = sortKeys(p.keys);
  const byId = new Map(p.objects.map((o) => [o.id, o]));
  const resolve = (t) => (k) => (k.targetObj && byId.has(k.targetObj) ? objectAt(byId.get(k.targetObj), t).pos : k.target);
  const ctx = { keys, byId, resolve, aspect };
  const head = `${p.aspect} vertical`.replace('16:9 vertical', '16:9 horizontal').replace('1:1 vertical', '1:1 square');

  const cam = [];
  if (!keys.length) {
    const c = p.camera;
    const subj = c.targetObj && byId.get(c.targetObj);
    cam.push(`0.0–${fmt(p.duration)} s: static camera, ${r0(c.lens)} mm, ${angleOf(c.pos, c.target)}${subj ? `, framed on ${subj.name}` : ''}.`);
  } else {
    if (keys[0].t > 0.05) cam.push(`0.0–${fmt(keys[0].t)} s: static hold on the opening frame.`);
    for (let i = 0; i < keys.length - 1; i++) cam.push(describeSegment(p, keys[i], keys[i + 1], ctx));
    if (keys.length === 1) cam.push(`${fmt(keys[0].t)}–${fmt(p.duration)} s: static camera, ${r0(keys[0].lens)} mm, ${angleOf(keys[0].pos, keys[0].target)}.`);
    const last = keys[keys.length - 1];
    if (keys.length > 1 && last.t < p.duration - 0.05) cam.push(`${fmt(last.t)}–${fmt(p.duration)} s: holds on the final frame.`);
  }

  const objs = describeObjects(p);
  const out = [
    `SHOT: ${p.name} — ${p.duration} s, ${head}, one continuous camera move.`,
    '',
    'CAMERA (timed):',
    ...cam.map((l) => `- ${l}`),
  ];
  if (objs.length) out.push('', 'SUBJECT MOTION:', ...objs);
  out.push('', 'STYLE: physically plausible camera with real inertia, no jitter, no sudden jumps; keep subjects and products consistent across the whole shot.');
  return out.join('\n');
}
