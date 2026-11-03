// Only active equipment is passed here. Each reached set threshold is granted once.
import { getItemBonuses, itemFitsSlot, SLOTS } from "./equipment.js?v=20261103-bonuses";

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const SLOT_IDS = new Set(SLOTS.map(({ id }) => id));

function definition(raw) {
  if (!isRecord(raw) || typeof raw.name !== "string" || !raw.name.trim()) throw new Error("Комплект: отсутствует название");
  const members = raw.members;
  if (!Array.isArray(members) || members.length < 2 || members.some((id) => !Number.isSafeInteger(id) || id <= 0)
      || new Set(members).size !== members.length) throw new Error("Комплект: неверные или повторные ID частей");
  const sorted = [...members].sort((a, b) => a - b);
  const id = `146:${sorted.join("-")}`;
  if (raw.id !== id) throw new Error("Комплект: ID не соответствует частям");
  if (!Array.isArray(raw.bonuses) || !raw.bonuses.length) throw new Error("Комплект: нет числовых порогов");
  const thresholds = new Set();
  const bonuses = raw.bonuses.map((bonus) => {
    if (!isRecord(bonus) || !Number.isSafeInteger(bonus.pieces) || bonus.pieces < 1 || bonus.pieces > members.length
        || thresholds.has(bonus.pieces)) throw new Error("Комплект: неверный или повторный порог");
    thresholds.add(bonus.pieces);
    if (!Array.isArray(bonus.texts) || !bonus.texts.length || bonus.texts.some((text) => typeof text !== "string"
        || !text.trim() || text.length > 500 || /[\u0000-\u001f\u007f]/u.test(text))
        || new Set(bonus.texts).size !== bonus.texts.length) throw new Error("Комплект: неверное описание бонуса");
    return { pieces: bonus.pieces, texts: [...bonus.texts].sort() };
  }).sort((a, b) => a.pieces - b.pieces);
  return { id, name: raw.name.trim(), members: sorted, bonuses };
}

export function resolveSetBonuses(equipment = {}) {
  if (!isRecord(equipment)) throw new Error("Комплект: неверные данные активной экипировки");
  if (Object.keys(equipment).some((slot) => !SLOT_IDS.has(slot))) throw new Error("Комплект: неизвестная ячейка");
  const groups = new Map();
  for (const { id: slot } of SLOTS) {
    const entry = equipment[slot];
    if (entry == null) continue;
    const item = entry.item;
    if (!item || !itemFitsSlot(item, slot)) throw new Error(`Комплект: предмет не подходит в ячейку ${slot}`);
    if (item.set_bonus == null) continue;
    const set = definition(item.set_bonus);
    if (!set.members.includes(item.id)) throw new Error(`Комплект: предмет ${item.id ?? "без ID"} отсутствует среди частей`);
    const signature = JSON.stringify(set);
    const existing = groups.get(set.id);
    if (existing && existing.signature !== signature) throw new Error(`Комплект ${set.name}: противоречивые определения частей`);
    if (existing) existing.count++;
    else groups.set(set.id, { set, signature, count: 1 });
  }
  const flat = {}, ranges = { phys_atk: [0, 0], mag_atk: [0, 0] }, sources = [], warnings = [], sets = [];
  for (const [, { set, count }] of [...groups].sort(([left], [right]) => left.localeCompare(right, "en"))) {
    const thresholds = [];
    for (const bonus of set.bonuses) {
      const active = count >= bonus.pieces;
      const label = `${set.name} · ${bonus.pieces} ч. (${count}/${set.members.length})`;
      // Share the exact item-property parser, including aliases, units and unknowns.
      const parsed = getItemBonuses({ item: { name: label, slot: "tome", addons: {
        count: bonus.texts.length, unique: bonus.texts.map((text) => ({ text, chance: 100 })),
      } } }, "tome");
      sources.push({ label, kind: "set", active,
        reason: active ? "" : `Для бонуса нужно ${bonus.pieces} активных частей; сейчас ${count}.`,
        entries: [
          ...parsed.contributions.map((entry) => ({ label: entry.label, stat: entry.stat, value: entry.value, percent: entry.percent })),
          ...parsed.unresolved.map((entry) => ({ label: `${entry.label}: ${entry.reason}`, stat: "unknown", value: null, percent: false })),
        ] });
      thresholds.push({ pieces: bonus.pieces, texts: [...bonus.texts], active });
      if (!active) continue;
      for (const [key, value] of Object.entries(parsed.flat)) flat[key] = (flat[key] ?? 0) + value;
      for (const key of ["phys_atk", "mag_atk"]) for (let i = 0; i < 2; i++) ranges[key][i] += parsed.ranges[key][i];
      warnings.push(...parsed.warnings);
    }
    sets.push({ id: set.id, name: set.name, count, bonuses: thresholds });
  }
  return { flat, ranges, sources, warnings: [...new Set(warnings)], sets };
}
