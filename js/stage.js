/* ==========================================================================
   لقطة — المشهد ثلاثي الأبعاد
   أرضية + شبكة + مجسمات بسيطة + كاميرا اللقطة + أدوات التحكم.
   إضاءة بسيطة جدًا (Ambient + Directional) وبدون ظلال عشان يضل خفيف على الآيفون.
   ========================================================================== */

import {
  WebGLRenderer, Scene, Color, Fog, PerspectiveCamera, AmbientLight, DirectionalLight,
  CanvasTexture, RepeatWrapping, SRGBColorSpace, Mesh, MeshLambertMaterial, MeshBasicMaterial, PlaneGeometry, BoxGeometry,
  SphereGeometry, CylinderGeometry, CapsuleGeometry, OctahedronGeometry, EdgesGeometry,
  LineSegments, LineBasicMaterial, LineDashedMaterial, Line, BufferGeometry,
  Float32BufferAttribute, Group, Vector2, Vector3, Raycaster, MathUtils,
  OrbitControls, TransformControls,
} from '../vendor/three.js';
import { ASPECTS, fovFromLens, evalObject, sampleObjectPath } from './anim.js';

const BG = 0x0b0c0f;
const AMBER = 0xffb020;

const GEO_MAKERS = {
  cube: () => new BoxGeometry(1, 1, 1),
  rect: () => new BoxGeometry(1.8, 1.4, 4.4),
  sphere: () => new SphereGeometry(0.5, 32, 16),
  cylinder: () => new CylinderGeometry(0.5, 0.5, 1, 32),
  person: () => new CapsuleGeometry(0.25, 1.3, 6, 16),
  wall: () => new BoxGeometry(4, 2.5, 0.12),
};
const GEO = {};
const EDGE_GEO = {};
const geo = (t) => (GEO[t] ||= GEO_MAKERS[t]());
const edgeGeo = (t) => (EDGE_GEO[t] ||= new EdgesGeometry(geo(t), 30));

const EDGE_MAT = new LineBasicMaterial({ color: 0x050608, transparent: true, opacity: 0.6 });
const SEL_MAT = new LineBasicMaterial({ color: AMBER });
const NOSE_GEO = new BoxGeometry(0.2, 0.08, 0.14);


/** يوقف أي زخم متبقي بالـ OrbitControls بعد ما نحط الكاميرا بمكان جديد برمجيًا. */
function stopInertia(c) {
  c._sphericalDelta?.set(0, 0, 0);
  c._panOffset?.set(0, 0, 0);
  if ('_scale' in c) c._scale = 1;
}

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.mode = 'camera';
    this.aspect = ASPECTS['9:16'];
    this.lens = 35;
    this.roll = 0;
    this.width = 1;
    this.height = 1;
    this.frame = { x: 0, y: 0, w: 1, h: 1 };
    this.needsRender = true;
    this.objects = new Map();
    this.pickables = [];
    this.selectedId = null;

    const r = (this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    r.setPixelRatio(this.dpr);

    const s = (this.scene = new Scene());
    s.background = new Color(BG);
    s.fog = new Fog(BG, 45, 170);
    s.add(new AmbientLight(0xffffff, 1.1));
    const sun = new DirectionalLight(0xffffff, 2.0);
    sun.position.set(6, 12, 8);
    s.add(sun);

    // أرضية عليها شبكة مرسومة كصورة: متر لكل مربع وخط أوضح كل ٥ متر.
    // أثبت من خطوط GridHelper على كل كروت الشاشة وبتتلاشى بنعومة بالبعيد.
    const ground = new Mesh(new PlaneGeometry(400, 400), new MeshBasicMaterial({ map: gridTexture(r) }));
    ground.rotation.x = -Math.PI / 2;
    s.add(ground);

    this.editorCam = new PerspectiveCamera(50, 1, 0.05, 600);
    this.shotCam = new PerspectiveCamera(50, this.aspect, 0.05, 600);
    this.viewCam = new PerspectiveCamera(50, 1, 0.05, 600);

    // الترتيب مهم: أداة التحريك أولاً عشان تلقط اللمسة قبل تدوير الكاميرا
    this.transform = new TransformControls(this.editorCam, canvas);
    this.transform.setSize(1.3);
    this.transform.setRotationSnap(MathUtils.degToRad(5));
    this.gizmo = this.transform.getHelper();
    s.add(this.gizmo);

    this.editorControls = new OrbitControls(this.editorCam, canvas);
    Object.assign(this.editorControls, { enableDamping: true, dampingFactor: 0.12, maxPolarAngle: Math.PI * 0.495, maxDistance: 250, minDistance: 0.5 });

    this.shotControls = new OrbitControls(this.shotCam, canvas);
    Object.assign(this.shotControls, { enableDamping: true, dampingFactor: 0.1, rotateSpeed: 0.55, panSpeed: 0.8, minDistance: 0.25, maxDistance: 300 });

    this.transform.addEventListener('dragging-changed', (e) => {
      this.editorControls.enabled = !e.value;
      this.onDragging?.(e.value);
    });
    this.transform.addEventListener('objectChange', () => {
      this.needsRender = true;
      this.onObjectChange?.();
    });

    this.raycaster = new Raycaster();
    this.buildRig();
    this.motionViz = new Group();
    s.add(this.motionViz);
    this.setMode('camera');
  }

  /* ---------- رسم كاميرا اللقطة داخل المشهد (بوضع المجسمات) ---------- */

  buildRig() {
    const mat = new LineBasicMaterial({ color: AMBER });
    this.rig = new Group();
    this.rigFrustum = new LineSegments(new BufferGeometry(), mat);
    this.rigFrustum.geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(22 * 3), 3));
    const body = new Mesh(new BoxGeometry(0.28, 0.2, 0.34), new MeshBasicMaterial({ color: AMBER }));
    body.position.z = 0.17;
    this.rigCam = new Group();
    this.rigCam.add(this.rigFrustum, body);

    this.lookLine = new Line(new BufferGeometry(), new LineDashedMaterial({ color: AMBER, dashSize: 0.25, gapSize: 0.18, transparent: true, opacity: 0.7 }));
    this.lookLine.geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(6), 3));
    this.targetMarker = new Mesh(new OctahedronGeometry(0.16), new MeshBasicMaterial({ color: AMBER, wireframe: true }));

    this.path = new Line(new BufferGeometry(), new LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.85 }));
    this.keyDots = new Group();
    this.rig.add(this.rigCam, this.lookLine, this.targetMarker, this.path, this.keyDots);
    this.scene.add(this.rig);
  }

  updateRig() {
    const F = MathUtils.degToRad(fovFromLens(this.lens, this.aspect));
    const d = 1.4, hh = Math.tan(F / 2) * d, hw = hh * this.aspect;
    const c = [[-hw, hh, -d], [hw, hh, -d], [hw, -hh, -d], [-hw, -hh, -d]];
    const v = [];
    for (const p of c) v.push(0, 0, 0, ...p);
    for (let i = 0; i < 4; i++) v.push(...c[i], ...c[(i + 1) % 4]);
    const tip = [0, hh * 1.45, -d];
    v.push(-hw * 0.5, hh * 1.06, -d, ...tip, ...tip, hw * 0.5, hh * 1.06, -d, hw * 0.5, hh * 1.06, -d, -hw * 0.5, hh * 1.06, -d);
    const attr = this.rigFrustum.geometry.attributes.position;
    attr.array.set(v);
    attr.needsUpdate = true;
    this.rigFrustum.geometry.computeBoundingSphere();

    this.rigCam.position.copy(this.shotCam.position);
    this.rigCam.quaternion.copy(this.shotCam.quaternion);
    const t = this.shotControls.target;
    const la = this.lookLine.geometry.attributes.position;
    la.array.set([...this.shotCam.position.toArray(), ...t.toArray()]);
    la.needsUpdate = true;
    this.lookLine.geometry.computeBoundingSphere();
    this.lookLine.computeLineDistances();
    this.targetMarker.position.copy(t);
  }

  setPath(points, keyPoints) {
    this.path.geometry.dispose();
    this.path.geometry = new BufferGeometry();
    this.path.geometry.setAttribute('position', new Float32BufferAttribute(points.flat(), 3));
    this.keyDots.clear();
    for (const p of keyPoints) {
      const dot = new Mesh(DOT_GEO, DOT_MAT);
      dot.position.fromArray(p);
      this.keyDots.add(dot);
    }
    this.needsRender = true;
  }

  /* ---------- المجسمات ---------- */

  syncObjects(objects) {
    const seen = new Set();
    for (const o of objects) {
      let g = this.objects.get(o.id);
      if (g && g.userData.type !== o.type) { this.removeObject(o.id); g = null; }
      if (!g) g = this.buildObject(o);
      g.userData.mat.color.set(o.color);
      seen.add(o.id);
    }
    for (const id of [...this.objects.keys()]) if (!seen.has(id)) this.removeObject(id);
    if (this.selectedId && !this.objects.has(this.selectedId)) this.select(null);
    this.needsRender = true;
  }

  buildObject(o) {
    const root = new Group();
    const mat = new MeshLambertMaterial({ color: o.color });
    const mesh = new Mesh(geo(o.type), mat);
    mesh.userData.pick = o.id;
    const edges = new LineSegments(edgeGeo(o.type), EDGE_MAT);
    root.add(mesh, edges);
    if (o.type === 'person') {
      // علامة صغيرة توضح وين وجه الشخص
      const nose = new Mesh(NOSE_GEO, new MeshBasicMaterial({ color: 0xf2f2f2 }));
      nose.position.set(0, 0.62, 0.25);
      root.add(nose);
    }
    root.userData = { id: o.id, type: o.type, mat, edges, mesh };
    this.scene.add(root);
    this.objects.set(o.id, root);
    this.pickables.push(mesh);
    return root;
  }

  removeObject(id) {
    const g = this.objects.get(id);
    if (!g) return;
    if (this.transform.object === g) this.transform.detach();
    this.scene.remove(g);
    g.userData.mat.dispose();
    this.pickables = this.pickables.filter((m) => m !== g.userData.mesh);
    this.objects.delete(id);
  }

  /** يطبّق أماكن المجسمات بالوقت t (من مفاتيح حركتها إذا عندها). */
  applyObjects(objects, t, skipId = null) {
    for (const o of objects) {
      if (o.id === skipId) continue;
      const g = this.objects.get(o.id);
      if (!g) continue;
      const v = evalObject(o.keys, t) || o;
      g.position.fromArray(v.pos);
      g.rotation.set(v.rot[0], v.rot[1], v.rot[2]);
      g.scale.fromArray(v.scale);
    }
    this.needsRender = true;
  }

  readTRS(id) {
    const g = this.objects.get(id);
    return {
      pos: g.position.toArray().map(round),
      rot: [g.rotation.x, g.rotation.y, g.rotation.z].map(round),
      scale: g.scale.toArray().map(round),
    };
  }

  objectPos(id) {
    return this.objects.get(id)?.position || null;
  }

  /** مسار حركة كل مجسم، ونقاط المفاتيح وأشباحها للمجسم المحدد. */
  updateMotionViz(objects) {
    for (const c of this.motionViz.children) {
      if (c.isLine) c.geometry.dispose();
      if (c.material && c.material !== DOT_MAT) c.material.dispose();
    }
    this.motionViz.clear();
    for (const o of objects) {
      const keys = o.keys || [];
      if (!keys.length) continue;
      const sel = o.id === this.selectedId;
      const pts = sampleObjectPath(keys);
      if (pts.length) {
        const line = new Line(new BufferGeometry(), new LineBasicMaterial({ color: o.color, transparent: true, opacity: sel ? 1 : 0.45 }));
        line.geometry.setAttribute('position', new Float32BufferAttribute(pts.flat(), 3));
        this.motionViz.add(line);
      }
      if (!sel) continue;
      for (const k of keys) {
        const ghost = new Mesh(geo(o.type), new MeshBasicMaterial({ color: o.color, wireframe: true, transparent: true, opacity: 0.28 }));
        ghost.position.fromArray(k.pos);
        ghost.rotation.set(k.rot[0], k.rot[1], k.rot[2]);
        ghost.scale.fromArray(k.scale);
        this.motionViz.add(ghost);
      }
    }
    this.needsRender = true;
  }

  select(id, gizmo = true) {
    if (this.selectedId) {
      const prev = this.objects.get(this.selectedId);
      if (prev) { prev.userData.edges.material = EDGE_MAT; prev.userData.mat.emissive.setHex(0); }
    }
    this.selectedId = id;
    const g = id ? this.objects.get(id) : null;
    if (g) { g.userData.edges.material = SEL_MAT; g.userData.mat.emissive.setHex(0x2a1c00); }
    if (g && gizmo) this.transform.attach(g);
    else this.transform.detach();
    this.needsRender = true;
  }

  pick(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.editorCam);
    const hit = this.raycaster.intersectObjects(this.pickables, false)[0];
    return hit ? hit.object.userData.pick : null;
  }

  /* ---------- كاميرا اللقطة ---------- */

  setShot(cam) {
    this.shotCam.position.fromArray(cam.pos);
    this.shotControls.target.fromArray(cam.target);
    this.lens = cam.lens;
    this.roll = cam.roll || 0;
    this.orientShot();
    stopInertia(this.shotControls);
    this.needsRender = true;
  }

  orientShot() {
    const c = this.shotCam;
    c.up.set(0, 1, 0);
    c.lookAt(this.shotControls.target);
    if (this.roll) c.rotateZ(MathUtils.degToRad(this.roll));
    c.aspect = this.aspect;
    c.fov = fovFromLens(this.lens, this.aspect);
    c.updateProjectionMatrix();
  }

  setEditorView(view) {
    this.editorCam.position.fromArray(view.pos);
    this.editorControls.target.fromArray(view.target);
    this.editorCam.lookAt(this.editorControls.target);
    stopInertia(this.editorControls);
    this.needsRender = true;
  }

  setAspect(key) {
    this.aspect = ASPECTS[key] || ASPECTS['9:16'];
    this.orientShot();
    this.layoutFrame();
  }

  setMode(mode) {
    this.mode = mode;
    const objects = mode === 'objects';
    this.rig.visible = objects;
    this.motionViz.visible = objects;
    this.gizmo.visible = objects;
    this.transform.enabled = objects;
    this.editorControls.enabled = objects;
    this.needsRender = true;
  }

  /* ---------- المقاس والإطار ---------- */

  resize(w, h) {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.width, this.height);
    this.editorCam.aspect = this.width / this.height;
    this.editorCam.updateProjectionMatrix();
    this.layoutFrame();
  }

  /** بوضع المعاينة: لوحة الرسم بحجم الإطار بالضبط وبدقة التصدير. */
  resizeExact(cssW, cssH, pxW, pxH) {
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(pxW, pxH, false);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.needsRender = true;
  }

  layoutFrame() {
    const pad = 12;
    const aw = this.width - pad * 2, ah = this.height - pad * 2;
    let w = aw, h = aw / this.aspect;
    if (h > ah) { h = ah; w = ah * this.aspect; }
    this.frame = { x: (this.width - w) / 2, y: (this.height - h) / 2, w, h };
    this.needsRender = true;
  }

  /* ---------- الرسم ---------- */

  /** يحدّث أدوات التحكم. بيرجع 'editor' أو 'shot' إذا تغيّر شي. */
  tick() {
    if (this.mode === 'objects') {
      if (this.editorControls.update()) { this.needsRender = true; return 'editor'; }
    } else if (this.mode === 'camera' && this.shotControls.enabled) {
      const changed = this.shotControls.update();
      this.orientShot();
      if (changed) { this.needsRender = true; return 'shot'; }
    }
    return null;
  }

  render() {
    this.needsRender = false;
    if (this.mode === 'objects') {
      this.updateRig();
      this.renderer.render(this.scene, this.editorCam);
      return;
    }
    const v = this.viewCam;
    const F = fovFromLens(this.lens, this.aspect);
    v.position.copy(this.shotCam.position);
    v.quaternion.copy(this.shotCam.quaternion);
    if (this.mode === 'preview') {
      v.aspect = this.aspect;
      v.fov = F;
    } else {
      // نوسّع زاوية الرؤية عشان الإطار يطلع بالضبط مثل الكاميرا، والباقي حواليه معتّم
      const k = this.height / this.frame.h;
      v.fov = MathUtils.radToDeg(2 * Math.atan(Math.tan(MathUtils.degToRad(F) / 2) * k));
      v.aspect = this.width / this.height;
    }
    v.updateProjectionMatrix();
    this.renderer.render(this.scene, v);
  }
}

function gridTexture(renderer) {
  const N = 512, cell = N / 5;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  g.fillStyle = '#101216';
  g.fillRect(0, 0, N, N);
  g.fillStyle = '#272c36';
  for (let i = 1; i < 5; i++) {
    g.fillRect(Math.round(i * cell) - 1, 0, 2, N);
    g.fillRect(0, Math.round(i * cell) - 1, N, 2);
  }
  g.fillStyle = '#434b5e';
  g.fillRect(0, 0, 3, N);
  g.fillRect(0, 0, N, 3);
  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(80, 80);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

const DOT_GEO = new SphereGeometry(0.09, 12, 8);
const DOT_MAT = new MeshBasicMaterial({ color: AMBER });
const round = (v) => Math.round(v * 1000) / 1000;
