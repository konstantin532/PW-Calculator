import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CLASSES, computeStats } from "../../static/js/engine/stats.js";

const readData = (name) => JSON.parse(readFileSync(new URL(`../../data/${name}`, import.meta.url), "utf8"));
const items = readData("catalog_items.json");
const stones = readData("catalog_stones.json");
const effectCatalog = readData("skills.json").skills.map((effect) => ({ ...effect, record: effect.source_record }));
const naked = { vit: 5, int: 5, str: 5, dex: 5 };
const character = { cls: "by", level: 105, attrs: naked };
const keys = ["hp", "physAtk", "magAtkRange", "physDef", "metal", "wood", "water", "fire", "earth", "magDef"];
const item = (id) => items.find((entry) => entry.id === id);
const stone = (id) => stones.find((entry) => entry.id === id);
const chosen = (id, extra = {}) => ({ item: item(id), refine: 0, stones: [], addons: [], ...extra });
const sourcesFor = (explanation, kind) => explanation.sources.filter((source) => source.kind === kind);
const entriesFor = (explanation, kind, stat) => sourcesFor(explanation, kind).flatMap((source) => source.entries).filter((entry) => entry.stat === stat);

function assertExact(stats) {
  assert.ok(stats.explanations, "computeStats должен возвращать объяснения характеристик");
  assert.deepEqual(Object.keys(stats.explanations).sort(), [...keys].sort());
  for (const key of keys) {
    const explanation = stats.explanations[key];
    const expected = stats.elements[key] ?? stats[key];
    assert.equal(explanation.key, key);
    assert.deepEqual(explanation.result, expected, key);
    assert.deepEqual(explanation.stages.at(-1).value, expected, `${key}: последняя стадия`);
    assert.ok(explanation.title && explanation.note);
    assert.ok(explanation.stages.every((stage) => stage.label && stage.expression));
    assert.ok(Array.isArray(explanation.warnings));
    for (const source of explanation.sources) {
      assert.equal(typeof source.active, "boolean");
      if (!source.active) assert.ok(source.reason);
      for (const entry of source.entries) assert.ok(entry.value === null || (Array.isArray(entry.value) ? entry.value.every(Number.isFinite) : Number.isFinite(entry.value)));
    }
  }
}

test("все десять классов: объяснения совпадают с цифрами, старые результаты неизменны", () => {
  const inputs = Object.keys(CLASSES).flatMap((cls) => [1, 51, 105].flatMap((level) => [false, true]
    .filter((spent) => level > 1 || !spent).map((spent) => ({ cls, level,
      attrs: spent ? { vit: 15, int: 35, str: 45, dex: 25 } : naked,
      titles: { hp: 13, phys_def: 7, mag_def: 11, phys_atk: 9, mag_atk: 15 } }))));
  const results = inputs.map(computeStats);
  // Снимок всех прежних полей снят до добавления объяснений: 50 состояний.
  const oldFields = results.map(({ explanations, damageReductionPhys, damageReductionMag, extraBonuses, equipmentSets, ...stats }) => stats);
  assert.equal(createHash("sha256").update(JSON.stringify(oldFields)).digest("hex"), "accebf1da4e18d717a474667c6d23dd90d3fe6b024c954f8758b8ed7c79703a5");
  results.forEach(assertExact);
});

test("Метеор 33533: база, заточка +11 и Ледяной камень разделены и учтены один раз", () => {
  const stats = computeStats({ ...character, cls: "ga", level: 102, attrs: { ...naked, str: 54, int: 300 },
    equipment: { weapon: chosen(33533, { refine: 11, stones: [stone(2004)], addons: ["Интеллект +19"] }) } });
  assertExact(stats);
  const magic = stats.explanations.magAtkRange;
  assert.deepEqual(entriesFor(magic, "base", "mag_atk").map((entry) => entry.value), [[831, 1016]]);
  assert.deepEqual(entriesFor(magic, "refine", "mag_atk").map((entry) => entry.value), [[754, 754]]);
  assert.deepEqual(entriesFor(magic, "stone", "mag_atk").map((entry) => entry.value), [[100, 100]]);
  assert.equal(entriesFor(magic, "addon", "int")[0].value, 19);
  assert.deepEqual(magic.stages.find((stage) => /Снаряжение и титулы/.test(stage.label)).value, [1685, 1870]);
  assert.ok(magic.stages.some((stage) => /round/.test(stage.expression)));
});

test("броня 9345 сохраняет красные источники, без прибавок к HP и защите", () => {
  const equipment = { chest: chosen(9345, { refine: 1, stones: [stone(2000)], addons: ["Физическая защита +264"] }) };
  const red = computeStats({ ...character, equipment });
  assertExact(red);
  assert.equal(red.hp, 3195);
  assert.equal(red.physDef, 3);
  const disabled = red.explanations.physDef.sources.filter((source) => !source.active);
  assert.ok(disabled.some((source) => /Броня владыки/.test(source.label) && /265/.test(source.reason)));
  assert.equal(disabled.flatMap((source) => source.entries).find((entry) => entry.stat === "phys_def" && entry.value === 1798).value, 1798);
  const active = computeStats({ ...character, attrs: { ...naked, str: 265, dex: 57 }, equipment });
  assertExact(active);
  assert.equal(active.hp, 3243);
  assert.equal(active.physDef, 3014);
  assert.ok(active.explanations.physDef.sources.every((source) => source.active));
});

test("репутация 12647: граница 199999/200000 отключает все части выбранного оружия", () => {
  const input = { ...character, cls: "ga", attrs: { ...naked, str: 50, int: 300 },
    equipment: { weapon: chosen(12647, { refine: 1, stones: [stone(2004)], addons: ["Интеллект +15"] }) } };
  const red = computeStats({ ...input, reputation: 199999 });
  const active = computeStats({ ...input, reputation: 200000 });
  assertExact(red); assertExact(active);
  assert.deepEqual(red.magAtkRange, [420, 420]);
  assert.deepEqual(active.magAtkRange, [5989, 7105]);
  for (const kind of ["base", "refine", "stone", "addon"]) assert.ok(sourcesFor(red.explanations.magAtkRange, kind).every((source) => !source.active && /200000/.test(source.reason.replaceAll(" ", ""))));
});

test("титулы, баф HP и дробная защита показывают действительный порядок округлений", () => {
  const stats = computeStats({ ...character, effects: [6, 5], effectSettings: { 5: { level: 11, variant: "rs" } }, effectCatalog,
    titles: { hp: 100 }, equipment: { chest: { item: { slot: "chest", name: "Проверочный доспех", stats: { phys_def: 1000 } } } } });
  assertExact(stats);
  assert.equal(stats.hp, 4284);
  assert.equal(stats.physDef, 1903);
  assert.equal(entriesFor(stats.explanations.hp, "titles", "hp")[0].value, 100);
  assert.ok(entriesFor(stats.explanations.hp, "effect", "fw").some((entry) => entry.value === 30 && entry.percent));
  assert.ok(stats.explanations.hp.stages.some((stage) => stage.value === 4283.5));
  assert.ok(stats.explanations.physDef.stages.some((stage) => /trunc\(89\.5\)/.test(stage.expression)));
});

test("средняя магзащита раскрывает пять разных стихий и последнее округление", () => {
  const stats = computeStats({ ...character, equipment: { necklace: { item: { slot: "necklace", stats: { def_fire: 13, def_wood: 7, mag_def: 20 } } } } });
  assertExact(stats);
  const mean = stats.explanations.magDef;
  for (const key of ["metal", "wood", "water", "fire", "earth"]) assert.ok(mean.stages.some((stage) => stage.value === stats.elements[key]));
  assert.match(mean.stages.at(-1).expression, /round.*5/);
});

const synthetic = (id, values, exclusiveId = null) => ({ id, name: `Проверка ${id}`, record: { ue: 1, lm: values,
  states: { 0: [{ types: Object.keys(values), ...(exclusiveId === null ? {} : { id: exclusiveId }) }] } } });

test("отрицательные модификаторы, обнуление и несовместимость отражаются без новых правил", () => {
  const catalog = [synthetic(900, { va: 1000, pt: 500, eh: 150 }), synthetic(901, { fw: 10 }, 44), synthetic(902, { fw: 20 }, 44)];
  const stats = computeStats({ ...character, equipment: { chest: { item: { slot: "chest", stats: { phys_def: 100, mag_def: 100 } } } },
    effects: [900, 901, 902], effectCatalog: catalog });
  assertExact(stats);
  assert.equal(stats.physDef, 0);
  assert.equal(stats.magDef, 0);
  assert.ok(stats.explanations.hp.sources.some((source) => !source.active && /901/.test(source.label) && /несовмест|замен/.test(source.reason)));
  assert.ok(stats.explanations.hp.sources.some((source) => source.active && /902/.test(source.label)));
  assert.ok(stats.explanations.physDef.stages.some((stage) => /1000/.test(stage.expression)));
  assert.ok(stats.explanations.metal.stages.some((stage) => /max\(0/.test(stage.expression)));
});

test("неизвестное свойство и отсутствующий эффект не маскируются подтверждённым нулём", () => {
  const stats = computeStats({ ...character, effects: [999999], effectCatalog: [], equipment: {
    chest: { item: { slot: "chest", name: "Неизвестный доспех", stats: { unknown_power: 777 } } } } });
  assertExact(stats);
  assert.ok(stats.explanations.hp.sources.flatMap((source) => source.entries).some((entry) => entry.value === null));
  assert.ok(stats.explanations.hp.warnings.some((warning) => /unknown_power/.test(warning)));
  assert.ok(stats.explanations.hp.warnings.some((warning) => /999999/.test(warning)));
});
