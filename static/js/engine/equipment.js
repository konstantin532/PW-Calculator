// Каталог хранит исходные значения Comeback. Неизвестные подписи не угадываем.
import { getRequiredReputation } from "./reputation.js?v=20261103-bonuses";

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

/** Confirmed /db/146 ammo condition, in weapon grades rather than player level. */
export function ammoWeaponGradeRange(item) {
  if (!itemFitsSlot(item, "ammo")) return null;
  const text = item.specs_extra?.["Условия применения"];
  if (typeof text !== "string" || /[\u0000-\u001f\u007f]/u.test(text)) return null;
  const match = /^Уровень оружия\s+(\d+)\s*[-–—]\s*(\d+)$/iu.exec(text.trim());
  if (!match) return null;
  const min = Number(match[1]), max = Number(match[2]);
  return Number.isSafeInteger(min) && Number.isSafeInteger(max) && min >= 0 && max >= min ? { min, max } : null;
}

export const SUPPORTED_STATS = ["vit", "int", "str", "dex", "hp", "mp", "phys_atk", "mag_atk", "phys_def", "mag_def",
  "def_metal", "def_wood", "def_water", "def_fire", "def_earth", "accuracy", "evasion", "crit", "crit_damage", "speed",
  "cast_time", "attack_level", "defense_level", "spirit", "stealth", "detection", "range", "atk_speed",
  "hp_percent", "mp_percent", "phys_def_percent", "mag_def_percent", "accuracy_percent", "evasion_percent", "speed_percent", "attack_interval",
  "damage_reduction_phys", "damage_reduction_mag", "requirement_reduction", "hp_regen", "mp_regen", "experience_percent", "monster_slayer", "monster_guard",
  "weapon_damage_metal", "weapon_damage_wood", "weapon_damage_water", "weapon_damage_fire", "weapon_damage_earth"];
const STAT_KEYS = new Set(SUPPORTED_STATS);
const LABELS = new Map(Object.entries({
  сила: "str", ловкость: "dex", ловк: "dex", интеллект: "int", интл: "int", магия: "int", телосложение: "vit", телослож: "vit", тел: "vit", выносливость: "vit",
  здоровье: "hp", "максимум здоровья": "hp", "максимальный запас здоровья": "hp",
  hp: "hp", жс: "hp", "макс хп": "hp", "уровень жс": "hp", "уровень жизненной силы": "hp", "запас жизненной силы": "hp",
  мана: "mp", "магическая энергия": "mp", "уровень магической энергии": "mp", "максимальный запас маны": "mp",
  mp: "mp", мэ: "mp", "запас магической энергии": "mp",
  "физ атака": "phys_atk", "физическая атака": "phys_atk", "маг атака": "mag_atk", "магическая атака": "mag_atk",
  защита: "phys_def", "физ защита": "phys_def", "физическая защита": "phys_def",
  "маг защита": "mag_def", "магическая защита": "mag_def",
  "защита от металла": "def_metal", "защита от дерева": "def_wood", "защита от воды": "def_water",
  "защита от огня": "def_fire", "защита от земли": "def_earth",
  меткость: "accuracy", "точность попадания": "accuracy", уклонение: "evasion", уклон: "evasion", "шанс крит удара": "crit",
  "вероятность критического удара": "crit", "шанс критического удара": "crit", крит: "crit", "критический урон": "crit_damage",
  скорость: "speed", "скорость передвижения": "speed", "скорость движения": "speed", "скорость перемещения": "speed",
  "время подготовки": "cast_time", "время пения": "cast_time", "время активации": "cast_time", пение: "cast_time",
  "пауза между атаками": "attack_interval", "интервал атаки": "attack_interval", "задержка атаки": "attack_interval",
  "уменьшение физ урона": "damage_reduction_phys", "уменьшение физического урона": "damage_reduction_phys",
  "иммунитет к физическому урону": "damage_reduction_phys",
  "уменьшение урона от стихий": "damage_reduction_mag", требования: "requirement_reduction",
  "скор восст hp": "hp_regen", "hp скорость восстановления": "hp_regen", "скорость восстановления жс": "hp_regen", "восстановление жс": "hp_regen",
  "скор восст mp": "mp_regen", "mp скорость восстановления": "mp_regen", "скорость восстановления мэ": "mp_regen", "восстановление мэ": "mp_regen",
  опыт: "experience_percent", "урон монстрам": "monster_slayer", "защита от монстров": "monster_guard",
  "урон от металла": "weapon_damage_metal", "урон стихией металла": "weapon_damage_metal",
  "урон от дерева": "weapon_damage_wood", "урон стихией дерева": "weapon_damage_wood",
  "урон от воды": "weapon_damage_water", "урон стихией воды": "weapon_damage_water",
  "урон от огня": "weapon_damage_fire", "урон стихией огня": "weapon_damage_fire", "урон от земли": "weapon_damage_earth",
  "показатель атаки": "attack_level", "уровень атаки": "attack_level", "показатель защиты": "defense_level", "уровень защиты": "defense_level",
  "сила духа": "spirit", "показатель силы духа": "spirit", скрытность: "stealth", обнаружение: "detection", дальность: "range", "дальность атаки": "range",
}));
// /db/146/item/12647, /22, /32261, /32263: «макс» относится только
// к верхней границе атаки. Диапазон ролла выбирается отдельно в addons.
const MAX_ATTACK_LABELS = new Map(Object.entries({
  "макс физ атака": "phys_atk", "физическая атака макс": "phys_atk",
  "макс маг атака": "mag_atk", "магическая атака макс": "mag_atk",
}));
const STAT_LABELS = {
  vit: "Выносливость", int: "Интеллект", str: "Сила", dex: "Ловкость", hp: "Здоровье", mp: "Мана",
  phys_atk: "Физическая атака", mag_atk: "Магическая атака", phys_def: "Физическая защита", mag_def: "Магическая защита",
  def_metal: "Защита от металла", def_wood: "Защита от дерева", def_water: "Защита от воды", def_fire: "Защита от огня", def_earth: "Защита от земли",
  accuracy: "Меткость", evasion: "Уклонение", crit: "Шанс критического удара", crit_damage: "Критический урон",
  speed: "Скорость передвижения", cast_time: "Время пения", attack_level: "Показатель атаки", defense_level: "Показатель защиты",
  spirit: "Сила духа", stealth: "Скрытность", detection: "Обнаружение", range: "Дальность", atk_speed: "Скорость атаки",
  hp_percent: "Здоровье (%)", mp_percent: "Мана (%)", phys_def_percent: "Физическая защита (%)", mag_def_percent: "Магическая защита (%)",
  accuracy_percent: "Меткость (%)", evasion_percent: "Уклонение (%)", speed_percent: "Скорость передвижения (%)", attack_interval: "Интервал атаки (сек.)",
  damage_reduction_phys: "Уменьшение физического урона (%)", damage_reduction_mag: "Уменьшение урона от стихий (%)", requirement_reduction: "Снижение требований (%)",
  hp_regen: "Восстановление здоровья снаряжением", mp_regen: "Восстановление маны снаряжением", experience_percent: "Опыт (%)",
  monster_slayer: "Урон монстрам", monster_guard: "Защита от монстров",
  weapon_damage_metal: "Дополнительный урон оружия металлом", weapon_damage_wood: "Дополнительный урон оружия деревом",
  weapon_damage_water: "Дополнительный урон оружия водой", weapon_damage_fire: "Дополнительный урон оружия огнём", weapon_damage_earth: "Дополнительный урон оружия землёй",
};
// У процентов собственные ключи: 4% защиты не превращаются в 4 единицы.
const PERCENT_STATS = new Map(Object.entries({ hp: "hp_percent", mp: "mp_percent", phys_def: "phys_def_percent", mag_def: "mag_def_percent",
  accuracy: "accuracy_percent", evasion: "evasion_percent", speed: "speed_percent" }));
const SPECIAL_PERCENT_STATS = new Set(["damage_reduction_phys", "damage_reduction_mag", "requirement_reduction"]);
const PERCENT_ONLY_STATS = new Set([...SPECIAL_PERCENT_STATS, "experience_percent"]);
const PERCENT_POINTS = new Set(["crit", "crit_damage", "cast_time", ...PERCENT_STATS.values(), ...PERCENT_ONLY_STATS]);
const isRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export function fixedAddonSlots(item) {
  const data = item?.client_fixed_addons;
  if (data === undefined) return null;
  if (!isRecord(data) || typeof data.required !== "boolean" || !Array.isArray(data.slots) || data.slots.length > 32
      || data.slots.some((slot) => !isRecord(slot) || typeof slot.text !== "string" || !slot.text.trim() || slot.text.length > 500)) {
    throw new Error("Неверные фиксированные свойства клиента");
  }
  return data.slots;
}

function addonMeaning(option) {
  const label = normalize(option.label);
  const maximum = MAX_ATTACK_LABELS.get(label);
  let key = maximum ?? (option.percent && label === "удар" ? "accuracy_percent" : LABELS.get(label));
  if (option.percent && PERCENT_STATS.has(key)) key = PERCENT_STATS.get(key);
  return `${maximum ? "max:" : ""}${key ?? label}:${option.percent}`;
}

function completeFixedAddons(item, selected, slots) {
  if (!item.client_fixed_addons.required && selected.length === 0) return [];
  if (selected.length > slots.length) throw new Error("Число выбранных свойств превышает фиксированные свойства клиента");
  const templates = slots.map((slot) => slot.text);
  const options = templates.map(parseAddonText);
  const legacy = ["options", "unique"].flatMap((kind) => item.addons?.[kind] ?? []).map((entry) => parseAddonText(entry.text));
  const match = (text, index) => {
    if (text === templates[index]) return true;
    const value = parseAddonText(text), option = options[index];
    if (!value || !option || addonMeaning(value) !== addonMeaning(option)) return false;
    if (value.min !== value.max) return value.min === option.min && value.max === option.max;
    if (value.min >= option.min && value.max <= option.max) return true;
    // A formerly fixed scalar from the web source may use the wrong units.
    // Replace it only when there is one unambiguous fixed client counterpart.
    return option.min === option.max && options.filter((other) => other && addonMeaning(other) === addonMeaning(option)).length === 1
      && legacy.some((old) => old && old.min === old.max && old.min === value.min && addonMeaning(old) === addonMeaning(value));
  };
  const owners = Array(slots.length).fill(-1);
  const assign = (selectedIndex, visited) => {
    for (let index = 0; index < slots.length; index++) {
      if (visited.has(index) || !match(selected[selectedIndex], index)) continue;
      visited.add(index);
      if (owners[index] === -1 || assign(owners[index], visited)) { owners[index] = selectedIndex; return true; }
    }
    return false;
  };
  for (let index = 0; index < selected.length; index++) {
    if (!assign(index, new Set())) throw new Error(`Выбранный бонус «${selected[index]}» не соответствует фиксированным свойствам клиента`);
  }
  return templates.map((text, index) => {
    const option = options[index];
    if (!option) return text;
    const old = owners[index] === -1 ? null : parseAddonText(selected[owners[index]]);
    const value = old && old.min === old.max && old.min >= option.min && old.max <= option.max ? old.min : option.max;
    return formatAddonValue(text, value);
  });
}

function hasStructuredSetBonus(item) {
  const set = item.set_bonus;
  return isRecord(set) && typeof set.id === "string" && set.id.trim().length > 0
    && typeof set.name === "string" && set.name.trim().length > 0
    && Array.isArray(set.members) && set.members.length > 0
    && set.members.every((id) => Number.isSafeInteger(id) && id > 0)
    && new Set(set.members).size === set.members.length && set.members.includes(item.id)
    && Array.isArray(set.bonuses) && set.bonuses.length > 0
    && set.bonuses.every((bonus) => isRecord(bonus) && Number.isSafeInteger(bonus.pieces) && bonus.pieces > 0 && bonus.pieces <= set.members.length
      && Array.isArray(bonus.texts) && bonus.texts.length > 0 && bonus.texts.every((text) => typeof text === "string" && text.trim().length > 0))
    && new Set(set.bonuses.map((bonus) => bonus.pieces)).size === set.bonuses.length;
}

export function availableAddonTexts(item) {
  const fixed = fixedAddonSlots(item);
  if (fixed) return [...new Set(fixed.map((slot) => slot.text))];
  return ["options", "unique"].flatMap((key) => Array.isArray(item?.addons?.[key]) ? item.addons[key].map((a) => a.text).filter((t) => typeof t === "string") : []);
}

export function guaranteedAddonTexts(item) {
  if (fixedAddonSlots(item)) return [];
  const unique = Array.isArray(item?.addons?.unique) ? item.addons.unique : [];
  return [...new Set(unique.filter((addon) => addon?.chance === 100 && typeof addon.text === "string").map((addon) => addon.text))];
}

function parseAddonText(text) {
  if (typeof text !== "string" || text.length > 500 || /[\u0000-\u001f\u007f]/u.test(text)) return null;
  // Fixed tome lines 17621–17662/36675 use a sentence without a plus sign.
  // Recognize only that complete numeric m/sec phrase, not arbitrary prose.
  const movement = /^Увеличение скорости передвижения на\s+(\d+(?:[.,]\d+)?)м\s*\/сек\.?$/iu.exec(text.trim());
  if (movement) {
    const value = Number(movement[1].replace(",", "."));
    return Number.isFinite(value) && value <= 1e9
      ? { label: "Скорость передвижения", min: value, max: value, percent: false, unit: "м/сек" } : null;
  }
  if (/^Увеличение скорости передвижения на\s/iu.test(text.trim())) return null;
  const match = /^(.+?)\s*([+-]\s*\d+(?:[.,]\d+)?)(?:\s*[~–]\s*([+-]?\s*\d+(?:[.,]\d+)?))?\s*(%|ед\.?|сек\.?|м\s*\/\s*с)?\s*$/u.exec(text);
  if (!match) return null;
  const label = match[1].trim();
  if (!/^[\p{L}][\p{L}\p{N}\s().·:/'-]*$/u.test(label) || ["__proto__", "constructor", "prototype"].includes(normalize(label))) return null;
  const unit = normalize(match[4] ?? "").replace(/\s/gu, "");
  // Секунды допустимы только у интервала атак; единицы других бонусов не меняем.
  if (unit === "сек" && !["пауза между атаками", "интервал атаки", "задержка атаки"].includes(normalize(label))) return null;
  if (unit === "м/с" && !["скорость", "скорость перемещения", "скорость передвижения", "скорость движения"].includes(normalize(label))) return null;
  const number = (value) => Number(value.replace(/\s+/gu, "").replace(",", "."));
  const first = number(match[2]);
  let last = match[3] === undefined ? first : number(match[3]);
  // В базе «Время пения -1~3%» означает уменьшение от 1 до 3%:
  // знак первого числа действует и на второй предел без собственного знака.
  const inheritedNegative = match[2].trim().startsWith("-") && match[3] !== undefined && !/^[+-]/u.test(match[3].trim());
  if (inheritedNegative) last = -last;
  if (![first, last].every((value) => Number.isFinite(value) && Math.abs(value) <= 1e9)) return null;
  if (inheritedNegative ? last > first : last < first) return null;
  return { label, min: Math.min(first, last), max: Math.max(first, last), percent: match[4] === "%", unit };
}

// Числа остаются в единицах исходной строки; неизвестные форматы не угадываем.
export function parseAddonOption(text) {
  const option = parseAddonText(text);
  if (!option) return null;
  const { label, min, max, percent } = option;
  return { label, min, max, percent };
}

function decimalText(value) {
  const text = String(value);
  const small = /^(-?)(\d)(?:\.(\d+))?e-(\d+)$/u.exec(text);
  return small ? `${small[1]}0.${"0".repeat(Number(small[4]) - 1)}${small[2]}${small[3] ?? ""}` : text;
}

export function formatAddonValue(optionText, value) {
  const option = parseAddonText(optionText);
  if (!option || typeof value !== "number" || !Number.isFinite(value) || value < option.min || value > option.max) throw new Error("Значение бонуса должно находиться в подтверждённом диапазоне");
  if (option.min === option.max) return optionText;
  const suffix = option.unit === "%" ? "%" : option.unit === "ед" ? " ед." : option.unit === "сек" ? " сек." : option.unit === "м/с" ? " м/с" : "";
  return `${option.label} ${value < 0 ? "" : "+"}${decimalText(value)}${suffix}`;
}

function addonIsOffered(text, offered) {
  // Точные старые строки, включая ещё не рассчитываемые эффекты, совместимы.
  if (offered.includes(text)) return true;
  const selected = parseAddonText(text);
  if (!selected || selected.min !== selected.max) return false;
  return offered.some((source) => {
    const option = parseAddonText(source);
    return option && option.min !== option.max && normalize(option.label) === normalize(selected.label)
      && option.unit === selected.unit && selected.min >= option.min && selected.max <= option.max;
  });
}

const STONE_TARGETS = {
  weapon: "weapon", helmet: "armor", cape: "armor", chest: "armor", wrists: "armor", legs: "armor", boots: "armor",
  necklace: "decoration", belt: "decoration", ring1: "decoration", ring2: "decoration",
};

// count включает постоянные unique со 100%: Метеор имеет четыре свойства,
// из которых три выбираются, а «Урон монстрам +60» присутствует всегда.
// Возвращаем число редактируемых мест; неизвестный предел равен 0.
export function maximumAddons(item) {
  const fixed = fixedAddonSlots(item);
  if (fixed) return fixed.length;
  const count = item?.addons?.count;
  if (typeof count !== "string" && typeof count !== "number") return 0;
  const match = /^(\d+)(?:\s*[~–—-]\s*(\d+))?$/.exec(String(count).trim());
  if (!match || (match[2] !== undefined && Number(match[2]) < Number(match[1]))) return 0;
  return Math.min(20, Math.max(0, Number(match[2] ?? match[1]) - guaranteedAddonTexts(item).length));
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
  let addons = entry.addons ?? [];
  if (!Array.isArray(addons) || addons.length > 32 || addons.some((a) => typeof a !== "string" || a.length > 500)) throw new Error("Неверные выбранные бонусы предмета");
  const fixed = fixedAddonSlots(entry.item);
  if (fixed) addons = completeFixedAddons(entry.item, addons, fixed);
  const offered = availableAddonTexts(entry.item);
  if (addons.some((a) => !addonIsOffered(a, offered))) throw new Error("Выбранный бонус отсутствует в каталоге предмета");
  const maximum = maximumAddons(entry.item);
  const guaranteed = new Set(guaranteedAddonTexts(entry.item));
  if (addons.filter((addon) => !guaranteed.has(addon)).length > maximum) throw new Error(`Для предмета подтверждено не больше ${maximum} выбранных бонусов (без постоянных свойств)`);
  const capacity = maxSockets(entry.item, slotId);
  if (stones.length > capacity) throw new Error(`Для предмета подтверждено ячеек для камней: ${capacity}`);
  const target = STONE_TARGETS[resolveSlot(entry.item, slotId)];
  for (const stone of stones) {
    if (!target || !isRecord(stone.effects?.[target])) throw new Error(`Камень ${stone.name || stone.id || "без названия"} не подходит: нет эффекта для этой ячейки`);
    if (Number.isFinite(entry.item.grade) && Number.isFinite(stone.grade) && stone.grade > entry.item.grade) throw new Error(`Ранг камня ${stone.grade} выше ранга предмета ${entry.item.grade}`);
  }
  return { item: entry.item, refine, stones, addons };
}

// Возвращает подтверждённые числа в исходных единицах. Проценты отделены
// от плоских бонусов: порядок их применения задаёт расчёт характеристик.
export function getItemBonuses(entry, slotId) {
  const { item, refine, stones, addons } = validateEquipmentChoice(entry, slotId);
  const flat = {};
  const ranges = { phys_atk: [0, 0], mag_atk: [0, 0] };
  const warnings = [];
  const contributions = [], unresolved = [];
  const prefix = item.name || `Предмет ${item.id ?? ""}`;
  let atkSpeed;
  const warn = (message) => warnings.push(`${prefix}: ${message}`);
  function reject(meta, reason) {
    warn(reason);
    unresolved.push({ source: meta.source, label: meta.label, reason, value: null });
  }
  function add(key, value, meta, percent = false) {
    if (!STAT_KEYS.has(key) || (percent && !PERCENT_POINTS.has(key))) {
      reject(meta, `не учтён эффект «${meta.raw}»`); return;
    }
    const range = Array.isArray(value);
    if (range && (value.length !== 2 || !["phys_atk", "mag_atk"].includes(key) || value[0] > value[1])) throw new Error(`${prefix}: неверный диапазон характеристик ${key}`);
    const numbers = range ? value : [value];
    if (numbers.some((n) => typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 1e9)) throw new Error(`${prefix}: неверное значение характеристик ${key}`);
    if (key === "attack_interval" && value >= 0) { reject(meta, `не подтверждён интервал атаки «${meta.raw}»`); return; }
    if (SPECIAL_PERCENT_STATS.has(key) && (key === "requirement_reduction" ? value >= 0 || value < -100 : value < 0 || value > 100)) {
      reject(meta, `не подтверждён процент «${meta.raw}»`); return;
    }
    if (key === "atk_speed") {
      const source146 = /^https:\/\/comeback\.pw\/db\/146\/item\/\d+$/u.test(item.source?.url ?? "");
      const evidence = item.source?.corrections?.atk_speed;
      const verified = item.attack_speed_verified === true || (evidence?.value ?? evidence?.applied) === value;
      if (slotId === "weapon" && value > 0 && value <= 5 && item.attack_speed_verified !== false && (!source146 || verified)) atkSpeed = value;
      else { reject(meta, `скорость атаки ${value}: единицы источника не подтверждены`); return; }
    } else if (key === "phys_atk" || key === "mag_atk") {
      ranges[key][0] += range ? value[0] : value;
      ranges[key][1] += range ? value[1] : value;
    } else flat[key] = (flat[key] ?? 0) + value;
    contributions.push({ ...meta, stat: key, value: ["phys_atk", "mag_atk"].includes(key) ? (range ? [...value] : [value, value]) : value, percent });
  }
  function addLabeled(label, value, meta, percent = false) {
    const normalized = normalize(label);
    const maximum = MAX_ATTACK_LABELS.get(normalized);
    // Same pw_id36539/43506 in mypers uses ae_eg for the source's «Удар +50%».
    // Only the verified percentage spelling is mapped, never a flat "hit" value.
    let key = maximum ?? (percent && normalized === "удар" ? "accuracy_percent" : LABELS.get(normalized));
    if (percent && PERCENT_STATS.has(key)) key = PERCENT_STATS.get(key);
    if (PERCENT_ONLY_STATS.has(key) && !percent) { reject(meta, `не подтверждены единицы «${meta.raw}»`); return; }
    if (!key || value === null || value === undefined) { reject(meta, `не учтён эффект «${meta.raw}»`); return; }
    add(key, maximum ? [0, value] : value, meta, percent);
  }
  if (!isRecord(item.stats ?? {})) throw new Error(`${prefix}: неверные данные характеристик`);
  for (const [key, value] of Object.entries(item.stats ?? {})) add(key, value, { source: "base", label: STAT_LABELS[key] ?? key, raw: key });
  if (refine > 0) {
    const value = item.refine?.levels?.[refine - 1];
    const meta = { source: "refine", label: `Заточка +${refine}: ${item.refine?.stat ?? "неизвестная характеристика"}`, raw: item.refine?.stat ?? `Заточка +${refine}` };
    if (typeof value === "number") {
      if (normalize(item.refine.stat) === "физ+маг атака") {
        add("phys_atk", value, meta); add("mag_atk", value, meta);
      } else if (normalize(item.refine.stat) === "защита & сопротивляемость стихиям") {
        add("phys_def", value, meta); add("mag_def", value, meta);
      } else addLabeled(item.refine.stat, value, meta);
    }
    else reject(meta, `нет подтверждённого значения заточки +${refine}`);
  }
  const guaranteed = new Set(guaranteedAddonTexts(item));
  // Старые сборки сохраняли постоянное свойство в addons. Оно применяется
  // один раз; одинаковые обычные роллы остаются отдельными свойствами.
  for (const text of [...guaranteed, ...addons.filter((addon) => !guaranteed.has(addon))]) {
    const option = parseAddonText(text);
    const meta = { source: fixedAddonSlots(item) !== null ? "fixed" : guaranteed.has(text) ? "guaranteed" : "addon", label: text, raw: text };
    if (option && option.min === option.max) addLabeled(option.label, option.min, meta, option.percent);
    else reject(meta, `не учтён выбранный бонус «${text}»`);
  }
  const target = STONE_TARGETS[slotId];
  for (const stone of stones) {
    const effect = stone.effects[target];
    addLabeled(effect.stat, effect.value, { source: "stone", label: `${stone.name || `Камень ${stone.id ?? ""}`}: ${effect.stat}`, raw: effect.raw ?? effect.stat }, effect.percent === true);
  }
  for (const label of Object.keys(item.specs_extra ?? {})) {
    if (label === "Требуемая репутация" && getRequiredReputation(item) !== null) continue;
    if (label === "Условия применения" && ammoWeaponGradeRange(item)) continue;
    reject({ source: "base", label }, `не учтена характеристика «${label}»`);
  }
  if (((Array.isArray(item.set) && item.set.length) || item.set_bonus !== undefined) && !hasStructuredSetBonus(item)) {
    reject({ source: "base", label: "Бонус комплекта" }, "бонус комплекта не рассчитан");
  }
  return { flat, ranges, atkSpeed, warnings, contributions, unresolved };
}
