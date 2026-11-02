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

test("уровень ограничен 1…105, в Comeback ровно 10 заданных классов", () => {
  assert.equal(computeStats({ cls: "by", level: 200, attrs: naked }).level, 105);
  assert.equal(computeStats({ cls: "by", level: 0, attrs: naked }).level, 1);
  assert.deepEqual(Object.values(CLASSES).map((cls) => cls.name), [
    "Воин", "Маг", "Оборотень", "Друид", "Лучник", "Жрец", "Мистик", "Страж", "Шаман", "Убийца",
  ]);
  for (const cls of ["he", "uf", "bard", "monkey"]) assert.throws(() => computeStats({ cls, level: 10, attrs: naked }), /Неизвестный класс/);
  assert.throws(() => computeStats({ cls: "paladin", level: 10, attrs: naked }), /Неизвестный класс/);
});

test("экипировка складывает базовые статы, выбранные бонусы, заточку и камни", () => {
  const armor = { id: 10, name: "Доспех", slot: "chest", sockets: { craft: { 1: 100 } }, stats: { phys_def: 100, mag_def: 50 },
    refine: { stat: "Здоровье", levels: [20, 40] }, addons: { count: "0~3", options: [{ text: "Сила +15" }, { text: "Здоровье +500" }] } };
  const ring = { id: 11, name: "Кольцо", slot: "ring", stats: { hp: 10, int: 2 } };
  const weapon = { id: 12, name: "Меч", slot: "weapon", sockets: { craft: { 1: 100 } }, stats: { phys_atk: [100, 200], mag_atk: [30, 50], atk_speed: 1.43 },
    refine: { stat: "Физ. атака", levels: [5] } };
  const stone = { id: 20, effects: { weapon: { stat: "физ. атака", value: 10, percent: false }, armor: { stat: "физ. защита", value: 30, percent: false } } };
  const s = computeStats({ cls: "by", level: 10, attrs: naked, equipment: {
    chest: { item: armor, refine: 2, stones: [stone], addons: ["Сила +15"] },
    ring1: { item: ring }, ring2: { item: ring }, weapon: { item: weapon, refine: 1, stones: [stone] },
  } });
  assert.deepEqual(s.effectiveAttrs, { vit: 5, int: 9, str: 20, dex: 5 });
  assert.equal(s.hp, 405); // 15*5 + 30*9 + 40 refine + two rings*10.
  assert.equal(s.mp, 243);
  assert.deepEqual(s.physAtk, [141, 254]);
  assert.deepEqual(s.magAtkRange, [33, 55]); // Воин 10: магическая часть уровня округляется до 0.
  assert.equal(s.physDef, 141);
  assert.equal(s.magDef, 54);
  assert.equal(s.atkSpeed, 1.43);
  assert.equal(s.gearWarnings.length, 0);
});

test("случайные бонусы предмета не применяются без выбора", () => {
  const item = { name: "Броня", slot: "chest", stats: {}, addons: { options: [{ text: "Здоровье +500" }] } };
  assert.equal(computeStats({ cls: "by", level: 1, attrs: naked, equipment: { chest: { item } } }).hp, 75);
});

test("неподдержанные эффекты и требования объясняются без выдуманной прибавки", () => {
  const item = { id: 1, name: "Проверка", slot: "weapon", level: 100, classes: ["Маг"], req: { str: 200 },
    stats: { atk_speed: 10, unknown_power: 999 }, addons: { count: "1", options: [{ text: "Удача +100" }] } };
  const s = computeStats({ cls: "by", level: 1, attrs: naked, effects: [1], equipment: { weapon: { item, addons: ["Удача +100"] } } });
  assert.equal(s.hp, 75);
  assert.equal(s.atkSpeed, 1.25);
  assert.ok(s.gearWarnings.some((w) => /уровень/i.test(w)));
  assert.ok(s.gearWarnings.some((w) => /класс/i.test(w)));
  assert.ok(s.gearWarnings.some((w) => /Сила/.test(w)));
  assert.ok(s.gearWarnings.some((w) => /unknown_power/.test(w)));
  assert.ok(s.gearWarnings.some((w) => /Удача/.test(w)));
  assert.ok(s.gearWarnings.some((w) => /эффект/i.test(w)));
});

test("отрицательное время подготовки и разная защита стихий сохраняют знак и диапазон", () => {
  const item = { id: 1, name: "Ожерелье", slot: "necklace", stats: { def_fire: 20 },
    addons: { count: "1", options: [{ text: "Время подготовки -6%" }] } };
  const s = computeStats({ cls: "ga", level: 1, attrs: naked, equipment: { necklace: { item, addons: ["Время подготовки -6%"] } } });
  assert.equal(s.castTime, -6);
  assert.equal(s.elements.fire, 22);
  assert.equal(s.elements.water, 2);
});

test("сломанные данные экипировки не превращают результат в NaN", () => {
  assert.throws(() => computeStats({ cls: "by", level: 1, attrs: naked, equipment: { chest: { item: { slot: "chest", stats: { hp: "100oops" } } } } }), /характеристик|значение/i);
  assert.throws(() => computeStats({ cls: "by", level: 1, attrs: naked, equipment: { chest: { item: { slot: "chest" }, refine: 13 } } }), /заточ/i);
});

test("реальный нагрудник 4872: защита и заточка берутся из данных Comeback", () => {
  // Нормализованные поля tests/fixtures/item_armor_4872.html; значения также
  // независимо проверяются Python-парсером в test_armor_item_fields.
  const item = { id: 4872, name: "☆☆Защитная броня", type: "Верх", subtype: "Тяжелый нагрудник", grade: 1, level: 1,
    stats: { phys_def: 48, def_metal: 20, def_wood: 20, def_water: 20, def_fire: 20, def_earth: 20 },
    req: { str: 5, dex: 5 }, classes: ["Воин", "Маг", "Оборотень", "Друид", "Лучник", "Жрец", "Убийца", "Шаман", "Страж", "Мистик", "Призрак", "Жнец"],
    refine: { stat: "Здоровье", base: 14, levels: [14, 28, 42, 60, 80, 105, 139, 182, 238, 308, 406, 525] },
    addons: { count: "0~3", options: [{ text: "Здоровье +10", chance: 10.989 }, { text: "Сила +1", chance: 8.7912 }], unique: [] } };
  const s = computeStats({ cls: "by", level: 1, attrs: naked, equipment: { chest: { item, refine: 12, addons: ["Здоровье +10"] } } });
  assert.equal(s.hp, 610);
  assert.equal(s.physDef, 51);
  assert.deepEqual(s.elements, { metal: 22, wood: 22, water: 22, fire: 22, earth: 22 });
  assert.equal(s.free, 0);
  assert.equal(s.gearWarnings.length, 0);
});
