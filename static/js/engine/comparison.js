import { CLASSES, MAX_LEVEL } from "./stats.js?v=20261103-explanations";

export const STATE_MESSAGE = "pwcalc:comparison-state";
export const APPLY_MESSAGE = "pwcalc:comparison-apply";
const MAX_BUILD_BYTES = 1024 * 1024;
const MAX_HASH_BYTES = 12000;
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value) => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
const rangeKeys = new Set(["physAtk", "magAtkRange"]);
const classNames = new Set(Object.values(CLASSES).map((entry) => entry.name));

export const COMPARISON_METRICS = Object.freeze([
  { key: "hp", label: "Здоровье", unit: "", better: "higher" },
  { key: "mp", label: "Магическая энергия", unit: "", better: "higher" },
  { key: "physAtk", label: "Физическая атака", unit: "", better: "higher" },
  { key: "magAtkRange", label: "Магическая атака", unit: "", better: "higher" },
  { key: "physDef", label: "Физическая защита", unit: "", better: "higher" },
  { key: "magDef", label: "Магическая защита", unit: "", better: "higher" },
  { key: "crit", label: "Шанс критического удара", unit: "%", better: "higher" },
  { key: "atkSpeed", label: "Атак в секунду", unit: "уд/сек", better: "higher" },
  { key: "castTime", label: "Время пения", unit: "%", better: "lower" },
  { key: "attackLevel", label: "Показатель атаки", unit: "", better: "higher" },
  { key: "defenseLevel", label: "Показатель защиты", unit: "", better: "higher" },
  { key: "speed", label: "Скорость", unit: "м/сек", better: "higher" },
].map(Object.freeze));

export function isComparisonSnapshot(value) {
  return isRecord(value) && typeof value.name === "string" && value.name.length <= 120
    && classNames.has(value.className) && Number.isInteger(value.level) && value.level >= 1 && value.level <= MAX_LEVEL
    && isRecord(value.metrics) && Object.keys(value.metrics).length === COMPARISON_METRICS.length
    && COMPARISON_METRICS.every(({ key }) => {
      const metric = value.metrics[key];
      return rangeKeys.has(key)
        ? Array.isArray(metric) && metric.length === 2 && metric.every(finite) && metric[0] <= metric[1]
        : finite(metric);
    });
}

export function createComparisonSnapshot(state, stats) {
  const snapshot = {
    name: state.name || "Без имени", className: CLASSES[state.cls]?.name, level: stats.level,
    metrics: Object.fromEntries(COMPARISON_METRICS.map(({ key }) => [key, rangeKeys.has(key) ? [...stats[key]] : stats[key]])),
  };
  if (!isComparisonSnapshot(snapshot)) throw new Error("Неверные показатели для сравнения персонажей");
  return snapshot;
}

export function compareSnapshots(left, right) {
  if (!isComparisonSnapshot(left) || !isComparisonSnapshot(right)) throw new Error("Неверные показатели для сравнения персонажей");
  const difference = (a, b) => Number((b - a).toFixed(8)) || 0;
  const copy = (value) => Array.isArray(value) ? [...value] : value;
  return COMPARISON_METRICS.map((metric) => {
    const a = left.metrics[metric.key], b = right.metrics[metric.key];
    const delta = rangeKeys.has(metric.key) ? a.map((value, index) => difference(value, b[index])) : difference(a, b);
    const signs = (Array.isArray(delta) ? delta : [delta]).map((value) => Math.sign(value) * (metric.better === "lower" ? -1 : 1));
    const trend = signs.every((sign) => sign === 0) ? "equal"
      : signs.every((sign) => sign >= 0) ? "better" : signs.every((sign) => sign <= 0) ? "worse" : "mixed";
    return { key: metric.key, label: metric.label, unit: metric.unit, left: copy(a), right: copy(b), delta, trend };
  });
}

export function isComparisonBuild(value) {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_BUILD_BYTES
    && new TextEncoder().encode(value).length <= MAX_BUILD_BYTES;
}

export function encodeBuildHash(json) {
  if (typeof json !== "string" || !json.length) throw new Error("Нет сборки для сравнения");
  const bytes = new TextEncoder().encode(json);
  if (bytes.length > MAX_HASH_BYTES) throw new Error("Сборка слишком велика для ссылки. Скачайте её в файл и загрузите в нужный калькулятор.");
  const encoded = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return `#build=${encoded}`;
}

export function comparisonUrl(json) { return `/compare/${encodeBuildHash(json)}`; }
