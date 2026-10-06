/* ==========================================================================
   لقطة — صور المنتجات
   الصور بتنحفظ بـ IndexedDB على الجهاز (مش بـ localStorage) عشان المشاريع تضل خفيفة.
   المشروع بيحفظ بس رقم الصورة.
   ========================================================================== */

const DB = 'laqta';
const STORE = 'images';
const MAX = 1024;   // أطول ضلع للصورة بعد التصغير

let dbp = null;
function db() {
  return (dbp ||= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}

function tx(mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  }));
}

export const putImage = (id, dataUrl) => tx('readwrite', (s) => s.put(dataUrl, id));

const cache = new Map();
export function getImage(id) {
  if (!id) return Promise.resolve(null);
  if (!cache.has(id)) cache.set(id, tx('readonly', (s) => s.get(id)).catch(() => null));
  return cache.get(id);
}

/** بيقرأ ملف صورة، بيصغّره، وبيرجّع dataURL + نسبة العرض للارتفاع.
 *  إذا الصورة فيها شفافية بتضل PNG، وإلا بتتحول JPEG أخف. */
export async function readImageFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('ما قدرنا نقرأ الصورة'));
      im.src = url;
    });
    const k = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k));
    const h = Math.max(1, Math.round(img.naturalHeight * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, w, h);
    let alpha = false;
    try {
      const px = g.getImageData(0, 0, w, h).data;
      for (let i = 3; i < px.length; i += 4 * 7) if (px[i] < 250) { alpha = true; break; }
    } catch { alpha = true; }
    const dataUrl = alpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9);
    return { dataUrl, aspect: w / h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** لوحة رسم جاهزة للخامة. للأسطوانة: الصورة على الوجه الأمامي (نص الدورة) والباقي رمادي. */
export function textureCanvas(img, shape) {
  const w = img ? img.naturalWidth : 256, h = img ? img.naturalHeight : 256;
  const c = document.createElement('canvas');
  c.width = shape === 'can' ? w * 2 : w;
  c.height = h;
  const g = c.getContext('2d');
  if (shape === 'can') {
    g.fillStyle = '#8b8f98';
    g.fillRect(0, 0, c.width, h);
  }
  if (img) {
    g.drawImage(img, shape === 'can' ? w / 2 : 0, 0, w, h);
  } else {
    // الصورة مش موجودة على هالجهاز
    g.fillStyle = '#2a2e37';
    g.fillRect(0, 0, c.width, h);
    g.fillStyle = '#ffb020';
    g.font = `bold ${Math.round(h * 0.09)}px -apple-system, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('الصورة مش موجودة', c.width / 2, h / 2 - h * 0.06);
    g.fillText('اضغط "تبديل الصورة"', c.width / 2, h / 2 + h * 0.06);
  }
  return c;
}

export function loadImg(dataUrl) {
  return new Promise((resolve) => {
    if (!dataUrl) return resolve(null);
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = dataUrl;
  });
}
