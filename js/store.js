/* ==========================================================================
   لقطة — المشروع والحفظ
   كل شي بـ localStorage على الجهاز. ما في سيرفر ولا حساب.
   ========================================================================== */

export const TYPES = {
  cube:     { label: 'مكعب',    y: 0.5 },
  rect:     { label: 'مستطيل',  y: 0.7 },
  sphere:   { label: 'كرة',     y: 0.5 },
  cylinder: { label: 'أسطوانة', y: 0.5 },
  person:   { label: 'شخص',     y: 0.9 },
  wall:     { label: 'جدار',    y: 1.25 },
};

/** صورة منتج: لوحة مسطحة أو أسطوانة (علبة/قنينة). الارتفاع الافتراضي بالمتر. */
export const IMAGE_SHAPES = {
  card: { label: 'لوحة مسطحة', height: 0.3 },
  can: { label: 'علبة / قنينة', height: 0.15 },
};

export function makeImageObject(objects, at, { image, aspect, shape }) {
  const n = objects.filter((o) => o.type === 'image').length + 1;
  const h = IMAGE_SHAPES[shape].height;
  return {
    id: uid(),
    type: 'image',
    name: `منتج ${n}`,
    color: '#ffffff',
    image,
    shape,
    aspect,
    pos: [at[0], h / 2, at[1]],
    rot: [0, 0, 0],
    scale: [h, h, h],
    keys: [],
  };
}

export const PALETTE = ['#d9773b', '#4f9dde', '#5fbf7a', '#c95f8f', '#d6c15a', '#9a8cf0', '#b8bcc6'];

export const uid = () => Math.random().toString(36).slice(2, 10);

export function makeObject(type, objects, at = [0, 0]) {
  const n = objects.filter((o) => o.type === type).length + 1;
  return {
    id: uid(),
    type,
    name: `${TYPES[type].label} ${n}`,
    color: PALETTE[objects.length % PALETTE.length],
    pos: [at[0], TYPES[type].y, at[1]],
    rot: [0, 0, 0],
    scale: [1, 1, 1],
    keys: [],               // مفاتيح حركة المجسم {id, t, pos, rot, scale, ease}
  };
}

export function newProject(name) {
  const p = {
    version: 1,
    id: uid(),
    name: name || `مشهد ${listProjects().length + 1}`,
    updated: Date.now(),
    duration: 10,
    aspect: '9:16',
    objects: [],
    camera: { pos: [5.5, 1.6, 8], target: [0, 0.8, 0], targetObj: null, lens: 35, roll: 0 },
    keys: [],
    editor: { pos: [7.5, 6, 10.5], target: [0, 0.5, 0] },
  };
  p.objects.push(makeObject('rect', p.objects));
  return p;
}

/* ---------- التخزين ---------- */

const IDX = 'blk.index';
const CUR = 'blk.current';
const KEY = (id) => `blk.p.${id}`;

function readJSON(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

export function listProjects() {
  return readJSON(IDX, []).sort((a, b) => b.updated - a.updated);
}

export function saveProject(p) {
  p.updated = Date.now();
  try {
    localStorage.setItem(KEY(p.id), JSON.stringify(p));
    const idx = readJSON(IDX, []).filter((e) => e.id !== p.id);
    idx.push({ id: p.id, name: p.name, updated: p.updated });
    localStorage.setItem(IDX, JSON.stringify(idx));
    localStorage.setItem(CUR, p.id);
    return true;
  } catch {
    return false;
  }
}

export function loadProject(id) {
  const p = readJSON(KEY(id), null);
  return p && p.version === 1 ? migrate(p) : null;
}

/** مشاريع قديمة كانت حركتها A → B: بتتحول لمفتاحين. */
export function migrate(p) {
  for (const o of p.objects) {
    const m = o.motion;
    if (!o.keys) o.keys = [];
    if (m && m.a && m.b && !o.keys.length) {
      o.keys = [
        { id: uid(), t: m.start, pos: m.a.pos, rot: m.a.rot, scale: m.a.scale, ease: m.ease || 'smooth' },
        { id: uid(), t: Math.round((m.start + m.dur) * 10) / 10, pos: m.b.pos, rot: m.b.rot, scale: m.b.scale, ease: 'smooth' },
      ];
    }
    delete o.motion;
  }
  return p;
}

export function deleteProject(id) {
  try {
    localStorage.removeItem(KEY(id));
    localStorage.setItem(IDX, JSON.stringify(readJSON(IDX, []).filter((e) => e.id !== id)));
  } catch { /* لا شي */ }
}

export function currentProjectId() {
  try { return localStorage.getItem(CUR); } catch { return null; }
}
