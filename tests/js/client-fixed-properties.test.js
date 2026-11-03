import assert from "node:assert/strict";
import { test } from "node:test";
import { getItemBonuses, validateEquipmentChoice, maximumAddons } from "../../static/js/engine/equipment.js";
import { parseBuild, serializeBuild } from "../../static/js/engine/build.js";
import { createDefaultChoice } from "../../static/js/engine/defaults.js";

const texts = ["Сила +6~7", "Ловкость +6~7", "Телосложение +6~7", "Интеллект +6~7", "Время пения -6%"];
const cape = { id: 21418, slot: "cape", addons: { count: "3", options: [{ text: texts[0] }] },
  client_fixed_addons: { required: true, slots: texts.map((text, index) => ({ addon_id: index + 1, text })) } };

test("клиент21418: пять обязательных типов сильнее неполного webcount3", () => {
  assert.equal(maximumAddons(cape), 5);
  assert.deepEqual(getItemBonuses({ item: cape }, "cape").flat, { str: 7, dex: 7, vit: 7, int: 7, cast_time: -6 });
  assert.equal(createDefaultChoice(cape, "cape").addons.length, 5);
});
test("дополнение фиксированных типов сохраняет выбранное значение в диапазоне", () => {
  const result = validateEquipmentChoice({ item: cape, addons: ["Сила +6", "Интеллект +6"] }, "cape");
  assert.deepEqual(result.addons, ["Сила +6", "Ловкость +7", "Телосложение +7", "Интеллект +6", "Время пения -6%"]);
  assert.throws(() => validateEquipmentChoice({ item: cape, addons: ["Сила +8"] }, "cape"), /фиксирован|каталог|клиент/);
  assert.throws(() => validateEquipmentChoice({ item: cape, addons: ["Сила +6", "Сила +7"] }, "cape"), /фиксирован|каталог|клиент/);
});
test("перекрывающиеся диапазоны назначаются без потери существующих двух роллов", () => {
  const item = { slot: "cape", client_fixed_addons: { required: true, slots: [
    { text: "Здоровье +100~200" }, { text: "Здоровье +100" },
  ] } };
  assert.deepEqual(validateEquipmentChoice({ item, addons: ["Здоровье +100", "Здоровье +150"] }, "cape").addons,
    ["Здоровье +150", "Здоровье +100"]);
});
test("неизвестный фиксированный эффект остаётся отдельным null и не блокирует известную силу", () => {
  const unknown = "Неизвестное свойство клиента ID851 (B_custom)";
  const item = { slot: "cape", client_fixed_addons: { required: true, slots: [{ text: "Сила +7" }, { text: unknown }] } };
  const result = getItemBonuses({ item }, "cape");
  assert.equal(result.flat.str, 7);
  assert.equal(result.unresolved[0].value, null);
  assert.equal(result.unresolved[0].label, unknown);
});
test("fixedсP0=1 не получает негенерируемые свойства; повреждённые метаданные не замалчиваются", () => {
  const item = { slot: "cape", client_fixed_addons: { required: false, slots: [] }, default_addons: ["Сила +7"] };
  assert.deepEqual(createDefaultChoice(item, "cape").addons, []);
  assert.throws(() => getItemBonuses({ item: { ...item, client_fixed_addons: { required: true, slots: "bad" } } }, "cape"), /клиент/);
});
test("старый сохранённый плащ дополняет потерянные типы, новый roundtrip сохраняет ролл6", () => {
  const state = { version: 1, cls: "ga", level: 105, attrs: { vit: 5, int: 5, str: 5, dex: 5 }, equipment: {
    cape: { itemId: 21418, addons: ["Сила +6"], addonsConfigured: true },
  } };
  const restored = parseBuild(JSON.stringify(state), [cape]);
  assert.equal(restored.equipment.cape.addons.length, 5);
  assert.equal(restored.equipment.cape.addons[0], "Сила +6");
  assert.deepEqual(restored.completedFixedAddons, ["cape"]);
  assert.deepEqual(parseBuild(serializeBuild(restored), [cape]).equipment.cape.addons, restored.equipment.cape.addons);
  assert.deepEqual(parseBuild(serializeBuild(restored), [cape]).completedFixedAddons, []);
});

test("фиксированный сырой webскаляр исправляется по единственному клиентскому типу с правильными единицами", () => {
  const item = { slot: "chest", addons: { count: 1, options: [{ text: "Скор. восст. HP +20" }] },
    client_fixed_addons: { required: true, slots: [{ text: "Скор. восст. HP +10" }] } };
  const result = getItemBonuses({ item, addons: ["Скор. восст. HP +20"] }, "chest");
  assert.equal(result.flat.hp_regen, 10);
  assert.equal(result.flat.hp, undefined);
});
