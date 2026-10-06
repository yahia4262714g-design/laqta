/* لقطة — اختبار صورة المنتج: إضافة، شكل، تبديل، وبتضل بعد إعادة الفتح */

import { chromium, devices } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SHOTS = fileURLToPath(new URL('./shots/', import.meta.url));
const FIX = fileURLToPath(new URL('./fixtures/', import.meta.url));
const PORT = 8143;
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
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 15 Pro'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const pick = async (shape, file) => {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator(`[data-shape="${shape}"]`).tap()]);
  await chooser.setFiles(join(FIX, file));
  await page.waitForFunction(() => document.querySelector('#sheet').hidden);
  await page.waitForTimeout(600);
};
const textured = (id) => page.evaluate((id) => !!window.__blk.stage.objects.get(id)?.userData.mat.map, id);
const sel = () => page.evaluate(() => { const { app } = window.__blk; return app.project.objects.find((o) => o.id === app.selectedId); });

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__blk);
  await page.waitForTimeout(400);
  await page.locator('#modeSeg [data-mode="objects"]').tap();
  await page.locator('[data-act="add"]').tap();
  await page.locator('[data-image]').tap();
  await pick('can', 'product.png');
  let o = await sel();
  ok(o?.type === 'image' && o.shape === 'can' && Math.abs(o.aspect - 330 / 600) < 0.01, 'إضافة منتج كأسطوانة', JSON.stringify({ shape: o?.shape, aspect: o?.aspect?.toFixed(2) }));
  ok(Math.abs(o.scale[1] - 0.15) < 1e-9 && Math.abs(o.pos[1] - 0.075) < 1e-9, 'الحجم الافتراضي 15 سم وواقف على الأرض');
  ok(await textured(o.id), 'الصورة انرسمت على المجسم');

  // لقطة منتج قريبة من الكاميرا
  await page.evaluate((id) => {
    const { app, stage } = window.__blk;
    const p = stage.objectPos(id).toArray();
    Object.assign(app.cam, { pos: [p[0] + 0.12, p[1] + 0.03, p[2] + 0.5], target: p, lens: 50, targetObj: id });
    stage.setShot(app.cam);
    window.__blk.setMode('camera');
  }, o.id);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOTS, 'product-can.png') });

  // تبديل الشكل لوحة ثم تبديل الصورة
  await page.evaluate(() => window.__blk.setMode('objects'));
  await page.locator('[data-act="img-shape"]').tap();
  o = await sel();
  ok(o.shape === 'card', 'تبديل الشكل للوحة');
  await page.locator('[data-act="img-replace"]').tap();
  await pick('card', 'box.jpg');
  o = await sel();
  ok(Math.abs(o.aspect - 1.5) < 0.01 && await textured(o.id), 'تبديل الصورة (بدون شفافية → JPEG)', o.aspect.toFixed(2));
  await page.locator('#btnUndo').tap();
  await page.waitForTimeout(500);
  o = await page.evaluate(() => window.__blk.app.project.objects.find((x) => x.type === 'image'));
  ok(Math.abs(o.aspect - 0.55) < 0.01, 'تراجع رجّع الصورة القديمة');

  // بتضل بعد إعادة الفتح (IndexedDB)
  await page.locator('#btnMenu').tap();
  await page.locator('[data-m="save"]').tap();
  await page.reload();
  await page.waitForFunction(() => window.__blk);
  await page.waitForTimeout(900);
  const id = await page.evaluate(() => window.__blk.app.project.objects.find((x) => x.type === 'image')?.id);
  ok(id && await textured(id), 'الصورة رجعت بعد إعادة فتح التطبيق');
  await page.screenshot({ path: join(SHOTS, 'product-reload.png') });

  // نص المشهد بيحمل رقم الصورة، والاستيراد على نفس الجهاز بيرجّعها
  const txt = await page.evaluate(() => window.__blk.exportText(window.__blk.app.project));
  ok(/"type":"image".*"image":"[a-z0-9]+".*"shape":"(card|can)"/.test(txt), 'نص المشهد فيه الصورة وشكلها');
  await page.locator('#btnMenu').tap();
  await page.locator('[data-m="paste"]').tap();
  await page.locator('#sceneText').fill(txt.replace('"name":"', '"name":"نسخة '));
  await page.locator('[data-p="import"]').tap();
  await page.waitForSelector('#sheet', { state: 'hidden' });
  await page.waitForTimeout(800);
  const id2 = await page.evaluate(() => window.__blk.app.project.objects.find((x) => x.type === 'image')?.id);
  ok(await textured(id2), 'استيراد المشهد بيرجّع صورة المنتج');

  ok(errors.length === 0, 'بدون أخطاء JavaScript', errors.join(' | '));
} catch (e) {
  failed++;
  console.log(' FAIL ', e.message);
  await page.screenshot({ path: join(SHOTS, 'product-error.png') });
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? `\n${failed} فشل` : '\nكل شي تمام');
process.exit(failed ? 1 : 0);
