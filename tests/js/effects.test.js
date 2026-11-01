import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as effects from "../../static/js/engine/effects.js";
import { computeStats } from "../../static/js/engine/stats.js";

const source = JSON.parse(readFileSync(new URL("../../data/skills.json", import.meta.url), "utf8"));
const catalog = source.skills.map((skill) => ({ ...skill, record: skill.source_record, sprite_id: skill.source_record.an }));
const find = (id) => catalog.find((effect) => effect.id === id);
const naked = { cls: "by", level: 105, attrs: { vit: 5, int: 5, str: 5, dex: 5 } };

test("старый Медный лист в сборке не даёт бонусов, когда исключён из каталога сервера", () => {
  const allowed = catalog.filter((effect) => effect.id !== 92);
  const baseline = computeStats({ ...naked, effectCatalog: allowed });
  const restored = computeStats({ ...naked, effectCatalog: allowed, effects: [92],
    effectSettings: { 92: { level: 1, variant: "normal", activeStates: ["0:0:normal"] } } });
  for (const key of ["hp", "mp", "physDef", "magDef"]) assert.equal(restored[key], baseline[key]);
  assert.deepEqual(restored.physAtk, baseline.physAtk);
  assert.deepEqual(restored.magAtkRange, baseline.magAtkRange);
  assert.ok(restored.gearWarnings.some((warning) => /92.*не учтён/.test(warning)));
});

test("Железный покров: исходные уровни 1, 2, 10 и светлый 11 совпадают с оригиналом", () => {
  const original = structuredClone(find(1));
  for (const [level, variant, required, range, mp, defense] of [
    [1, "normal", 9, 18.4, 27, 15], [2, "normal", 12, 19.3, 36, 20],
    [10, "normal", 36, 26.5, 108, 60], [11, "rs", 89, 28, 265, 60],
    [11, "je", 89, 28, 265, 60],
  ]) {
    const result = effects.resolveEffect(find(1), { level, variant });
    assert.equal(result.values.oj_for_fu, required);
    assert.equal(result.values.ve, range);
    assert.equal(result.values.mp, mp);
    assert.equal(result.values.tb, defense);
    assert.ok(!result.description.includes("{tb}"));
  }
  assert.match(effects.resolveEffect(find(1), { level: 11, variant: "rs" }).name, /Светлый/);
  assert.deepEqual(find(1), original);
});

test("светлое временное состояние не включается вместе с уровнем умения", () => {
  const settings = { level: 11, variant: "rs" };
  const states = effects.getEffectStates(find(1), settings);
  assert.deepEqual(states.map((state) => [state.icon, state.base, state.values.tb]), [[1, true, 60], [10, false, 100]]);
  assert.deepEqual(effects.getEffectStates(find(1), { level: 10, variant: "normal" }).map((s) => s.key), [states[0].key]);
  const armor = { item: { id: 1, slot: "chest", stats: { phys_def: 100, mag_def: 100 } } };
  const base = { ...naked, equipment: { chest: armor }, effects: [1], effectCatalog: catalog };
  assert.equal(computeStats({ ...base, effectSettings: { 1: settings } }).physDef, 164);
  assert.equal(computeStats({ ...base, effectSettings: { 1: { ...settings, activeStates: [states[1].key] } } }).physDef, 264);
  assert.equal(computeStats({ ...base, effects: [], effectSettings: { 1: { ...settings, activeStates: [states[1].key] } } }).physDef, 204);
});

test("бафф здоровья и бонусы титулов проходят через исходные формулы", () => {
  const state = { ...naked, effects: [6], effectSettings: { 6: { level: 10, variant: "normal" } }, effectCatalog: catalog,
    titles: { hp: 100, phys_def: 100, mag_def: 50, phys_atk: 20, mag_atk: 30, accuracy: 8, evasion: 9, attack_level: 4, defense_level: 5 } };
  const result = computeStats(state);
  assert.equal(result.hp, 4284); // (3195 + 100) * 1.30, округление mypers.
  assert.equal(result.physDef, 104);
  assert.equal(result.elements.fire, 53);
  assert.deepEqual(result.physAtk, [129, 129]);
  assert.deepEqual(result.magAtkRange, [33, 33]);
  assert.equal(result.accuracy, 58);
  assert.equal(result.evasion, 59);
  assert.equal(result.attackLevel, 4);
  assert.equal(result.defenseLevel, 5);
});

test("прирост атаки добавляется к коэффициенту атрибута по pwscripts", () => {
  const weapon = { item: { id: 1, slot: "weapon", stats: { phys_atk: [100, 200], mag_atk: [30, 50] } } };
  const result = computeStats({ ...naked, equipment: { weapon }, effects: [7, 4], effectSettings: {
    7: { level: 10, variant: "normal" }, 4: { level: 10, variant: "normal" },
  }, effectCatalog: catalog });
  assert.deepEqual(result.physAtk, [273, 406]); // yh30, а не конечная атака *1.3.
  assert.deepEqual(result.magAtkRange, [54, 89]); // sq70 - исходная поправка tq(id4) 1.
});

test("уровень без настройки соответствует максимальному обычному уровню оригинала", () => {
  assert.equal(effects.resolveEffect(find(1)).level, 10);
});

test("замедление атаки округляет исходный интервал оружия до сотых перед шагом 0,05", () => {
  const result = computeStats({ ...naked, cls: "fx", effects: [54], effectCatalog: catalog,
    effectSettings: { 54: { level: 5, variant: "normal" } },
    equipment: { weapon: { item: { id: 1, slot: "weapon", stats: { atk_speed: 1.43 } } } } });
  assert.equal(result.atkSpeed, 0.8);
});

test("неизвестные состояния и отсутствующий доверенный каталог дают явное предупреждение", () => {
  const unknown = { id: 900, name: "Неизвестное", record: { ue: 1, lm: { invented: 999 }, states: [[{ type: "invented", an: 1 }]] } };
  const result = computeStats({ ...naked, effects: [900], effectCatalog: [unknown] });
  assert.equal(result.hp, 3195);
  assert.ok(result.gearWarnings.some((warning) => /invented/.test(warning)));
  assert.ok(computeStats({ ...naked, effects: [1] }).gearWarnings.some((warning) => /каталог эффектов не загружен/.test(warning)));
});

test("живой оригинал: Рев главы стаи уровня10 меняет HP воина105 с3195 на4154", () => {
  const result = computeStats({ ...naked, effects: [6], effectCatalog: catalog });
  assert.equal(result.hp, 4154);
});

test("Шкура зверя действует только в облике тигра; скрытность включает уровень персонажа", () => {
  const effectSettings = { 12: { level: 11, variant: "je" } };
  const off = computeStats({ ...naked, cls: "ya", effects: [12], effectCatalog: catalog, effectSettings });
  const on = computeStats({ ...naked, cls: "ya", effects: [8, 12], effectCatalog: catalog, effectSettings });
  assert.equal(off.crit, 1);
  assert.ok(on.crit > off.crit);
  const stealth = computeStats({ ...naked, cls: "fx", effects: [52], effectCatalog: catalog });
  assert.equal(stealth.stealth, 105 + effects.resolveEffect(find(52)).values.uu);
});

test("исходная поправка Ауры стали применяется до целочисленного коэффициента защиты", () => {
  const result = computeStats({ ...naked, effects: [5], effectSettings: { 5: { level: 11, variant: "rs" } }, effectCatalog: catalog,
    equipment: { chest: { item: { slot: "chest", stats: { phys_def: 1000 } } } } });
  assert.equal(result.physDef, 1903); // базовые1013 +1000 *trunc(89.5)/100.
});

test("связанные состояния вспышки Демона сохраняют оба явных выбора из UI", () => {
  const linked = effects.getEffectStates(find(116));
  const settings = { 116: { level: 1, variant: "normal", activeStates: [linked[1].key] } };
  const both = effects.collectEffects([116], settings, catalog, { cls: "by" });
  assert.equal(both.modifiers.yh, 500);
  assert.equal(both.modifiers.wh, 26); // Исходная поправка sd.tq к скорости.
  const baseOnly = effects.collectEffects([116], {}, catalog, { cls: "by" });
  assert.equal(baseOnly.modifiers.yh, 500);
  assert.equal(baseOnly.modifiers.wh, undefined);
  const extraOnly = effects.collectEffects([], settings, catalog, { cls: "by" });
  assert.equal(extraOnly.modifiers.yh, undefined);
  assert.equal(extraOnly.modifiers.wh, 25); // sd.tq прибавляет1 только второму выбранному состоянию.
});

test("исключение атаки вспышки Демона сохраняет её отдельное состояние скорости", () => {
  const settings = { 116: { level: 1, variant: "normal", activeStates: ["0:1:normal"] } };
  // UI заменил116 yh на115 yh, оставив явно отмеченную116 wh.
  const result = effects.collectEffects([115], settings, catalog, { cls: "by" });
  assert.equal(result.modifiers.yh, effects.resolveEffect(find(115)).values.yh);
  assert.equal(result.modifiers.wh, 25);
});

test("ограничения класса берутся отдельно из самого умения и его состояния", () => {
  assert.equal(effects.canUseEffect(find(41), "by"), true);
  assert.equal(effects.canUseEffect(find(41), "ga"), false);
  assert.equal(effects.canUseEffect(find(40), "rg"), true);
  assert.equal(effects.canUseEffect(find(39), "ej"), true);
  const dark = { level: 11, variant: "je", activeStates: ["11:0:je"] };
  const extra = effects.getEffectStates(find(4), dark).find((state) => !state.base);
  assert.deepEqual(extra.hi, [5]);
  assert.equal(effects.canUseEffectState(find(4), extra, "ij"), true);
  assert.equal(effects.canUseEffectState(find(4), extra, "ga"), false);
  const mage = effects.collectEffects([41, 42, 4], { 4: dark }, catalog, { cls: "ga" });
  const priest = effects.collectEffects([4], { 4: dark }, catalog, { cls: "ij" });
  assert.equal(mage.modifiers.tb, undefined);
  assert.equal(mage.modifiers.xk, undefined);
  assert.equal(mage.modifiers.sq, 69);
  assert.equal(priest.modifiers.sq, 219);
  assert.ok(mage.warnings.some((message) => /класс/i.test(message)));
});

test("светлый и темный варианты используют их собственную иконку из addition_hf", () => {
  for (const [id, variant, icon] of [[38, "je", 23], [39, "je", 25], [40, "normal", 26], [40, "rs", 27], [40, "je", 28]]) {
    assert.equal(effects.resolveEffect(find(id), { level: variant === "normal" ? 10 : 11, variant }).sprite_id, icon);
  }
});

test("одинаковые IDs состояний баффа и дебаффа не исключают друг друга", () => {
  const result = effects.collectEffects([1, 180], { 1: { level: 11, variant: "rs", activeStates: ["11:0:rs"] } }, catalog, { cls: "ij" });
  assert.equal(result.modifiers.tb, 160);
});
