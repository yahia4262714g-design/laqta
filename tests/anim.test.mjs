/* لقطة — اختبارات منطق الحركة */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../js/store.js';
import {
  evalCamera, evalObject, sampleObjectPath, sortKeys, keyAt, fitToDuration,
  fovFromLens, sampleCameraPath, snapTime,
} from '../js/anim.js';

const key = (t, x, extra = {}) => ({ id: `k${t}`, t, pos: [x, 1.6, 5], target: [0, 1, 0], targetObj: null, lens: 35, roll: 0, ease: 'smooth', ...extra });
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('بدون مفاتيح ما في كاميرا محسوبة', () => {
  assert.equal(evalCamera([], 1), null);
});

test('قبل أول مفتاح وبعد آخر مفتاح الكاميرا ثابتة', () => {
  const ks = [key(2, 0), key(6, 10)];
  close(evalCamera(ks, 0).pos[0], 0);
  close(evalCamera(ks, 9).pos[0], 10);
});

test('المفاتيح بتمر بالقيم بالضبط', () => {
  const ks = [key(0, 0), key(3, 4), key(6, -2)];
  for (const k of ks) close(evalCamera(ks, k.t).pos[0], k.pos[0]);
});

test('ناعم بين مفتاحين = بداية ونهاية هادية (ease in/out)', () => {
  const ks = [key(0, 0), key(4, 10)];
  close(evalCamera(ks, 2).pos[0], 5);
  const early = evalCamera(ks, 0.4).pos[0];
  assert.ok(early < 1, 'البداية لازم تكون أبطأ من الخطي');
});

test('خطي = سرعة ثابتة', () => {
  const ks = [key(0, 0, { ease: 'linear' }), key(4, 10)];
  close(evalCamera(ks, 1).pos[0], 2.5);
  close(evalCamera(ks, 3).pos[0], 7.5);
});

test('الحركة الناعمة ما بتتجاوز المفاتيح (بدون اهتزاز)', () => {
  const ks = [key(0, 0), key(1, 10), key(5, 10.5), key(6, 0)];
  for (let t = 0; t <= 6; t += 0.01) {
    const x = evalCamera(ks, t).pos[0];
    assert.ok(x >= -1e-9 && x <= 10.5 + 1e-9, `تجاوز عند ${t}: ${x}`);
  }
});

test('مفتاحين متطابقين = ثبات تام بينهم', () => {
  const ks = [key(0, 0), key(2, 5), key(4, 5), key(6, 0)];
  for (let t = 2; t <= 4; t += 0.1) close(evalCamera(ks, t).pos[0], 5);
});

test('المسار ناعم: ما في قفزات بين الإطارات', () => {
  const ks = [key(0, 0), key(3, 6), key(6, 6.5), key(10, 20)];
  let prev = evalCamera(ks, 0).pos[0];
  for (let t = 1 / 60; t <= 10; t += 1 / 60) {
    const x = evalCamera(ks, t).pos[0];
    assert.ok(Math.abs(x - prev) < 0.2, `قفزة عند ${t}`);
    prev = x;
  }
});

test('هدف الكاميرا بيتبع مجسم متحرك', () => {
  const ks = [key(0, 0, { targetObj: 'car' }), key(4, 10, { targetObj: 'car' })];
  const carAt = [7, 0.7, -3];
  const c = evalCamera(ks, 2, (k) => (k.targetObj ? carAt : k.target));
  assert.deepEqual(c.target.map((v) => +v.toFixed(6)), carAt);
});

test('العدسة بتتحرك باللوغاريتم (زوم متوازن)', () => {
  const ks = [key(0, 0, { lens: 20 }), key(2, 0, { lens: 80, ease: 'linear' })];
  ks[0].ease = 'linear';
  close(evalCamera(ks, 1).lens, 40, 1e-6);
});

test('الميلان (Roll) بيتحرك كمان', () => {
  const ks = [key(0, 0, { roll: 0, ease: 'linear' }), key(2, 0, { roll: 10 })];
  close(evalCamera(ks, 1).roll, 5);
});

test('ترتيب المفاتيح والبحث عن مفتاح بوقت', () => {
  const ks = sortKeys([key(6, 0), key(0, 0), key(3, 0)]);
  assert.deepEqual(ks.map((k) => k.t), [0, 3, 6]);
  assert.equal(keyAt(ks, 3.02).t, 3);
  assert.equal(keyAt(ks, 3.2), null);
});

test('مسار الكاميرا للرسم', () => {
  assert.equal(sampleCameraPath([key(0, 0), key(2, 4)], 10).length, 11);
  assert.equal(sampleCameraPath([key(0, 0)]).length, 1);
});

const okey = (t, x, extra = {}) => ({ id: `o${t}`, t, pos: [x, 0.5, 0], rot: [0, 0, 0], scale: [1, 1, 1], ease: 'smooth', ...extra });

test('عنصر بدون مفاتيح = ثابت', () => {
  assert.equal(evalObject([], 2), null);
  assert.equal(evalObject(undefined, 2), null);
});

test('حركة العنصر بالمفاتيح: ثابت قبل وبعد، ويمر بكل نقطة', () => {
  const ks = [okey(1, 0), okey(3, 4), okey(6, 4.5)];
  close(evalObject(ks, 0).pos[0], 0);
  close(evalObject(ks, 9).pos[0], 4.5);
  for (const k of ks) close(evalObject(ks, k.t).pos[0], k.pos[0]);
  const mid = evalObject(ks, 2).pos[0];
  assert.ok(mid > 0.5 && mid < 3.5, `${mid}`);
});

test('حركة العنصر الخطية = سرعة ثابتة', () => {
  const ks = [okey(0, 0, { ease: 'linear' }), okey(4, 8)];
  close(evalObject(ks, 1).pos[0], 2);
});

test('الدوران بياخد أقصر طريق (سيارة بتلف)', () => {
  const a = 170 * Math.PI / 180, b = -170 * Math.PI / 180;
  const ks = [okey(0, 0, { rot: [0, a, 0], ease: 'linear' }), okey(2, 0, { rot: [0, b, 0] })];
  close(Math.abs(evalObject(ks, 1).rot[1]), Math.PI, 1e-9);
});

test('الحجم بيتحرك كمان', () => {
  const ks = [okey(0, 0, { scale: [1, 1, 1], ease: 'linear' }), okey(2, 0, { scale: [3, 1, 1] })];
  close(evalObject(ks, 1).scale[0], 2);
});

test('مسار العنصر للرسم', () => {
  assert.equal(sampleObjectPath([okey(0, 0), okey(2, 4)], 10).length, 11);
  assert.equal(sampleObjectPath([okey(0, 0)]).length, 0);
});

test('تقصير المدة بيحافظ على المفاتيح والحركات جوّا المشهد', () => {
  const p = {
    duration: 20,
    keys: [key(2, 0), key(12, 0), key(18, 0)],
    objects: [{ keys: [okey(8, 0), okey(14, 1), okey(19, 2)] }],
  };
  fitToDuration(p, 10);
  const ts = p.keys.map((k) => k.t).sort((a, b) => a - b);
  assert.ok(ts.every((t) => t <= 10));
  assert.equal(new Set(ts).size, 3, 'ما لازم يصيروا مفتاحين بنفس الوقت');
  const ot = p.objects[0].keys.map((k) => k.t);
  assert.ok(ot.every((t) => t <= 10) && new Set(ot).size === 3, ot.join());
});

test('العدسة: نفس الإحساس بكل النسب', () => {
  close(fovFromLens(35, 9 / 16), 2 * Math.atan(18 / 35) * 180 / Math.PI);
  close(fovFromLens(35, 16 / 9), 2 * Math.atan(10.125 / 35) * 180 / Math.PI);
  assert.ok(fovFromLens(85, 1) < fovFromLens(24, 1));
});

test('تقريب الوقت لعُشر الثانية', () => {
  assert.equal(snapTime(2.96), 3);
  assert.equal(snapTime(0.04), 0);
});

test('مشروع قديم بحركة A → B بيتحول لمفتاحين', () => {
  const p = { objects: [
    { id: 'a', pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], motion: { a: { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] }, b: { pos: [5, 0, 0], rot: [0, 1, 0], scale: [1, 1, 1] }, start: 2, dur: 3, ease: 'smooth' } },
    { id: 'b', pos: [1, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], motion: null },
  ] };
  migrate(p);
  assert.deepEqual(p.objects[0].keys.map((k) => k.t), [2, 5]);
  assert.equal(p.objects[0].keys[1].pos[0], 5);
  assert.equal(p.objects[0].motion, undefined);
  assert.deepEqual(p.objects[1].keys, []);
});
