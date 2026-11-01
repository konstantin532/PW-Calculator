import assert from "node:assert/strict";
import { test } from "node:test";

import { CLASSES, computeStats, totalPoints } from "../../static/js/engine/stats.js";

const naked = { vit: 5, int: 5, str: 5, dex: 5 };

test("Воин 105 без экипировки совпадает с выводом mypers", () => {
  const s = computeStats({ cls: "by", level: 105, attrs: naked });
  assert.equal(s.hp, 3195);
  assert.equal(s.mp, 1917);
  assert.deepEqual(s.physAtk, [108, 108]);
  assert.equal(s.magAtk, 1);
  assert.equal(s.crit, 1);
  assert.equal(s.accuracy, 50);
  assert.equal(s.evasion, 50);
  assert.equal(s.physDef, 3);
  assert.equal(s.magDef, 2);
  assert.equal(s.spirit, 16275);
  assert.equal(s.speed, 5.0);
  assert.equal(s.free, 520);
});

test("у мага магическая атака растёт от уровня, физическая слабая", () => {
  const s = computeStats({ cls: "ga", level: 105, attrs: naked });
  assert.equal(s.magAtk, 110);
  assert.deepEqual(s.physAtk, [23, 23]);
  assert.equal(s.hp, 2130);
});

test("ловкость даёт крит раз в 20 очков, максимум 100%", () => {
  assert.equal(computeStats({ cls: "fx", level: 105, attrs: { ...naked, dex: 45 } }).crit, 3);
  assert.equal(computeStats({ cls: "fx", level: 105, attrs: { ...naked, dex: 525 } }).crit, 27);
});

test("нельзя распределить больше очков, чем даёт уровень", () => {
  assert.equal(totalPoints(1), 0);
  assert.throws(() => computeStats({ cls: "by", level: 1, attrs: { ...naked, str: 6 } }), /больше очков/);
  assert.throws(() => computeStats({ cls: "by", level: 10, attrs: { ...naked, str: 4 } }), /Неверное/);
});

test("уровень ограничен 1…105, в игре ровно 12 классов", () => {
  assert.equal(computeStats({ cls: "by", level: 200, attrs: naked }).level, 105);
  assert.equal(computeStats({ cls: "by", level: 0, attrs: naked }).level, 1);
  assert.equal(Object.keys(CLASSES).length, 12);
  assert.throws(() => computeStats({ cls: "paladin", level: 10, attrs: naked }), /Неизвестный класс/);
});
