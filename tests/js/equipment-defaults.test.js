import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createDefaultChoice, defaultAddons } from "../../static/js/engine/defaults.js";
import { parseBuild, serializeBuild } from "../../static/js/engine/build.js";
const items = JSON.parse(readFileSync(new URL("../../data/catalog_items.json", import.meta.url), "utf8"));
const original = items.find((item) => item.id === 26389);
const profile = ["Время пения -6%", "Крит +3%", "Показатель атаки +2"];
const ring = { ...original, default_addons: profile };
const base = { version: 1, cls: "ga", level: 105, attrs: { vit: 5, int: 5, str: 5, dex: 5 }, equipment: {
  ring1: { itemId: ring.id, addons: [] },
} };

test("новый предмет26389 получает редактируемый проверенный набор146", () => {
  const choice = createDefaultChoice(ring, "ring1");
  assert.deepEqual(choice.addons, profile);
  assert.notEqual(choice.addons, profile);
  assert.deepEqual(defaultAddons(original, "ring1"), []);
  assert.throws(() => createDefaultChoice({ ...ring, default_addons: ["Крит +100%"] }, "ring1"), /бонус/);
});
test("старое пустое сохранение восстанавливает известные свойства и сообщает об этом", () => {
  const restored = parseBuild(JSON.stringify(base), [ring]);
  assert.deepEqual(restored.equipment.ring1.addons, profile);
  assert.deepEqual(restored.restoredDefaults, ["ring1"]);
});
test("старые непустые значения и новые осознанно пустые свойства не заменяются", () => {
  const partial = structuredClone(base);
  partial.equipment.ring1.addons = ["Время пения -6%"];
  assert.deepEqual(parseBuild(JSON.stringify(partial), [ring]).equipment.ring1.addons, ["Время пения -6%"]);
  const explicit = structuredClone(base);
  explicit.equipment.ring1.addonsConfigured = true;
  assert.deepEqual(parseBuild(JSON.stringify(explicit), [ring]).equipment.ring1.addons, []);
  const saved = serializeBuild({ ...base, equipment: { ring1: { item: ring, addons: [] } } });
  assert.equal(JSON.parse(saved).equipment.ring1.addonsConfigured, true);
  assert.deepEqual(parseBuild(saved, [ring]).equipment.ring1.addons, []);
});
test("каталог без профиля остаётся совместимым, маркер принимает только boolean", () => {
  assert.deepEqual(parseBuild(JSON.stringify(base), [original]).equipment.ring1.addons, []);
  const invalid = structuredClone(base);
  invalid.equipment.ring1.addonsConfigured = "true";
  assert.throws(() => parseBuild(JSON.stringify(invalid), [ring]), /свойств/);
});

test("исходная повреждённая строка старой сборки исправляется по точной карте предмета", () => {
  const raw = "Уменьшение урона от стихий +1022739087%";
  const fixed = "Уменьшение урона от стихий +3%";
  const boots = { id: 32965, slot: "boots", addons: { count: 1, options: [{ text: fixed }] }, addon_corrections: { [raw]: fixed } };
  const restored = parseBuild(JSON.stringify({ ...base, equipment: { boots: { itemId: 32965, addons: [raw] } } }), [boots]);
  assert.deepEqual(restored.equipment.boots.addons, [fixed]);
  assert.deepEqual(restored.correctedAddons, ["boots"]);
});
