/* لقطة — اختبارات استيراد وتصدير المشهد (نسخ ولصق مع Claude) */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importScene, exportText, extractJSON, claudePrompt } from '../js/scene-io.js';
import { evalObject, evalCamera } from '../js/anim.js';

const SCENE = {
  laqta: 1, name: 'Car pass', duration: 8, aspect: '16:9',
  objects: [
    { id: 'car', type: 'rect', name: 'Car', pos: [-6, 0.7, 0], rot: [0, 90, 0],
      keys: [{ t: 0, pos: [-6, 0.7, 0] }, { t: 6, pos: [6, 0.7, 0], ease: 'linear' }] },
    { id: 'man', type: 'person', name: 'Man', pos: [2, 0.9, -2], rot: [0, 180, 0] },
  ],
  camera: [
    { t: 0, pos: [-3, 1.2, 7], target: 'car', lens: 35 },
    { t: 6, pos: [4, 1.6, 5], target: 'car', lens: 50 },
    { t: 8, pos: [4, 1.6, 5], target: [2, 1.5, -2], lens: 50, roll: 4 },
  ],
};

test('رد Claude مع كلام قبل وبعد كتلة الكود', () => {
  const p = importScene(`Sure! Here is your shot:\n\`\`\`json\n${JSON.stringify(SCENE, null, 2)}\n\`\`\`\nHave fun.`);
  assert.equal(p.name, 'Car pass');
  assert.equal(p.duration, 8);
  assert.equal(p.aspect, '16:9');
  assert.equal(p.objects.length, 2);
  assert.equal(p.keys.length, 3);
});

test('الدوران بالدرجات بيتحول صح، والعنصر بيتحرك', () => {
  const p = importScene(JSON.stringify(SCENE));
  const car = p.objects[0];
  assert.ok(Math.abs(car.rot[1] - Math.PI / 2) < 1e-9);
  assert.equal(car.keys[1].rot[1], car.rot[1], 'الدوران الناقص بيكمل من اللي قبله');
  assert.equal(evalObject(car.keys, 3).pos[0], 0);
});

test('هدف الكاميرا = اسم العنصر، وبيلحقه وهو ماشي', () => {
  const p = importScene(JSON.stringify(SCENE));
  const car = p.objects[0];
  assert.equal(p.keys[0].targetObj, car.id);
  assert.equal(p.keys[2].targetObj, null);
  const at = (t) => evalCamera(p.keys, t, (k) => (k.targetObj ? evalObject(car.keys, t).pos : k.target)).target;
  assert.equal(at(3)[0], 0);
});

test('تعليقات وفواصل زيادة ما بتخرب الاستيراد', () => {
  const messy = `{ "duration": 5, // مدة
    "objects": [ { "id": "a", "type": "cube", }, ],
    "camera": [ { "pos": [0, 1, 5], "target": "a", }, ], }`;
  const p = importScene(messy);
  assert.equal(p.duration, 5);
  assert.equal(p.objects[0].pos[1], 0.5, 'مكان افتراضي على الأرض');
});

test('كاميرا وحدة بدل قائمة مقبولة', () => {
  const p = importScene('{"objects":[],"camera":{"pos":[0,2,6],"target":[0,1,0],"lens":24}}');
  assert.equal(p.keys.length, 1);
  assert.equal(p.camera.lens, 24);
});

test('الأخطاء بتوضح شو الغلط بالعربي', () => {
  assert.throws(() => importScene(''), /فاضي/);
  assert.throws(() => importScene('hello'), /ما لقيت مشهد/);
  assert.throws(() => importScene('{"objects":[{"type":"car"}],"camera":[{"pos":[0,1,5],"target":[0,0,0]}]}'), /النوع "car"/);
  assert.throws(() => importScene('{"objects":[],"camera":[{"pos":[0,1,5],"target":"ghost"}]}'), /"ghost"/);
  assert.throws(() => importScene('{"objects":[{"type":"cube","pos":[1,2]}],"camera":[{"pos":[0,1,5],"target":[0,0,0]}]}'), /pos/);
  assert.throws(() => importScene('{"objects":[]}'), /camera ناقصة/);
});

test('القيم الغريبة بتنضبط: المدة والنسبة والعدسة', () => {
  const p = importScene('{"duration":999,"aspect":"4:3","objects":[],"camera":[{"t":500,"pos":[0,1,5],"target":[0,0,0],"lens":2}]}');
  assert.equal(p.duration, 120);
  assert.equal(p.aspect, '9:16');
  assert.equal(p.keys[0].t, 120);
  assert.equal(p.keys[0].lens, 8);
});

test('تصدير ثم استيراد ثم تصدير = نفس النص، والأسماء محفوظة', () => {
  const t1 = exportText(importScene(JSON.stringify(SCENE)));
  assert.ok(t1.includes('"id":"car"') && t1.includes('"target":"car"'));
  assert.equal(exportText(importScene(t1)), t1);
  assert.ok(extractJSON(t1).objects.length === 2);
});

test('تعليمات Claude فيها القواعد والمشهد الحالي', () => {
  const p = importScene(JSON.stringify(SCENE));
  const txt = claudePrompt(p);
  assert.ok(txt.includes('RULES') && txt.includes('"target":"car"') && txt.includes('16:9') && txt.trim().endsWith('MY SHOT'));
});

test('ملف CLAUDE-SCENES.md مطابق لقواعد التطبيق', async () => {
  const { readFile } = await import('node:fs/promises');
  const { claudeRules } = await import('../js/scene-io.js');
  const md = await readFile(new URL('../CLAUDE-SCENES.md', import.meta.url), 'utf8');
  assert.ok(md.includes(claudeRules().trim()), 'حدّث CLAUDE-SCENES.md لما تتغير القواعد');
});
