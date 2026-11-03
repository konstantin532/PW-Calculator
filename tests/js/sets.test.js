import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolveEquipment } from "../../static/js/engine/eligibility.js";
import { resolveSetBonuses } from "../../static/js/engine/sets.js";

const items = JSON.parse(readFileSync(new URL("../../data/catalog_items.json", import.meta.url), "utf8"));
const definitions = JSON.parse(readFileSync(new URL("../../data/catalog_sets.json", import.meta.url), "utf8")).sets;
const choice = (item) => ({ item, refine: 0, stones: [], addons: [] });
const rawItem = (id) => items.find((item) => item.id === id);
const realItem = (id) => ({ ...rawItem(id), set_bonus: definitions.find((set) => set.members.includes(id)) });
const equipped = (ids) => Object.fromEntries(ids.map((id) => [rawItem(id).slot, choice(realItem(id))]));
const definition = (members, bonuses, name = "Проверочный комплект") => ({
  id: `146:${[...members].sort((a, b) => a - b).join("-")}`, name, members, bonuses,
});
const synthetic = (id, slot, set, req = {}, stats = {}) => choice({ id, slot, name: `Часть ${id}`, set_bonus: set, req, stats });
const state = { cls: "by", level: 105, attrs: { vit: 5, int: 5, str: 5, dex: 5 } };

test("146: Сила безумного короля начисляет пороги двух и четырёх частей один раз", () => {
  const one = resolveSetBonuses(equipped([14927]));
  assert.deepEqual(one.flat, {});
  assert.ok(one.sources.every((source) => !source.active && source.reason));
  const two = resolveSetBonuses(equipped([14927, 14933]));
  assert.equal(two.flat.str, 10);
  assert.equal(two.flat.damage_reduction_phys, undefined);
  assert.deepEqual(two.sets[0].bonuses.map((bonus) => bonus.active), [true, false]);
  const four = resolveSetBonuses(equipped([14927, 14933, 14939, 14945]));
  assert.deepEqual(four.flat, { str: 10, damage_reduction_phys: 3 });
  assert.equal(four.sets[0].count, 4);
  assert.equal(four.sources.filter((source) => source.entries.some((entry) => entry.stat === "str")).length, 1);
  assert.ok(four.sources.every((source) => source.kind === "set" && source.active));
});

test("146: Тень перерождения складывает достигнутые пороги 2/5/6", () => {
  const members = [25701, 25702, 25703, 25704, 25705, 25713];
  assert.deepEqual(resolveSetBonuses(equipped(members.slice(0, 2))).flat, { attack_level: 5 });
  assert.deepEqual(resolveSetBonuses(equipped(members.slice(0, 5))).flat, { attack_level: 5, defense_level: 10 });
  assert.deepEqual(resolveSetBonuses(equipped(members)).flat, { attack_level: 5, defense_level: 13 });
});

test("активная и недостигнутая неизвестная строка остаются null с явным статусом", () => {
  const set = definition([1, 2, 3], [{ pieces: 2, texts: ["Сила +10", "Неизвестный эффект +77"] },
    { pieces: 3, texts: ["Маг атака +20"] }]);
  const result = resolveSetBonuses({ helmet: synthetic(1, "helmet", set), chest: synthetic(2, "chest", set) });
  assert.deepEqual(result.flat, { str: 10 });
  assert.ok(result.sources[0].entries.some((entry) => entry.value === null));
  assert.ok(result.warnings.some((warning) => /Неизвестный эффект/.test(warning)));
  assert.equal(result.sources[1].active, false);
  assert.match(result.sources[1].reason, /3/);
  assert.deepEqual(result.ranges.mag_atk, [0, 0]);
});

test("комплекты используют общий обработчик плоских, процентных и максимальных атак", () => {
  const set = definition([1, 2], [{ pieces: 2, texts: ["Физическая атака +7", "Макс маг атака +20", "Макс ХП +5%"] }]);
  const result = resolveSetBonuses({ helmet: synthetic(1, "helmet", set), chest: synthetic(2, "chest", set) });
  assert.deepEqual(result.flat, { hp_percent: 5 });
  assert.deepEqual(result.ranges, { phys_atk: [7, 7], mag_atk: [0, 20] });
  assert.ok(result.sources[0].entries.some((entry) => entry.stat === "hp_percent" && entry.percent));
});

test("одинаковые определения объединяются, порядок ввода не меняет результат", () => {
  const normal = equipped([14927, 14933, 14939, 14945]);
  const reverse = Object.fromEntries(Object.entries(normal).reverse());
  assert.deepEqual(resolveSetBonuses(normal), resolveSetBonuses(reverse));
  const inconsistent = structuredClone(normal);
  inconsistent.legs.item.set_bonus = structuredClone(inconsistent.legs.item.set_bonus);
  inconsistent.legs.item.set_bonus.bonuses[0].texts = ["Сила +999"];
  assert.throws(() => resolveSetBonuses(inconsistent), /противореч|согласован/);
  assert.throws(() => resolveSetBonuses({ chest: synthetic(999, "chest", normal.chest.item.set_bonus) }), /част|комплект/);
});

test("неверные ID, дубли частей, пороги и пустые строки комплекта не создают бонусы", () => {
  const valid = definition([1, 2], [{ pieces: 2, texts: ["Сила +10"] }]);
  const malformed = [
    { ...valid, id: "146:9-10" }, { ...valid, members: [1, 1] },
    { ...valid, bonuses: [{ pieces: 0, texts: ["Сила +10"] }] },
    { ...valid, bonuses: [{ pieces: 3, texts: ["Сила +10"] }] },
    { ...valid, bonuses: [{ pieces: true, texts: ["Сила +10"] }] },
    { ...valid, bonuses: [{ pieces: 2, texts: [""] }] },
  ];
  for (const set of malformed) assert.throws(() => resolveSetBonuses({ helmet: synthetic(1, "helmet", set) }), /комплект/iu);
});

test("два разрешённых кольцевых слота считаются как две надетые части без повторного порога", () => {
  const set = definition([1, 2], [{ pieces: 2, texts: ["Здоровье +40"] }]);
  const result = resolveSetBonuses({ ring1: synthetic(1, "ring", set), ring2: synthetic(1, "ring", set) });
  assert.equal(result.sets[0].count, 2);
  assert.equal(result.flat.hp, 40);
});

test("красная часть не завершает комплект, снятие части отключает порог", () => {
  const set = definition([1, 2], [{ pieces: 2, texts: ["Сила +10"] }]);
  const gear = { helmet: synthetic(1, "helmet", set), chest: synthetic(2, "chest", set, { str: 10 }) };
  const red = resolveEquipment({ ...state, equipment: gear });
  assert.equal(red.status.chest.usable, false);
  assert.deepEqual(resolveSetBonuses(red.activeEquipment).flat, {});
  const active = resolveEquipment({ ...state, attrs: { ...state.attrs, str: 10 }, equipment: gear });
  assert.equal(resolveSetBonuses(active.activeEquipment).flat.str, 10);
  assert.deepEqual(resolveSetBonuses({ helmet: active.activeEquipment.helmet }).flat, {});
});

test("бонус комплекта не запускает собственные части и взаимную цепочку требований", () => {
  const set = definition([1, 2], [{ pieces: 2, texts: ["Сила +10"] }]);
  const result = resolveEquipment({ ...state, equipment: {
    helmet: synthetic(1, "helmet", set, { str: 15 }), chest: synthetic(2, "chest", set, { str: 15 }),
  } });
  assert.deepEqual(result.activeEquipment, {});
  const one = resolveEquipment({ ...state, equipment: {
    helmet: synthetic(1, "helmet", set), chest: synthetic(2, "chest", set, { str: 15 }),
  } });
  assert.equal(one.status.helmet.usable, true);
  assert.equal(one.status.chest.usable, false);
});

test("две другие активные части поддерживают требование следующей вещи; снятие разрывает цепочку", () => {
  const set = definition([1, 2, 3], [{ pieces: 2, texts: ["Сила +10"] }]);
  const gear = { helmet: synthetic(1, "helmet", set), chest: synthetic(2, "chest", set),
    weapon: synthetic(3, "weapon", set, { str: 15 }) };
  const result = resolveEquipment({ ...state, equipment: gear });
  assert.ok(Object.values(result.status).every((status) => status.usable));
  assert.equal(result.status.weapon.requirements[0].current, 15);
  const reordered = resolveEquipment({ ...state, equipment: Object.fromEntries(Object.entries(gear).reverse()) });
  assert.deepEqual(result, reordered);
  const removed = resolveEquipment({ ...state, equipment: { helmet: gear.helmet, weapon: gear.weapon } });
  assert.equal(removed.status.weapon.usable, false);
});

test("отрицательный порог комплекта сохраняет защиту уже активных требований", () => {
  const set = definition([1, 2, 3], [{ pieces: 3, texts: ["Сила -10"] }]);
  const result = resolveEquipment({ ...state, attrs: { ...state.attrs, str: 15 }, equipment: {
    helmet: synthetic(1, "helmet", set), chest: synthetic(2, "chest", set),
    legs: synthetic(3, "legs", set, { int: 15 }),
    weapon: choice({ id: 4, slot: "weapon", req: { str: 15 }, stats: { int: 10 } }),
  } });
  assert.equal(result.status.weapon.usable, true);
  assert.equal(result.status.legs.usable, false);
  assert.ok(result.status.legs.reasons.some((reason) => /нарушают требования/.test(reason)));
});
