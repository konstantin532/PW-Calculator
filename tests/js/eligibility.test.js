import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { computeStats } from "../../static/js/engine/stats.js";
import { resolveEquipment } from "../../static/js/engine/eligibility.js";

const attrs = { vit: 5, int: 5, str: 5, dex: 5 };
const character = { cls: "by", level: 105, attrs };
const choice = (item, extra = {}) => ({ item, refine: 0, stones: [], addons: [], ...extra });

test("вещь рассчитывается при силе 49, но собственный бонус не закрывает требование 50", () => {
  const state = { ...character, attrs: { ...attrs, str: 49 } };
  const item = { id: 1, slot: "chest", req: { str: 50 }, stats: { hp: 500, str: 100 } };
  const blocked = computeStats({ ...state, equipment: { chest: choice(item) } });
  assert.equal(blocked.hp, computeStats(state).hp + 500);
  assert.equal(blocked.effectiveAttrs.str, 149);
  assert.equal(blocked.activeEquipment.chest.item, item);
  assert.equal(blocked.equipmentStatus.chest.usable, false);
  assert.deepEqual(blocked.equipmentStatus.chest.requirements.find((r) => r.key === "str"),
    { key: "str", label: "Сила", required: 50, current: 49, met: false });
  const allowed = computeStats({ ...state, attrs: { ...attrs, str: 50 }, equipment: { chest: choice(item) } });
  assert.equal(allowed.equipmentStatus.chest.usable, true);
  assert.equal(allowed.effectiveAttrs.str, 150);
});

test("репутация меняет предупреждение, сохраняя бонусы вещи, заточки, камня и свойств", () => {
  const item = { id: 2, name: "Ранговый доспех", slot: "chest", grade: 1,
    specs_extra: { "Требуемая репутация": "300 000" }, stats: { hp: 100 },
    refine: { stat: "Здоровье", levels: [100] }, sockets: { craft: { 1: 100 } },
    addons: { count: "2", unique: [{ text: "Здоровье +50", chance: 100 }],
      options: [{ text: "Здоровье +20", chance: 50 }] } };
  const stone = { id: 3, grade: 1, effects: { armor: { stat: "здоровье", value: 30, percent: false } } };
  const equipment = { chest: choice(item, { refine: 1, stones: [stone], addons: ["Здоровье +20"] }) };
  const low = computeStats({ ...character, reputation: 299999, equipment });
  assert.equal(low.hp, computeStats(character).hp + 300);
  assert.equal(low.equipmentStatus.chest.usable, false);
  const eligible = computeStats({ ...character, reputation: 300000, equipment });
  assert.equal(eligible.hp, computeStats(character).hp + 300);
  assert.equal(eligible.equipmentStatus.chest.usable, true);
  assert.ok(!eligible.gearWarnings.some((warning) => /не учтена характеристика.*репутация/i.test(warning)));
});

test("уровень, класс и все четыре основные характеристики являются требованиями", () => {
  const item = { id: 4, slot: "chest", level: 105, classes: ["Маг"], req: { vit: 6, int: 7, str: 8, dex: 9 }, stats: { hp: 500 } };
  const result = computeStats({ ...character, level: 104, equipment: { chest: choice(item) } });
  assert.equal(result.hp, computeStats({ ...character, level: 104 }).hp + 500);
  const unmet = result.equipmentStatus.chest.requirements.filter((r) => !r.met).map((r) => r.key);
  assert.deepEqual(unmet.sort(), ["class", "dex", "int", "level", "str", "vit"]);
});

test("допустимая цепочка вещей работает независимо от порядка ключей сборки", () => {
  const ring = choice({ id: 5, slot: "ring", stats: { str: 10 } });
  const armor = choice({ id: 6, slot: "chest", req: { str: 15 }, stats: { int: 10 } });
  const weapon = choice({ id: 7, slot: "weapon", req: { int: 15 }, stats: { phys_atk: [100, 200] } });
  for (const equipment of [{ weapon, chest: armor, ring1: ring }, { ring1: ring, chest: armor, weapon }]) {
    const result = computeStats({ ...character, equipment });
    assert.equal(result.equipmentStatus.weapon.usable, true);
    assert.equal(result.equipmentStatus.chest.usable, true);
    assert.equal(result.equipmentStatus.ring1.usable, true);
    assert.deepEqual(result.effectiveAttrs, { vit: 5, int: 15, str: 15, dex: 5 });
  }
});

test("план сборки рассчитывает взаимные бонусы независимо от порядка надевания", () => {
  const equipment = {
    chest: choice({ id: 8, slot: "chest", req: { str: 15 }, stats: { int: 10, hp: 500 } }),
    weapon: choice({ id: 9, slot: "weapon", req: { int: 15 }, stats: { str: 10, phys_atk: [100, 200] } }),
  };
  const result = computeStats({ ...character, equipment });
  assert.deepEqual(result.activeEquipment, equipment);
  assert.equal(result.equipmentStatus.chest.usable, true);
  assert.equal(result.equipmentStatus.weapon.usable, true);
  assert.equal(result.hp, computeStats(character).hp + 500);
  assert.deepEqual(result.effectiveAttrs, { vit: 5, int: 15, str: 15, dex: 5 });
});

test("нехватка репутации не убирает поддержку других вещей, снятие меняет их предупреждения", () => {
  const armor = choice({ id: 10, slot: "chest", req: { str: 15 }, stats: { hp: 500 } });
  const ring = choice({ id: 11, slot: "ring", stats: { str: 10 }, specs_extra: { "Требуемая репутация": "100" } });
  const equipment = { chest: armor, ring1: ring };
  assert.equal(computeStats({ ...character, reputation: 100, equipment }).hp, computeStats(character).hp + 500);
  const low = computeStats({ ...character, reputation: 99, equipment });
  assert.equal(low.hp, computeStats(character).hp + 500);
  assert.deepEqual(low.activeEquipment, equipment);
  assert.equal(low.equipmentStatus.ring1.usable, false);
  assert.equal(low.equipmentStatus.chest.usable, true);
  assert.equal(equipment.chest, armor);
  assert.equal(equipment.ring1, ring);
  const removed = computeStats({ ...character, equipment: { chest: armor } });
  assert.equal(removed.hp, computeStats(character).hp + 500);
  assert.equal(removed.equipmentStatus.chest.usable, false);
  assert.equal(removed.effectiveAttrs.str, 5);
});

test("непрочитанное требование репутации не считается нулевым", () => {
  const item = { id: 12, slot: "chest", stats: { hp: 500 }, specs_extra: { "Требуемая репутация": "неизвестно" } };
  const result = computeStats({ ...character, reputation: 1000000, equipment: { chest: choice(item) } });
  assert.equal(result.hp, computeStats(character).hp + 500);
  assert.equal(result.equipmentStatus.chest.usable, false);
  assert.ok(result.gearWarnings.some((warning) => /репутац/i.test(warning)));
});

test("отрицательный бонус участвует в плане и предупреждениях остальных вещей", () => {
  const equipment = {
    helmet: choice({ id: 13, slot: "helmet", req: { str: 5 }, stats: { str: 5 } }),
    chest: choice({ id: 14, slot: "chest", req: { str: 10 }, stats: { str: -5, hp: 500 } }),
  };
  const result = computeStats({ ...character, equipment });
  assert.equal(result.equipmentStatus.helmet.usable, false);
  assert.equal(result.equipmentStatus.chest.usable, true);
  assert.equal(result.effectiveAttrs.str, 5);
  assert.equal(result.hp, computeStats(character).hp + 500);
});

test("выбранное оружие включает состояния оружия даже с невыполненным требованием", () => {
  const source = JSON.parse(readFileSync(new URL("../../data/skills.json", import.meta.url), "utf8"));
  const record = source.skills.find((effect) => effect.id === 55);
  const effect = { ...record, record: record.source_record };
  const result = computeStats({ ...character, effects: [55], effectCatalog: [effect], equipment: {
    weapon: choice({ id: 15, slot: "weapon", req: { str: 100 }, stats: { phys_atk: [100, 200] } }),
  } });
  assert.equal(result.equipmentStatus.weapon.usable, false);
  assert.ok(!result.gearWarnings.some((warning) => /только с оружием/i.test(warning)));
  assert.ok(result.defenseLevel > 0);
});

test("реальная карточка Comeback проверяет 200000 репутации и не меняет исходный каталог", () => {
  const catalog = JSON.parse(readFileSync(new URL("../../data/catalog_items.json", import.meta.url), "utf8"));
  const item = catalog.find((entry) => entry.id === 12647);
  assert.equal(item.specs_extra["Требуемая репутация"], "200 000");
  const state = { ...character, cls: "ga", attrs: { ...attrs, str: 50, int: 300 }, equipment: { weapon: choice(item) } };
  const before = JSON.stringify(item);
  assert.equal(computeStats({ ...state, reputation: 199999 }).equipmentStatus.weapon.usable, false);
  assert.equal(computeStats({ ...state, reputation: 200000 }).equipmentStatus.weapon.usable, true);
  const planned = computeStats({ ...character, cls: "ga", reputation: 0, equipment: state.equipment });
  assert.equal(planned.equipmentStatus.weapon.usable, false);
  assert.ok(planned.magAtkRange[0] > computeStats({ ...character, cls: "ga" }).magAtkRange[0]);
  assert.deepEqual(planned.equipmentStatus.weapon.requirements.filter((r) => !r.met).map((r) => r.key).sort(),
    ["int", "reputation", "str"]);
  assert.equal(JSON.stringify(item), before);
});

test("броня 9345 увеличивает защиту плана при базовых 5 и предупреждает о силе 265 и ловкости 57", () => {
  const catalog = JSON.parse(readFileSync(new URL("../../data/catalog_items.json", import.meta.url), "utf8"));
  const item = catalog.find((entry) => entry.id === 9345);
  const result = computeStats({ ...character, equipment: { chest: choice(item) } });
  assert.ok(result.physDef > computeStats(character).physDef);
  assert.equal(result.equipmentStatus.chest.usable, false);
  assert.deepEqual(result.equipmentStatus.chest.requirements.filter((r) => !r.met), [
    { key: "str", label: "Сила", required: 265, current: 5, met: false },
    { key: "dex", label: "Ловкость", required: 57, current: 5, met: false },
  ]);
});

test("описание требований не возвращает классы за пределами десяти классов Comeback", () => {
  const item = { id: 16, slot: "chest", classes: ["Маг", "Призрак", "Жнец"], stats: { hp: 500 } };
  const result = computeStats({ ...character, equipment: { chest: choice(item) } });
  const requirement = result.equipmentStatus.chest.requirements.find((entry) => entry.key === "class");
  assert.equal(requirement.required, "Маг");
  assert.ok(!JSON.stringify(result.equipmentStatus).includes("Призрак"));
  assert.ok(!JSON.stringify(result.equipmentStatus).includes("Жнец"));
});

test("общая проверка не разрешает неизвестный класс и не принимает подменённую подпись класса", () => {
  assert.throws(() => resolveEquipment({ ...character, cls: "he" }), /класс/i);
  const item = { id: 17, slot: "chest", classes: ["Маг"] };
  const result = resolveEquipment({ ...character, className: "Маг", equipment: { chest: choice(item) } });
  assert.equal(result.status.chest.usable, false);
  assert.equal(result.status.chest.requirements.find((entry) => entry.key === "class").current, "Воин");
});
