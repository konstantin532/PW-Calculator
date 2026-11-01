// Расчёт характеристик персонажа. Базовые формулы взяты с mypers.ru и
// сверены с его выводом; соответствие игре Comeback 1.4.6 ещё не подтверждено.
import { getItemBonuses, itemFitsSlot, SLOTS } from "./equipment.js";

export const MAX_LEVEL = 105;
export const BASE_ATTR = 5;
export const POINTS_PER_LEVEL = 5;
export const ATTRS = ["vit", "int", "str", "dex"];

const WARRIOR = { hp: 15, mp: 9, speed: 5.0, acc: 10, eva: 10, role: "phys" };
const CASTER = { hp: 10, mp: 14, speed: 4.8, acc: 5, eva: 2, role: "magic" };
const AGILE = { hp: 13, mp: 11, speed: 5.2, acc: 8, eva: 6, role: "phys" };

export const CLASSES = {
  by: { name: "Воин", ...WARRIOR },
  ej: { name: "Страж", ...WARRIOR },
  ga: { name: "Маг", ...CASTER },
  ij: { name: "Жрец", ...CASTER },
  sj: { name: "Шаман", ...CASTER },
  he: { name: "Жнец", ...CASTER },
  rg: { name: "Мистик", ...CASTER, acc: 8, eva: 6 },
  ya: { name: "Оборотень", hp: 17, mp: 7, speed: 4.9, acc: 8, eva: 8, role: "phys" },
  rl: { name: "Друид", hp: 12, mp: 12, speed: 5.1, acc: 7, eva: 6, role: "hybrid" },
  js: { name: "Лучник", ...AGILE },
  fx: { name: "Убийца", ...AGILE },
  uf: { name: "Призрак", ...AGILE },
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

function physicalAttack(cls, level, attrs, weaponMin, weaponMax) {
  const stat = attrs.str;
  const e = 1 + stat / 100;
  const a = cls.role === "hybrid" ? 0.6 : cls.role === "magic" ? 0.21 : 1;
  const n = Math.round(stat / 3);
  const lvl = Math.round(level * a);
  const one = (w) => Math.round(w * e + lvl * e - ((w + lvl) / 100) * n);
  return [one(weaponMin), one(weaponMax)];
}

function magicAttack(cls, level, attrs, weaponMagic) {
  const a = 1 + attrs.int / 100;
  const e = cls.role === "hybrid" ? 0.6 : cls.role === "phys" ? 0.0095 : 1;
  return Math.round(a * weaponMagic) + Math.round(Math.round(level * e) * a + Math.round(attrs.int / 1720));
}

export function computeStats({ cls: code, level, attrs, equipment = {}, effects = [] }) {
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
  if (!Array.isArray(effects) || effects.length > 1000) throw new Error("Неверный список эффектов");
  const gearWarnings = [];
  const flat = {};
  const weapon = { phys_atk: [0, 0], mag_atk: [0, 0] };
  let atkSpeed = 1.25;
  const knownSlots = new Set(SLOTS.map((s) => s.id));
  const entries = [];
  for (const [slot, entry] of Object.entries(equipment)) {
    if (entry == null) continue;
    if (!knownSlots.has(slot)) throw new Error(`Неизвестная ячейка экипировки: ${slot}`);
    if (!entry.item || !itemFitsSlot(entry.item, slot)) throw new Error(`Предмет не подходит в ячейку ${slot}`);
    const bonus = getItemBonuses(entry, slot);
    gearWarnings.push(...bonus.warnings);
    for (const [key, value] of Object.entries(bonus.flat)) flat[key] = (flat[key] ?? 0) + value;
    for (const key of ["phys_atk", "mag_atk"]) for (let i = 0; i < 2; i++) weapon[key][i] += bonus.ranges[key][i];
    if (bonus.atkSpeed !== undefined) atkSpeed = bonus.atkSpeed;
    entries.push(entry);
  }
  const effectiveAttrs = Object.fromEntries(ATTRS.map((key) => [key, attrs[key] + (flat[key] ?? 0)]));
  if (Object.values(effectiveAttrs).some((n) => n < 0)) throw new Error("Итоговая характеристика не может быть отрицательной");
  for (const { item } of entries) {
    const prefix = item.name || `Предмет ${item.id ?? ""}`;
    if (item.level > lvl) gearWarnings.push(`${prefix}: требуется уровень ${item.level}`);
    if (Array.isArray(item.classes) && item.classes.length && !item.classes.some((c) => c === code || String(c).toLowerCase() === cls.name.toLowerCase())) gearWarnings.push(`${prefix}: не подходит выбранный класс`);
    for (const [key, value] of Object.entries(item.req ?? {})) {
      if (!ATTRS.includes(key) || typeof value !== "number" || !Number.isFinite(value)) gearWarnings.push(`${prefix}: не распознано требование ${key}`);
      else if (effectiveAttrs[key] < value) gearWarnings.push(`${prefix}: требуется ${key} ${value}`);
    }
  }
  if (effects.length) gearWarnings.push(`Выбрано эффектов: ${effects.length}. Их влияние на характеристики Comeback 1.4.6 пока не подтверждено и не учтено.`);
  const attr = effectiveAttrs;
  const physDef = defense(flat.phys_def ?? 0, attr.vit, attr.str, [1, 2, 4, 1, 3, 25, 100]);
  const elements = Object.fromEntries(["metal", "wood", "water", "fire", "earth"].map((key) => [key,
    defense((flat.mag_def ?? 0) + (flat[`def_${key}`] ?? 0), attr.vit, attr.int, [0, 2, 4, 1, 3, 25, 100])]));
  const magDef = Math.round(Object.values(elements).reduce((sum, n) => sum + n, 0) / 5);
  const magAtkRange = weapon.mag_atk.map((n) => magicAttack(cls, lvl, attr, n));
  return {
    level: lvl,
    free,
    effectiveAttrs,
    gearWarnings,
    hp: cls.hp * attr.vit + 2 * cls.hp * (lvl - 1) + (flat.hp ?? 0),
    mp: cls.mp * attr.int + 2 * cls.mp * (lvl - 1) + (flat.mp ?? 0),
    physAtk: physicalAttack(cls, lvl, attr, ...weapon.phys_atk),
    magAtk: magAtkRange[0],
    magAtkRange,
    crit: Math.min(100, Math.max(0, 1 + Math.floor(attr.dex / 20) + (flat.crit ?? 0))),
    critDamage: 200 + (flat.crit_damage ?? 0),
    atkSpeed,
    attackRange: flat.range ?? 0,
    castTime: flat.cast_time ?? 0,
    accuracy: cls.acc * attr.dex + (flat.accuracy ?? 0),
    evasion: cls.eva * attr.dex + (flat.evasion ?? 0),
    speed: cls.speed + (flat.speed ?? 0),
    physDef,
    physDefPct: defensePercent(physDef, lvl),
    magDef,
    magDefPct: defensePercent(magDef, lvl),
    elements,
    attackLevel: flat.attack_level ?? 0,
    defenseLevel: flat.defense_level ?? 0,
    spirit: (50 + lvl) * lvl + (flat.spirit ?? 0),
    stealth: flat.stealth ?? 0,
    detection: lvl + (flat.detection ?? 0),
  };
}
