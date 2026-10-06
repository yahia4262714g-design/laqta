/* ==========================================================================
   لقطة — التطبيق
   أداة Blocking للمشاهد قبل توليدها بالذكاء الاصطناعي.
   الأولوية: التحكم بالكاميرا + مفاتيح الكاميرا + شريط الوقت.
   ========================================================================== */

import { Stage } from './stage.js';
import { Timeline } from './timeline.js';
import { LookControls } from './look.js';
import { Recorder } from './recorder.js';
import { icon } from './icons.js';
import * as A from './anim.js';
import * as S from './store.js';

const $ = (s) => document.querySelector(s);
const DEG = 180 / Math.PI;
const LENSES = [14, 18, 24, 35, 50, 85, 135];

const app = {
  project: null,
  cam: null,              // حالة الكاميرا الحالية (نفس project.camera)
  keys: [],               // مفاتيح الكاميرا مرتبة
  time: 0,
  playing: false,
  loop: false,
  mode: 'camera',         // camera | objects
  preview: false,
  recording: false,
  selectedId: null,
  gizmo: 'translate',
  objPanel: 'main',       // main | motion
  gesture: 'orbit',       // orbit | look
  nudgeOpen: false,
  nudge: null,            // {f, r, u} أثناء الضغط على أزرار التحريك
  undo: [],
  drag: null,             // أثناء سحب مجسم بأداة التحريك
  video: null,
};

/* ==========================================================================
   التهيئة
   ========================================================================== */

const canvas = $('#c');
const viewport = $('#viewport');
const stage = new Stage(canvas);
const recorder = new Recorder();

const look = new LookControls(canvas, {
  get: () => ({ pos: app.cam.pos, target: app.cam.target }),
  set: (pos, target) => {
    app.cam.pos = pos;
    app.cam.target = target;
    stage.setShot(app.cam);
    onCameraManual();
  },
  radPerPx: () => (A.fovFromLens(app.cam.lens, stage.aspect) / DEG) / stage.frame.h,
  worldPerPx: () => {
    const d = dist(app.cam.pos, app.cam.target);
    return (2 * d * Math.tan(A.fovFromLens(app.cam.lens, stage.aspect) / DEG / 2)) / stage.frame.h;
  },
});

const timeline = new Timeline($('#timeline'), {
  scrub: (t) => { pause(); applyTime(t); },
  keyTap: (id) => {
    const k = app.project.keys.find((x) => x.id === id);
    if (k) { pause(); applyTime(k.t); }
  },
  keyMove: (id, t) => {
    const k = app.project.keys.find((x) => x.id === id);
    if (!k || k.t === t) return;
    if (!app.drag) { pushUndo(); app.drag = { key: id }; }
    if (app.project.keys.some((x) => x !== k && Math.abs(x.t - t) < A.KEY_EPS)) return;
    k.t = t;
    refreshKeys();
    pause();
    applyTime(t);
    renderTimeline();
  },
  keyMoveEnd: () => { app.drag = null; commit(); },
  barTap: (id) => {
    if (app.mode !== 'objects') setMode('objects');
    select(id);
  },
});

stage.onDragging = (on) => {
  const id = app.selectedId;
  if (on && id) {
    pushUndo();
    app.drag = { id, start: stage.readTRS(id) };
  } else if (!on && app.drag?.id) {
    commitTransform(app.drag.id, stage.readTRS(app.drag.id), app.drag.start);
    app.drag = null;
  }
};
stage.onObjectChange = () => {
  if (app.drag?.id) updateCamera();
};

/* ---------- المشروع ---------- */

function loadState(p, { keepUndo = false } = {}) {
  app.project = p;
  app.cam = p.camera;
  if (!keepUndo) {
    app.undo = [];
    app.time = 0;
    app.selectedId = null;
    stage.setEditorView(p.editor);
  }
  if (app.selectedId && !p.objects.some((o) => o.id === app.selectedId)) app.selectedId = null;
  stage.syncObjects(p.objects);
  stage.setAspect(p.aspect);
  refreshKeys();
  select(app.selectedId);
  applyTime(Math.min(app.time, p.duration));
  layout();
  renderUI();
}

function pushUndo() {
  app.undo.push(JSON.stringify(app.project));
  if (app.undo.length > 60) app.undo.shift();
}

function undo() {
  const s = app.undo.pop();
  if (!s) return toast('ما في شي للتراجع عنه');
  pause();
  loadState(JSON.parse(s), { keepUndo: true });
  scheduleSave();
  toast('تم التراجع');
}

let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 700);
}
function saveNow() {
  clearTimeout(saveTimer);
  const p = app.project;
  if (!p) return false;
  p.editor = { pos: stage.editorCam.position.toArray(), target: stage.editorControls.target.toArray() };
  return S.saveProject(p);
}

function commit() {
  scheduleSave();
  renderUI();
}

/* ==========================================================================
   الوقت والكاميرا
   ========================================================================== */

function refreshKeys() {
  app.keys = A.sortKeys(app.project.keys);
  stage.setPath(A.sampleCameraPath(app.keys), app.keys.map((k) => k.pos));
}

const resolveTarget = (k) => {
  if (k.targetObj) {
    const v = stage.objectPos(k.targetObj);
    if (v) return v.toArray();
  }
  return k.target;
};

/** الهدف المقفول بهاللحظة: من المفتاح الحالي، أو إذا المفتاحين حوالين الوقت نفس الهدف. */
function lockAt(t) {
  const ks = app.keys;
  if (!ks.length) return app.cam.targetObj;
  const on = A.keyAt(ks, t);
  if (on) return on.targetObj || null;
  if (t <= ks[0].t) return ks[0].targetObj || null;
  if (t >= ks[ks.length - 1].t) return ks[ks.length - 1].targetObj || null;
  const i = ks.findIndex((k) => k.t > t);
  return ks[i - 1].targetObj && ks[i - 1].targetObj === ks[i].targetObj ? ks[i].targetObj : null;
}

function applyTime(t) {
  app.time = A.clamp(t, 0, app.project.duration);
  stage.applyObjects(app.project.objects, app.time, app.drag?.id);
  updateCamera();
  updateTimeUI();
}

function updateCamera() {
  const cam = app.cam;
  if (app.keys.length) {
    const c = A.evalCamera(app.keys, app.time, resolveTarget);
    Object.assign(cam, c, { targetObj: lockAt(app.time) });
  } else if (cam.targetObj) {
    const v = stage.objectPos(cam.targetObj);
    if (v) cam.target = v.toArray();
    else cam.targetObj = null;
  }
  stage.setShot(cam);
  stage.shotControls.enablePan = !cam.targetObj;
}

/** الكاميرا تحركت يدويًا (لمس أو أزرار). */
function onCameraManual() {
  app.cam.pos = stage.shotCam.position.toArray();
  app.cam.target = stage.shotControls.target.toArray();
  scheduleSave();
  updateCamUI();
}

/** هل الكاميرا الحالية مختلفة عن المفاتيح؟ (تغيير ما انحفظ كمفتاح) */
function camDirty() {
  if (!app.keys.length || app.playing) return false;
  const c = A.evalCamera(app.keys, app.time, resolveTarget);
  const cam = app.cam;
  return dist(c.pos, cam.pos) > 1e-3 || dist(c.target, cam.target) > 1e-3 ||
    Math.abs(c.lens - cam.lens) > 0.05 || Math.abs(c.roll - (cam.roll || 0)) > 0.05;
}

function syncControls() {
  const editable = !app.playing && !app.preview;
  const shot = stage.shotControls;
  shot.enabled = editable && app.mode === 'camera' && app.gesture === 'orbit';
  shot.enablePan = !app.cam.targetObj;
  look.enabled = editable && app.mode === 'camera' && app.gesture === 'look';
  stage.select(app.selectedId, editable && app.mode === 'objects');
}

/* ---------- التشغيل ---------- */

function play() {
  if (app.time >= app.project.duration - 1e-3) app.time = 0;
  app.playing = true;
  syncControls();
  renderUI();
}

function pause() {
  if (!app.playing) return;
  app.playing = false;
  syncControls();
  renderUI();
}

function stop() {
  pause();
  applyTime(0);
  renderUI();
}

/* ---------- مفاتيح الكاميرا ---------- */

function addKey() {
  pushUndo();
  const p = app.project, cam = app.cam;
  const t = A.snapTime(app.time);
  const existing = A.keyAt(p.keys, t);
  const data = { t, pos: cam.pos.slice(), target: cam.target.slice(), targetObj: cam.targetObj || null, lens: cam.lens, roll: cam.roll || 0 };
  if (existing) Object.assign(existing, data);
  else p.keys.push({ id: S.uid(), ease: 'smooth', ...data });
  refreshKeys();
  applyTime(t);
  commit();
  if (existing) toast(`تم تحديث المفتاح عند ${fmt(t)}`);
  else if (p.keys.length === 1) toast('أول مفتاح ✓ — حرّك المؤشر لوقت تاني، غيّر الكاميرا، وأضف مفتاح', 3800);
  else toast(`مفتاح عند ${fmt(t)}`);
}

function currentKey() {
  return A.keyAt(app.keys, app.time);
}

function deleteKey() {
  const k = currentKey();
  if (!k) return;
  pushUndo();
  app.project.keys = app.project.keys.filter((x) => x.id !== k.id);
  refreshKeys();
  applyTime(app.time);
  commit();
  toast('تم حذف المفتاح');
}

function toggleKeyEase() {
  const k = currentKey();
  if (!k) return;
  pushUndo();
  k.ease = k.ease === 'linear' ? 'smooth' : 'linear';
  refreshKeys();
  applyTime(app.time);
  commit();
}

/* ---------- تحريك الكاميرا بالأزرار ---------- */

function nudgeStep(dt) {
  const n = app.nudge;
  if (!n) return;
  const cam = app.cam;
  const locked = !!cam.targetObj;
  const d = dist(cam.pos, cam.target);
  const speed = Math.max(0.8, d * 0.6) * dt;
  let fx = cam.target[0] - cam.pos[0], fz = cam.target[2] - cam.pos[2];
  const fl = Math.hypot(fx, fz) || 1;
  fx /= fl; fz /= fl;
  const rx = -fz, rz = fx;
  const move = [
    (fx * n.f + rx * n.r) * speed,
    n.u * speed,
    (fz * n.f + rz * n.r) * speed,
  ];
  const np = cam.pos.map((v, i) => v + move[i]);
  if (locked && n.f > 0 && Math.hypot(cam.target[0] - np[0], cam.target[2] - np[2]) < 0.4) return;
  cam.pos = np;
  if (!locked) cam.target = cam.target.map((v, i) => v + move[i]);
  stage.setShot(cam);
  onCameraManual();
}

/* ==========================================================================
   المجسمات
   ========================================================================== */

const selected = () => app.project.objects.find((o) => o.id === app.selectedId) || null;

function select(id) {
  app.selectedId = id;
  if (!id) app.objPanel = 'main';
  syncControls();
  stage.updateMotionViz(app.project.objects);
  renderUI();
}

function addObject(type) {
  pushUndo();
  const p = app.project;
  const t = stage.editorControls.target;
  let at = [Math.round(t.x * 2) / 2, Math.round(t.z * 2) / 2];
  while (p.objects.some((o) => Math.abs(o.pos[0] - at[0]) < 0.3 && Math.abs(o.pos[2] - at[1]) < 0.3)) at = [at[0] + 1.5, at[1]];
  const o = S.makeObject(type, p.objects, at);
  p.objects.push(o);
  stage.syncObjects(p.objects);
  applyTime(app.time);
  if (app.mode !== 'objects') setMode('objects');
  select(o.id);
  commit();
}

function duplicateObject() {
  const o = selected();
  if (!o) return;
  pushUndo();
  const c = JSON.parse(JSON.stringify(o));
  c.id = S.uid();
  c.name = `${o.name} نسخة`;
  const shift = (trs) => trs && (trs.pos[0] += 1.5);
  shift(c);
  if (c.motion) { shift(c.motion.a); shift(c.motion.b); }
  app.project.objects.push(c);
  stage.syncObjects(app.project.objects);
  applyTime(app.time);
  select(c.id);
  commit();
}

function deleteObject() {
  const o = selected();
  if (!o) return;
  pushUndo();
  const p = app.project;
  p.objects = p.objects.filter((x) => x.id !== o.id);
  // المفاتيح اللي كانت تنظر لهالمجسم بتضل تنظر لنفس النقطة
  for (const k of p.keys) if (k.targetObj === o.id) k.targetObj = null;
  if (app.cam.targetObj === o.id) app.cam.targetObj = null;
  stage.syncObjects(p.objects);
  refreshKeys();
  select(null);
  applyTime(app.time);
  commit();
  toast(`تم حذف ${o.name}`);
}

function cycleColor() {
  const o = selected();
  if (!o) return;
  pushUndo();
  o.color = S.PALETTE[(S.PALETTE.indexOf(o.color) + 1) % S.PALETTE.length];
  stage.syncObjects(app.project.objects);
  stage.updateMotionViz(app.project.objects);
  commit();
}

function renameObject() {
  const o = selected();
  if (!o) return;
  const name = prompt('اسم العنصر', o.name);
  if (!name || !name.trim()) return;
  pushUndo();
  o.name = name.trim().slice(0, 30);
  commit();
}

/** يحفظ مكان المجسم بعد التعديل، وبيعرف إذا لازم يعدّل البداية A أو النهاية B. */
function commitTransform(id, trs, start) {
  const o = app.project.objects.find((x) => x.id === id);
  if (!o) return;
  const where = A.motionEditTarget(o.motion, app.time);
  const set = (dst) => { dst.pos = trs.pos.slice(); dst.rot = trs.rot.slice(); dst.scale = trs.scale.slice(); };
  if (where === 'base') set(o);
  else if (where === 'a') { set(o.motion.a); set(o); }
  else if (where === 'b') set(o.motion.b);
  else {
    // بنص الحركة: بنزيح المسار كله
    const d = trs.pos.map((v, i) => v - start.pos[i]);
    for (const t of [o, o.motion.a, o.motion.b]) t.pos = t.pos.map((v, i) => v + d[i]);
    if (app.gizmo !== 'translate') toast('للتدوير أو الحجم: روح لبداية أو نهاية الحركة');
  }
  applyTime(app.time);
  stage.updateMotionViz(app.project.objects);
  commit();
}

/* ---------- الحركة A → B ---------- */

function setMotionPoint(which) {
  const o = selected();
  if (!o) return;
  const p = app.project;
  if (which === 'b' && !o.motion?.a) return toast('عيّن البداية A أولاً');
  pushUndo();
  const trs = stage.readTRS(o.id);
  const t = A.snapTime(app.time);
  if (which === 'a') {
    const m = (o.motion ||= { a: null, b: null, start: 0, dur: 3, ease: 'smooth' });
    m.a = trs;
    Object.assign(o, { pos: trs.pos.slice(), rot: trs.rot.slice(), scale: trs.scale.slice() });
    m.start = A.clamp(t, 0, p.duration - 0.1);
    m.dur = A.clamp(m.dur, 0.1, p.duration - m.start);
    toast(m.b ? 'تم تحديث البداية A' : 'تم تعيين A ✓ — حرّك المؤشر للوقت اللي بدك، انقل العنصر، واضغط B', 4200);
  } else {
    const m = o.motion;
    m.b = trs;
    if (t > m.start + 0.05) m.dur = A.snapTime(t - m.start);
    m.dur = A.clamp(m.dur, 0.1, p.duration - m.start);
    Object.assign(o, { pos: m.a.pos.slice(), rot: m.a.rot.slice(), scale: m.a.scale.slice() });
    toast(`الحركة جاهزة: ${fmt(m.start)} ← ${fmt(m.start + m.dur)}`);
  }
  applyTime(app.time);
  stage.updateMotionViz(p.objects);
  commit();
}

function editMotion(field, delta) {
  const o = selected();
  const m = o?.motion;
  if (!m) return;
  pushUndo();
  const D = app.project.duration;
  if (field === 'start') m.start = A.clamp(A.snapTime(m.start + delta), 0, D - 0.1);
  if (field === 'dur') m.dur = A.snapTime(m.dur + delta);
  if (field === 'ease') m.ease = m.ease === 'linear' ? 'smooth' : 'linear';
  m.dur = A.clamp(m.dur, 0.1, D - m.start);
  applyTime(app.time);
  commit();
}

function promptMotion(field) {
  const m = selected()?.motion;
  if (!m) return;
  const v = parseFloat(prompt(field === 'start' ? 'وقت البداية (ثانية)' : 'المدة (ثانية)', m[field]));
  if (!isFinite(v)) return;
  editMotion(field, v - m[field]);
}

function removeMotion() {
  const o = selected();
  if (!o?.motion) return;
  pushUndo();
  if (o.motion.a) Object.assign(o, { pos: o.motion.a.pos.slice(), rot: o.motion.a.rot.slice(), scale: o.motion.a.scale.slice() });
  o.motion = null;
  applyTime(app.time);
  stage.updateMotionViz(app.project.objects);
  commit();
  toast('تم حذف الحركة');
}

/* ==========================================================================
   الأوضاع
   ========================================================================== */

function setMode(mode) {
  app.mode = mode;
  stage.setMode(mode);
  document.body.dataset.mode = mode;
  syncControls();
  stage.updateMotionViz(app.project.objects);
  layout();
  renderUI();
}

function setAspect(key) {
  pushUndo();
  app.project.aspect = key;
  stage.setAspect(key);
  layout();
  commit();
}

function cycleAspect() {
  const order = Object.keys(A.ASPECTS);
  setAspect(order[(order.indexOf(app.project.aspect) + 1) % order.length]);
}

function setDuration(d) {
  pushUndo();
  A.fitToDuration(app.project, d);
  refreshKeys();
  applyTime(Math.min(app.time, d));
  commit();
}

/* ---------- المعاينة ---------- */

function enterPreview() {
  app.preview = true;
  document.body.classList.add('preview');
  stage.setMode('preview');
  syncControls();
  layout();
  applyTime(0);
  play();
}

async function exitPreview() {
  if (app.recording) await stopRecording(false);
  pause();
  app.preview = false;
  document.body.classList.remove('preview');
  stage.setMode(app.mode);
  syncControls();
  layout();
  renderUI();
}

function startRecording() {
  if (!Recorder.supported()) return toast('تسجيل الفيديو غير مدعوم بهالمتصفح — استخدم تسجيل الشاشة');
  try {
    recorder.start(canvas.width, canvas.height);
  } catch {
    return toast('ما قدرنا نبدأ التسجيل');
  }
  app.recording = true;
  app.loop = false;
  applyTime(0);
  play();
  renderUI();
}

async function stopRecording(offer = true) {
  if (!app.recording) return;
  app.recording = false;
  pause();
  const res = await recorder.stop();
  renderUI();
  if (!res || !res.blob.size) return toast('التسجيل فاضي');
  app.video = res;
  if (offer) openVideoSheet();
}

/* ==========================================================================
   التخطيط
   ========================================================================== */

function layout() {
  if (app.preview) {
    const ui = $('#previewUI');
    const top = ui.querySelector('.pv-top').offsetHeight || 56;
    const bottom = ui.querySelector('.pv-bottom').offsetHeight || 120;
    const W = window.innerWidth, H = window.innerHeight;
    const safeT = parseFloat(getComputedStyle(ui).paddingTop) || 0;
    const safeB = parseFloat(getComputedStyle(ui).paddingBottom) || 0;
    const aw = W - 16, ah = H - top - bottom - safeT - safeB;
    const a = stage.aspect;
    let w = aw, h = aw / a;
    if (h > ah) { h = ah; w = ah * a; }
    const longSide = 1920, shortSide = 1080;
    const px = a >= 1 ? [Math.round(longSide), Math.round(longSide / a)] : [shortSide, Math.round(shortSide / a)];
    if (a === 1) px[0] = px[1] = 1080;
    stage.resizeExact(w, h, px[0], px[1]);
    Object.assign(canvas.style, { position: 'fixed', left: `${(W - w) / 2}px`, top: `${safeT + top + (ah - h) / 2}px`, right: 'auto', bottom: 'auto' });
    return;
  }
  Object.assign(canvas.style, { position: '', left: '', top: '', right: '', bottom: '' });
  const r = viewport.getBoundingClientRect();
  stage.resize(r.width, r.height);
  const f = stage.frame;
  Object.assign($('#frame').style, { left: `${f.x}px`, top: `${f.y}px`, width: `${f.w}px`, height: `${f.h}px` });
  stage.needsRender = true;
}

new ResizeObserver(() => layout()).observe(viewport);
window.addEventListener('resize', () => app.preview && layout());

/* ==========================================================================
   الواجهة
   ========================================================================== */

const fmt = (t) => `${t.toFixed(1)}s`;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function btn(action, ico, label, cls = '', extra = '') {
  return `<button class="act ${cls}" data-act="${action}" ${extra}>${icon(ico)}<span>${label}</span></button>`;
}

function renderUI() {
  renderTop();
  renderActions();
  renderTimeline();
  renderTransport();
  updateCamUI();
}

function renderTop() {
  for (const b of document.querySelectorAll('#modeSeg button')) b.classList.toggle('on', b.dataset.mode === app.mode);
  $('#btnUndo').disabled = !app.undo.length;
}

let lastActionsSig = '';
function renderActions(force = false) {
  const el = $('#actions');
  const p = app.project;
  const k = currentKey();
  const dirty = camDirty();
  const o = selected();
  const sig = JSON.stringify([app.mode, app.objPanel, app.gizmo, app.gesture, app.nudgeOpen, k?.id, k?.ease, dirty, app.playing,
    p.aspect, app.cam.targetObj, Math.round(app.cam.lens), o && [o.id, o.name, o.color, o.motion], p.objects.length]);
  if (!force && sig === lastActionsSig) return;
  lastActionsSig = sig;

  let html = '';
  if (app.mode === 'camera') {
    const tObj = p.objects.find((x) => x.id === app.cam.targetObj);
    html += btn('key-add', 'key', k ? 'تحديث المفتاح' : 'إضافة مفتاح كاميرا', `primary key-btn${dirty ? ' dirty' : ''}`);
    if (k) {
      html += btn('key-del', 'trash', 'حذف المفتاح', 'danger');
      html += btn('key-ease', k.ease === 'linear' ? 'right' : 'motion', k.ease === 'linear' ? 'خطي' : 'ناعم');
    }
    html += btn('target', 'target', tObj ? esc(tObj.name) : 'الهدف: حر', tObj ? 'lit' : '');
    html += btn('lens', 'lens', `${Math.round(app.cam.lens)}mm`);
    html += btn('gesture', app.gesture === 'orbit' ? 'orbit' : 'eye', app.gesture === 'orbit' ? 'مدار' : 'التفاف');
    html += btn('nudge', 'pad', 'أزرار', app.nudgeOpen ? 'lit' : '');
    html += btn('aspect', 'frame', p.aspect);
    html += btn('cam-num', 'hash', 'أرقام');
  } else if (!o) {
    html += btn('add', 'plus', 'إضافة عنصر', 'primary obj');
    html += btn('cam-here', 'camera', 'الكاميرا من هنا');
    html += `<div class="hint">اضغط على عنصر لتحديده</div>`;
  } else if (app.objPanel === 'motion') {
    const m = o.motion || {};
    html += btn('motion-back', 'back', 'رجوع');
    html += btn('motion-a', 'pinA', m.a ? 'A ✓' : 'تعيين A', m.a ? 'lit' : 'primary obj');
    html += btn('motion-b', 'flag', m.b ? 'B ✓' : 'تعيين B', m.b ? 'lit' : (m.a ? 'primary obj' : ''));
    if (m.a) {
      html += stepper('start', 'يبدأ', m.start);
      html += stepper('dur', 'المدة', m.dur);
      html += btn('motion-ease', m.ease === 'linear' ? 'right' : 'motion', m.ease === 'linear' ? 'خطي' : 'ناعم');
      html += btn('motion-del', 'trash', 'حذف الحركة', 'danger');
    } else {
      html += `<div class="hint">ضع العنصر بمكان البداية واضغط A</div>`;
    }
  } else {
    html += `<button class="act name-chip" data-act="rename" style="--c:${o.color}"><i></i><span>${esc(o.name)}</span></button>`;
    html += `<div class="seg mini">${[['translate', 'move', 'تحريك'], ['rotate', 'rotate', 'تدوير'], ['scale', 'scale', 'حجم']]
      .map(([m, i, l]) => `<button data-act="gizmo" data-v="${m}" class="${app.gizmo === m ? 'on' : ''}">${icon(i, 20)}<span>${l}</span></button>`).join('')}</div>`;
    html += btn('motion', 'motion', o.motion?.b ? 'حركة ✓' : 'حركة A→B', o.motion?.b ? 'lit' : '');
    html += btn('dup', 'copy', 'نسخ');
    html += btn('color', 'palette', 'لون');
    html += btn('obj-num', 'hash', 'أرقام');
    html += btn('del', 'trash', 'حذف', 'danger');
    html += btn('deselect', 'check', 'تم');
  }
  el.innerHTML = html;
}

function stepper(field, label, v) {
  return `<div class="stepper"><button data-act="step" data-f="${field}" data-d="-0.5">${icon('minus', 18)}</button>
    <button class="val" data-act="step-edit" data-f="${field}"><small>${label}</small>${fmt(v)}</button>
    <button data-act="step" data-f="${field}" data-d="0.5">${icon('plus', 18)}</button></div>`;
}

function renderTimeline() {
  const p = app.project;
  const bars = p.objects.filter((o) => o.motion?.a && o.motion?.b).map((o) => ({
    id: o.id, name: o.name, color: o.color, start: o.motion.start, dur: o.motion.dur, selected: o.id === app.selectedId,
  }));
  timeline.render({ duration: p.duration, keys: app.keys, bars, time: app.time });
}

function renderTransport() {
  $('#btnPlay').innerHTML = icon(app.playing ? 'pause' : 'play', 26);
  $('#btnLoop').classList.toggle('on', app.loop);
  $('#btnDur').innerHTML = `${icon('clock', 18)}<span>${app.project.duration}s</span>`;
  $('#pvPlay').innerHTML = icon(app.playing ? 'pause' : 'play', 28);
  $('#pvRec').classList.toggle('on', app.recording);
  $('#pvRec').innerHTML = `${icon(app.recording ? 'stop' : 'rec', 20)}<span>${app.recording ? 'إيقاف' : 'تسجيل'}</span>`;
  $('#pvAspect').textContent = app.project.aspect;
  $('#pvAspect').disabled = app.recording;
  updateTimeUI();
}

function updateTimeUI() {
  const p = app.project;
  const txt = `${app.time.toFixed(1)} / ${p.duration}s`;
  $('#timeLabel').textContent = txt;
  $('#pvTime').textContent = txt;
  $('#pvBar').style.width = `${(app.time / p.duration) * 100}%`;
  timeline.setTime(app.time);
  // نحدّث الإبراز على المفاتيح لما المؤشر يدخل أو يطلع منها
  const k = currentKey();
  if ((k?.id || null) !== updateTimeUI.lastKey) {
    updateTimeUI.lastKey = k?.id || null;
    if (!app.playing) renderTimeline();
  }
  updateCamUI();
}

function updateCamUI() {
  if (!app.project) return;
  const cam = app.cam;
  const fov = A.fovFromLens(cam.lens, stage.aspect);
  const k = currentKey();
  const dirty = camDirty();
  let hud = '';
  if (app.mode === 'camera') {
    hud = `<span>${Math.round(cam.lens)}mm · ${Math.round(fov)}° · ↕${cam.pos[1].toFixed(1)}m</span>`;
    if (k && !dirty) hud += `<span class="k">◆ ${fmt(k.t)}</span>`;
    if (dirty) hud += `<span class="d">● غير محفوظ كمفتاح</span>`;
  } else {
    const o = selected();
    hud = o ? `<span>${esc(o.name)}</span>` : `<span>${app.project.objects.length} عناصر</span>`;
  }
  const el = $('#hud');
  if (el.innerHTML !== hud) el.innerHTML = hud;
  renderActions();
}

/* ---------- القوائم المنبثقة ---------- */

function openSheet(title, body, onReady) {
  $('#sheetTitle').textContent = title;
  $('#sheetBody').innerHTML = body;
  $('#sheet').hidden = false;
  requestAnimationFrame(() => $('#sheet').classList.add('open'));
  onReady?.($('#sheetBody'));
}

function closeSheet() {
  $('#sheet').classList.remove('open');
  setTimeout(() => { if (!$('#sheet').classList.contains('open')) $('#sheet').hidden = true; }, 220);
}

function openAddSheet() {
  openSheet('إضافة عنصر', `<div class="grid3">${Object.entries(S.TYPES)
    .map(([t, d]) => `<button class="tile" data-type="${t}">${icon(t, 34)}<span>${d.label}</span></button>`).join('')}</div>`,
  (b) => b.addEventListener('click', (e) => {
    const t = e.target.closest('[data-type]');
    if (!t) return;
    closeSheet();
    addObject(t.dataset.type);
  }));
}

function openTargetSheet() {
  const objs = app.project.objects;
  const cur = app.cam.targetObj;
  openSheet('الكاميرا تنظر إلى…', `<div class="list">
    <button class="row${!cur ? ' on' : ''}" data-id="">${icon('target')}<span>نقطة حرة (بدون قفل)</span></button>
    ${objs.map((o) => `<button class="row${cur === o.id ? ' on' : ''}" data-id="${o.id}"><i class="sw" style="background:${o.color}"></i><span>${esc(o.name)}</span></button>`).join('')}
    </div>
    ${app.keys.length && cur ? `<button class="row all-keys" data-all="1">${icon('key')}<span>قفل كل المفاتيح على ${esc(objs.find((o) => o.id === cur)?.name || '')}</span></button>` : ''}
    <p class="note">لما تقفل الهدف على عنصر، الكاميرا بتضل تنظر له حتى لو تحرك. كل مفتاح بيحفظ هدفه، والقفل بيشتغل بين مفتاحين مقفولين على نفس العنصر.</p>`,
  (b) => b.addEventListener('click', (e) => {
    if (e.target.closest('[data-all]')) {
      pushUndo();
      for (const k of app.project.keys) k.targetObj = cur;
      refreshKeys();
      applyTime(app.time);
      commit();
      closeSheet();
      return toast('كل المفاتيح بتنظر لنفس العنصر الآن');
    }
    const r = e.target.closest('[data-id]');
    if (!r) return;
    const id = r.dataset.id || null;
    app.cam.targetObj = id;
    if (id) {
      app.cam.target = stage.objectPos(id).toArray();
      if (app.gesture === 'look') app.gesture = 'orbit';
    }
    stage.setShot(app.cam);
    syncControls();
    onCameraManual();
    closeSheet();
    if (app.keys.length) toast('اضغط ◆ لحفظ الهدف بالمفتاح');
  }));
}

function openLensSheet() {
  const cam = app.cam;
  const toSlider = (l) => Math.log(l / 10) / Math.log(20) * 100;
  const fromSlider = (v) => 10 * Math.pow(20, v / 100);
  openSheet('العدسة والميلان', `
    <div class="chips">${LENSES.map((l) => `<button class="chip${Math.round(cam.lens) === l ? ' on' : ''}" data-lens="${l}">${l}</button>`).join('')}</div>
    <label class="slider"><span>البعد البؤري <b id="lensVal"></b></span><input id="lensRange" type="range" min="0" max="100" step="0.1" value="${toSlider(cam.lens)}"></label>
    <label class="slider"><span>ميلان (Dutch) <b id="rollVal"></b></span><input id="rollRange" type="range" min="-45" max="45" step="0.5" value="${cam.roll || 0}"></label>
    <p class="note">العدسة محسوبة على حساس Full Frame (الضلع الطويل 36mm) فبتعطي نفس الإحساس بكل النسب.</p>`,
  (b) => {
    const show = () => {
      $('#lensVal').textContent = `${Math.round(cam.lens)}mm · ${Math.round(A.fovFromLens(cam.lens, stage.aspect))}°`;
      $('#rollVal').textContent = `${(cam.roll || 0).toFixed(1)}°`;
      for (const c of b.querySelectorAll('[data-lens]')) c.classList.toggle('on', +c.dataset.lens === Math.round(cam.lens));
    };
    const apply = () => { stage.setShot(cam); onCameraManual(); show(); };
    show();
    b.addEventListener('click', (e) => {
      const c = e.target.closest('[data-lens]');
      if (!c) return;
      cam.lens = +c.dataset.lens;
      $('#lensRange').value = toSlider(cam.lens);
      apply();
    });
    $('#lensRange').addEventListener('input', (e) => { cam.lens = Math.round(fromSlider(+e.target.value) * 10) / 10; apply(); });
    $('#rollRange').addEventListener('input', (e) => { cam.roll = +e.target.value; apply(); });
    $('#rollRange').addEventListener('dblclick', (e) => { cam.roll = 0; e.target.value = 0; apply(); });
  });
}

function numField(id, label, value, step = 0.1) {
  return `<label class="num"><span>${label}</span><div><button type="button" data-step="-${step}" data-for="${id}">${icon('minus', 16)}</button><input id="${id}" type="number" step="any" value="${+value.toFixed(2)}"><button type="button" data-step="${step}" data-for="${id}">${icon('plus', 16)}</button></div></label>`;
}

function wireNumbers(body, onChange) {
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-step]');
    if (!b) return;
    const inp = body.querySelector(`#${b.dataset.for}`);
    inp.value = +(parseFloat(inp.value || 0) + parseFloat(b.dataset.step)).toFixed(2);
    onChange(inp.id);
  });
  body.addEventListener('change', (e) => e.target.matches('input[type=number]') && onChange(e.target.id));
}

function openCamNumbers() {
  const cam = app.cam;
  const dir = cam.target.map((v, i) => v - cam.pos[i]);
  const d = Math.hypot(...dir) || 1;
  const pan = Math.atan2(dir[0], dir[2]) * DEG;
  const tilt = Math.asin(dir[1] / d) * DEG;
  openSheet('الكاميرا بالأرقام', `
    <h4>المكان</h4><div class="nums">${numField('cx', 'X', cam.pos[0])}${numField('cy', 'الارتفاع Y', cam.pos[1])}${numField('cz', 'Z', cam.pos[2])}</div>
    <h4>الاتجاه</h4><div class="nums">${numField('pan', 'Pan°', pan, 5)}${numField('tilt', 'Tilt°', tilt, 5)}${numField('roll', 'Roll°', cam.roll || 0, 1)}</div>
    <h4>الهدف (Look At)</h4><div class="nums">${numField('tx', 'X', cam.target[0])}${numField('ty', 'Y', cam.target[1])}${numField('tz', 'Z', cam.target[2])}</div>
    <div class="nums">${numField('lensN', 'العدسة mm', cam.lens, 1)}</div>`,
  (b) => wireNumbers(b, (id) => {
    const v = (k) => parseFloat(b.querySelector(`#${k}`).value) || 0;
    if (['pan', 'tilt'].includes(id)) {
      const p = v('pan') / DEG, t = A.clamp(v('tilt'), -89, 89) / DEG;
      const dd = dist(cam.pos, cam.target) || 5;
      cam.target = [cam.pos[0] + Math.sin(p) * Math.cos(t) * dd, cam.pos[1] + Math.sin(t) * dd, cam.pos[2] + Math.cos(p) * Math.cos(t) * dd];
      cam.targetObj = null;
    } else if (['tx', 'ty', 'tz'].includes(id)) {
      cam.target = [v('tx'), v('ty'), v('tz')];
      cam.targetObj = null;
    } else if (['cx', 'cy', 'cz'].includes(id)) {
      const delta = [v('cx') - cam.pos[0], v('cy') - cam.pos[1], v('cz') - cam.pos[2]];
      cam.pos = [v('cx'), v('cy'), v('cz')];
      // نحافظ على اتجاه النظر لما الهدف حر
      if (!cam.targetObj) cam.target = cam.target.map((x, i) => x + delta[i]);
    } else if (id === 'roll') cam.roll = A.clamp(v('roll'), -90, 90);
    else if (id === 'lensN') cam.lens = A.clamp(v('lensN'), 8, 300);
    stage.setShot(cam);
    syncControls();
    onCameraManual();
    const set = (k, x) => { const el = b.querySelector(`#${k}`); if (el && document.activeElement !== el) el.value = +x.toFixed(2); };
    set('tx', cam.target[0]); set('ty', cam.target[1]); set('tz', cam.target[2]);
  }));
}

function openObjNumbers() {
  const o = selected();
  if (!o) return;
  const t = stage.readTRS(o.id);
  openSheet(o.name, `
    <h4>المكان (متر)</h4><div class="nums">${numField('px', 'X', t.pos[0])}${numField('py', 'Y', t.pos[1])}${numField('pz', 'Z', t.pos[2])}</div>
    <h4>الدوران (درجة)</h4><div class="nums">${numField('rx', 'X', t.rot[0] * DEG, 5)}${numField('ry', 'Y', t.rot[1] * DEG, 5)}${numField('rz', 'Z', t.rot[2] * DEG, 5)}</div>
    <h4>الحجم</h4><div class="nums">${numField('sx', 'X', t.scale[0])}${numField('sy', 'Y', t.scale[1])}${numField('sz', 'Z', t.scale[2])}</div>`,
  (b) => wireNumbers(b, () => {
    const v = (k) => parseFloat(b.querySelector(`#${k}`).value) || 0;
    const start = stage.readTRS(o.id);
    const trs = {
      pos: [v('px'), v('py'), v('pz')],
      rot: [v('rx') / DEG, v('ry') / DEG, v('rz') / DEG],
      scale: [v('sx'), v('sy'), v('sz')].map((s) => Math.max(0.01, s)),
    };
    pushUndo();
    commitTransform(o.id, trs, start);
  }));
}

function openDurationSheet() {
  openSheet('مدة المشهد', `<div class="chips big">${A.DURATIONS.map((d) => `<button class="chip${app.project.duration === d ? ' on' : ''}" data-d="${d}">${d}s</button>`).join('')}</div>
    <p class="note">إذا قصّرت المدة، المفاتيح اللي بعد النهاية بتنتقل لآخر المشهد.</p>`,
  (b) => b.addEventListener('click', (e) => {
    const c = e.target.closest('[data-d]');
    if (!c) return;
    setDuration(+c.dataset.d);
    closeSheet();
  }));
}

function openMenu(view = 'main') {
  const p = app.project;
  if (view === 'open') {
    const list = S.listProjects();
    openSheet('فتح مشروع', `<div class="list">${list.map((e) => `
      <div class="row proj${e.id === p.id ? ' on' : ''}"><button class="grow" data-open="${e.id}">${icon('folder')}<span>${esc(e.name)}</span><small>${new Date(e.updated).toLocaleDateString('ar')}</small></button>
      <button class="icon-btn danger" data-del="${e.id}" aria-label="حذف">${icon('trash', 20)}</button></div>`).join('') || '<p class="note">ما في مشاريع محفوظة.</p>'}</div>`,
    (b) => b.addEventListener('click', (e) => {
      const o = e.target.closest('[data-open]');
      const d = e.target.closest('[data-del]');
      if (o) {
        saveNow();
        const np = S.loadProject(o.dataset.open);
        if (!np) return toast('ما قدرنا نفتح المشروع');
        pause();
        loadState(np);
        closeSheet();
        toast(`تم فتح ${np.name}`);
      } else if (d) {
        const id = d.dataset.del;
        const e2 = S.listProjects().find((x) => x.id === id);
        if (!confirm(`حذف "${e2?.name}" نهائيًا؟`)) return;
        S.deleteProject(id);
        if (id === p.id) { loadState(S.newProject()); saveNow(); }
        openMenu('open');
      }
    }));
    return;
  }
  openSheet('المشروع', `
    <button class="row proj-name" data-m="rename">${icon('fileNew')}<span>${esc(p.name)}</span><small>تغيير الاسم</small></button>
    <div class="grid3">
      <button class="tile" data-m="save">${icon('save', 30)}<span>حفظ المشروع</span></button>
      <button class="tile" data-m="open">${icon('folder', 30)}<span>فتح مشروع</span></button>
      <button class="tile" data-m="new">${icon('plus', 30)}<span>مشروع جديد</span></button>
    </div>
    <h4>طريقة الاستخدام</h4>
    <ul class="help">
      <li><b>إصبع واحد:</b> تدوير الكاميرا حول الهدف (Orbit)</li>
      <li><b>إصبعين:</b> سحب = Pan، قرص = Dolly / Zoom</li>
      <li><b>وضع "التفاف":</b> الكاميرا بتلف بمكانها (Pan / Tilt)</li>
      <li><b>مفاتيح الكاميرا:</b> حرّك المؤشر بالشريط ← حرّك الكاميرا ← اضغط ◆</li>
      <li><b>حركة عنصر:</b> حدّده ← حركة A→B ← A بالبداية، B بالنهاية</li>
    </ul>
    <p class="note">كل شي محفوظ تلقائيًا على هذا الجهاز فقط. ما في حساب ولا سحابة.</p>`,
  (b) => b.addEventListener('click', (e) => {
    const m = e.target.closest('[data-m]')?.dataset.m;
    if (m === 'save') { closeSheet(); toast(saveNow() ? 'تم حفظ المشروع ✓' : 'ما قدرنا نحفظ — المساحة ممتلئة؟'); }
    if (m === 'open') openMenu('open');
    if (m === 'new') {
      saveNow();
      pause();
      loadState(S.newProject());
      saveNow();
      closeSheet();
      toast('مشروع جديد — القديم محفوظ');
    }
    if (m === 'rename') {
      const n = prompt('اسم المشروع', p.name);
      if (n && n.trim()) { p.name = n.trim().slice(0, 40); saveNow(); openMenu(); }
    }
  }));
}

function openVideoSheet() {
  const v = app.video;
  const mb = (v.blob.size / 1048576).toFixed(1);
  const canShare = !!navigator.canShare?.({ files: [new File([v.blob], `shot.${v.ext}`, { type: v.blob.type })] });
  openSheet('الفيديو جاهز', `
    <p class="note">${app.project.aspect} · ${app.project.duration}s · ${v.ext.toUpperCase()} · ${mb}MB</p>
    <div class="grid2">
      ${canShare ? `<button class="tile" data-v="share">${icon('share', 30)}<span>مشاركة / حفظ بالصور</span></button>` : ''}
      <button class="tile" data-v="dl">${icon('download', 30)}<span>تنزيل</span></button>
    </div>`,
  (b) => b.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-v]')?.dataset.v;
    const name = `${app.project.name.replace(/[^\p{L}\p{N}_-]+/gu, '_')}_${app.project.aspect.replace(':', 'x')}.${v.ext}`;
    const file = new File([v.blob], name, { type: v.blob.type });
    if (a === 'share') {
      try { await navigator.share({ files: [file] }); } catch { /* المستخدم لغى */ }
    } else if (a === 'dl') {
      const url = URL.createObjectURL(v.blob);
      const link = Object.assign(document.createElement('a'), { href: url, download: name });
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  }));
}

let toastTimer = 0;
function toast(msg, ms = 2200) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/* ==========================================================================
   الأحداث
   ========================================================================== */

$('#btnMenu').innerHTML = icon('menu');
$('#btnUndo').innerHTML = icon('undo');
$('#btnPreview').innerHTML = `${icon('play', 18)}<span class="long">معاينة الكاميرا</span><span class="short">معاينة</span>`;
$('#modeSeg').innerHTML = `<button data-mode="camera">كاميرا</button><button data-mode="objects">مجسمات</button>`;
$('#btnStop').innerHTML = icon('stop', 20);
$('#btnLoop').innerHTML = icon('loop', 20);
$('#sheetClose').innerHTML = icon('x');
$('#pvExit').innerHTML = icon('x', 24);
$('#pvStop').innerHTML = icon('stop', 22);
for (const b of document.querySelectorAll('#nudge [data-n]')) b.innerHTML = icon(b.dataset.i, 22);

$('#btnMenu').addEventListener('click', () => openMenu());
$('#btnUndo').addEventListener('click', undo);
$('#btnPreview').addEventListener('click', enterPreview);
$('#modeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (b && b.dataset.mode !== app.mode) setMode(b.dataset.mode);
});
$('#btnPlay').addEventListener('click', () => (app.playing ? pause() : play()));
$('#btnStop').addEventListener('click', stop);
$('#btnLoop').addEventListener('click', () => { app.loop = !app.loop; renderTransport(); toast(app.loop ? 'تكرار: شغّال' : 'تكرار: متوقف'); });
$('#btnDur').addEventListener('click', openDurationSheet);
$('#sheetClose').addEventListener('click', closeSheet);
$('#sheet').addEventListener('click', (e) => e.target.id === 'sheet' && closeSheet());

$('#pvExit').addEventListener('click', exitPreview);
$('#pvPlay').addEventListener('click', () => (app.playing ? pause() : play()));
$('#pvStop').addEventListener('click', () => { if (app.recording) stopRecording(); else stop(); });
$('#pvRec').addEventListener('click', () => (app.recording ? stopRecording() : startRecording()));
$('#pvAspect').addEventListener('click', () => { if (!app.recording) { cycleAspect(); layout(); } });
$('#pvScrub').addEventListener('pointerdown', (e) => {
  if (app.recording) return;
  const el = e.currentTarget;
  el.setPointerCapture(e.pointerId);
  const seek = (ev) => {
    const r = el.getBoundingClientRect();
    pause();
    applyTime(((ev.clientX - r.left) / r.width) * app.project.duration);
  };
  seek(e);
  el.onpointermove = seek;
  el.onpointerup = el.onpointercancel = () => { el.onpointermove = null; };
});

$('#actions').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  const actions = {
    'key-add': addKey,
    'key-del': deleteKey,
    'key-ease': toggleKeyEase,
    target: openTargetSheet,
    lens: openLensSheet,
    gesture: () => {
      app.gesture = app.gesture === 'orbit' ? 'look' : 'orbit';
      if (app.gesture === 'look' && app.cam.targetObj) { app.cam.targetObj = null; toast('تم فك قفل الهدف'); }
      syncControls();
      toast(app.gesture === 'orbit' ? 'مدار: إصبع واحد يدور حول الهدف' : 'التفاف: الكاميرا بتلف بمكانها (Pan / Tilt)');
      renderActions(true);
    },
    nudge: () => { app.nudgeOpen = !app.nudgeOpen; $('#nudge').hidden = !app.nudgeOpen; renderActions(true); },
    aspect: cycleAspect,
    'cam-num': openCamNumbers,
    add: openAddSheet,
    'cam-here': () => {
      app.cam.pos = stage.editorCam.position.toArray();
      app.cam.target = stage.editorControls.target.toArray();
      app.cam.targetObj = null;
      stage.setShot(app.cam);
      setMode('camera');
      onCameraManual();
      toast('الكاميرا انتقلت لهالمنظر — اضغط ◆ لحفظه كمفتاح');
    },
    rename: renameObject,
    gizmo: () => { app.gizmo = b.dataset.v; stage.transform.setMode(app.gizmo); renderActions(true); },
    motion: () => { app.objPanel = 'motion'; renderActions(true); },
    'motion-back': () => { app.objPanel = 'main'; renderActions(true); },
    'motion-a': () => setMotionPoint('a'),
    'motion-b': () => setMotionPoint('b'),
    'motion-ease': () => editMotion('ease', 0),
    'motion-del': removeMotion,
    step: () => editMotion(b.dataset.f, parseFloat(b.dataset.d)),
    'step-edit': () => promptMotion(b.dataset.f),
    dup: duplicateObject,
    color: cycleColor,
    'obj-num': openObjNumbers,
    del: deleteObject,
    deselect: () => select(null),
  };
  actions[act]?.();
});

// أزرار التحريك: اضغط مطولًا للحركة المستمرة
for (const b of document.querySelectorAll('#nudge [data-n]')) {
  const [f, r, u] = b.dataset.n.split(',').map(Number);
  const start = (e) => {
    e.preventDefault();
    b.setPointerCapture?.(e.pointerId);
    app.nudge = { f, r, u };
    b.classList.add('on');
  };
  const end = () => { app.nudge = null; b.classList.remove('on'); };
  b.addEventListener('pointerdown', start);
  b.addEventListener('pointerup', end);
  b.addEventListener('pointercancel', end);
  b.addEventListener('lostpointercapture', end);
}

// اختيار المجسم بالنقر بوضع المجسمات
let tap = null;
canvas.addEventListener('pointerdown', (e) => {
  if (app.mode !== 'objects' || app.preview) return;
  tap = tap ? { multi: true } : { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), gizmo: stage.transform.dragging };
});
canvas.addEventListener('pointerup', (e) => {
  const t = tap;
  tap = null;
  if (!t || t.multi || t.gizmo || t.id !== e.pointerId || app.playing) return;
  if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > 8 || performance.now() - t.t > 450) return;
  const id = stage.pick(e.clientX, e.clientY);
  if (id !== app.selectedId) select(id);
});
canvas.addEventListener('pointercancel', () => { tap = null; });

// منع تكبير الصفحة بالقرص على سفاري
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && saveNow());
window.addEventListener('pagehide', saveNow);

/* ==========================================================================
   الحلقة الرئيسية
   ========================================================================== */

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (app.playing) {
    let t = app.time + dt;
    const D = app.project.duration;
    if (t >= D) {
      if (app.recording) { t = D; applyTime(t); stopRecording(); }
      else if (app.loop || (app.preview && !app.recording)) t = t - D;
      else { t = D; app.playing = false; syncControls(); renderUI(); }
    }
    applyTime(t);
  }

  if (app.nudge && app.mode === 'camera' && !app.playing) nudgeStep(dt);

  const changed = stage.tick();
  if (changed === 'shot') onCameraManual();

  if (stage.needsRender || app.recording) {
    stage.render();
    if (app.recording) recorder.capture(canvas);
  }
  requestAnimationFrame(frame);
}

/* ---------- البداية ---------- */

const startId = S.currentProjectId();
loadState((startId && S.loadProject(startId)) || S.newProject());
setMode('camera');
saveNow();
requestAnimationFrame(frame);
if (!S.listProjects().some((e) => e.id !== app.project.id) && !app.project.keys.length) {
  setTimeout(() => toast('حرّك الكاميرا بإصبعك، ثم اضغط ◆ إضافة مفتاح كاميرا', 4200), 600);
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// للاختبار الآلي فقط
window.__blk = { app, stage, applyTime, addKey, play, pause, setMode, addObject, select, setMotionPoint, A };
