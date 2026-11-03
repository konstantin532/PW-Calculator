import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { getItemBonuses, validateEquipmentChoice } from "../../static/js/engine/equipment.js";
import { parseBuild, serializeBuild } from "../../static/js/engine/build.js";

const items = JSON.parse(readFileSync(new URL("../../data/catalog_items.json", import.meta.url), "utf8"));
const stones = JSON.parse(readFileSync(new URL("../../data/catalog_stones.json", import.meta.url), "utf8"));
const item = (id) => items.find((record) => record.id === id);
const stone = (id) => stones.find((record) => record.id === id);

test("146 меч 12647: Крит даёт процентные пункты, Макс маг атака меняет только верхний предел", () => {
  const result = getItemBonuses({ item: item(12647), addons: ["Крит +4%", "Макс маг атака +130", "Интеллект +15"] }, "weapon");
  assert.deepEqual(result.flat, { range: 3, crit: 4, int: 15 });
  assert.deepEqual(result.ranges, { phys_atk: [663, 995], mag_atk: [1212, 1611] });
  assert.equal(result.warnings.length, 1); // Исходная скорость 14 по-прежнему неизвестна.
  assert.match(result.warnings[0], /единицы источника не подтверждены/u);
});

test("обе подписи максимальной физической атаки 146 увеличивают только верхнюю границу", () => {
  assert.deepEqual(getItemBonuses({ item: item(22), addons: ["Макс физ атака +17"] }, "weapon").ranges.phys_atk, [131, 213]);
  assert.deepEqual(getItemBonuses({ item: item(32263), addons: ["Физическая атака макс +180"] }, "weapon").ranges.phys_atk, [1249, 2473]);
  assert.deepEqual(getItemBonuses({ item: item(32261), addons: ["Магическая Атака макс +180"] }, "weapon").ranges.mag_atk, [1266, 1721]);
});

test("журнал Метеора раздельно объясняет базу, заточку, камни и выбранные свойства", () => {
  const result = getItemBonuses({ item: item(33533), refine: 11, stones: [stone(2004), stone(2004)], addons: ["Здоровье +350", "Сила +19", "Интеллект +19"] }, "weapon");
  assert.deepEqual(result.ranges, { phys_atk: [1210, 1438], mag_atk: [1785, 1970] });
  assert.deepEqual(result.flat, { range: 3, monster_slayer: 60, hp: 350, str: 19, int: 19 });
  const entries = result.contributions;
  assert.deepEqual(entries.filter((e) => e.source === "refine").map(({ stat, value }) => ({ stat, value })), [
    { stat: "phys_atk", value: [754, 754] }, { stat: "mag_atk", value: [754, 754] },
  ]);
  assert.deepEqual(entries.filter((e) => e.source === "stone").map(({ stat, value }) => ({ stat, value })), [
    { stat: "mag_atk", value: [100, 100] }, { stat: "mag_atk", value: [100, 100] },
  ]);
  assert.deepEqual(entries.filter((e) => e.source === "addon").map(({ stat, value }) => ({ stat, value })), [
    { stat: "hp", value: 350 }, { stat: "str", value: 19 }, { stat: "int", value: 19 },
  ]);
  assert.deepEqual(entries.find((e) => e.source === "base" && e.stat === "mag_atk").value, [831, 1016]);
  assert.ok(entries.every((e) => typeof e.label === "string" && e.label && typeof e.raw === "string" && typeof e.percent === "boolean"));
  assert.deepEqual(result.unresolved, []);
  assert.equal(result.contributions.find((entry) => entry.stat === "monster_slayer").value, 60);
});

test("журнал сохраняет процент критического удара камня и направление максимальной атаки", () => {
  const result = getItemBonuses({ item: item(12647), stones: [stone(12638)], addons: ["Крит +4%", "Макс маг атака +130"] }, "weapon");
  assert.equal(result.flat.crit, 5);
  assert.deepEqual(result.contributions.filter((e) => e.stat === "crit").map(({ source, value, percent }) => ({ source, value, percent })), [
    { source: "addon", value: 4, percent: true }, { source: "stone", value: 1, percent: true },
  ]);
  assert.deepEqual(result.contributions.find((e) => e.source === "addon" && e.stat === "mag_atk").value, [0, 130]);
});

test("старое сохранение постоянного свойства 146 даёт единственную запись guaranteed", () => {
  const state = { cls: "by", level: 105, attrs: { vit: 5, int: 5, str: 5, dex: 5 }, equipment: {
    weapon: { item: item(34760), addons: ["Показатель атаки +40", "Здоровье +350", "Сила +19", "Ловкость +19"] },
  } };
  const restored = parseBuild(serializeBuild(state), items, stones);
  const result = getItemBonuses(restored.equipment.weapon, "weapon");
  assert.equal(result.flat.attack_level, 40);
  assert.equal(result.contributions.filter((e) => e.stat === "attack_level").length, 1);
  assert.equal(result.contributions.find((e) => e.stat === "attack_level").source, "guaranteed");
  assert.throws(() => validateEquipmentChoice({ item: item(34760), addons: [...state.equipment.weapon.addons, "Крит +1%"] }, "weapon"), /бонус/u);
});

test("неизвестный камень и исходная скорость остаются null; процент защиты имеет отдельный ключ", () => {
  const weapon = getItemBonuses({ item: item(12647), stones: [stone(25154)] }, "weapon");
  assert.equal(weapon.flat.phys_def, undefined);
  assert.equal(weapon.atkSpeed, undefined);
  assert.equal(weapon.unresolved.length, 2);
  assert.ok(weapon.unresolved.every((e) => e.value === null && e.reason));
  assert.deepEqual(new Set(weapon.unresolved.map((e) => e.source)), new Set(["base", "stone"]));
  const armor = getItemBonuses({ item: item(25701), addons: ["Физическая защита +4%"] }, "boots");
  assert.equal(armor.flat.phys_def, item(25701).stats.phys_def);
  assert.equal(armor.flat.phys_def_percent, 4);
  assert.equal(armor.contributions.filter((e) => e.source === "addon").length, 1);
  assert.equal(armor.unresolved.find((e) => e.source === "addon"), undefined);
  const set = getItemBonuses({ item: item(14927) }, "chest");
  assert.ok(set.unresolved.some((e) => e.source === "base" && /комплект/u.test(e.label) && e.value === null));
});

test("новые алиасы сохраняют ограничения источника и точные выбранные числа после загрузки", () => {
  const state = { cls: "ga", level: 105, attrs: { vit: 5, int: 300, str: 50, dex: 5 }, reputation: 200000,
    equipment: { weapon: { item: item(12647), addons: ["Крит +4%", "Макс маг атака +130", "Интеллект +15"] } } };
  const restored = parseBuild(serializeBuild(state), items, stones);
  const result = getItemBonuses(restored.equipment.weapon, "weapon");
  assert.equal(result.flat.crit, 4);
  assert.deepEqual(result.ranges.mag_atk, [1212, 1611]);
  for (const text of ["Крит +5%", "Крит +4", "Макс маг атака +131", "Макс маг атака +130%", "Мин маг атака +130"]) {
    assert.throws(() => validateEquipmentChoice({ item: item(12647), addons: [text] }, "weapon"), /бонус/u, text);
  }
});
