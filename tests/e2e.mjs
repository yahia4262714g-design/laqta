/* ==========================================================================
   لقطة — اختبار بمتصفح حقيقي بمقاس آيفون مع لمس حقيقي (CDP touch events)
   التشغيل: node blocking/tests/e2e.mjs   (من جذر المستودع)
   ========================================================================== */

import { chromium, devices } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SHOTS = fileURLToPath(new URL('./shots/', import.meta.url));
const PORT = 8134;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(PORT, r));
await mkdir(SHOTS, { recursive: true });

let failed = 0;
const ok = (cond, name, detail = '') => {
  if (!cond) failed++;
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 15 Pro'], locale: 'ar' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const cdp = await ctx.newCDPSession(page);

const shot = async (name) => { await page.waitForTimeout(250); await page.screenshot({ path: join(SHOTS, `${name}.png`) }); };
const st = () => page.evaluate(() => {
  const { app } = window.__blk;
  return { time: app.time, keys: app.project.keys.length, pos: app.cam.pos, target: app.cam.target, playing: app.playing, mode: app.mode, objects: app.project.objects.length };
});
const box = async (sel) => page.locator(sel).boundingBox();

async function touchDrag(points, steps = 12) {
  // points: [[x0,y0,x1,y1], ...] لكل إصبع
  const at = (k) => points.map(([x0, y0, x1, y1], id) => ({ x: x0 + ((x1 - x0) * k) / steps, y: y0 + ((y1 - y0) * k) / steps, id }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
  for (let k = 1; k <= steps; k++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(k) });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(350);
}

async function scrubTo(t) {
  const b = await box('#timeline');
  const D = await page.evaluate(() => window.__blk.app.project.duration);
  await page.touchscreen.tap(b.x + 18 + (t / D) * (b.width - 36), b.y + 12);
  await page.waitForTimeout(120);
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__blk);
  await page.waitForTimeout(500);
  await shot('01-camera');
  let s = await st();
  ok(s.mode === 'camera' && s.objects === 1, 'يفتح بوضع الكاميرا مع مجسم واحد');
  ok(await page.locator('#frame').isVisible(), 'إطار 9:16 ظاهر');

  // --- إصبع واحد: Orbit
  const vp = await box('#viewport');
  const cx = vp.x + vp.width / 2, cy = vp.y + vp.height / 2;
  const before = s.pos;
  await touchDrag([[cx - 60, cy, cx + 80, cy]]);
  s = await st();
  ok(dist(before, s.pos) > 0.5 && Math.abs(dist(s.pos, s.target) - dist(before, s.target)) < 0.05, 'إصبع واحد = Orbit حول الهدف', `تحركت ${dist(before, s.pos).toFixed(2)}m والمسافة ثابتة`);

  // --- قرص: Dolly
  const d0 = dist(s.pos, s.target);
  await touchDrag([[cx - 40, cy, cx - 120, cy], [cx + 40, cy, cx + 120, cy]]);
  s = await st();
  ok(dist(s.pos, s.target) < d0 - 0.3, 'قرص بإصبعين = Dolly In', `${d0.toFixed(2)} → ${dist(s.pos, s.target).toFixed(2)}`);

  // --- إصبعين سحب: Pan
  const t0 = s.target;
  await touchDrag([[cx - 40, cy, cx - 40, cy + 70], [cx + 40, cy, cx + 40, cy + 70]]);
  s = await st();
  ok(dist(t0, s.target) > 0.1, 'سحب بإصبعين = Pan (الهدف تحرك)');

  // --- مفاتيح الكاميرا: 0s, 3s, 6s
  await page.locator('[data-act="key-add"]').tap();
  await scrubTo(3);
  await touchDrag([[cx + 60, cy, cx - 90, cy - 30]]);
  await page.locator('[data-act="key-add"]').tap();
  await scrubTo(6);
  await touchDrag([[cx + 60, cy, cx - 90, cy + 20]]);
  await page.locator('[data-act="key-add"]').tap();
  s = await st();
  ok(s.keys === 3, '٣ مفاتيح كاميرا', `${s.keys}`);
  ok(await page.locator('.tl-key').count() === 3, '٣ نقاط على شريط الوقت');
  const keys = await page.evaluate(() => window.__blk.app.keys.map((k) => ({ t: k.t, pos: k.pos })));
  ok(keys.map((k) => k.t).join() === '0,3,6', 'أوقات المفاتيح صح', keys.map((k) => k.t).join());
  await shot('02-keys');

  // --- Scrub بين المفاتيح
  await scrubTo(1.5);
  s = await st();
  const expected = await page.evaluate(() => {
    const { app, A } = window.__blk;
    return A.evalCamera(app.keys, app.time).pos;
  });
  ok(dist(s.pos, expected) < 1e-6 && dist(s.pos, keys[0].pos) > 0.05 && dist(s.pos, keys[1].pos) > 0.05, 'Scrubbing بيحرك الكاميرا بين المفاتيح');

  // --- Play
  await scrubTo(0);
  await page.locator('#btnPlay').tap();
  const samples = [];
  for (let i = 0; i < 6; i++) { await page.waitForTimeout(250); samples.push(await st()); }
  ok(samples.every((x) => x.playing) && samples.at(-1).time > 1.0, 'التشغيل شغال والوقت ماشي', `t=${samples.at(-1).time.toFixed(2)}`);
  let moving = 0;
  for (let i = 1; i < samples.length; i++) if (dist(samples[i].pos, samples[i - 1].pos) > 1e-3) moving++;
  ok(moving >= 4, 'الكاميرا بتتحرك تلقائيًا أثناء التشغيل');
  await page.locator('#btnPlay').tap();
  ok(!(await st()).playing, 'Pause');
  await page.locator('#btnStop').tap();
  ok((await st()).time === 0, 'Stop يرجع للصفر');

  // --- سحب مفتاح من 6s إلى 8s
  const k6 = page.locator('.tl-key').nth(2);
  const kb = await k6.boundingBox();
  const tb = await box('#timeline');
  const x8 = tb.x + 18 + 0.8 * (tb.width - 36);
  await touchDrag([[kb.x + kb.width / 2, kb.y + kb.height / 2, x8, kb.y + kb.height / 2]], 10);
  const ts = await page.evaluate(() => window.__blk.app.keys.map((k) => k.t));
  ok(Math.abs(ts[2] - 8) < 0.15, 'سحب المفتاح على الشريط بيغيّر وقته', ts.join());

  // --- نقرة على مفتاح = انتقال له، ثم حذف
  await page.locator('.tl-key').nth(1).tap();
  s = await st();
  ok(Math.abs(s.time - 3) < 1e-6, 'النقر على مفتاح بينقل له');
  ok(await page.locator('[data-act="key-del"]').isVisible(), 'زر حذف المفتاح ظاهر');
  await page.locator('[data-act="key-ease"]').tap();
  ok(await page.evaluate(() => window.__blk.app.keys[1].ease) === 'linear', 'تبديل Smooth → Linear');
  await page.locator('[data-act="key-del"]').tap();
  ok((await st()).keys === 2, 'حذف المفتاح');
  await page.locator('#btnUndo').tap();
  ok((await st()).keys === 3, 'تراجع رجّع المفتاح');

  // --- أزرار التحريك (Truck)
  await page.locator('[data-act="nudge"]').tap();
  const p0 = (await st()).pos;
  const right = page.locator('#nudge [data-i="right"]');
  const rb = await right.boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rb.x + 20, y: rb.y + 20, id: 0 }] });
  await page.waitForTimeout(500);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const p1 = (await st()).pos;
  ok(dist(p0, p1) > 0.2 && Math.abs(p0[1] - p1[1]) < 1e-6, 'زر يمين = Truck بدون تغيير الارتفاع', `${dist(p0, p1).toFixed(2)}m`);
  await shot('03-nudge-dirty');
  ok(await page.locator('.key-btn.dirty').count() === 1, 'زر المفتاح بينبّه إنه في تغيير غير محفوظ');

  // --- وضع المجسمات + حركة A → B
  await page.locator('#modeSeg [data-mode="objects"]').tap();
  await page.waitForTimeout(200);
  await shot('04-objects');
  await page.locator('[data-act="add"]').tap();
  await page.locator('.tile[data-type="sphere"]').tap();
  await page.waitForSelector('#sheet', { state: 'hidden' });
  s = await st();
  ok(s.objects === 2, 'إضافة كرة');
  await scrubTo(1);
  await page.locator('[data-act="motion"]').tap();
  await page.locator('[data-act="motion-a"]').tap();
  await scrubTo(5);
  await page.locator('[data-act="motion-back"]').tap();
  await page.locator('[data-act="obj-num"]').tap();
  await page.locator('#px').fill('6');
  await page.locator('#px').dispatchEvent('change');
  await page.locator('#sheetClose').tap();
  await page.waitForSelector('#sheet', { state: 'hidden' });
  await page.locator('[data-act="motion"]').tap();
  await page.locator('[data-act="motion-b"]').tap();
  const m = await page.evaluate(() => {
    const { app } = window.__blk;
    return app.project.objects.find((o) => o.id === app.selectedId).motion;
  });
  ok(m.start === 1 && Math.abs(m.dur - 4) < 1e-6 && m.b.pos[0] === 6, 'حركة A→B: البداية 1s والمدة 4s', JSON.stringify({ s: m.start, d: m.dur, bx: m.b.pos[0] }));
  ok(await page.locator('.tl-bar').count() === 1, 'شريط الحركة ظاهر على التايملاين');
  await shot('05-motion');
  await scrubTo(3);
  const mid = await page.evaluate(() => window.__blk.stage.objectPos(window.__blk.app.selectedId).x);
  ok(mid > 0.5 && mid < 5.5, 'المجسم بنص الطريق عند 3s', mid.toFixed(2));

  // --- قفل هدف الكاميرا على المجسم المتحرك
  const sphereId = await page.evaluate(() => window.__blk.app.selectedId);
  await page.locator('[data-act="motion-back"]').tap();
  await page.locator('[data-act="deselect"]').tap();
  await page.locator('#modeSeg [data-mode="camera"]').tap();
  await page.locator('[data-act="target"]').tap();
  await page.locator(`.row[data-id="${sphereId}"]`).tap();
  await page.waitForSelector('#sheet', { state: 'hidden' });
  await page.locator('[data-act="key-add"]').tap();
  await page.locator('[data-act="target"]').tap();
  await page.locator('[data-all]').tap();
  await page.waitForSelector('#sheet', { state: 'hidden' });
  const lockedTargets = [];
  for (const t of [2, 4.5]) {
    await scrubTo(t);
    s = await st();
    const sp = await page.evaluate((id) => window.__blk.stage.objectPos(id).toArray(), sphereId);
    lockedTargets.push([s.target, sp]);
  }
  ok(lockedTargets.every(([a, b]) => dist(a, b) < 1e-6) && dist(lockedTargets[0][1], lockedTargets[1][1]) > 1,
    'الكاميرا بتضل تنظر للمجسم وهو متحرك (Target Keyframes)');

  // --- العدسة
  await page.locator('[data-act="lens"]').tap();
  await page.locator('.chip[data-lens="85"]').tap();
  ok((await page.evaluate(() => window.__blk.app.cam.lens)) === 85, 'تغيير العدسة 85mm');
  await page.locator('#sheetClose').tap();
  await page.waitForSelector('#sheet', { state: 'hidden' });
  await shot('06-camera-target');

  // --- النسبة
  await page.locator('[data-act="aspect"]').tap();
  ok(await page.evaluate(() => window.__blk.app.project.aspect) === '16:9', 'تبديل إلى 16:9');
  await page.waitForTimeout(200);
  await shot('07-16x9');
  await page.locator('[data-act="aspect"]').tap();
  await page.locator('[data-act="aspect"]').tap();

  // --- مدة المشهد
  await page.locator('#btnDur').tap();
  await page.locator('.chip[data-d="5"]').tap();
  await page.locator('[data-apply]').tap();
  await page.waitForSelector('#sheet', { state: 'hidden' });
  const after = await page.evaluate(() => ({ D: window.__blk.app.project.duration, ks: window.__blk.app.keys.map((k) => k.t) }));
  ok(after.D === 5 && after.ks.every((t) => t <= 5), 'تغيير المدة لـ 5s والمفاتيح جوّا', after.ks.join());

  // --- مدة بأي عدد ثواني (+ و − ثانية ثانية)
  await page.locator('#btnDur').tap();
  for (let i = 0; i < 2; i++) await page.locator('[data-dd="1"]').tap();
  ok(await page.locator('#durVal').textContent() === '7', 'زر + بيزيد ثانية وحدة', await page.locator('#durVal').textContent());
  await page.locator('[data-dd="-1"]').tap();
  await page.locator('[data-apply]').tap();
  await page.waitForSelector('#sheet', { state: 'hidden' });
  ok(await page.evaluate(() => window.__blk.app.project.duration) === 6, 'مدة 6 ثواني');
  await page.locator('#btnDur').tap();
  await page.locator('#durRange').fill('60');
  await page.locator('[data-apply]').tap();
  await page.waitForSelector('#sheet', { state: 'hidden' });
  ok(await page.evaluate(() => window.__blk.app.project.duration) === 60, 'مدة 60 ثانية من السلايدر');
  await shot('07b-60s');
  await page.locator('#btnDur').tap();
  await page.locator('.chip[data-d="5"]').tap();
  await page.locator('[data-apply]').tap();
  await page.waitForSelector('#sheet', { state: 'hidden' });

  // --- المعاينة + التسجيل
  await page.locator('#btnPreview').tap();
  await page.waitForTimeout(600);
  ok(await page.evaluate(() => window.__blk.app.playing && document.body.classList.contains('preview')), 'المعاينة بتشتغل تلقائيًا');
  const cv = await page.evaluate(() => [document.querySelector('#c').width, document.querySelector('#c').height]);
  ok(cv[0] === 1080 && cv[1] === 1920, 'دقة المعاينة 1080×1920', cv.join('×'));
  await shot('08-preview');
  await page.locator('#pvRec').tap();
  await page.waitForTimeout(800);
  await shot('09-recording');
  await page.waitForFunction(() => !window.__blk.app.recording, null, { timeout: 15000 });
  await page.waitForTimeout(500);
  const vid = await page.evaluate(() => window.__blk.app.video && { size: window.__blk.app.video.blob.size, ext: window.__blk.app.video.ext });
  ok(vid && vid.size > 10000, 'تسجيل الفيديو', vid ? `${vid.ext} ${(vid.size / 1024).toFixed(0)}KB` : 'لا يوجد');
  await shot('10-video-ready');
  await page.locator('#sheetClose').tap();
  await page.waitForSelector('#sheet', { state: 'hidden' });
  await page.locator('#pvExit').tap();
  await page.waitForTimeout(300);
  ok(!(await page.evaluate(() => document.body.classList.contains('preview'))), 'الخروج من المعاينة');

  // --- الحفظ وإعادة الفتح
  const saved = await st();
  await page.locator('#btnMenu').tap();
  await shot('11-menu');
  await page.locator('[data-m="save"]').tap();
  await page.waitForSelector('#sheet', { state: 'hidden' });
  await page.reload();
  await page.waitForFunction(() => window.__blk);
  await page.waitForTimeout(300);
  const re = await page.evaluate(() => ({ keys: window.__blk.app.project.keys.length, objs: window.__blk.app.project.objects.length, D: window.__blk.app.project.duration, motion: !!window.__blk.app.project.objects[1]?.motion?.b }));
  ok(re.keys === saved.keys && re.objs === 2 && re.D === 5 && re.motion, 'المشروع رجع كامل بعد إعادة الفتح', JSON.stringify(re));

  // --- مشروع جديد وفتح القديم
  await page.locator('#btnMenu').tap();
  await page.locator('[data-m="new"]').tap();
  await page.waitForSelector('#sheet', { state: 'hidden' });
  ok((await st()).keys === 0, 'مشروع جديد فاضي');
  await page.locator('#btnMenu').tap();
  await page.locator('[data-m="open"]').tap();
  ok(await page.locator('[data-open]').count() === 2, 'قائمة المشاريع فيها مشروعين');
  await page.locator('[data-open]').nth(1).tap();
  await page.waitForSelector('#sheet', { state: 'hidden' });
  ok((await st()).keys === saved.keys, 'فتح المشروع القديم');

  // --- مقاسات الأزرار للمس
  const small = await page.evaluate(() => [...document.querySelectorAll('#topbar button, #actions button, #transport button')]
    .filter((b) => b.offsetParent && !b.closest('.seg')).map((b) => [b.className || b.id || b.dataset.act, b.getBoundingClientRect()]).filter(([, r]) => r.height < 44 || r.width < 36).map(([n, r]) => `${n}:${Math.round(r.width)}x${Math.round(r.height)}`));
  ok(small.length === 0, 'كل الأزرار مناسبة للمس (≥ 44px)', small.join(' '));

  // --- وضع الالتفاف (Pan / Tilt بمكانها)
  await page.locator('[data-act="gesture"]').tap();
  const g0 = await st();
  await touchDrag([[cx - 50, cy, cx + 50, cy]]);
  const g1 = await st();
  ok(dist(g0.pos, g1.pos) < 1e-6 && dist(g0.target, g1.target) > 0.1, 'وضع الالتفاف: الكاميرا بتلف بمكانها');

  ok(errors.length === 0, 'بدون أخطاء JavaScript', errors.join(' | '));
} catch (e) {
  failed++;
  console.log(' FAIL ', e.message);
  await shot('error');
} finally {
  await browser.close();
  server.close();
}

console.log(failed ? `\n${failed} فشل` : '\nكل شي تمام');
process.exit(failed ? 1 : 0);
