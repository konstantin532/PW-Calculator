// Каталог хранит исходные значения Comeback. Неизвестные подписи не угадываем.
export const SLOTS = [
  { id: "helmet", name: "Шлем", side: "left" },
  { id: "necklace", name: "Ожерелье", side: "left" },
  { id: "cape", name: "Накидка", side: "left" },
  { id: "chest", name: "Доспех", side: "left" },
  { id: "wrists", name: "Наручи", side: "left" },
  { id: "belt", name: "Пояс", side: "right" },
  { id: "legs", name: "Поножи", side: "right" },
  { id: "boots", name: "Обувь", side: "right" },
  { id: "ring1", name: "Кольцо", side: "right" },
  { id: "ring2", name: "Кольцо", side: "right" },
  { id: "weapon", name: "Оружие", side: "bottom" },
  { id: "ammo", name: "Снаряды", side: "bottom" },
  { id: "tome", name: "Трактат", side: "bottom" },
  { id: "flight", name: "Полёт", side: "bottom" },
];

const SLOT_IDS = new Set(SLOTS.map((s) => s.id));
const normalize = (s) => String(s).toLowerCase().replaceAll("ё", "е").replaceAll(".", "").replace(/\s+/g, " ").trim();
const TYPE_SLOTS = new Map(Object.entries({
  шлем: "helmet", шапка: "helmet", "головной убор": "helmet", ожерелье: "necklace",
  накидка: "cape", плащ: "cape", верх: "chest", нагрудник: "chest", наручи: "wrists",
  пояс: "belt", низ: "legs", поножи: "legs", обувь: "boots", сапоги: "boots", кольцо: "ring",
  оружие: "weapon", боеприпасы: "ammo", снаряды: "ammo", стрелы: "ammo", болты: "ammo", патроны: "ammo",
  трактат: "tome", "небесная книга": "tome", полет: "flight", "летательные устройства": "flight",
}));

export function itemFitsSlot(item, slotId) {
  if (!item || typeof item !== "object" || !SLOT_IDS.has(slotId)) return false;
  const wanted = slotId === "ring1" || slotId === "ring2" ? "ring" : slotId;
  if (item.slot) return item.slot === wanted || item.slot === slotId;
  const type = TYPE_SLOTS.get(normalize(item.type ?? ""));
  if (type) return type === wanted;
  const labels = [item.subtype, ...(Array.isArray(item.breadcrumb) ? [...item.breadcrumb].reverse() : []), item.list_kind, item.section];
  for (const label of labels) {
    const found = TYPE_SLOTS.get(normalize(label ?? ""));
    if (found) return found === wanted;
  }
  return false;
}

export const SUPPORTED_STATS = ["vit", "int", "str", "dex", "hp", "mp", "phys_atk", "mag_atk", "phys_def", "mag_def",
  "def_metal", "def_wood", "def_water", "def_fire", "def_earth", "accuracy", "evasion", "crit", "crit_damage", "speed",
  "cast_time", "attack_level", "defense_level", "spirit", "stealth", "detection", "range", "atk_speed"];
const STAT_KEYS = new Set(SUPPORTED_STATS);
const LABELS = new Map(Object.entries({
  сила: "str", ловкость: "dex", интеллект: "int", магия: "int", телосложение: "vit", выносливость: "vit",
  здоровье: "hp", "максимум здоровья": "hp", "максимальный запас здоровья": "hp",
  мана: "mp", "магическая энергия": "mp", "уровень магической энергии": "mp", "максимальный запас маны": "mp",
  "физ атака": "phys_atk", "физическая атака": "phys_atk", "маг атака": "mag_atk", "магическая атака": "mag_atk",
  защита: "phys_def", "физ защита": "phys_def", "физическая защита": "phys_def",
  "маг защита": "mag_def", "магическая защита": "mag_def",
  "защита от металла": "def_metal", "защита от дерева": "def_wood", "защита от воды": "def_water",
  "защита от огня": "def_fire", "защита от земли": "def_earth",
  меткость: "accuracy", "точность попадания": "accuracy", уклонение: "evasion", "шанс крит удара": "crit",
  "вероятность критического удара": "crit", "шанс критического удара": "crit", "критический урон": "crit_damage",
  скорость: "speed", "скорость передвижения": "speed", "время подготовки": "cast_time", "время пения": "cast_time", пение: "cast_time",
  "показатель атаки": "attack_level", "уровень атаки": "attack_level", "показатель защиты": "defense_level", "уровень защиты": "defense_level",
  "сила духа": "spirit", скрытность: "stealth", обнаружение: "detection", дальность: "range",
}));
const PERCENT_POINTS = new Set(["crit", "crit_damage", "cast_time"]);
const isRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export function availableAddonTexts(item) {
  return ["options", "unique"].flatMap((key) => Array.isArray(item?.addons?.[key]) ? item.addons[key].map((a) => a.text).filter((t) => typeof t === "string") : []);
}

const STONE_TARGETS = {
  weapon: "weapon", helmet: "armor", cape: "armor", chest: "armor", wrists: "armor", legs: "armor", boots: "armor",
  necklace: "decoration", belt: "decoration", ring1: "decoration", ring2: "decoration",
};

// count — общий предел выбранных дополнений. Источник не подтверждает,
// что unique можно прибавлять сверх этого числа; неизвестный предел равен 0.
export function maximumAddons(item) {
  const count = item?.addons?.count;
  if (typeof count !== "string" && typeof count !== "number") return 0;
  const match = /^(\d+)(?:\s*[~–—-]\s*(\d+))?$/.exec(String(count).trim());
  if (!match || (match[2] !== undefined && Number(match[2]) < Number(match[1]))) return 0;
  return Math.min(20, Number(match[2] ?? match[1]));
}

function resolveSlot(item, slotId) {
  return slotId ?? SLOTS.find((slot) => itemFitsSlot(item, slot.id))?.id;
}

// Используем только подтверждённые варианты создания/дропа с шансом > 0.
// Отсутствие данных о ячейках не означает возможность вставить 4 камня.
export function maxSockets(item, slotId) {
  const slot = resolveSlot(item, slotId);
  if (!STONE_TARGETS[slot] || !itemFitsSlot(item, slot)) return 0;
  let maximum = 0;
  for (const source of ["craft", "drop"]) {
    const capacities = item?.sockets?.[source];
    if (!isRecord(capacities)) continue;
    for (const [key, chance] of Object.entries(capacities)) {
      if (!/^[0-4]$/.test(key) || typeof chance !== "number" || !Number.isFinite(chance) || chance <= 0) continue;
      maximum = Math.max(maximum, Number(key));
    }
  }
  return maximum;
}

export function validateEquipmentChoice(entry, slotId) {
  if (!isRecord(entry) || !isRecord(entry.item)) throw new Error("Неверные данные предмета экипировки");
  const refine = entry.refine ?? 0;
  if (!Number.isInteger(refine) || refine < 0 || refine > 12) throw new Error("Уровень заточки должен быть целым числом от 0 до 12");
  const stones = entry.stones ?? [];
  if (!Array.isArray(stones) || stones.length > 4 || stones.some((s) => !isRecord(s))) throw new Error("Допускается до четырёх камней на предмет");
  const addons = entry.addons ?? [];
  if (!Array.isArray(addons) || addons.length > 20 || addons.some((a) => typeof a !== "string" || a.length > 500)) throw new Error("Неверные выбранные бонусы предмета");
  const offered = availableAddonTexts(entry.item);
  if (addons.some((a) => !offered.includes(a))) throw new Error("Выбранный бонус отсутствует в каталоге предмета");
  const maximum = maximumAddons(entry.item);
  if (addons.length > maximum) throw new Error(`Для предмета подтверждено не больше ${maximum} выбранных бонусов (общий предел options и unique)`);
  const capacity = maxSockets(entry.item, slotId);
  if (stones.length > capacity) throw new Error(`Для предмета подтверждено ячеек для камней: ${capacity}`);
  const target = STONE_TARGETS[resolveSlot(entry.item, slotId)];
  for (const stone of stones) {
    if (!target || !isRecord(stone.effects?.[target])) throw new Error(`Камень ${stone.name || stone.id || "без названия"} не подходит: нет эффекта для этой ячейки`);
    if (Number.isFinite(entry.item.grade) && Number.isFinite(stone.grade) && stone.grade > entry.item.grade) throw new Error(`Ранг камня ${stone.grade} выше ранга предмета ${entry.item.grade}`);
  }
  return { item: entry.item, refine, stones, addons };
}

// Возвращает только однозначные численные прибавки. Проценты HP/защиты и
// условные эффекты требуют отдельно подтверждённых игровых правил.
export function getItemBonuses(entry, slotId) {
  const { item, refine, stones, addons } = validateEquipmentChoice(entry, slotId);
  const flat = {};
  const ranges = { phys_atk: [0, 0], mag_atk: [0, 0] };
  const warnings = [];
  const prefix = item.name || `Предмет ${item.id ?? ""}`;
  let atkSpeed;
  const warn = (message) => warnings.push(`${prefix}: ${message}`);
  function add(key, value, percent = false, raw = key) {
    if (!STAT_KEYS.has(key) || (percent && !PERCENT_POINTS.has(key))) {
      warn(`не учтён эффект «${raw}»`); return;
    }
    const range = Array.isArray(value);
    if (range && (value.length !== 2 || !["phys_atk", "mag_atk"].includes(key) || value[0] > value[1])) throw new Error(`${prefix}: неверный диапазон характеристик ${key}`);
    const numbers = range ? value : [value];
    if (numbers.some((n) => typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 1e9)) throw new Error(`${prefix}: неверное значение характеристик ${key}`);
    if (key === "atk_speed") {
      if (slotId === "weapon" && value > 0 && value <= 5) atkSpeed = value;
      else warn(`скорость атаки ${value}: единицы источника не подтверждены`);
    } else if (key === "phys_atk" || key === "mag_atk") {
      ranges[key][0] += range ? value[0] : value;
      ranges[key][1] += range ? value[1] : value;
    } else flat[key] = (flat[key] ?? 0) + value;
  }
  function addLabeled(label, value, percent = false, raw = label) {
    const key = LABELS.get(normalize(label));
    if (!key || value === null || value === undefined) { warn(`не учтён эффект «${raw}»`); return; }
    add(key, value, percent, raw);
  }
  if (!isRecord(item.stats ?? {})) throw new Error(`${prefix}: неверные данные характеристик`);
  for (const [key, value] of Object.entries(item.stats ?? {})) add(key, value);
  if (refine > 0) {
    const value = item.refine?.levels?.[refine - 1];
    if (typeof value === "number") addLabeled(item.refine.stat, value);
    else warn(`нет подтверждённого значения заточки +${refine}`);
  }
  for (const text of addons) {
    const m = /^(.+?)\s*([+-]\s*\d+(?:[.,]\d+)?)\s*(%|ед\.?)?\s*$/u.exec(text);
    if (m) addLabeled(m[1], Number(m[2].replaceAll(" ", "").replace(",", ".")), m[3] === "%", text);
    else warn(`не учтён выбранный бонус «${text}»`);
  }
  const target = STONE_TARGETS[slotId];
  for (const stone of stones) {
    const effect = stone.effects[target];
    addLabeled(effect.stat, effect.value, effect.percent === true, effect.raw ?? effect.stat);
  }
  for (const label of Object.keys(item.specs_extra ?? {})) warn(`не учтена характеристика «${label}»`);
  if (Array.isArray(item.set) && item.set.length) warn("бонус комплекта не рассчитан");
  return { flat, ranges, atkSpeed, warnings };
}
