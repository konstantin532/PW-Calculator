import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { computeStats } from "../../static/js/engine/stats.js";
import { getItemBonuses } from "../../static/js/engine/equipment.js";

const items = JSON.parse(readFileSync(new URL("../../data/catalog_items.json", import.meta.url), "utf8"));
const stones = JSON.parse(readFileSync(new URL("../../data/catalog_stones.json", import.meta.url), "utf8"));
const item = (id) => items.find((entry) => entry.id === id);
const stone = (id) => stones.find((entry) => entry.id === id);
const choice = (id, addons = [], extra = {}) => ({ item: item(id), addons, refine: 0, stones: [], ...extra });
const attrs = { vit: 5, int: 5, str: 5, dex: 5 };
const state = { cls: "by", level: 105, attrs };
const effect = (values) => ({ id: 9000, name: "Контрольный эффект", record: { ue: 1, lm: values,
  states: { 0: [{ types: Object.keys(values) }] } } });

test("146: HP/MP проценты вещей складываются с бафом до единственного округления", () => {
  const result = computeStats({ ...state, cls: "ga", titles: { hp: 100 },
    equipment: { necklace: choice(8368, ["Макс ХП +5%"]), belt: choice(9326, ["Мана +5%"]) },
    effects: [9000], effectCatalog: [effect({ fw: 30, vd: 20 })] });
  assert.equal(result.hp, 3011); // (2130 + 100) × 1.35 = 3010.5
  assert.equal(result.mp, 3728); // 2982 × 1.25 = 3727.5
  assert.equal(result.explanations.hp.result, result.hp);
  assert.ok(result.explanations.hp.sources.flatMap((s) => s.entries).some((e) => e.stat === "hp_percent" && e.value === 5));
});

test("146: проценты защиты применяются к снаряжению, затем к нему добавляется вклад атрибутов", () => {
  const input = { ...state, attrs: { ...attrs, str: 252, dex: 54 },
    equipment: { boots: choice(25701, ["Физическая защита +4%", "Маг защита +4%"]) } };
  const result = computeStats(input);
  assert.equal(result.physDef, 1275); // 64 + round(896 × 1.31) + 1 + round(896 × .04)
  assert.deepEqual(Object.values(result.elements), [404, 404, 404, 404, 404]);
  const buffed = computeStats({ ...input, effects: [9000], effectCatalog: [effect({ tb: 60, xk: 60 })] });
  assert.equal(buffed.physDef, 1812);
  assert.equal(buffed.magDef, 634);
  assert.ok(buffed.explanations.physDef.sources.flatMap((s) => s.entries).some((e) => e.stat === "phys_def_percent" && e.value === 4));
});

test("146: красная броня не даёт собственных процентов, уменьшения урона или интервала", () => {
  const result = computeStats({ ...state, equipment: {
    boots: choice(25701, ["Физическая защита +4%", "Маг защита +4%", "Уменьшение физ урона +1%"]),
    weapon: choice(78, ["Пауза между атаками -0.1"]),
  } });
  assert.equal(result.hp, 3195);
  assert.equal(result.physDef, 3);
  assert.equal(result.magDef, 2);
  assert.equal(result.damageReductionPhys, 0);
  assert.equal(result.atkSpeed, 1.25);
});

test("отдельное уменьшение урона экипировки не подменяет процент от обычной защиты", () => {
  const result = computeStats({ ...state, attrs: { ...attrs, str: 252, dex: 54 },
    equipment: { boots: choice(25701, ["Уменьшение физ урона +1%"]) } });
  assert.equal(result.damageReductionPhys, 1);
  assert.equal(result.damageReductionMag, 0);
  assert.ok(result.physDefPct > 1);
  assert.equal(computeStats(state).damageReductionPhys, 0);
});

test("пауза между атаками меняет интервал в секундах до ускорения и шага0.05", () => {
  // Один достоверный базовый APS вместо неоднозначного raw-ранга источника.
  const weapon = { ...item(77), stats: { ...item(77).stats, atk_speed: 1.25 } };
  const input = { ...state, attrs: { ...attrs, str: 200, dex: 100 }, equipment: {
    weapon: { item: weapon, addons: ["Пауза между атаками -0.1"] },
  } };
  assert.equal(computeStats(input).atkSpeed, 1.43);
  assert.equal(computeStats({ ...input, effects: [9000], effectCatalog: [effect({ wh: 20 })] }).atkSpeed, 1.82);
});

test("два кольца26389 и каменьНюйвы дают суммарное пение, крит и ПА одинраз", () => {
  const ring = choice(26389, ["Крит +3%", "Время пения -6%", "Показатель атаки +2"]);
  const result = computeStats({ ...state, cls: "ga", attrs: { ...attrs, str: 54, int: 300 }, equipment: {
    ring1: ring, ring2: ring, weapon: choice(33533, [], { stones: [stone(12637)] }),
  } });
  assert.equal(result.castTime, -15);
  assert.equal(result.crit, 7);
  assert.equal(result.attackLevel, 4);
});

test("проценты меткости, уклонения и движения не теряются после плоских прибавок", () => {
  const result = computeStats({ ...state, reputation: 200000, attrs: { ...attrs, str: 54, int: 300, dex: 50 },
    equipment: { weapon: choice(32261, ["Меткость +50%"]), necklace: choice(1895, ["Уклон +10%"]) }, cls: "ga" });
  assert.equal(result.accuracy, 375);
  assert.equal(result.evasion, 212);
  const movement = computeStats({ ...state, equipment: { boots: { item: {
    slot: "boots", addons: { count: "2", options: [{ text: "Скорость движения +10%" }, { text: "Скорость движения +0.2" }] },
  }, addons: ["Скорость движения +10%", "Скорость движения +0.2"] } } });
  assert.equal(movement.speed, 5.7);
});

test("дальнобойное оружие и кинжалы получают атаку от ловкости только пока активны", () => {
  for (const type of ["Оружие дальнего боя", "Кинжалы"]) {
    const weapon = { slot: "weapon", type, stats: { phys_atk: [100, 200] } };
    const input = { ...state, attrs: { ...attrs, str: 80, dex: 200 }, equipment: { weapon: { item: weapon } } };
    const result = computeStats(input);
    assert.deepEqual(result.physAtk, [478, 711]);
    assert.ok(result.explanations.physAtk.stages.some((stage) => /ловкость/i.test(stage.label) && stage.value === 200));
    assert.deepEqual(computeStats({ ...input, equipment: { weapon: { item: { ...weapon, req: { int: 600 } } } } }).physAtk, [161, 161]);
  }
});

test("пауза ниже0.2 до замедления не ограничивается раньше правила оригинала", () => {
  const weapon = { slot: "weapon", stats: { atk_speed: 1.25 }, addons: { count: 1, options: [{ text: "Пауза между атаками -0.7" }] } };
  const result = computeStats({ ...state, equipment: { weapon: { item: weapon, addons: ["Пауза между атаками -0.7"] } },
    effects: [9000], effectCatalog: [effect({ gn: 50 })] });
  assert.equal(result.atkSpeed, 5); // .8 - .7 = .1; ×1.5 = .15; ограничение5APS после округления
});

test("бонусы реального комплекта14927 попадают в итог и источники одинраз", () => {
  const sets = JSON.parse(readFileSync(new URL("../../data/catalog_sets.json", import.meta.url), "utf8")).sets;
  const set = sets.find((entry) => entry.members.includes(14927));
  const selected = (id) => ({ ...choice(id), item: { ...item(id), set_bonus: set } });
  const input = { ...state, attrs: { ...attrs, str: 250, dex: 60 }, equipment: { chest: selected(14927), legs: selected(14933) } };
  const two = computeStats(input);
  assert.equal(two.effectiveAttrs.str, 260);
  assert.equal(two.equipmentSets[0].count, 2);
  assert.ok(two.explanations.physDef.sources.some((entry) => entry.kind === "set" && entry.active));
  const four = computeStats({ ...input, equipment: { ...input.equipment, boots: selected(14939), wrists: selected(14945) } });
  assert.equal(four.effectiveAttrs.str, 260);
  assert.equal(four.damageReductionPhys, 3);
  assert.equal(four.equipmentSets[0].count, 4);
  assert.equal(two.damageReductionPhys, 0);
});

test("атака боеприпаса411 работает с дальнобойным оружием, но не с магическим", () => {
  const ammo = choice(411);
  const weapon = { slot: "weapon", grade: 4, type: "Оружие дальнего боя", stats: { phys_atk: [100, 200] } };
  const input = { ...state, equipment: { weapon: { item: weapon }, ammo } };
  const ranged = computeStats(input);
  const rangedWithout = computeStats({ ...state, equipment: { weapon: { item: weapon } } });
  assert.ok(ranged.physAtk[0] > rangedWithout.physAtk[0]);
  const mage = computeStats({ ...input, equipment: { weapon: { item: { ...weapon, type: "Магическое оружие" } }, ammo } });
  const mageWithout = computeStats({ ...state, equipment: { weapon: { item: { ...weapon, type: "Магическое оружие" } } } });
  assert.deepEqual(mage.physAtk, mageWithout.physAtk);
  assert.ok(mage.explanations.physAtk.sources.some((source) => !source.active && /дальнобойн/.test(source.reason)));
});

test("сырой ранг оружия1–5 не выдаётся за подтверждённые атаки в секунду", () => {
  const weapon = item(78);
  assert.equal(weapon.stats.atk_speed, 2);
  assert.equal(getItemBonuses({ item: weapon }, "weapon").atkSpeed, undefined);
  const verified = { ...weapon, stats: { ...weapon.stats, atk_speed: 1.11 }, attack_speed_verified: true };
  assert.equal(getItemBonuses({ item: verified }, "weapon").atkSpeed, 1.11);
});
