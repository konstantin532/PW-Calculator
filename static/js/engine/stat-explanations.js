// Представление уже выполненного расчёта: этот модуль не вычисляет статы.
const ATTR_LABELS = { vit: "Выносливость", int: "Интеллект", str: "Сила", dex: "Ловкость" };
const STAT_LABELS = { ...ATTR_LABELS, hp: "Здоровье", phys_atk: "Физическая атака", mag_atk: "Магическая атака", phys_def: "Физическая защита",
  mag_def: "Общая магическая защита", accuracy: "Меткость", evasion: "Уклонение", attack_level: "Показатель атаки", defense_level: "Показатель защиты" };
const PART_LABELS = { base: "Базовые свойства", refine: "Заточка", stone: "Камни", guaranteed: "Постоянные свойства", addon: "Выбранные свойства" };
const TITLES = { hp: "Здоровье", physAtk: "Физическая атака", magAtkRange: "Магическая атака", physDef: "Физическая защита",
  metal: "Защита от металла", wood: "Защита от дерева", water: "Защита от воды", fire: "Защита от огня", earth: "Защита от земли", magDef: "Средняя магическая защита" };
const RELEVANT = {
  hp: ["vit", "hp", "zk", "fw", "eh"], physAtk: ["str", "phys_atk", "gs_oi_av", "yh", "xp"],
  magAtkRange: ["int", "mag_atk", "gs_xq", "sq", "so"], physDef: ["vit", "str", "phys_def", "tb", "od", "va"],
};
const ELEMENT_CODES = { metal: "lw", wood: "mo", water: "dn", fire: "vt", earth: "sp" };
for (const [key, code] of Object.entries(ELEMENT_CODES)) RELEVANT[key] = ["vit", "int", "mag_def", `def_${key}`, "xk", "og", "pt", `gs_${code}_gq_eg`, `vh_${code}_gq_eg`];
RELEVANT.magDef = [...new Set(Object.keys(ELEMENT_CODES).flatMap((key) => RELEVANT[key]))];

export const statExplanationTitle = (key) => TITLES[key];

export function recordStage(stages, label, expression, value) {
  stages.push({ label, expression, value: Array.isArray(value) ? [...value] : value });
  return value;
}

export function itemExplanationSources(entry, bonus, status) {
  const groups = new Map();
  const group = (kind) => {
    if (!groups.has(kind)) groups.set(kind, { label: `${entry.item.name || `Предмет ${entry.item.id ?? ""}`} · ${PART_LABELS[kind] ?? kind}`,
      kind, active: status.usable, reason: status.usable ? "" : status.reasons.join(" "), entries: [] });
    return groups.get(kind);
  };
  for (const contribution of bonus.contributions ?? []) {
    group(contribution.source).entries.push({ label: contribution.label, stat: contribution.stat,
      value: contribution.value, percent: Boolean(contribution.percent) });
  }
  for (const unresolved of bonus.unresolved ?? []) group(unresolved.source).entries.push({
    label: `${unresolved.label}: ${unresolved.reason}`, stat: "unknown", value: null, percent: false,
  });
  return [...groups.values()];
}

export function explanationSources(attrs, equipmentSources, titles, effects) {
  const sources = [{ label: "Собственные характеристики персонажа", kind: "attributes", active: true, reason: "",
    entries: Object.entries(attrs).map(([stat, value]) => ({ label: ATTR_LABELS[stat] ?? stat, stat, value, percent: false })) }, ...equipmentSources];
  if (Object.keys(titles).length) sources.push({ label: "Ручные бонусы титулов", kind: "titles", active: true, reason: "",
    entries: Object.entries(titles).map(([stat, value]) => ({ label: STAT_LABELS[stat] ?? stat, stat, value, percent: false })) });
  return [...sources, ...effects];
}

export function statExplanation(key, result, stages, sources, warnings) {
  const relevant = new Set(RELEVANT[key]);
  return { key, title: TITLES[key], result, stages,
    sources: sources.map((source) => ({ ...source, entries: source.entries.filter((entry) => entry.value === null || relevant.has(entry.stat)) }))
      .filter((source) => source.entries.length),
    warnings: [...new Set(warnings)],
    note: "Стадии показывают порядок действительного расчёта. Источники уже включены в стадии: повторно складывать их не нужно. Базовые формулы перенесены из mypers; полная независимая сверка с игрой Comeback PW 1.4.6 пока не выполнена. round — округление до ближайшего целого; sourceRound — сначала до 8 знаков, затем до целого; trunc — отсечение дробной части; max — выбор большего значения." };
}
