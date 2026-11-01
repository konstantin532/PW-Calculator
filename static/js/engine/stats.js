// Расчёт характеристик персонажа без экипировки. Формулы взяты с mypers.ru и
// сверены с его выводом; соответствие игре Comeback 1.4.6 ещё не подтверждено.

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

export function computeStats({ cls: code, level, attrs }) {
  const cls = CLASSES[code];
  if (!cls) throw new Error(`Неизвестный класс: ${code}`);
  const lvl = clampLevel(level);
  for (const key of ATTRS) {
    if (!Number.isInteger(attrs[key]) || attrs[key] < BASE_ATTR) throw new Error(`Неверное значение ${key}`);
  }
  const free = totalPoints(lvl) - spentPoints(attrs);
  if (free < 0) throw new Error("Распределено больше очков, чем доступно");
  const physDef = defense(0, attrs.vit, attrs.str, [1, 2, 4, 1, 3, 25, 100]);
  const magDef = defense(0, attrs.vit, attrs.int, [0, 2, 4, 1, 3, 25, 100]);
  return {
    level: lvl,
    free,
    hp: cls.hp * attrs.vit + 2 * cls.hp * (lvl - 1),
    mp: cls.mp * attrs.int + 2 * cls.mp * (lvl - 1),
    physAtk: physicalAttack(cls, lvl, attrs, 0, 0),
    magAtk: magicAttack(cls, lvl, attrs, 0),
    crit: Math.min(100, 1 + Math.floor(attrs.dex / 20)),
    critDamage: 200,
    atkSpeed: 1.25,
    castTime: 0,
    accuracy: cls.acc * attrs.dex,
    evasion: cls.eva * attrs.dex,
    speed: cls.speed,
    physDef,
    physDefPct: defensePercent(physDef, lvl),
    magDef,
    magDefPct: defensePercent(magDef, lvl),
    elements: { metal: magDef, wood: magDef, water: magDef, fire: magDef, earth: magDef },
    attackLevel: 0,
    defenseLevel: 0,
    spirit: (50 + lvl) * lvl,
    stealth: 0,
    detection: lvl,
  };
}
