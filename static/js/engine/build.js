import { ATTRS, BASE_ATTR, CLASSES, MAX_LEVEL, spentPoints, totalPoints, validateTitles } from "./stats.js";
import { itemFitsSlot, SLOTS, validateEquipmentChoice } from "./equipment.js";
import { validateEffectSettings } from "./effects.js";

const MAX_BYTES = 1024 * 1024;
const SLOT_IDS = new Set(SLOTS.map((slot) => slot.id));
const isRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const validId = (id) => Number.isSafeInteger(id) && id > 0;

function validateCharacter(data) {
  if (!isRecord(data)) throw new Error("Файл должен содержать объект сборки");
  if (data.version !== 1) throw new Error("Неподдерживаемая версия сборки");
  if (!Object.hasOwn(CLASSES, data.cls)) throw new Error("Неизвестный класс персонажа");
  if (!Number.isInteger(data.level) || data.level < 1 || data.level > MAX_LEVEL) throw new Error(`Уровень должен быть от 1 до ${MAX_LEVEL}`);
  if (!isRecord(data.attrs) || ATTRS.some((k) => !Number.isInteger(data.attrs[k]) || data.attrs[k] < BASE_ATTR)) throw new Error("Неверные основные характеристики");
  if (spentPoints(data.attrs) > totalPoints(data.level)) throw new Error("Распределено больше очков, чем доступно на этом уровне");
  if (data.name !== undefined && (typeof data.name !== "string" || data.name.length > 120)) throw new Error("Имя должно содержать не больше 120 символов");
  if (data.gender !== undefined && !["male", "female"].includes(data.gender)) throw new Error("Неизвестный внешний вид персонажа");
  const effects = data.effects ?? [];
  if (!Array.isArray(effects) || effects.length > 1000 || effects.some((id) => !validId(id))) throw new Error("Неверные IDs выбранных эффектов");
  const addedEffects = data.addedEffects ?? [];
  const hiddenEffects = data.hiddenEffects ?? [];
  for (const ids of [addedEffects, hiddenEffects]) if (!Array.isArray(ids) || ids.length > 1000 || ids.some((id) => !validId(id))) throw new Error("Неверные IDs добавленных или скрытых эффектов");
  const effectSettings = validateEffectSettings(data.effectSettings ?? {});
  const titles = validateTitles(data.titles ?? {});
  if (!isRecord(data.equipment ?? {})) throw new Error("Неверный список экипировки");
  return { version: 1, name: data.name ?? "", cls: data.cls, level: data.level,
    attrs: Object.fromEntries(ATTRS.map((k) => [k, data.attrs[k]])), equipment: {}, effects: [...new Set(effects)],
    effectSettings, titles, addedEffects: [...new Set(addedEffects)], hiddenEffects: [...new Set(hiddenEffects)], gender: data.gender ?? "male" };
}

function catalogMap(records, label) {
  if (!Array.isArray(records)) throw new Error(`Не загружен каталог ${label}`);
  return new Map(records.filter((r) => isRecord(r) && validId(r.id)).map((r) => [r.id, r]));
}

export function parseBuild(json, catalogItems = [], catalogStones = []) {
  if (typeof json !== "string" || new TextEncoder().encode(json).length > MAX_BYTES) throw new Error("Превышен размер файла сборки (1 МБ)");
  let data;
  try { data = JSON.parse(json); } catch { throw new Error("Не удалось прочитать JSON сборки"); }
  const state = validateCharacter(data);
  const items = catalogMap(catalogItems, "предметов");
  const stones = catalogMap(catalogStones, "камней");
  for (const [slot, saved] of Object.entries(data.equipment ?? {})) {
    if (!SLOT_IDS.has(slot)) throw new Error(`Неизвестная ячейка экипировки: ${slot}`);
    if (saved == null) continue;
    if (!isRecord(saved) || !validId(saved.itemId)) throw new Error(`Неверный ID предмета в ячейке ${slot}`);
    const item = items.get(saved.itemId);
    if (!item) throw new Error(`Предмет ${saved.itemId} отсутствует в каталоге Comeback 1.4.6`);
    if (!itemFitsSlot(item, slot)) throw new Error(`Предмет ${saved.itemId} не подходит в ячейку (слот) ${slot}`);
    const ids = saved.stones ?? [];
    if (!Array.isArray(ids) || ids.length > 4 || ids.some((id) => !validId(id))) throw new Error("Допускается до четырёх камней с целыми IDs");
    const selectedStones = ids.map((id) => {
      const stone = stones.get(id);
      if (!stone) throw new Error(`Камень ${id} отсутствует в каталоге Comeback 1.4.6`);
      return stone;
    });
    state.equipment[slot] = validateEquipmentChoice({ item, refine: saved.refine ?? 0, stones: selectedStones, addons: saved.addons ?? [] }, slot);
  }
  return state;
}

export function serializeBuild(state) {
  const compact = validateCharacter({ ...state, version: 1 });
  const items = [], stones = [];
  for (const [slot, entry] of Object.entries(state.equipment ?? {})) {
    if (!SLOT_IDS.has(slot)) throw new Error(`Неизвестная ячейка экипировки: ${slot}`);
    if (entry == null) continue;
    const choice = validateEquipmentChoice(entry, slot);
    if (!validId(choice.item.id) || choice.stones.some((s) => !validId(s.id))) throw new Error("У предмета или камня отсутствует целый ID");
    items.push(choice.item); stones.push(...choice.stones);
    compact.equipment[slot] = { itemId: choice.item.id, refine: choice.refine, stones: choice.stones.map((s) => s.id), addons: [...choice.addons] };
  }
  const json = JSON.stringify(compact);
  parseBuild(json, items, stones);
  return json;
}
