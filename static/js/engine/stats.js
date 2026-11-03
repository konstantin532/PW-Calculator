// Расчёт характеристик персонажа. Базовые формулы взяты с mypers.ru и
// сверены с его выводом; соответствие игре Comeback 1.4.6 ещё не подтверждено.
import { getItemBonuses, itemFitsSlot, SLOTS } from "./equipment.js";
import { collectEffects, sourceRound, validateEffectSettings } from "./effects.js";
import { resolveEquipment } from "./eligibility.js?v=20261103-activation";

export const MAX_LEVEL = 105;
export const BASE_ATTR = 5;
export const POINTS_PER_LEVEL = 5;
export const ATTRS = ["vit", "int", "str", "dex"];
export const TITLE_KEYS = ["phys_atk", "mag_atk", "phys_def", "mag_def", "accuracy", "evasion", "attack_level", "defense_level", "hp"];

export function validateTitles(titles = {}) {
  if (titles === null || typeof titles !== "object" || Array.isArray(titles) || Object.keys(titles).some((key) => !TITLE_KEYS.includes(key))) throw new Error("Неверные бонусы титулов");
  for (const value of Object.values(titles)) if (!Number.isInteger(value) || value < 0 || value > 50000) throw new Error("Бонусы титулов должны быть целыми числами от 0 до 50000");
  return { ...titles };
}

const WARRIOR = { hp: 15, mp: 9, speed: 5.0, acc: 10, eva: 10, role: "phys" };
const CASTER = { hp: 10, mp: 14, speed: 4.8, acc: 5, eva: 2, role: "magic" };
const AGILE = { hp: 13, mp: 11, speed: 5.2, acc: 8, eva: 6, role: "phys" };

export const CLASSES = {
  by: { name: "Воин", ...WARRIOR },
  ga: { name: "Маг", ...CASTER },
  ya: { name: "Оборотень", hp: 17, mp: 7, speed: 4.9, acc: 8, eva: 8, role: "phys" },
  rl: { name: "Друид", hp: 12, mp: 12, speed: 5.1, acc: 7, eva: 6, role: "hybrid" },
  js: { name: "Лучник", ...AGILE },
  ij: { name: "Жрец", ...CASTER },
  rg: { name: "Мистик", ...CASTER, acc: 8, eva: 6 },
  ej: { name: "Страж", ...WARRIOR },
  sj: { name: "Шаман", ...CASTER },
  fx: { name: "Убийца", ...AGILE },
};

export function totalPoints(level) {
  return POINTS_PER_LEVEL * (clampLevel(level) - 1);
}

export function spentPoints(attrs) {
  return ATTRS.reduce((sum, key) => sum + (attrs[key] - BASE_ATTR), 0);
}

export function clampLevel(level) {
  const value = Math.trunc(Number(level));
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_LEVEL, Math.max(1, value));
}

// Общая формула защиты mypers: e = [база, сдвиг, делитель, k, k2, d1, d2].
function defense(gear, primary, secondary, e) {
  return (
    Math.round((primary + secondary - e[1]) / e[2]) +
    Math.round(gear * (e[3] + Math.round((e[1] * primary + e[4] * secondary) / e[5]) / e[6])) +
    e[0]
  );
}

export function defensePercent(value, level) {
  return Math.min(95, Math.max(0, (100 * value) / (40 * level + value - 25)));
}

function physicalAttack(cls, level, attrs, weaponMin, weaponMax, percent = 0) {
  const stat = attrs.str;
  const e = 1 + stat / 100 + percent / 100;
  const a = cls.role === "hybrid" ? 0.6 : cls.role === "magic" ? 0.21 : 1;
  const n = Math.round(stat / 3);
  const lvl = Math.round(level * a);
  const one = (w) => Math.round(w * e + lvl * e - ((w + lvl) / 100) * n);
  return [one(weaponMin), one(weaponMax)];
}

function magicAttack(cls, level, attrs, weaponMagic, percent = 0) {
  const a = 1 + attrs.int / 100 + percent / 100;
  const e = cls.role === "hybrid" ? 0.6 : cls.role === "phys" ? 0.0095 : 1;
  return Math.round(a * weaponMagic) + Math.round(Math.round(level * e) * a + Math.round(attrs.int / 1720));
}

export function computeStats({ cls: code, level, attrs, reputation = 0, equipment = {}, effects = [], effectSettings = {}, effectCatalog, titles = {} }) {
  if (!Object.hasOwn(CLASSES, code)) throw new Error(`Неизвестный класс: ${code}`);
  const cls = CLASSES[code];
  const lvl = clampLevel(level);
  if (!attrs || typeof attrs !== "object") throw new Error("Неверные характеристики персонажа");
  for (const key of ATTRS) {
    if (!Number.isInteger(attrs[key]) || attrs[key] < BASE_ATTR) throw new Error(`Неверное значение ${key}`);
  }
  const free = totalPoints(lvl) - spentPoints(attrs);
  if (free < 0) throw new Error("Распределено больше очков, чем доступно");
  if (!equipment || typeof equipment !== "object" || Array.isArray(equipment)) throw new Error("Неверные данные экипировки");
  if (!Array.isArray(effects) || effects.length > 1000 || effects.some((id) => !Number.isSafeInteger(id) || id < 1)) throw new Error("Неверный список эффектов");
  const safeEffectSettings = validateEffectSettings(effectSettings);
  const titleBonuses = validateTitles(titles);
  const eligibility = resolveEquipment({ cls: code, className: cls.name, level: lvl, reputation, attrs, equipment });
  const gearWarnings = [...eligibility.warnings];
  const flat = {};
  const weapon = { phys_atk: [0, 0], mag_atk: [0, 0] };
  let atkSpeed = 1.25;
  const knownSlots = new Set(SLOTS.map((s) => s.id));
  for (const [slot, entry] of Object.entries(equipment)) {
    if (entry == null) continue;
    if (!knownSlots.has(slot)) throw new Error(`Неизвестная ячейка экипировки: ${slot}`);
    if (!entry.item || !itemFitsSlot(entry.item, slot)) throw new Error(`Предмет не подходит в ячейку ${slot}`);
    const bonus = getItemBonuses(entry, slot);
    gearWarnings.push(...bonus.warnings);
    if (!eligibility.status[slot].usable) continue;
    for (const [key, value] of Object.entries(bonus.flat)) flat[key] = (flat[key] ?? 0) + value;
    for (const key of ["phys_atk", "mag_atk"]) for (let i = 0; i < 2; i++) weapon[key][i] += bonus.ranges[key][i];
    if (bonus.atkSpeed !== undefined) atkSpeed = bonus.atkSpeed;
  }
  // sd.vq складывает ручные титулы с характеристиками снаряжения до формул.
  for (const [key, value] of Object.entries(titleBonuses)) {
    if (key === "phys_atk" || key === "mag_atk") for (let i = 0; i < 2; i++) weapon[key][i] += value;
    else flat[key] = (flat[key] ?? 0) + value;
  }
  const effectiveAttrs = Object.fromEntries(ATTRS.map((key) => [key, attrs[key] + (flat[key] ?? 0)]));
  if (Object.values(effectiveAttrs).some((n) => n < 0)) throw new Error("Итоговая характеристика не может быть отрицательной");
  let ib = {};
  const hasActiveEffects = effects.length > 0 || Object.values(safeEffectSettings).some((saved) => saved.activeStates.length > 0);
  if (hasActiveEffects && !Array.isArray(effectCatalog)) gearWarnings.push(`Выбранные эффекты пока не учтены: каталог эффектов не загружен.`);
  else if (hasActiveEffects) {
    const result = collectEffects(effects, safeEffectSettings, effectCatalog, { hasWeapon: Boolean(eligibility.activeEquipment.weapon?.item), cls: code });
    ib = result.modifiers;
    gearWarnings.push(...result.warnings);
  }
  const mod = (key) => ib[key] ?? 0;
  const integerMod = (key) => Math.trunc(mod(key));
  const attr = effectiveAttrs;
  const physicalGear = flat.phys_def ?? 0;
  const physDef = mod("va") >= 1000 ? 0 : Math.max(0, defense(physicalGear, attr.vit, attr.str, [1, 2, 4, 1, 3, 25, 100]) + sourceRound(physicalGear / 100 * (integerMod("tb") + integerMod("od") - integerMod("va"))));
  const elementCodes = { metal: "lw", wood: "mo", water: "dn", fire: "vt", earth: "sp" };
  const elements = Object.fromEntries(Object.entries(elementCodes).map(([key, elementCode]) => {
    const gear = (flat.mag_def ?? 0) + (flat[`def_${key}`] ?? 0);
    return [key, Math.max(0, defense(gear, attr.vit, attr.int, [0, 2, 4, 1, 3, 25, 100]) + sourceRound(gear / 100 * (integerMod("xk") + integerMod("og") - integerMod("pt") + mod(`gs_${elementCode}_gq_eg`) - mod(`vh_${elementCode}_gq_eg`))))];
  }));
  const magDef = Math.round(Object.values(elements).reduce((sum, n) => sum + n, 0) / 5);
  const magAtkRange = weapon.mag_atk.map((n) => magicAttack(cls, lvl, attr, n + mod("gs_xq"), mod("sq") - mod("so")));
  const baseHp = cls.hp * attr.vit + 2 * cls.hp * (lvl - 1) + (flat.hp ?? 0) + mod("zk");
  const baseMp = cls.mp * attr.int + 2 * cls.mp * (lvl - 1) + (flat.mp ?? 0);
  const defenseLevelBeforeSkill = (flat.defense_level ?? 0) + mod("gs_sx") - mod("vh_sx");
  const defenseLevel = defenseLevelBeforeSkill - (mod("vh_sx_min_20_eg") ? Math.max(20, sourceRound(defenseLevelBeforeSkill / 100 * mod("vh_sx_min_20_eg"))) : 0);
  const attackFromDefense = mod("gs_ad_from_sx_eg") ? sourceRound(Math.max(20, sourceRound(defenseLevelBeforeSkill / 100 * 40)) / 100 * mod("gs_ad_from_sx_eg")) : 0;
  if (mod("wh") || mod("gn")) {
    const weaponInterval = Number((1 / atkSpeed).toFixed(2));
    const interval = 0.05 * sourceRound(weaponInterval * (1 - (mod("wh") - mod("gn")) / 100) / 0.05);
    atkSpeed = Math.min(5, Math.max(0, Number((1 / interval).toFixed(2))));
  }
  return {
    level: lvl,
    free,
    effectiveAttrs,
    gearWarnings,
    equipmentStatus: eligibility.status,
    activeEquipment: eligibility.activeEquipment,
    hp: sourceRound(baseHp * (1 + (mod("fw") - mod("eh")) / 100)),
    mp: sourceRound(baseMp * (1 + (mod("vd") - mod("ef")) / 100)),
    physAtk: physicalAttack(cls, lvl, attr, weapon.phys_atk[0] + mod("gs_oi_av"), weapon.phys_atk[1] + mod("gs_oi_av"), mod("yh") - mod("xp")),
    magAtk: magAtkRange[0],
    magAtkRange,
    crit: Math.min(100, Math.max(0, 1 + Math.floor(attr.dex / 20) + (flat.crit ?? 0) + Math.trunc(mod("jk")))),
    critDamage: 200 + (flat.crit_damage ?? 0) + Math.trunc(mod("gs_crit_rage_ghk")),
    atkSpeed,
    attackRange: flat.range ?? 0,
    castTime: Math.max(-100, (flat.cast_time ?? 0) - mod("re") + mod("xj")),
    accuracy: sourceRound((cls.acc * attr.dex + (flat.accuracy ?? 0) + Math.trunc(mod("gs_ae"))) * (1 + (mod("bx") - mod("yr")) / 100)),
    evasion: sourceRound((cls.eva * attr.dex + (flat.evasion ?? 0)) * (1 + (mod("br") - mod("na")) / 100)),
    speed: Number(Math.min(15, (cls.speed + mod("gs_cl")) * (1 + (mod("ln") - mod("la")) / 100) + (flat.speed ?? 0)).toFixed(1)),
    physDef,
    physDefPct: defensePercent(physDef, lvl),
    magDef,
    magDefPct: defensePercent(magDef, lvl),
    elements,
    attackLevel: (flat.attack_level ?? 0) + mod("gs_ad") - mod("vh_ad") + attackFromDefense,
    defenseLevel,
    spirit: (50 + lvl) * lvl + (flat.spirit ?? 0),
    stealth: (flat.stealth ?? 0) + (mod("uu") ? lvl + mod("uu") : 0),
    detection: lvl + (flat.detection ?? 0) + mod("uu_detect"),
  };
}
