/* ==========================================================================
   لقطة — اختبار الكمبيوتر: ماوس + كيبورد بشاشة كبيرة
   التشغيل: node tests/desktop.mjs
   ========================================================================== */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SHOTS = fileURLToPath(new URL('./shots/', import.meta.url));
const PORT = 8138;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const data = await readFile(join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, '')));
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(PORT, r));
await mkdir(SHOTS, { recursive: true });

let failed = 0;
const ok = (c, name, d = '') => { if (!c) failed++; console.log(`${c ? '  ok  ' : ' FAIL '} ${name}${d ? ' — ' + d : ''}`); };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 860 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const st = () => page.evaluate(() => {
  const { app } = window.__blk;
  return { t: app.time, keys: app.project.keys.length, pos: app.cam.pos, target: app.cam.target, playing: app.playing, mode: app.mode, objs: app.project.objects.length, gizmo: app.gizmo, sel: app.selectedId };
});
const key = async (k, n = 1) => { for (let i = 0; i < n; i++) await page.keyboard.press(k); await page.waitForTimeout(60); };

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__blk);
  await page.waitForTimeout(400);
  const vp = await page.locator('#viewport').boundingBox();
  const cx = vp.x + vp.width / 2, cy = vp.y + vp.height / 2;
  ok((await page.locator('#actions').boundingBox()).x > vp.x + vp.width - 5, 'لوحة أدوات جانبية بالشاشة الكبيرة');

  // ماوس: سحب = Orbit، عجلة = Dolly، زر يمين = Pan
  let s = await st();
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 200, cy, { steps: 12 }); await page.mouse.up();
  await page.waitForTimeout(400);
  let s2 = await st();
  ok(dist(s.pos, s2.pos) > 0.5, 'سحب بالماوس = Orbit');
  const d0 = dist(s2.pos, s2.target);
  await page.mouse.wheel(0, -600); await page.waitForTimeout(400);
  s = await st();
  ok(dist(s.pos, s.target) < d0 - 0.2, 'العجلة = Dolly In');
  const t0 = s.target;
  await page.mouse.move(cx, cy); await page.mouse.down({ button: 'right' }); await page.mouse.move(cx + 120, cy + 40, { steps: 10 }); await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(400);
  ok(dist(t0, (await st()).target) > 0.1, 'زر يمين = Pan');
  await page.waitForTimeout(1500);   // نخلي زخم السحب يهدى

  // العجلة: نقرة وحدة لازم تحرك بوضوح، وبتكمل لقدام حتى بعد الهدف
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -100); await page.mouse.wheel(0, 100);   // بيوقف أي زخم باقي من السحب
  await page.waitForTimeout(150);
  s = await st();
  await page.mouse.wheel(0, -100); await page.waitForTimeout(150);
  s2 = await st();
  ok(dist(s.pos, s2.pos) > 0.1, 'نقرة عجلة وحدة = خطوة لقدام', `${dist(s.pos, s2.pos).toFixed(2)}m`);
  await page.mouse.wheel(0, 100); await page.waitForTimeout(150);
  { const b2 = await st(); ok(dist(s.pos, b2.pos) < 1e-3, 'نقرة لورا بترجعها لنفس المكان', `${s.pos.map((v) => v.toFixed(3))} → ${s2.pos.map((v) => v.toFixed(3))} → ${b2.pos.map((v) => v.toFixed(3))} d=${dist(s.pos, s.target).toFixed(2)}`); }
  for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, -100); await page.waitForTimeout(10); }
  s2 = await st();
  ok(dist(s.pos, s2.pos) > dist(s.pos, s.target), 'العجلة بتمشي لقدام وبتعدّي الهدف بدون ما تعلق', `${dist(s.pos, s2.pos).toFixed(1)}m`);
  s = s2;
  await page.mouse.wheel(250, 0); await page.waitForTimeout(150);
  s2 = await st();
  ok(dist(s.pos, s2.pos) > 0.1 && Math.abs(s.pos[1] - s2.pos[1]) < 1e-6, 'العجلة الأفقية = يمين / يسار');
  await page.keyboard.down('Shift'); await page.mouse.wheel(0, 200); await page.keyboard.up('Shift'); await page.waitForTimeout(150);
  ok(dist(s2.pos, (await st()).pos) > 0.1, 'Shift + العجلة = يمين / يسار');
  s = await st();
  await page.keyboard.down('Alt'); await page.mouse.wheel(0, -200); await page.keyboard.up('Alt'); await page.waitForTimeout(150);
  ok((await st()).pos[1] > s.pos[1] + 0.1, 'Alt + العجلة = فوق');

  // كيبورد: مفاتيح ووقت
  await key('k');
  await key('Shift+ArrowRight', 3);
  ok(Math.abs((await st()).t - 3) < 1e-6, 'Shift+→ = ثانية لقدام', `${(await st()).t}`);
  const p0 = (await st()).pos;
  await page.keyboard.down('KeyD'); await page.waitForTimeout(400); await page.keyboard.up('KeyD');
  ok(dist(p0, (await st()).pos) > 0.2, 'D = Truck يمين');
  const p1 = (await st()).pos;
  await page.keyboard.down('KeyE'); await page.waitForTimeout(300); await page.keyboard.up('KeyE');
  ok((await st()).pos[1] > p1[1] + 0.1, 'E = Pedestal Up');
  await key('k');
  await key('ArrowRight', 30);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(300); await page.keyboard.up('KeyW');
  await key('k');
  s = await st();
  ok(s.keys === 3, 'K = إضافة مفتاح (٣ مفاتيح)', `${s.keys}`);
  await key('Home');
  ok((await st()).t === 0, 'Home = البداية');
  await key(']');
  ok(Math.abs((await st()).t - 3) < 1e-6, '] = المفتاح التالي');
  await key('Delete');
  ok((await st()).keys === 2, 'Delete = حذف المفتاح');
  await key('Control+z');
  ok((await st()).keys === 3, 'Ctrl+Z = تراجع');
  await key('Home');
  await key('Space');
  await page.waitForTimeout(700);
  s = await st();
  ok(s.playing && s.t > 0.3, 'Space = تشغيل');
  await key('Space');
  ok(!(await st()).playing, 'Space = إيقاف');

  // وضع الالتفاف بالماوس
  await key('v');
  s = await st();
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx - 120, cy, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(200);
  s2 = await st();
  const ang = (() => {
    const u = s.target.map((v, i) => v - s.pos[i]), w = s2.target.map((v, i) => v - s2.pos[i]);
    return Math.acos(Math.min(1, u.reduce((acc, v, i) => acc + v * w[i], 0) / (Math.hypot(...u) * Math.hypot(...w)))) * 180 / Math.PI;
  })();
  ok(dist(s.pos, s2.pos) < 1e-6 && ang > 5, 'V ثم سحب = Pan/Tilt بمكانها', `لفّت ${ang.toFixed(0)}°`);
  await page.mouse.wheel(0, -300); await page.waitForTimeout(200);
  ok(dist(s2.pos, (await st()).pos) > 0.1, 'العجلة بوضع الالتفاف = Dolly');
  await key('v');
  await page.screenshot({ path: join(SHOTS, 'desktop-camera.png') });

  // المجسمات
  await key('2');
  ok((await st()).mode === 'objects', '2 = وضع المجسمات');
  ok(await page.locator('[data-act="add-type"]').count() === 6, 'الأشكال ظاهرة مباشرة باللوحة');
  await page.locator('[data-act="add-type"][data-type="person"]').click();
  s = await st();
  ok(s.objs === 2 && s.sel, 'إضافة شخص بنقرة');

  // حركة العنصر بالماوس: K بالبداية، وبعدين سحب العنصر بالثانية 3 = مفتاح لحاله
  const objScreen = () => page.evaluate(() => {
    const { stage, app } = window.__blk;
    const v = stage.objectPos(app.selectedId).clone().project(stage.editorCam);
    const r = stage.canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  });
  const objPos = () => page.evaluate(() => window.__blk.stage.objectPos(window.__blk.app.selectedId).toArray());
  await key('Home');
  await key('k');
  await key('Shift+ArrowRight', 3);
  const o0 = await objPos();
  const sc = await objScreen();
  await page.mouse.move(sc.x, sc.y); await page.mouse.down(); await page.mouse.move(sc.x + 160, sc.y + 20, { steps: 14 }); await page.mouse.up();
  await page.waitForTimeout(300);
  const okeys = await page.evaluate(() => { const { app } = window.__blk; return app.project.objects.find((o) => o.id === app.selectedId).keys.map((k) => k.t); });
  ok(okeys.join() === '0,3', 'سحب العنصر بعد أول مفتاح = مفتاح جديد لحاله', okeys.join());
  await key('Home');
  ok(dist(await objPos(), o0) < 1e-6, 'بالثانية 0 العنصر بمكانه الأول');
  await key('Space');
  await page.waitForTimeout(1200);
  await key('Space');
  const oMid = await objPos();
  ok(dist(oMid, o0) > 0.2, 'التشغيل بيحرك العنصر لحاله', `${dist(oMid, o0).toFixed(2)}m`);
  await key('Home');
  await key('r');
  ok((await st()).gizmo === 'rotate', 'R = تدوير');
  const e0 = await page.evaluate(() => window.__blk.stage.editorCam.position.toArray());
  await page.mouse.move(cx, cy); await page.mouse.wheel(0, -300); await page.waitForTimeout(150);
  const e1 = await page.evaluate(() => window.__blk.stage.editorCam.position.toArray());
  ok(dist(e0, e1) > 0.3, 'العجلة شغالة بوضع المجسمات كمان');
  await key('g');
  await key('Control+d');
  ok((await st()).objs === 3, 'Ctrl+D = نسخ');
  await key('Delete');
  ok((await st()).objs === 2, 'Delete = حذف العنصر');
  await page.screenshot({ path: join(SHOTS, 'desktop-objects.png') });
  await key('Escape');
  ok(!(await st()).sel, 'Esc = إلغاء التحديد');

  // مدة 60 ثانية وتدريج كل ثانية
  await page.locator('#btnDur').click();
  await page.locator('#durRange').fill('60');
  await page.locator('[data-apply]').click();
  await page.waitForSelector('#sheet', { state: 'hidden' });
  const ticks = await page.evaluate(() => ({ all: document.querySelectorAll('.tl-ruler i.mj, .tl-ruler i.mn').length, labels: [...document.querySelectorAll('.tl-ruler b')].map((b) => b.textContent) }));
  ok(ticks.all === 61, 'شريط الوقت فيه خط لكل ثانية من 0 لـ 60', `${ticks.all}`);
  ok(ticks.labels.at(-1) === '60s', 'آخر رقم 60s', ticks.labels.join(' '));
  await page.screenshot({ path: join(SHOTS, 'desktop-60s.png') });

  // القوائم والمعاينة
  await key('1');
  await page.locator('#btnMenu').click();
  ok(await page.locator('.keys kbd').count() > 10, 'قائمة الاختصارات ظاهرة');
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(SHOTS, 'desktop-menu.png') });
  await key('Escape');
  await page.waitForSelector('#sheet', { state: 'hidden' });
  await key('p');
  await page.waitForTimeout(500);
  ok(await page.evaluate(() => document.body.classList.contains('preview')), 'P = معاينة');
  await page.screenshot({ path: join(SHOTS, 'desktop-preview.png') });
  await key('Escape');
  ok(!(await page.evaluate(() => document.body.classList.contains('preview'))), 'Esc = خروج من المعاينة');

  ok(errors.length === 0, 'بدون أخطاء JavaScript', errors.join(' | '));
} catch (e) {
  failed++;
  console.log(' FAIL ', e.message);
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? `\n${failed} فشل` : '\nكل شي تمام');
process.exit(failed ? 1 : 0);
