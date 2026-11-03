import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { getItemBonuses, parseAddonOption, formatAddonValue, validateEquipmentChoice } from "../../static/js/engine/equipment.js";

const data = (name) => JSON.parse(readFileSync(new URL(`../../data/${name}`, import.meta.url), "utf8"));
const items = data("catalog_items.json"), stones = data("catalog_stones.json");
const item = (id) => items.find((entry) => entry.id === id);
const stone = (id) => stones.find((entry) => entry.id === id);
const bonus = (id, addons = [], extra = {}) => {
  const record = item(id);
  return getItemBonuses({ item: record, addons, ...extra }, record.slot === "ring" ? "ring1" : record.slot);
};

test("146: плоские сокращения уклонения, скорости, HP/MP и дальности учитываются", () => {
  for (const [id, text, key, value] of [
    [133, "Уклон +6", "evasion", 6],
    [226, "Скорость движения +0.1", "speed", 0.1],
    [32261, "HP +300", "hp", 300],
    [32261, "MP +400", "mp", 400],
    [19888, "Телослож. +19", "vit", 19],
  ]) {
    const result = bonus(id, [text]);
    assert.equal(result.flat[key], value, text);
    assert.ok(result.contributions.some((entry) => entry.stat === key && entry.value === value && !entry.percent), text);
    assert.ok(!result.unresolved.some((entry) => entry.label === text), text);
  }
  assert.equal(bonus(32264, ["Дальность атаки +2"]).flat.range, 5.5);
});

test("146: уклонение заточки и гарантированные ЖС/МЭ трактатов не теряются", () => {
  assert.equal(bonus(267, [], { refine: 1 }).flat.evasion, 13);
  assert.equal(bonus(17663).flat.hp, 140);
  assert.equal(bonus(17679).flat.hp, 70);
  assert.equal(bonus(17679).flat.mp, 80);
  assert.equal(bonus(17654).flat.cast_time, -1);
});

test("146: янтарные, изумрудные и ТЕЛ камни применяют подтверждённые HP/MP/выносливость", () => {
  for (const [id, key, value] of [[2012, "hp", 25], [6384, "hp", 32], [6389, "mp", 52], [12638, "vit", 10]]) {
    const result = bonus(9345, [], { stones: [stone(id)] });
    assert.equal(result.flat[key], value, `${id} ${key}`);
    assert.ok(result.contributions.some((entry) => entry.source === "stone" && entry.stat === key && entry.value === value));
  }
  // В original словаре Channelling имеет подписи «Время пения» и «Время активации».
  const channelling = bonus(33533, [], { stones: [stone(12637)] });
  assert.equal(channelling.flat.cast_time, -3);
  assert.ok(channelling.contributions.some((entry) => entry.source === "stone" && entry.stat === "cast_time" && entry.value === -3 && entry.percent));
});

test("146: проценты сохраняются отдельно от плоских прибавок с точными единицами", () => {
  for (const [id, text, key, value] of [
    [8368, "Макс ХП +5%", "hp_percent", 5],
    [9326, "Мана +5%", "mp_percent", 5],
    [25701, "Физическая защита +4%", "phys_def_percent", 4],
    [25701, "Маг защита +4%", "mag_def_percent", 4],
    [32261, "Меткость +50%", "accuracy_percent", 50],
    [1895, "Уклон +10%", "evasion_percent", 10],
    [45289, "Скорость движения +10%", "speed_percent", 10],
  ]) {
    const result = bonus(id, [text]);
    assert.equal(result.flat[key], value, text);
    assert.ok(result.contributions.some((entry) => entry.stat === key && entry.value === value && entry.percent), text);
    assert.ok(!result.unresolved.some((entry) => entry.label === text), text);
  }
  const mixed = bonus(1895, ["Уклон +72", "Уклон +10%"]);
  assert.equal(mixed.flat.evasion, 165);
  assert.equal(mixed.flat.evasion_percent, 10);
});

test("146: пауза между атаками является отрицательными секундами, а не процентом APS", () => {
  const result = bonus(22, ["Пауза между атаками -0.05"]);
  assert.equal(result.flat.attack_interval, -0.05);
  assert.ok(result.contributions.some((entry) => entry.stat === "attack_interval" && entry.value === -0.05 && !entry.percent));
  const seconds = { slot: "wrists", addons: { count: 1, options: [{ text: "Интервал атаки -0.05 сек." }] } };
  assert.equal(getItemBonuses({ item: seconds, addons: ["Интервал атаки -0.05 сек."] }, "wrists").flat.attack_interval, -0.05);
  assert.deepEqual(parseAddonOption("Интервал атаки -0.05 сек."), { label: "Интервал атаки", min: -0.05, max: -0.05, percent: false });
  assert.equal(formatAddonValue("Интервал атаки -0.05~0.15 сек.", -0.1), "Интервал атаки -0.1 сек.");
});

test("новые алиасы не обходят источник, единицы и неизвестные свойства", () => {
  assert.throws(() => validateEquipmentChoice({ item: item(22), addons: ["Пауза между атаками -0.05%"] }, "weapon"), /бонус/);
  assert.throws(() => validateEquipmentChoice({ item: item(32261), addons: ["HP +301"] }, "weapon"), /бонус/);
  for (const text of ["Здоровье +10 сек.", "Интервал атаки -0.05 минут", "Интервал атаки -0.05 сек.\nСила +100"]) assert.equal(parseAddonOption(text), null, text);
  const unrecognized = bonus(133, ["Прочность +25%"]);
  assert.ok(unrecognized.unresolved.some((entry) => entry.label === "Прочность +25%" && entry.value === null));
  assert.equal(unrecognized.flat.durability, undefined);
});

test("146: снижение урона хранится отдельно от защиты, требования — отрицательными процентами", () => {
  for (const [id, text, key, value] of [
    [14927, "Уменьшение физ урона +2%", "damage_reduction_phys", 2],
    [32261, "Уменьшение физического урона +3%", "damage_reduction_phys", 3],
    [32261, "Уменьшение урона от стихий +4%", "damage_reduction_mag", 4],
    [22, "Требования -10%", "requirement_reduction", -10],
  ]) {
    const result = bonus(id, [text]);
    assert.equal(result.flat[key], value, text);
    assert.ok(result.contributions.some((entry) => entry.stat === key && entry.value === value && entry.percent), text);
    assert.ok(!result.unresolved.some((entry) => entry.label === text), text);
  }
  assert.equal(bonus(17669).flat.damage_reduction_phys, 6);
  assert.equal(bonus(17627).flat.damage_reduction_phys, 3); // Original pw_id17627: type bu, val3.
  assert.equal(bonus(14927, ["Уменьшение физ урона +2%"]).flat.phys_def, item(14927).stats.phys_def);
});

test("некорректные единицы и направления специальных процентов не создают боевые бонусы", () => {
  for (const text of ["Уменьшение физ урона +2", "Уменьшение физ урона -2%", "Уменьшение урона от стихий +101%", "Требования +10%", "Требования -101%", "Требования -10"]) {
    const record = { slot: "chest", addons: { count: 1, options: [{ text }] } };
    const result = getItemBonuses({ item: record, addons: [text] }, "chest");
    assert.deepEqual(result.flat, {}, text);
    assert.ok(result.unresolved.some((entry) => entry.label === text && entry.value === null), text);
  }
});

test("146: точные фразы скорости и задержки атак трактатов сохраняют единицы", () => {
  assert.equal(bonus(17621).flat.speed, 0.1);
  assert.equal(bonus(17622).flat.speed, 0.2);
  assert.equal(bonus(17623).flat.speed, 0.3);
  assert.equal(bonus(17683).flat.attack_interval, -0.05);
  const hegemony = bonus(36675);
  assert.equal(hegemony.flat.attack_interval, -0.05);
  assert.equal(hegemony.flat.speed, 0.1);
  for (const text of ["Увеличение скорости передвижения на Infinityм/сек.", "Увеличение скорости передвижения на 0.1м/мин.", "Увеличение скорости передвижения на 0.1м/сек. и Сила +100"]) {
    assert.equal(parseAddonOption(text), null, text);
  }
});

test("146: восстановление и опыт — отдельные показатели, а не максимум HP/MP", () => {
  assert.equal(bonus(134, ["Скор. восст. HP +6"]).flat.hp_regen, 6);
  assert.equal(bonus(149, ["Скор. восст. MP +4"]).flat.mp_regen, 4);
  assert.equal(bonus(17607).flat.hp_regen, 3);
  assert.equal(bonus(17607).flat.experience_percent, 1);
  assert.equal(bonus(17681).flat.hp_regen, 20);
  assert.equal(bonus(17681).flat.mp_regen, 20);
  assert.equal(bonus(17681).flat.hp, 70);
  const result = bonus(32274, ["HP скорость восстановления +25"]);
  assert.equal(result.flat.hp_regen, 25);
  assert.equal(result.flat.hp, undefined);
});

test("146: PvE уровни и пять стихийных добавок оружия не смешиваются с обычной атакой", () => {
  assert.equal(bonus(33533).flat.monster_slayer, 60);
  assert.equal(bonus(32510, ["Защита от монстров +3"]).flat.monster_guard, 3);
  for (const [id, element, value] of [[5292, "metal", 6], [5299, "wood", 6], [5306, "water", 6], [5313, "fire", 6], [5320, "earth", 6],
    [6394, "metal", 40], [6399, "wood", 40], [6404, "water", 40], [6409, "fire", 40]]) {
    const result = bonus(33533, [], { stones: [stone(id)] });
    assert.equal(result.flat[`weapon_damage_${element}`], value, `${id} ${element}`);
    assert.deepEqual(result.ranges.phys_atk, item(33533).stats.phys_atk);
    assert.deepEqual(result.ranges.mag_atk, item(33533).stats.mag_atk);
    assert.equal(result.flat[`def_${element}`], undefined);
    const armor = bonus(9345, [], { stones: [stone(id)] });
    assert.equal(armor.flat[`weapon_damage_${element}`], undefined);
    assert.equal(armor.flat[`def_${element}`], item(9345).stats[`def_${element}`] + stone(id).effects.armor.value);
  }
});

test("предупреждение о комплекте снимается только при подтверждённой структуре его описания", () => {
  const source = item(14927), definition = { id: "146:14927-14933", name: "Проверочный комплект", members: [14927, 14933],
    bonuses: [{ pieces: 2, texts: ["Сила +10"] }] };
  const result = getItemBonuses({ item: { ...source, set_bonus: definition } }, "chest");
  assert.ok(!result.unresolved.some((entry) => /комплект/u.test(entry.label)));
  assert.equal(result.flat.str, undefined); // Комплект считает отдельный движок.
  for (const bad of [null, {}, { ...definition, name: "" }, { ...definition, members: [14927, 14927] },
    { ...definition, members: [14933] }, { ...definition, bonuses: [] }, { ...definition, bonuses: [{ pieces: 3, texts: ["Сила +10"] }] },
    { ...definition, bonuses: [{ pieces: 2, texts: [] }] }]) {
    const unknown = getItemBonuses({ item: { ...source, set_bonus: bad } }, "chest");
    assert.ok(unknown.unresolved.some((entry) => /комплект/u.test(entry.label) && entry.value === null), JSON.stringify(bad));
  }
});

test("146: совмещённая заточка36529 добавляется один раз к физзащите и каждой стихии", () => {
  const result = bonus(36529, [], { refine: 1 });
  assert.equal(result.flat.phys_def, 402);
  assert.equal(result.flat.mag_def, 42);
  for (const element of ["metal", "wood", "water", "fire", "earth"]) {
    assert.equal(result.flat[`def_${element}`], 360);
    assert.equal(result.flat[`def_${element}`] + result.flat.mag_def, 402);
  }
  assert.deepEqual(result.contributions.filter((entry) => entry.source === "refine").map(({stat,value}) => ({stat,value})), [
    {stat: "phys_def", value: 42}, {stat: "mag_def", value: 42},
  ]);
});

test("146: все582 числовых порога восстановленных комплектов распознаны", () => {
  const sets = data("catalog_sets.json").sets;
  let count = 0;
  for (const set of sets) for (const threshold of set.bonuses) for (const text of threshold.texts) {
    const record = { slot: "chest", addons: { count: 1, options: [{ text }] } };
    const result = getItemBonuses({ item: record, addons: [text] }, "chest");
    assert.ok(result.contributions.length, `${set.id}: ${text}`);
    assert.deepEqual(result.unresolved, [], `${set.id}: ${text}`);
    count++;
  }
  assert.equal(count, 582);
  const speed = { slot: "chest", addons: { count: 1, options: [{ text: "Скорость перемещения +0.2 м/с" }] } };
  assert.equal(getItemBonuses({ item: speed, addons: ["Скорость перемещения +0.2 м/с"] }, "chest").flat.speed, 0.2);
  for (const text of ["Сила +10 м/с", "Скорость перемещения +0.2 км/час"]) assert.equal(parseAddonOption(text), null, text);
});

test("146: Удар50% сопоставлен с меткостью по тому же pw_id36539", () => {
  const result = bonus(36539, ["Удар +50%"]);
  assert.equal(result.flat.accuracy_percent, 50);
  assert.equal(result.flat.crit, undefined);
  const unknown = { slot: "ring", addons: { count: 1, options: [{ text: "Удар +50" }] } };
  assert.deepEqual(getItemBonuses({ item: unknown, addons: ["Удар +50"] }, "ring1").flat, {});
});
