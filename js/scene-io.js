/* ==========================================================================
   لقطة — استيراد وتصدير المشهد كنص
   صيغة بسيطة بيكتبها Claude (أو أي حدا) بالنسخ واللصق، بدون سيرفر.
   الدوران بالدرجات، والمجسمات بتتسمّى بـ id نصي عشان الكاميرا تنظر لها.
   ========================================================================== */

import { evalObject, ASPECTS, MIN_DURATION, MAX_DURATION, clamp, snapTime, KEY_EPS } from './anim.js';
import { TYPES, PALETTE, IMAGE_SHAPES, uid } from './store.js';

const DEG = Math.PI / 180;
const r2 = (v) => Math.round(v * 100) / 100;
const r1 = (v) => Math.round(v * 10) / 10;

/* ---------- تصدير ---------- */

export function exportScene(p) {
  // بنحافظ على أسماء Claude (مثل "car") إذا موجودة وما بتتكرر
  const ids = new Map();
  const used = new Set();
  p.objects.forEach((o, i) => {
    let id = o.ref && /^[\w-]{1,24}$/.test(o.ref) && !used.has(o.ref) ? o.ref : `o${i + 1}`;
    while (used.has(id)) id += '_';
    used.add(id);
    ids.set(o.id, id);
  });
  const trs = (x, base = null) => {
    const out = {};
    if (!base || x.pos.some((v, i) => v !== base.pos[i])) out.pos = x.pos.map(r2);
    if (!base || x.rot.some((v, i) => v !== base.rot[i])) out.rot = x.rot.map((v) => r1(v / DEG));
    if (!base || x.scale.some((v, i) => v !== base.scale[i])) out.scale = x.scale.map(r2);
    return out;
  };
  return {
    laqta: 1,
    name: p.name,
    duration: p.duration,
    aspect: p.aspect,
    objects: p.objects.map((o) => {
      const e = { id: ids.get(o.id), type: o.type, name: o.name, color: o.color, ...trs(o) };
      if (o.type === 'image') Object.assign(e, { image: o.image, shape: o.shape, aspect: Math.round(o.aspect * 1000) / 1000 });
      if (o.keys.length) {
        // كل مفتاح بيكتب بس اللي تغيّر عن اللي قبله (المكان دايمًا)
        e.keys = o.keys.map((k, i) => {
          const d = trs(k, i ? o.keys[i - 1] : o);
          return { t: k.t, pos: k.pos.map(r2), ...(d.rot ? { rot: d.rot } : {}), ...(d.scale ? { scale: d.scale } : {}), ...(k.ease === 'linear' ? { ease: 'linear' } : {}) };
        });
      }
      return e;
    }),
    camera: (p.keys.length ? [...p.keys].sort((a, b) => a.t - b.t) : [{ t: 0, ...p.camera }]).map((k) => ({
      t: k.t,
      pos: k.pos.map(r2),
      target: k.targetObj && ids.has(k.targetObj) ? ids.get(k.targetObj) : k.target.map(r2),
      lens: r1(k.lens),
      ...(k.roll ? { roll: r1(k.roll) } : {}),
      ...(k.ease === 'linear' ? { ease: 'linear' } : {}),
    })),
  };
}

export function exportText(p) {
  const sc = exportScene(p);
  const one = (o) => JSON.stringify(o);
  const objs = sc.objects.map((o) => {
    const { keys, ...rest } = o;
    if (!keys) return `  ${one(rest)}`;
    return `  ${one(rest).slice(0, -1)},"keys":[\n${keys.map((k) => `    ${one(k)}`).join(',\n')}\n  ]}`;
  });
  return `{"laqta":1,"name":${one(sc.name)},"duration":${sc.duration},"aspect":${one(sc.aspect)},
 "objects":[
${objs.join(',\n')}
 ],
 "camera":[
${sc.camera.map((c) => `  ${one(c)}`).join(',\n')}
 ]}`;
}

/* ---------- استيراد ---------- */

class SceneError extends Error {}
const fail = (msg) => { throw new SceneError(msg); };

/** بيلقط الـ JSON من رد Claude حتى لو فيه كلام قبله أو بعده. */
export function extractJSON(text) {
  const t = String(text || '').trim();
  if (!t) fail('النص فاضي — الصق رد Claude أولاً.');
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = fence ? fence[1] : t;
  const a = body.indexOf('{'), b = body.lastIndexOf('}');
  if (a < 0 || b <= a) fail('ما لقيت مشهد بالنص. لازم يكون فيه { … } من رد Claude.');
  body = body.slice(a, b + 1);
  try {
    return JSON.parse(body);
  } catch {
    // تسامح مع أخطاء شائعة: تعليقات // وفواصل زيادة وعلامات تنصيص ذكية
    const fixed = body
      .replace(/[“”]/g, '"')
      .replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*/g, (m, str) => str || '')
      .replace(/,\s*([}\]])/g, '$1');
    try {
      return JSON.parse(fixed);
    } catch (e) {
      fail(`النص مش JSON صحيح (${e.message}). انسخ كتلة الكود كاملة من رد Claude.`);
    }
  }
}

function vec(v, where, { required = false, fallback = null } = {}) {
  if (v === undefined || v === null) {
    if (required) fail(`${where}: ناقص (لازم 3 أرقام [x, y, z]).`);
    return fallback;
  }
  if (!Array.isArray(v) || v.length !== 3 || v.some((n) => typeof n !== 'number' || !isFinite(n))) {
    fail(`${where}: لازم يكون 3 أرقام [x, y, z].`);
  }
  return v.slice();
}

function time(t, where, duration) {
  if (typeof t !== 'number' || !isFinite(t)) fail(`${where}: الوقت t لازم يكون رقم بالثواني.`);
  return clamp(snapTime(t), 0, duration);
}

/** بيحوّل نص المشهد لمشروع جاهز للتطبيق. بيرمي خطأ بالعربي بيوضح شو الغلط. */
export function importScene(text) {
  const s = extractJSON(text);
  if (typeof s !== 'object' || Array.isArray(s)) fail('المشهد لازم يكون كائن { … }.');

  const duration = clamp(Math.round(Number(s.duration) || 10), MIN_DURATION, MAX_DURATION);
  const aspect = ASPECTS[s.aspect] ? s.aspect : '9:16';
  if (s.objects !== undefined && !Array.isArray(s.objects)) fail('objects لازم تكون قائمة [ … ].');

  // المجسمات
  const idMap = new Map();
  const objects = (s.objects || []).map((e, i) => {
    const where = `العنصر ${e && e.id ? `"${e.id}"` : i + 1}`;
    if (!e || typeof e !== 'object') fail(`${where}: لازم يكون كائن.`);
    const type = String(e.type || '').toLowerCase();
    const isImage = type === 'image';
    if (!TYPES[type] && !isImage) fail(`${where}: النوع "${e.type}" مش معروف. المسموح: ${Object.keys(TYPES).join(' / ')} / image.`);
    const shape = isImage ? (IMAGE_SHAPES[e.shape] ? e.shape : 'card') : null;
    const h0 = isImage ? IMAGE_SHAPES[shape].height : 1;
    const key = String(e.id ?? `o${i + 1}`);
    if (idMap.has(key)) fail(`${where}: الـ id مكرر.`);
    const id = uid();
    idMap.set(key, id);
    const pos = vec(e.pos, `${where} → pos`, { fallback: [0, isImage ? h0 / 2 : TYPES[type].y, 0] });
    const rot = vec(e.rot, `${where} → rot`, { fallback: [0, 0, 0] }).map((v) => v * DEG);
    const scale = vec(e.scale, `${where} → scale`, { fallback: [h0, h0, h0] }).map((v) => Math.max(0.01, v));
    const color = /^#[0-9a-f]{6}$/i.test(e.color || '') ? e.color : PALETTE[i % PALETTE.length];
    const name = String(e.name || `${isImage ? 'منتج' : TYPES[type].label} ${i + 1}`).slice(0, 30);

    if (e.keys !== undefined && !Array.isArray(e.keys)) fail(`${where} → keys لازم تكون قائمة [ … ].`);
    const keys = [];
    let prev = { pos, rot, scale };
    for (const [j, k] of [...(e.keys || [])].sort((a, b) => (a?.t ?? 0) - (b?.t ?? 0)).entries()) {
      const kw = `${where} → المفتاح ${j + 1}`;
      if (!k || typeof k !== 'object') fail(`${kw}: لازم يكون كائن.`);
      const t = time(k.t, kw, duration);
      // القيمة الناقصة بتكمل من المفتاح اللي قبله (أو من مكان العنصر)
      const cur = {
        pos: vec(k.pos, `${kw} → pos`, { fallback: prev.pos }),
        rot: k.rot !== undefined ? vec(k.rot, `${kw} → rot`).map((v) => v * DEG) : prev.rot,
        scale: k.scale !== undefined ? vec(k.scale, `${kw} → scale`).map((v) => Math.max(0.01, v)) : prev.scale,
      };
      const same = keys.find((x) => Math.abs(x.t - t) < KEY_EPS);
      if (same) Object.assign(same, cur);
      else keys.push({ id: uid(), t, ...cur, ease: k.ease === 'linear' ? 'linear' : 'smooth' });
      prev = cur;
    }
    const base = keys[0] || { pos, rot, scale };
    const out = { id, ref: key, type, name, color: isImage ? '#ffffff' : color, pos: base.pos.slice(), rot: base.rot.slice(), scale: base.scale.slice(), keys };
    if (isImage) {
      // الصورة نفسها محفوظة على الجهاز؛ النص بيحمل رقمها بس
      out.image = typeof e.image === 'string' ? e.image : null;
      out.shape = shape;
      out.aspect = clamp(Number(e.aspect) || 1, 0.1, 10);
    }
    return out;
  });

  // الكاميرا: قائمة مفاتيح، أو كاميرا وحدة ثابتة
  let cams = s.camera ?? s.cameraKeys ?? s.keys;
  if (cams && !Array.isArray(cams)) cams = [{ t: 0, ...cams }];
  if (!cams || !cams.length) fail('camera ناقصة: لازم مفتاح كاميرا واحد على الأقل فيه pos و target.');

  const objAt = (id, t) => {
    const o = objects.find((x) => x.id === id);
    const v = evalObject(o.keys, t);
    return (v ? v.pos : o.pos).slice();
  };
  const keys = [];
  for (const [j, k] of [...cams].sort((a, b) => (a?.t ?? 0) - (b?.t ?? 0)).entries()) {
    const kw = `مفتاح الكاميرا ${j + 1}`;
    if (!k || typeof k !== 'object') fail(`${kw}: لازم يكون كائن.`);
    const t = time(k.t ?? 0, kw, duration);
    const pos = vec(k.pos, `${kw} → pos`, { required: true });
    let target, targetObj = null;
    if (typeof k.target === 'string') {
      targetObj = idMap.get(k.target);
      if (!targetObj) fail(`${kw}: الهدف "${k.target}" مش موجود بين العناصر (${[...idMap.keys()].join('، ') || 'ما في عناصر'}).`);
      target = objAt(targetObj, t);
    } else {
      target = vec(k.target, `${kw} → target`, { required: true });
    }
    if (Math.hypot(...target.map((v, i) => v - pos[i])) < 0.05) fail(`${kw}: الكاميرا والهدف بنفس المكان، ابعدهم عن بعض.`);
    const lens = clamp(Number(k.lens) || 35, 8, 300);
    const roll = clamp(Number(k.roll) || 0, -90, 90);
    const data = { t, pos, target, targetObj, lens, roll };
    const same = keys.find((x) => Math.abs(x.t - t) < KEY_EPS);
    if (same) Object.assign(same, data);
    else keys.push({ id: uid(), ease: k.ease === 'linear' ? 'linear' : 'smooth', ...data });
  }

  // منظر التحرير بيشمل كل العناصر
  const pts = objects.flatMap((o) => [o.pos, ...o.keys.map((k) => k.pos)]);
  const c = pts.length ? [0, 1, 2].map((i) => pts.reduce((a, p) => a + p[i], 0) / pts.length) : [0, 0.5, 0];
  const spread = pts.length ? Math.max(4, ...pts.map((p) => Math.hypot(p[0] - c[0], p[2] - c[2]))) : 4;

  const first = keys[0];
  return {
    version: 1,
    id: uid(),
    name: String(s.name || 'مشهد من Claude').slice(0, 40),
    updated: Date.now(),
    duration,
    aspect,
    objects,
    camera: { pos: first.pos.slice(), target: first.target.slice(), targetObj: first.targetObj, lens: first.lens, roll: first.roll },
    keys,
    editor: { pos: [c[0] + spread * 0.9, Math.max(4, spread * 0.75), c[2] + spread * 1.25], target: [c[0], 0.5, c[2]] },
  };
}

/* ---------- التعليمات اللي بتنلصق لـ Claude ---------- */

/** قواعد صيغة المشهد لـ Claude (نفس النص بملف CLAUDE-SCENES.md). */
export function claudeRules() {
  return `You are helping me block out a shot in "Laqta", a simple 3D camera-blocking app I use before generating AI video.
Reply with ONE json code block only, in the exact format below (valid JSON, no comments).

FORMAT EXAMPLE
{"laqta":1,"name":"Car pass","duration":8,"aspect":"9:16",
 "objects":[
  {"id":"car","type":"rect","name":"Car","pos":[-6,0.7,0],"rot":[0,90,0],
   "keys":[{"t":0,"pos":[-6,0.7,0]},{"t":6,"pos":[6,0.7,0],"ease":"linear"}]},
  {"id":"man","type":"person","name":"Man","pos":[2,0.9,-2],"rot":[0,180,0]}
 ],
 "camera":[
  {"t":0,"pos":[-3,1.2,7],"target":"car","lens":35},
  {"t":6,"pos":[4,1.6,5],"target":"car","lens":50},
  {"t":8,"pos":[4,1.6,5],"target":[2,1.5,-2],"lens":50}
 ]}

RULES
- Units: metres, seconds (0.1 s precision), degrees. Y is up, the ground is y = 0. duration 1–120. aspect "9:16" | "16:9" | "1:1".
- pos is the object's centre, so an object standing on the ground has y = half its height.
- Types and sizes at scale 1: cube 1×1×1 (y 0.5); rect 1.8 wide × 1.4 tall × 4.4 long, long side along Z — use it as a car, rot [0,90,0] makes it drive along X (y 0.7); sphere Ø1 (y 0.5); cylinder Ø1 × 1 tall (y 0.5); person 1.8 tall, faces +Z (y 0.9); wall 4 wide × 2.5 tall × 0.12 thick (y 1.25). Use scale to resize, e.g. a table = cube with scale [1.6,0.75,0.9].
- Objects with "type":"image" are my real product photos (a flat card, or "shape":"can" for a can/bottle; scale = height in metres, the photo faces +Z). Never invent new image objects; when editing, keep their "image", "shape" and "aspect" exactly as given. You may move, rotate, resize and animate them, and frame the camera on them like a product shot.
- Object "keys" (optional): each has t and any of pos / rot / scale; missing values carry over from the previous key. The object holds its first key before it and its last key after it. Omit keys for static objects.
- Camera: a list of keys, at least one. pos = camera position; target = an object id (the camera keeps looking at it while it moves) or an [x,y,z] point; lens = focal length in mm, full frame (long side of the frame = 36 mm: 18 ultra-wide, 24 wide, 35 natural, 50 normal, 85 portrait, 135 tele); roll = dutch angle in degrees (optional).
- "ease": "smooth" (default: eases in/out, passes smoothly through middle keys, never overshoots) or "linear" (constant speed). It applies to the segment that starts at that key. Two identical consecutive keys = a hold.
- Build camera moves with keys: dolly in/out = move pos along the view line; truck = move pos and target sideways together; pedestal / crane = change pos y (crane: also arc the distance); orbit = keys around the target at the same distance and height, one key every 45° or less; pan / tilt = keep pos, move target; push in = closer pos or longer lens; follow = target the moving object.
- Framing check (do the maths for every key): visible width at distance d = d × W / lens and visible height = d × H / lens, with W×H = 20.25×36 for 9:16, 36×20.25 for 16:9, 36×36 for 1:1. Keep the subject within about 70% of the frame unless it is a deliberate close-up. Example: a car side-on (4.4 m) in 9:16 at 24 mm needs d ≥ 7.5 m.
- Keep the camera at least 0.5 m from objects, never inside them, and above the ground (y ≥ 0.15) unless I ask otherwise. Keep the main subject inside the frame.
- Think like a cinematographer: motivated moves, clear beats, no random jitter. Slow motion = space the object keys further apart in time after the key moment (speed ramp).

`;
}

export function claudePrompt(p) {
  return `${claudeRules()}CURRENT SCENE (edit it unless I ask for a new one)
${exportText(p)}

MY SHOT
`;
}
