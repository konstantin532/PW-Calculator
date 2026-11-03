import { ammoWeaponGradeRange, getItemBonuses, itemFitsSlot, SLOTS } from "./equipment.js?v=20261103-bonuses";
import { getRequiredReputation, validateReputation } from "./reputation.js?v=20261103-bonuses";
import { sourceRound } from "./effects.js?v=20261103-bonuses";
import { resolveSetBonuses } from "./sets.js?v=20261103-bonuses";

const ATTR_LABELS = { vit: "Выносливость", int: "Интеллект", str: "Сила", dex: "Ловкость" };
const ATTRS = Object.keys(ATTR_LABELS);
const SLOT_IDS = new Set(SLOTS.map((slot) => slot.id));
const normalize = (value) => String(value).toLocaleLowerCase("ru-RU").replaceAll("ё", "е").trim();
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const CLASS_LABELS = { by: "Воин", ga: "Маг", ya: "Оборотень", rl: "Друид", js: "Лучник",
  ij: "Жрец", rg: "Мистик", ej: "Страж", sj: "Шаман", fx: "Убийца" };
const classLabel = (value) => CLASS_LABELS[value] ?? Object.values(CLASS_LABELS).find((label) => normalize(label) === normalize(value));

function requirementsFor(item, context, attrs, reduction = 0, activeWeapon = null) {
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
      const required = valid ? Math.max(0, value - sourceRound(value / 100 * reduction)) : "неизвестно";
      add(key, ATTR_LABELS[key] ?? key, required, attrs[key] ?? "неизвестно", valid && attrs[key] >= required);
    }
  }
  if (itemFitsSlot(item, "ammo")) {
    const range = ammoWeaponGradeRange(item);
    const grade = activeWeapon?.grade;
    const validGrade = Number.isSafeInteger(grade) && grade >= 0;
    add("weapon_grade", "Ранг активного оружия", range ? `${range.min}–${range.max}` : "неизвестно",
      activeWeapon ? validGrade ? grade : "неизвестно" : "нет активного оружия",
      Boolean(range && activeWeapon && validGrade && grade >= range.min && grade <= range.max));
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
  // sd.jw: only this item's ct modifiers alter its requirements, even before
  // activation. Each percentage is truncated before the sum; attributes from
  // the item itself still cannot satisfy those reduced requirements.
  const reductions = new Map(selected.map(([slot]) => [slot, Math.min(100, Math.max(0,
    bonuses.get(slot).contributions.filter((entry) => entry.stat === "requirement_reduction")
      .reduce((sum, entry) => sum + Math.trunc(-entry.value), 0)))]));
  const checkRequirements = (slot, availableAttrs, activeSlots) => requirementsFor(equipment[slot].item, context, availableAttrs, reductions.get(slot),
    activeSlots.has("weapon") ? equipment.weapon.item : null);
  const active = new Set();
  const setAttributes = new Map();
  const attributes = (slots, excluded) => {
    const result = Object.fromEntries(ATTRS.map((key) => [key, attrs[key]]));
    const included = selected.filter(([slot]) => slots.has(slot) && slot !== excluded);
    for (const slot of slots) {
      if (slot === excluded) continue;
      for (const key of ATTRS) result[key] += bonuses.get(slot).flat[key] ?? 0;
    }
    // The excluded item's membership cannot complete a set that qualifies
    // itself. Other already-active parts may qualify the next item.
    const signature = included.map(([slot]) => slot).join("|");
    if (!setAttributes.has(signature)) setAttributes.set(signature, resolveSetBonuses(Object.fromEntries(included)).flat);
    const setFlat = setAttributes.get(signature);
    for (const key of ATTRS) result[key] += setFlat[key] ?? 0;
    return result;
  };
  const conflict = (slot) => {
    const proposed = new Set([...active, slot]);
    if (Object.values(attributes(proposed)).some((value) => value < 0)) return "Бонусы предмета делают основную характеристику отрицательной.";
    for (const other of active) {
      if (!checkRequirements(other, attributes(proposed, other), proposed).usable) {
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
      if (checkRequirements(slot, attributes(active), active).usable && !conflict(slot)) {
        active.add(slot);
        changed = true;
      }
    }
  } while (changed);

  const status = {}, activeEquipment = {}, warnings = [];
  for (const [slot, entry] of selected) {
    const resolved = checkRequirements(slot, attributes(active, slot), active);
    if (active.has(slot)) activeEquipment[slot] = entry;
    else if (resolved.usable) resolved.reasons.push(conflict(slot) ?? "Требования цепочки экипировки не выполнены.");
    status[slot] = { ...resolved, usable: active.has(slot) };
    for (const reason of resolved.reasons) warnings.push(`${entry.item.name || `Предмет ${entry.item.id ?? ""}`}: ${reason}`);
  }
  return { activeEquipment, status, warnings };
}
