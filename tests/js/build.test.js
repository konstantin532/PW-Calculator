import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { parseBuild, serializeBuild } from "../../static/js/engine/build.js";
import { itemFitsSlot, maxSockets, maximumAddons, validateEquipmentChoice } from "../../static/js/engine/equipment.js";

const ring = { id: 259, name: "Кольцо", slot: "ring", sockets: { craft: { 1: 100 } }, stats: { hp: 20 }, addons: { count: "1", options: [{ text: "Сила +1" }] } };
const stone = { id: 1996, effects: { decoration: { stat: "Здоровье", value: 5 } } };
const state = { name: "Мой воин", cls: "by", level: 5, attrs: { vit: 5, int: 5, str: 5, dex: 5 },
  equipment: { ring1: { item: ring, refine: 2, stones: [stone], addons: ["Сила +1"] } }, effects: [1, 9], gender: "female" };

test("сохранение содержит IDs, загрузка восстанавливает предметы из доверенного каталога", () => {
  const json = serializeBuild(state);
  assert.ok(!json.includes('"stats"'));
  assert.ok(!json.includes('"effects":{"decoration"'));
  const result = parseBuild(json, [ring], [stone]);
  assert.equal(result.equipment.ring1.item, ring);
  assert.equal(result.equipment.ring1.stones[0], stone);
  assert.deepEqual(result.equipment.ring1.addons, ["Сила +1"]);
  assert.deepEqual(result.effects, [1, 9]);
  assert.equal(result.gender, "female");
});

test("уровни, свет/тьма, отдельные состояния и девять титулов сохраняются без данных каталога", () => {
  const settings = { 1: { level: 11, variant: "rs", activeStates: ["11:0:rs"] }, 9: { level: 10, variant: "normal", activeStates: [] } };
  const titles = { phys_atk: 8, mag_atk: 9, phys_def: 10, mag_def: 11, accuracy: 12, evasion: 13, attack_level: 14, defense_level: 15, hp: 100 };
  const json = serializeBuild({ ...state, effectSettings: settings, titles, addedEffects: [9], hiddenEffects: [3] });
  const loaded = parseBuild(json, [ring], [stone]);
  assert.deepEqual(loaded.effectSettings, settings);
  assert.deepEqual(loaded.titles, titles);
  assert.deepEqual(loaded.addedEffects, [9]);
  assert.deepEqual(loaded.hiddenEffects, [3]);
  const legacy = JSON.parse(serializeBuild(state));
  delete legacy.effectSettings; delete legacy.titles; delete legacy.addedEffects; delete legacy.hiddenEffects;
  const old = parseBuild(JSON.stringify(legacy), [ring], [stone]);
  assert.deepEqual(old.effectSettings, {});
  assert.deepEqual(old.titles, {});
  assert.deepEqual(old.addedEffects, []);
  assert.deepEqual(old.hiddenEffects, []);
});

test("настройки эффектов и титулов отклоняют опасные ключи, неверные типы и выход за границы", () => {
  const doc = JSON.parse(serializeBuild(state));
  for (const overrides of [
    { effectSettings: [] }, { effectSettings: { bad: { level: 1, variant: "normal" } } },
    { effectSettings: { 1: { level: 100, variant: "normal" } } },
    { effectSettings: { 1: { level: 1, variant: "evil" } } },
    { effectSettings: { 1: { level: 1, variant: "normal", activeStates: ["<script>"] } } },
    { effectSettings: JSON.parse('{"__proto__":{"level":1,"variant":"normal"}}') },
    { addedEffects: ["1"] }, { hiddenEffects: [-1] }, { titles: { hp: -1 } }, { titles: { hp: 50001 } },
    { titles: { hp: 0.5 } }, { titles: { hp: "100" } }, { titles: { script: 1 } },
  ]) assert.throws(() => parseBuild(JSON.stringify({ ...doc, ...overrides }), [ring], [stone]));
});

test("импорт отклоняет неизвестный ID, чужой слот и подмену бонуса", () => {
  const doc = JSON.parse(serializeBuild(state));
  assert.throws(() => parseBuild(JSON.stringify(doc), [], [stone]), /259|каталог/i);
  doc.equipment.chest = doc.equipment.ring1;
  assert.throws(() => parseBuild(JSON.stringify(doc), [ring], [stone]), /слот|место/i);
  delete doc.equipment.chest;
  doc.equipment.ring1.addons = ["Здоровье +999999"];
  assert.throws(() => parseBuild(JSON.stringify(doc), [ring], [stone]), /бонус/i);
});

test("импорт проверяет очки, размер, версию, тип IDs и лимиты заточки и камней", () => {
  const doc = JSON.parse(serializeBuild(state));
  for (const mutation of [
    (b) => { b.attrs.str = 999; }, (b) => { b.version = 2; }, (b) => { b.cls = "alien"; },
    (b) => { b.cls = "he"; }, (b) => { b.cls = "uf"; },
    (b) => { b.cls = "bard"; }, (b) => { b.cls = "monkey"; },
    (b) => { b.equipment.ring1.itemId = "259"; }, (b) => { b.equipment.ring1.refine = 13; },
    (b) => { b.equipment.ring1.stones = [1996, 1996, 1996, 1996, 1996]; },
  ]) {
    const bad = structuredClone(doc); mutation(bad);
    assert.throws(() => parseBuild(JSON.stringify(bad), [ring], [stone]));
  }
  assert.throws(() => parseBuild(" ".repeat(1024 * 1024 + 1)), /размер/i);
});

test("старые формы каталога правильно попадают в соответствующие ячейки", () => {
  assert.ok(itemFitsSlot({ type: "Верх", breadcrumb: ["Доспехи"] }, "chest"));
  assert.ok(itemFitsSlot({ type: "Кольцо" }, "ring2"));
  assert.ok(itemFitsSlot({ slot: "weapon" }, "weapon"));
  assert.equal(itemFitsSlot({ type: "Кольцо" }, "helmet"), false);
  assert.equal(itemFitsSlot({ slot: "chest", type: "Кольцо" }, "ring1"), false);
});

const catalogItems = JSON.parse(readFileSync(new URL("../../data/catalog_items.json", import.meta.url), "utf8"));
const catalogStones = JSON.parse(readFileSync(new URL("../../data/catalog_stones.json", import.meta.url), "utf8"));
const savedChoice = (slot, itemId, overrides) => JSON.stringify({ version: 1, cls: "by", level: 105,
  attrs: { vit: 5, int: 5, str: 5, dex: 5 }, equipment: { [slot]: { itemId, ...overrides } } });

test("настоящий каталог: импорт отклоняет четвёртый бонус при source count 0~3", () => {
  const armor = catalogItems.find((i) => i.id === 4872);
  const addons = armor.addons.options.slice(0, 4).map((a) => a.text);
  assert.throws(() => parseBuild(savedChoice("chest", 4872, { addons }), catalogItems, catalogStones), /бонус.*3|3.*бонус/i);
});

test("настоящий каталог: ожерелье 259 не получает камни без подтверждённых ячеек", () => {
  assert.throws(() => parseBuild(savedChoice("necklace", 259, { stones: [1996] }), catalogItems, catalogStones), /ячее|камн/i);
});

test("настоящий каталог: камень 5 ранга не вставляется в доспех 1 ранга", () => {
  assert.throws(() => parseBuild(savedChoice("chest", 4872, { stones: [1996] }), catalogItems, catalogStones), /ранг/i);
});

test("нулевая вероятность ячейки и чужая цель камня не разрешают вставку", () => {
  const weaponOnly = { id: 999, grade: 1, effects: { weapon: { stat: "физ. атака", value: 10 } } };
  const armor = { id: 1, slot: "chest", grade: 1, sockets: { craft: { 1: 0, 4: 0 } } };
  assert.throws(() => validateEquipmentChoice({ item: armor, stones: [weaponOnly] }, "chest"), /ячее|камн/i);
  armor.sockets.craft[1] = 100;
  assert.throws(() => validateEquipmentChoice({ item: armor, stones: [weaponOnly] }, "chest"), /эффект|подходит/i);
});

test("верхняя граница count общая для обычных и уникальных бонусов", () => {
  for (const count of ["3", "0~3", "2~3"]) {
    const item = { slot: "chest", addons: { count, options: [{ text: "Сила +1" }, { text: "Ловкость +1" }], unique: [{ text: "Здоровье +10" }, { text: "Мана +10" }] } };
    assert.throws(() => validateEquipmentChoice({ item, addons: ["Сила +1", "Ловкость +1", "Здоровье +10", "Мана +10"] }, "chest"), /бонус/i);
    assert.equal(validateEquipmentChoice({ item, addons: ["Сила +1", "Ловкость +1", "Здоровье +10"] }, "chest").addons.length, 3);
  }
});

test("настоящий каталог: разрешённые четыре камня своего ранга загружаются", () => {
  const loaded = parseBuild(savedChoice("chest", 137, { stones: [1996, 1996, 1996, 1996] }), catalogItems, catalogStones);
  assert.equal(loaded.equipment.chest.stones.length, 4);
  assert.equal(loaded.equipment.chest.stones[0].grade, 5);
});

test("общие UI-лимиты не обещают неизвестные бонусы и ячейки", () => {
  assert.equal(maximumAddons({ addons: { options: [{ text: "Сила +1" }] } }), 0);
  assert.equal(maxSockets({ slot: "chest" }, "chest"), 0);
  assert.equal(maxSockets({ slot: "chest", sockets: { craft: { 0: 100, 2: 5, 4: 0, 9: 100 }, drop: { 3: 0 } } }, "chest"), 2);
});

test("числовая репутация сохраняется в сборке v1 и восстанавливается", () => {
  const json = serializeBuild({ ...state, reputation: 300000 });
  const compact = JSON.parse(json);
  assert.equal(compact.version, 1);
  assert.equal(compact.reputation, 300000);
  assert.equal(parseBuild(json, [ring], [stone]).reputation, 300000);
});

test("старая сборка без репутации получает 0 и сохраняет выбранную недоступную вещь", () => {
  const requiredRing = { ...ring, req: { str: 50 }, specs_extra: { "Требуемая репутация": "200 000" } };
  const compact = JSON.parse(serializeBuild(state));
  delete compact.reputation;
  const loaded = parseBuild(JSON.stringify(compact), [requiredRing], [stone]);
  assert.equal(loaded.reputation, 0);
  assert.equal(loaded.equipment.ring1.item, requiredRing);
  assert.equal(JSON.parse(serializeBuild(loaded)).reputation, 0);
});

test("импорт и сохранение отклоняют буквы, числовые строки и неверные числа репутации", () => {
  const compact = JSON.parse(serializeBuild(state));
  for (const reputation of ["300000", "abc", "1e6", "１２３", null, true, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseBuild(JSON.stringify({ ...compact, reputation }), [ring], [stone]), /репутац/i);
    assert.throws(() => serializeBuild({ ...state, reputation }), /репутац/i);
  }
  for (const reputation of [NaN, Infinity, -Infinity]) {
    assert.throws(() => serializeBuild({ ...state, reputation }), /репутац/i);
  }
});
