import { getItemBonuses, itemFitsSlot, SLOTS } from "./equipment.js?v=20261103-explanations";
import { getRequiredReputation, validateReputation } from "./reputation.js?v=20261103-explanations";

const ATTR_LABELS = { vit: "Выносливость", int: "Интеллект", str: "Сила", dex: "Ловкость" };
const ATTRS = Object.keys(ATTR_LABELS);
const SLOT_IDS = new Set(SLOTS.map((slot) => slot.id));
const normalize = (value) => String(value).toLocaleLowerCase("ru-RU").replaceAll("ё", "е").trim();
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const CLASS_LABELS = { by: "Воин", ga: "Маг", ya: "Оборотень", rl: "Друид", js: "Лучник",
  ij: "Жрец", rg: "Мистик", ej: "Страж", sj: "Шаман", fx: "Убийца" };
const classLabel = (value) => CLASS_LABELS[value] ?? Object.values(CLASS_LABELS).find((label) => normalize(label) === normalize(value));

function requirementsFor(item, context, attrs) {
  const requirements = [], reasons = [];
  const add = (key, label, required, current, met) => {
    requirements.push({ key, label, required, current, met });
    if (!met) reasons.push(`${label}: требуется ${required}, доступно ${current}.`);
  };
  if (item.level !== undefined && item.level !== null) {
    const valid = Number.isSafeInteger(item.level) && item.level >= 0;
    add("level", "Требуемый уровень", valid ? item.level : "неизвестно", context.level, valid && context.level >= item.level);
  }
  if (item.classes !== undefined && item.classes !== null) {
    const valid = Array.isArray(item.classes) && item.classes.every((value) => typeof value === "string");
    if (!valid || item.classes.length) {
      const matches = valid && item.classes.some((value) => [context.cls, context.className].some((name) => name && normalize(name) === normalize(value)));
      const allowed = valid ? [...new Set(item.classes.map(classLabel).filter(Boolean))] : [];
      if (allowed.length < Object.keys(CLASS_LABELS).length) {
        add("class", "Класс", allowed.join(", ") || "не подтверждён", context.className ?? context.cls, matches);
      }
    }
  }
  const requiredReputation = getRequiredReputation(item);
  if (requiredReputation === null || requiredReputation > 0) {
    add("reputation", "Репутация", requiredReputation ?? "неизвестно", context.reputation,
      requiredReputation !== null && context.reputation >= requiredReputation);
  }
  if (!isRecord(item.req ?? {})) {
    reasons.push("Требования характеристик не распознаны.");
  } else {
    for (const [key, value] of Object.entries(item.req ?? {})) {
      const valid = ATTRS.includes(key) && Number.isSafeInteger(value) && value >= 0;
      add(key, ATTR_LABELS[key] ?? key, valid ? value : "неизвестно", attrs[key] ?? "неизвестно", valid && attrs[key] >= value);
    }
  }
  return { usable: reasons.length === 0, reasons, requirements };
}

/** Activate eligible selected items without self-support or circular grants. */
export function resolveEquipment({ cls, level, reputation = 0, attrs, equipment = {} }) {
  if (!Object.hasOwn(CLASS_LABELS, cls)) throw new Error(`Неизвестный класс персонажа: ${cls}`);
  const context = { cls, className: CLASS_LABELS[cls], level, reputation: validateReputation(reputation) };
  if (!Number.isSafeInteger(level) || level < 0) throw new Error("Неверный уровень для проверки экипировки");
  if (!isRecord(attrs) || ATTRS.some((key) => !Number.isFinite(attrs[key]) || attrs[key] < 0)) throw new Error("Неверные характеристики для проверки экипировки");
  if (!isRecord(equipment)) throw new Error("Неверные данные экипировки");
  for (const [slot, entry] of Object.entries(equipment)) {
    if (!SLOT_IDS.has(slot)) throw new Error(`Неизвестная ячейка экипировки: ${slot}`);
    if (entry != null && (!entry.item || !itemFitsSlot(entry.item, slot))) throw new Error(`Предмет не подходит в ячейку ${slot}`);
  }
  // SLOTS makes requirement context independent of the input object's insertion order.
  const selected = SLOTS.filter(({ id }) => equipment[id] != null).map(({ id }) => [id, equipment[id]]);
  const bonuses = new Map(selected.map(([slot, entry]) => [slot, getItemBonuses(entry, slot)]));
  const active = new Set();
  const attributes = (slots, excluded) => {
    const result = Object.fromEntries(ATTRS.map((key) => [key, attrs[key]]));
    for (const slot of slots) {
      if (slot === excluded) continue;
      for (const key of ATTRS) result[key] += bonuses.get(slot).flat[key] ?? 0;
    }
    return result;
  };
  const conflict = (slot) => {
    const proposed = new Set([...active, slot]);
    if (Object.values(attributes(proposed)).some((value) => value < 0)) return "Бонусы предмета делают основную характеристику отрицательной.";
    for (const other of active) {
      if (!requirementsFor(equipment[other].item, context, attributes(proposed, other)).usable) {
        return "Бонусы предмета нарушают требования другой активной вещи.";
      }
    }
    return null;
  };
  // Only active gear can support another item's requirements. Repeated passes
  // resolve valid chains; mutually dependent items cannot start themselves.
  let changed;
  do {
    changed = false;
    for (const [slot, entry] of selected) {
      if (active.has(slot)) continue;
      if (requirementsFor(entry.item, context, attributes(active)).usable && !conflict(slot)) {
        active.add(slot);
        changed = true;
      }
    }
  } while (changed);

  const status = {}, activeEquipment = {}, warnings = [];
  for (const [slot, entry] of selected) {
    const resolved = requirementsFor(entry.item, context, attributes(active, slot));
    if (active.has(slot)) activeEquipment[slot] = entry;
    else if (resolved.usable) resolved.reasons.push(conflict(slot) ?? "Требования цепочки экипировки не выполнены.");
    status[slot] = { ...resolved, usable: active.has(slot) };
    for (const reason of resolved.reasons) warnings.push(`${entry.item.name || `Предмет ${entry.item.id ?? ""}`}: ${reason}`);
  }
  return { activeEquipment, status, warnings };
}
