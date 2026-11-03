// Расчёт характеристик персонажа. Базовые формулы взяты с mypers.ru и
// сверены с его выводом; соответствие игре Comeback 1.4.6 ещё не подтверждено.
import { getItemBonuses, itemFitsSlot, SLOTS } from "./equipment.js?v=20261103-bonuses";
import { collectEffects, sourceRound, validateEffectSettings } from "./effects.js?v=20261103-bonuses";
import { resolveEquipment } from "./eligibility.js?v=20261103-bonuses";
import { resolveSetBonuses } from "./sets.js?v=20261103-bonuses";
import { explanationSources, itemExplanationSources, recordStage, statExplanation, statExplanationTitle } from "./stat-explanations.js?v=20261103-bonuses";

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
function defense(gear, primary, secondary, e, stages) {
  const intrinsic = recordStage(stages, "Защита от характеристик", `round((${primary} + ${secondary} − ${e[1]}) / ${e[2]})`, Math.round((primary + secondary - e[1]) / e[2]));
  const attributeFactor = recordStage(stages, "Округлённый вклад характеристик в множитель", `round((${e[1]} × ${primary} + ${e[4]} × ${secondary}) / ${e[5]})`, Math.round((e[1] * primary + e[4] * secondary) / e[5]));
  const factor = recordStage(stages, "Множитель защиты снаряжения", `${e[3]} + ${attributeFactor} / ${e[6]}`, e[3] + attributeFactor / e[6]);
  const scaledGear = recordStage(stages, "Защита снаряжения после округления", `round(${gear} × ${factor})`, Math.round(gear * factor));
  return recordStage(stages, "Защита до эффектов", `${intrinsic} + ${scaledGear} + ${e[0]}`, intrinsic + scaledGear + e[0]);
}

export function defensePercent(value, level) {
  return Math.min(95, Math.max(0, (100 * value) / (40 * level + value - 25)));
}

function physicalAttack(cls, level, attrs, weaponMin, weaponMax, percent, stages, attribute = "str") {
  const stat = attrs[attribute];
  const label = attribute === "dex" ? "ловкости" : "силы";
  const e = recordStage(stages, `Множитель ${label} и эффектов`, `1 + ${stat} / 100 + ${percent} / 100`, 1 + stat / 100 + percent / 100);
  const a = cls.role === "hybrid" ? 0.6 : cls.role === "magic" ? 0.21 : 1;
  const n = recordStage(stages, `Округлённая поправка ${label}`, `round(${stat} / 3)`, Math.round(stat / 3));
  const lvl = recordStage(stages, "Вклад уровня с коэффициентом класса", `round(${level} × ${a})`, Math.round(level * a));
  const one = (w) => w * e + lvl * e - ((w + lvl) / 100) * n;
  const raw = recordStage(stages, "Атака до окончательного округления", `[${weaponMin}; ${weaponMax}] × ${e} + ${lvl} × ${e} − (([${weaponMin}; ${weaponMax}] + ${lvl}) / 100) × ${n}`, [one(weaponMin), one(weaponMax)]);
  return recordStage(stages, "Физическая атака", `round([${raw.join("; ")}])`, raw.map((value) => Math.round(value)));
}

function magicAttack(cls, level, attrs, weaponMagic, percent, stages) {
  const a = recordStage(stages, "Множитель интеллекта и эффектов", `1 + ${attrs.int} / 100 + ${percent} / 100`, 1 + attrs.int / 100 + percent / 100);
  const e = cls.role === "hybrid" ? 0.6 : cls.role === "phys" ? 0.0095 : 1;
  const scaledWeapon = recordStage(stages, "Округлённая атака снаряжения", `round(${a} × [${weaponMagic.join("; ")}])`, weaponMagic.map((value) => Math.round(a * value)));
  const roundedLevel = recordStage(stages, "Вклад уровня с коэффициентом класса", `round(${level} × ${e})`, Math.round(level * e));
  const intCorrection = recordStage(stages, "Округлённая поправка интеллекта", `round(${attrs.int} / 1720)`, Math.round(attrs.int / 1720));
  const scaledLevel = recordStage(stages, "Округлённая атака от уровня", `round(${roundedLevel} × ${a} + ${intCorrection})`, Math.round(roundedLevel * a + intCorrection));
  return recordStage(stages, "Магическая атака", `[${scaledWeapon.join("; ")}] + ${scaledLevel}`, scaledWeapon.map((value) => value + scaledLevel));
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
  const gearSources = [];
  const flat = {};
  const weapon = { phys_atk: [0, 0], mag_atk: [0, 0] };
  let atkSpeed = 1.25;
  const knownSlots = new Set(SLOTS.map((s) => s.id));
  for (const [slot, entry] of Object.entries(equipment)) {
    if (entry == null) continue;
    if (!knownSlots.has(slot)) throw new Error(`Неизвестная ячейка экипировки: ${slot}`);
    if (!entry.item || !itemFitsSlot(entry.item, slot)) throw new Error(`Предмет не подходит в ячейку ${slot}`);
    const bonus = getItemBonuses(entry, slot);
    if (slot === "ammo" && eligibility.status[slot].usable
        && eligibility.activeEquipment.weapon?.item?.type !== "Оружие дальнего боя") {
      const omitted = bonus.contributions.filter((part) => part.source === "base" && part.stat === "phys_atk");
      if (omitted.length) {
        const reason = "Базовая атака боеприпаса действует только с активным дальнобойным оружием.";
        gearSources.push(...itemExplanationSources(entry, { contributions: omitted }, { usable: false, reasons: [reason] }));
        for (const part of omitted) for (let i = 0; i < 2; i++) bonus.ranges.phys_atk[i] -= part.value[i];
        bonus.contributions = bonus.contributions.filter((part) => !omitted.includes(part));
        bonus.warnings.push(`${entry.item.name || "Боеприпасы"}: ${reason}`);
      }
    }
    gearWarnings.push(...bonus.warnings);
    gearSources.push(...itemExplanationSources(entry, bonus, eligibility.status[slot]));
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
  const setBonuses = resolveSetBonuses(eligibility.activeEquipment);
  for (const [key, value] of Object.entries(setBonuses.flat)) flat[key] = (flat[key] ?? 0) + value;
  for (const key of ["phys_atk", "mag_atk"]) for (let i = 0; i < 2; i++) weapon[key][i] += setBonuses.ranges[key][i];
  gearSources.push(...setBonuses.sources);
  gearWarnings.push(...setBonuses.warnings);
  const effectiveAttrs = Object.fromEntries(ATTRS.map((key) => [key, attrs[key] + (flat[key] ?? 0)]));
  if (Object.values(effectiveAttrs).some((n) => n < 0)) throw new Error("Итоговая характеристика не может быть отрицательной");
  let ib = {}, effectSources = [];
  const hasActiveEffects = effects.length > 0 || Object.values(safeEffectSettings).some((saved) => saved.activeStates.length > 0);
  if (hasActiveEffects && !Array.isArray(effectCatalog)) {
    const reason = "Выбранные эффекты пока не учтены: каталог эффектов не загружен.";
    gearWarnings.push(reason);
    effectSources.push({ label: "Выбранные эффекты", kind: "effect", active: false, reason,
      entries: [{ label: "Влияние неизвестно без каталога", stat: "unknown", value: null, percent: false }] });
  }
  else if (hasActiveEffects) {
    const result = collectEffects(effects, safeEffectSettings, effectCatalog, { hasWeapon: Boolean(eligibility.activeEquipment.weapon?.item), cls: code });
    ib = result.modifiers;
    effectSources = result.contributions;
    gearWarnings.push(...result.warnings);
  }
  const mod = (key) => ib[key] ?? 0;
  const integerMod = (key) => Math.trunc(mod(key));
  const attr = effectiveAttrs;
  const traces = Object.fromEntries(["hp", "physAtk", "magAtkRange", "physDef", "metal", "wood", "water", "fire", "earth", "magDef"].map((key) => [key, []]));
  const physicalGear = flat.phys_def ?? 0;
  const physicalStages = traces.physDef;
  recordStage(physicalStages, "Итоговая выносливость", "Собственная выносливость + бонусы активных вещей", attr.vit);
  recordStage(physicalStages, "Итоговая сила", "Собственная сила + бонусы активных вещей", attr.str);
  recordStage(physicalStages, "Защита снаряжения и титулов", "Сумма физической защиты активных вещей, камней, свойств и титулов", physicalGear);
  let physDef;
  if (mod("va") >= 1000) physDef = recordStage(physicalStages, "Физическая защита", `Условие обнуления: уменьшение ${mod("va")} ≥ 1000`, 0);
  else {
    const baseDefense = defense(physicalGear, attr.vit, attr.str, [1, 2, 4, 1, 3, 25, 100], physicalStages);
    const percent = recordStage(physicalStages, "Процент вещей и эффектов после отсечения дробей", `trunc(${flat.phys_def_percent ?? 0}) + trunc(${mod("tb")}) + trunc(${mod("od")}) − trunc(${mod("va")})`, Math.trunc(flat.phys_def_percent ?? 0) + integerMod("tb") + integerMod("od") - integerMod("va"));
    const adjustment = recordStage(physicalStages, "Поправка эффектов к защите", `sourceRound(${physicalGear} / 100 × ${percent})`, sourceRound(physicalGear / 100 * percent));
    const beforeClamp = recordStage(physicalStages, "Защита до ограничения", `${baseDefense} + ${adjustment}`, baseDefense + adjustment);
    physDef = recordStage(physicalStages, "Физическая защита", `max(0, ${beforeClamp})`, Math.max(0, beforeClamp));
  }
  const elementCodes = { metal: "lw", wood: "mo", water: "dn", fire: "vt", earth: "sp" };
  const elements = Object.fromEntries(Object.entries(elementCodes).map(([key, elementCode]) => {
    const gear = (flat.mag_def ?? 0) + (flat[`def_${key}`] ?? 0);
    const stages = traces[key];
    recordStage(stages, "Итоговая выносливость", "Собственная выносливость + бонусы активных вещей", attr.vit);
    recordStage(stages, "Итоговый интеллект", "Собственный интеллект + бонусы активных вещей", attr.int);
    recordStage(stages, "Защита снаряжения и титулов", `${flat.mag_def ?? 0} общей магзащиты + ${flat[`def_${key}`] ?? 0} защиты стихии`, gear);
    const baseDefense = defense(gear, attr.vit, attr.int, [0, 2, 4, 1, 3, 25, 100], stages);
    const percent = recordStage(stages, "Процент вещей и эффектов защиты", `trunc(${flat.mag_def_percent ?? 0}) + trunc(${mod("xk")}) + trunc(${mod("og")}) − trunc(${mod("pt")}) + ${mod(`gs_${elementCode}_gq_eg`)} − ${mod(`vh_${elementCode}_gq_eg`)}`, Math.trunc(flat.mag_def_percent ?? 0) + integerMod("xk") + integerMod("og") - integerMod("pt") + mod(`gs_${elementCode}_gq_eg`) - mod(`vh_${elementCode}_gq_eg`));
    const adjustment = recordStage(stages, "Поправка эффектов к защите", `sourceRound(${gear} / 100 × ${percent})`, sourceRound(gear / 100 * percent));
    const beforeClamp = recordStage(stages, "Защита до ограничения", `${baseDefense} + ${adjustment}`, baseDefense + adjustment);
    return [key, recordStage(stages, "Защита стихии", `max(0, ${beforeClamp})`, Math.max(0, beforeClamp))];
  }));
  for (const [key, value] of Object.entries(elements)) recordStage(traces.magDef, statExplanationTitle(key), "Итог отдельного расчёта этой стихии", value);
  const magDef = recordStage(traces.magDef, "Средняя магическая защита", `round((${Object.values(elements).join(" + ")}) / 5)`, Math.round(Object.values(elements).reduce((sum, n) => sum + n, 0) / 5));
  recordStage(traces.magAtkRange, "Итоговый интеллект", "Собственный интеллект + бонусы активных вещей", attr.int);
  recordStage(traces.magAtkRange, "Снаряжение и титулы", "Сумма магической атаки активных вещей, заточки, камней, свойств и титулов", weapon.mag_atk);
  const magicWeapon = recordStage(traces.magAtkRange, "Атака снаряжения с плоскими эффектами", `[${weapon.mag_atk.join("; ")}] + ${mod("gs_xq")}`, weapon.mag_atk.map((n) => n + mod("gs_xq")));
  const magicPercent = recordStage(traces.magAtkRange, "Процент эффектов атаки", `${mod("sq")} − ${mod("so")}`, mod("sq") - mod("so"));
  const magAtkRange = magicAttack(cls, lvl, attr, magicWeapon, magicPercent, traces.magAtkRange);
  recordStage(traces.hp, "Итоговая выносливость", "Собственная выносливость + бонусы активных вещей", attr.vit);
  const vitalityHp = recordStage(traces.hp, "Здоровье от выносливости", `${cls.hp} × ${attr.vit}`, cls.hp * attr.vit);
  const levelHp = recordStage(traces.hp, "Здоровье от уровня", `2 × ${cls.hp} × (${lvl} − 1)`, 2 * cls.hp * (lvl - 1));
  recordStage(traces.hp, "Здоровье снаряжения и титулов", "Сумма здоровья активных вещей, заточки, камней, свойств и титулов", flat.hp ?? 0);
  const baseHp = recordStage(traces.hp, "Здоровье до процентных эффектов", `${vitalityHp} + ${levelHp} + ${flat.hp ?? 0} + ${mod("zk")}`, vitalityHp + levelHp + (flat.hp ?? 0) + mod("zk"));
  const hpMultiplier = recordStage(traces.hp, "Множитель вещей и эффектов здоровья", `1 + (trunc(${flat.hp_percent ?? 0}) + ${mod("fw")} − ${mod("eh")}) / 100`, 1 + (Math.trunc(flat.hp_percent ?? 0) + mod("fw") - mod("eh")) / 100);
  const rawHp = recordStage(traces.hp, "Здоровье до округления", `${baseHp} × ${hpMultiplier}`, baseHp * hpMultiplier);
  const hp = recordStage(traces.hp, "Здоровье", `sourceRound(${rawHp})`, sourceRound(rawHp));
  const physicalAttribute = ["Оружие дальнего боя", "Кинжалы"].includes(eligibility.activeEquipment.weapon?.item?.type) ? "dex" : "str";
  recordStage(traces.physAtk, physicalAttribute === "dex" ? "Итоговая ловкость" : "Итоговая сила", "Собственная характеристика + бонусы активных вещей и комплектов", attr[physicalAttribute]);
  recordStage(traces.physAtk, "Снаряжение и титулы", "Сумма физической атаки активных вещей, заточки, камней, свойств и титулов", weapon.phys_atk);
  const physicalWeapon = recordStage(traces.physAtk, "Атака снаряжения с плоскими эффектами", `[${weapon.phys_atk.join("; ")}] + ${mod("gs_oi_av")}`, weapon.phys_atk.map((value) => value + mod("gs_oi_av")));
  const physicalPercent = recordStage(traces.physAtk, "Процент эффектов атаки", `${mod("yh")} − ${mod("xp")}`, mod("yh") - mod("xp"));
  const physAtk = physicalAttack(cls, lvl, attr, physicalWeapon[0], physicalWeapon[1], physicalPercent, traces.physAtk, physicalAttribute);
  const baseMp = cls.mp * attr.int + 2 * cls.mp * (lvl - 1) + (flat.mp ?? 0);
  const defenseLevelBeforeSkill = (flat.defense_level ?? 0) + mod("gs_sx") - mod("vh_sx");
  const defenseLevel = defenseLevelBeforeSkill - (mod("vh_sx_min_20_eg") ? Math.max(20, sourceRound(defenseLevelBeforeSkill / 100 * mod("vh_sx_min_20_eg"))) : 0);
  const attackFromDefense = mod("gs_ad_from_sx_eg") ? sourceRound(Math.max(20, sourceRound(defenseLevelBeforeSkill / 100 * 40)) / 100 * mod("gs_ad_from_sx_eg")) : 0;
  if (flat.attack_interval || mod("wh") || mod("gn")) {
    const weaponInterval = Number((1 / atkSpeed).toFixed(2));
    const equipmentInterval = (flat.attack_interval ?? 0) <= -weaponInterval ? 0.2 : weaponInterval + (flat.attack_interval ?? 0);
    const interval = 0.05 * sourceRound(equipmentInterval * (1 - (mod("wh") - mod("gn")) / 100) / 0.05);
    atkSpeed = Math.min(5, Math.max(0, Number((1 / interval).toFixed(2))));
  }
  const sources = explanationSources(attrs, gearSources, titleBonuses, effectSources);
  const values = { hp, physAtk, magAtkRange, physDef, ...elements, magDef };
  const explanations = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, statExplanation(key, value, traces[key], sources, gearWarnings, { physicalAttribute })]));
  return {
    level: lvl,
    free,
    effectiveAttrs,
    gearWarnings,
    equipmentStatus: eligibility.status,
    activeEquipment: eligibility.activeEquipment,
    hp,
    mp: sourceRound(baseMp * (1 + (Math.trunc(flat.mp_percent ?? 0) + mod("vd") - mod("ef")) / 100)),
    physAtk,
    magAtk: magAtkRange[0],
    magAtkRange,
    crit: Math.min(100, Math.max(0, 1 + Math.floor(attr.dex / 20) + (flat.crit ?? 0) + Math.trunc(mod("jk")))),
    critDamage: 200 + (flat.crit_damage ?? 0) + Math.trunc(mod("gs_crit_rage_ghk")),
    atkSpeed,
    attackRange: flat.range ?? 0,
    castTime: Math.trunc(Math.max(-100, (flat.cast_time ?? 0) - mod("re") + mod("xj"))) || 0,
    accuracy: sourceRound((cls.acc * attr.dex + (flat.accuracy ?? 0) + Math.trunc(mod("gs_ae"))) * (1 + ((flat.accuracy_percent ?? 0) + mod("bx") - mod("yr")) / 100)),
    evasion: sourceRound((cls.eva * attr.dex + (flat.evasion ?? 0)) * (1 + ((flat.evasion_percent ?? 0) + mod("br") - mod("na")) / 100)),
    speed: Number(Math.min(15, (cls.speed + mod("gs_cl")) * (1 + ((flat.speed_percent ?? 0) + mod("ln") - mod("la")) / 100) + (flat.speed ?? 0)).toFixed(1)),
    physDef,
    physDefPct: defensePercent(physDef, lvl),
    magDef,
    magDefPct: defensePercent(magDef, lvl),
    elements,
    attackLevel: (flat.attack_level ?? 0) + mod("gs_ad") - mod("vh_ad") + attackFromDefense,
    defenseLevel,
    damageReductionPhys: Math.trunc(flat.damage_reduction_phys ?? 0),
    damageReductionMag: Math.trunc(flat.damage_reduction_mag ?? 0),
    extraBonuses: { ...flat },
    equipmentSets: setBonuses.sets,
    spirit: (50 + lvl) * lvl + (flat.spirit ?? 0),
    stealth: (flat.stealth ?? 0) + (mod("uu") ? lvl + mod("uu") : 0),
    detection: lvl + (flat.detection ?? 0) + mod("uu_detect"),
    explanations,
  };
}
