import assert from "node:assert/strict";
import { test } from "node:test";
import * as equipment from "../../static/js/engine/equipment.js";
import { parseBuild, serializeBuild } from "../../static/js/engine/build.js";

// Подтверждённые данные Comeback 1.4.6, предмет 33533: обе атаки
// увеличиваются на 754 при +11. Камни в эти строки не включаются.
const levels = Array(12).fill(null);
levels[10] = 754;
const meteor = {
  id: 33533, name: "★★Метеор", slot: "weapon", grade: 15,
  stats: { phys_atk: [456, 684], mag_atk: [831, 1016] },
  refine: { stat: "Физ+маг атака", levels },
  sockets: { craft: { 2: 100 } },
  addons: { count: "3", options: [{ text: "Здоровье +350" }, { text: "Сила +18~19" }, { text: "Интеллект +18~19" }] },
};

test("заточка смешанной атаки +11 даёт обе строки Метеора из игры", () => {
  const result = equipment.getItemBonuses({ item: meteor, refine: 11 }, "weapon");
  assert.deepEqual(result.ranges, { phys_atk: [1210, 1438], mag_atk: [1585, 1770] });
  assert.deepEqual(result.warnings, []);
});

test("выбранные +19 из исходного диапазона учитываются как точные основные характеристики", () => {
  const result = equipment.getItemBonuses({ item: meteor, addons: ["Здоровье +350", "Сила +19", "Интеллект +19"] }, "weapon");
  assert.deepEqual(result.flat, { hp: 350, str: 19, int: 19 });
  assert.deepEqual(result.warnings, []);
});

test("выбор из диапазона не позволяет менять пределы, характеристику или единицы", () => {
  for (const text of ["Интеллект +20", "Интеллект +17", "Ловкость +19", "Интеллект +19%", "Интеллект +19 ед.", "__proto__ +19", "constructor +19", "Интеллект +Infinity", "Интеллект +18~20"]) {
    assert.throws(() => equipment.validateEquipmentChoice({ item: meteor, addons: [text] }, "weapon"), /бонус/i, text);
  }
  assert.equal(equipment.validateEquipmentChoice({ item: meteor, addons: ["  ИНТЕЛЛЕКТ  +19  "] }, "weapon").addons[0], "  ИНТЕЛЛЕКТ  +19  ");
});

test("разбор опций сохраняет отрицательные диапазоны, дроби и проценты", () => {
  assert.equal(typeof equipment.parseAddonOption, "function");
  for (const [text, expected] of [
    ["Интеллект +18~19", { label: "Интеллект", min: 18, max: 19, percent: false }],
    ["Интеллект +18–19", { label: "Интеллект", min: 18, max: 19, percent: false }],
    ["Время пения -1~3%", { label: "Время пения", min: -3, max: -1, percent: true }],
    ["Время пения -3~-1%", { label: "Время пения", min: -3, max: -1, percent: true }],
    ["Скорость +0,1~0,3 ед.", { label: "Скорость", min: 0.1, max: 0.3, percent: false }],
    ["Здоровье +350", { label: "Здоровье", min: 350, max: 350, percent: false }],
  ]) assert.deepEqual(equipment.parseAddonOption(text), expected, text);
  for (const text of [null, {}, "", "Интеллект +19~18", "Интеллект +18~~19", "Интеллект +Infinity", "Интеллект +1e3", "__proto__ +1~2", "constructor +1~2", "prototype +1~2", "Интеллект +18~19\nЗдоровье +100"]) {
    assert.equal(equipment.parseAddonOption(text), null, String(text));
  }
});

test("форматирование выбранного числа проверяет границы и не изменяет фиксированную строку", () => {
  assert.equal(typeof equipment.formatAddonValue, "function");
  assert.equal(equipment.formatAddonValue("Интеллект +18~19", 19), "Интеллект +19");
  assert.equal(equipment.formatAddonValue("Время пения -1~3%", -2), "Время пения -2%");
  assert.equal(equipment.formatAddonValue("Скорость +0,1~0,3 ед.", 0.2), "Скорость +0.2 ед.");
  assert.equal(equipment.formatAddonValue("Здоровье  +350 ед.", 350), "Здоровье  +350 ед.");
  for (const value of [17, 20, NaN, Infinity, -Infinity, "19", null]) {
    assert.throws(() => equipment.formatAddonValue("Интеллект +18~19", value), /бонус|значен/i);
  }
  assert.throws(() => equipment.formatAddonValue("Здоровье +350", 351), /бонус|значен/i);
});

test("отрицательный нулевой предел и малые дроби сохраняют знак и проходят обратный разбор", () => {
  assert.deepEqual(equipment.parseAddonOption("Время пения -0~3%"), { label: "Время пения", min: -3, max: -0, percent: true });
  const text = equipment.formatAddonValue("Скорость +0.00000001~0.00000003", 0.00000002);
  assert.equal(text, "Скорость +0.00000002");
  assert.deepEqual(equipment.parseAddonOption(text), { label: "Скорость", min: 0.00000002, max: 0.00000002, percent: false });
});

test("единицы и знак диапазонного бонуса сверяются с его исходным текстом", () => {
  const item = { slot: "chest", addons: { count: 1, options: [{ text: "Время пения -1~3%" }] } };
  assert.deepEqual(equipment.getItemBonuses({ item, addons: ["Время пения -2%"] }, "chest").flat, { cast_time: -2 });
  for (const text of ["Время пения +2%", "Время пения -2", "Время пения -4%", "Время пения -2 ед."]) {
    assert.throws(() => equipment.validateEquipmentChoice({ item, addons: [text] }, "chest"), /бонус/i);
  }
});

test("точный выбранный бонус переживает компактное сохранение и загрузку только с доверенным каталогом", () => {
  const state = { cls: "by", level: 105, attrs: { vit: 5, int: 5, str: 5, dex: 5 },
    equipment: { weapon: { item: meteor, refine: 11, addons: ["Интеллект +19"] } } };
  const json = serializeBuild(state);
  const compact = JSON.parse(json);
  assert.deepEqual(compact.equipment.weapon, { itemId: 33533, refine: 11, stones: [], addons: ["Интеллект +19"] });
  const restored = parseBuild(json, [meteor]);
  assert.equal(restored.equipment.weapon.item, meteor);
  assert.deepEqual(equipment.getItemBonuses(restored.equipment.weapon, "weapon").flat, { int: 19 });
  compact.equipment.weapon.addons[0] = "Интеллект +20";
  assert.throws(() => parseBuild(JSON.stringify(compact), [meteor]), /бонус/i);
});

test("старые точные строки и общий предел бонусов сохраняют прежнюю проверку", () => {
  assert.deepEqual(equipment.validateEquipmentChoice({ item: meteor, addons: ["Интеллект +18~19"] }, "weapon").addons, ["Интеллект +18~19"]);
  assert.throws(() => equipment.validateEquipmentChoice({ item: meteor, addons: ["Здоровье +350", "Сила +19", "Интеллект +19", "Сила +18"] }, "weapon"), /бонус.*3|3.*бонус/i);
});

const fixedMeteor = { ...meteor, addons: { ...meteor.addons, count: "4", unique: [{ text: "Урон монстрам +60", chance: 100 }] } };
const attackWeapon = { ...meteor, addons: { count: "4", options: [{ text: "Здоровье +350" }], unique: [{ text: "Показатель атаки +40", chance: 100 }] } };

test("один гарантированный unique из общего count4 оставляет три редактируемых свойства", () => {
  assert.equal(equipment.maximumAddons(fixedMeteor), 3);
  const addons = ["Здоровье +350", "Сила +19", "Интеллект +19"];
  const result = equipment.getItemBonuses({ item: fixedMeteor, addons }, "weapon");
  assert.deepEqual(result.flat, { hp: 350, str: 19, int: 19 });
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /не учтён эффект «Урон монстрам \+60»/);
  assert.throws(() => equipment.validateEquipmentChoice({ item: fixedMeteor, addons: [...addons, "Сила +18"] }, "weapon"), /бонус.*3|3.*бонус/i);
});

test("подтверждённый постоянный Показатель атаки +40 применяется без ручного выбора", () => {
  const result = equipment.getItemBonuses({ item: attackWeapon }, "weapon");
  assert.deepEqual(result.flat, { attack_level: 40 });
  assert.deepEqual(result.warnings, []);
  const probabilistic = { ...attackWeapon, addons: { ...attackWeapon.addons, unique: [{ text: "Показатель атаки +40", chance: 50 }] } };
  assert.deepEqual(equipment.getItemBonuses({ item: probabilistic }, "weapon").flat, {});
  assert.equal(equipment.maximumAddons(probabilistic), 4);
});

test("старый выбор постоянного свойства не удваивает его и не расходует редактируемые места", () => {
  const choice = { item: attackWeapon, addons: ["Показатель атаки +40", "Здоровье +350", "Здоровье +350", "Здоровье +350"] };
  const result = equipment.getItemBonuses(choice, "weapon");
  assert.deepEqual(result.flat, { attack_level: 40, hp: 1050 });
  assert.equal(equipment.validateEquipmentChoice(choice, "weapon").addons.length, 4);
});

test("legacy сборка с тремя роллами и постоянным четвёртым свойством сохраняется без двойного эффекта", () => {
  const state = { cls: "by", level: 105, attrs: { vit: 5, int: 5, str: 5, dex: 5 },
    equipment: { weapon: { item: fixedMeteor, addons: ["Здоровье +350", "Сила +19", "Интеллект +19", "Урон монстрам +60"] } } };
  const restored = parseBuild(serializeBuild(state), [fixedMeteor]);
  assert.equal(restored.equipment.weapon.addons.length, 4);
  const result = equipment.getItemBonuses(restored.equipment.weapon, "weapon");
  assert.deepEqual(result.flat, { hp: 350, str: 19, int: 19 });
  assert.equal(result.warnings.length, 1);
  for (const text of ["Урон монстрам +61", "Показатель атаки +40", "Сила +20"]) {
    assert.throws(() => equipment.validateEquipmentChoice({ item: fixedMeteor, addons: [text] }, "weapon"), /бонус/i);
  }
});
