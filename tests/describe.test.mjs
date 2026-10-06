/* لقطة — اختبارات وصف الحركة للبرومبت */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importScene } from '../js/scene-io.js';
import { describeProject } from '../js/describe.js';

const load = (f) => importScene(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const line = (txt, start) => txt.split('\n').find((l) => l.startsWith(`- ${start}`)) || '';

test('مشهد الممر: كل حركة بتنوصف صح', () => {
  const d = describeProject(load('corridor.json'));
  assert.match(d, /^SHOT: .* 23 s, 9:16 vertical/);
  assert.match(line(d, '0.0–2.0'), /tracks with Walker from behind/);
  assert.match(line(d, '2.0–2.8'), /over Walker's shoulder/);
  assert.match(line(d, '2.8–3.5'), /overtakes Walker/);
  assert.match(line(d, '3.5–5.0'), /leads Walker/);
  assert.match(line(d, '5.0–5.8'), /leads Walker.*drifting right/);
  assert.match(line(d, '14.0–14.8'), /orbits right \d+° around Walker/);
  assert.match(line(d, '14.8–15.6'), /re-framing from Walker to the group \(Figure 1, Figure 2, Figure 3, Figure 4\)/);
  assert.match(line(d, '19.4–20.3'), /flying over the group/);
  assert.match(line(d, '21.5–23.0'), /cranes up 5\.0 m/);
  assert.match(d, /Walker \(person\): 0\.0–13\.0 s walks 14\.3 m/);
});

test('مشهد الحادث: كاميرا ثابتة، قطع مقترح، وسلو موشن', () => {
  const d = describeProject(load('crash.json'));
  assert.match(line(d, '0.0–2.6'), /stays fixed in place.*following Car 1/);
  assert.ok(!/[\u0600-\u06FF]/.test(d), 'ما في عربي بالبرومبت');
  assert.match(line(d, '2.6–3.6'), /consider a cut here/);
  assert.match(line(d, '3.6–4.0'), /dutch angle/);
  assert.match(d, /in slow motion \(speed ramp\)/);
  assert.match(d, /snapping back to real time/);
  assert.match(d, /rolls over \d+°/);
});

test('مشهد بدون مفاتيح = كاميرا ثابتة', () => {
  const p = importScene('{"duration":5,"objects":[{"id":"box","type":"cube"}],"camera":{"pos":[0,1.5,5],"target":"box","lens":50}}');
  const d = describeProject(p);
  assert.match(d, /0\.0–5\.0 s: static camera, 50 mm/);
});

test('Pan بمكانها و Orbit حوالين عنصر ثابت', () => {
  const p = importScene(JSON.stringify({
    duration: 6, objects: [{ id: 'can', type: 'cylinder', name: 'Can' }],
    camera: [
      { t: 0, pos: [0, 1.5, 6], target: [0, 1.5, 0], lens: 35 },
      { t: 2, pos: [0, 1.5, 6], target: [-3, 1.5, 0], lens: 35 },
      { t: 3, pos: [0, 1, 4], target: 'can', lens: 50 },
      { t: 6, pos: [4, 1, 0], target: 'can', lens: 50 },
    ],
  }));
  const d = describeProject(p);
  assert.match(line(d, '0.0–2.0'), /stays fixed in place, pans/);
  assert.match(line(d, '3.0–6.0'), /orbits right 90° around Can/);
});
