import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as equipmentEngine from "../../static/js/engine/equipment.js";
import { resolveEquipment } from "../../static/js/engine/eligibility.js";
import { parseBuild, serializeBuild } from "../../static/js/engine/build.js";

const items = JSON.parse(readFileSync(new URL("../../data/catalog_items.json", import.meta.url), "utf8"));
const item = (id) => items.find((entry) => entry.id === id);
const selected = (record, addons = []) => ({ item: record, refine: 0, stones: [], addons });
const attrs = { vit: 5, int: 5, str: 61, dex: 47 };
const character = { cls: "by", level: 105, reputation: 0, attrs };
const ammo = selected(item(411));
const weapon = selected(item(22));

test("146: все62 диапазона боеприпасов читаются из точного условия применения", () => {
  assert.equal(typeof equipmentEngine.ammoWeaponGradeRange, "function");
  assert.deepEqual(equipmentEngine.ammoWeaponGradeRange(item(411)), { min: 4, max: 16 });
  const records = items.filter((entry) => entry.slot === "ammo");
  assert.equal(records.length, 62);
  assert.ok(records.every((record) => equipmentEngine.ammoWeaponGradeRange(record)));
  assert.ok(records.some((record) => equipmentEngine.ammoWeaponGradeRange(record).min === 0));
  assert.equal(equipmentEngine.ammoWeaponGradeRange(item(22)), null);
  const zeroMinimum = selected(records.find((record) => equipmentEngine.ammoWeaponGradeRange(record).min === 0));
  assert.equal(resolveEquipment({ ...character, equipment: { ammo: zeroMinimum } }).status.ammo.usable, false);
  assert.equal(resolveEquipment({ ...character, equipment: { ammo: zeroMinimum, weapon: selected({ ...item(22), grade: 0 }) } }).status.ammo.usable, true);
  for (const text of [null, "", "Уровень оружия 4-3", "Уровень оружия -1-16", "Уровень оружия 4.5-16", "Уровень оружия 4-16 или выше", "Уровень оружия 4-16\nСила +100", "Уровень оружия 1-9007199254740992"]) {
    assert.equal(equipmentEngine.ammoWeaponGradeRange({ ...item(411), specs_extra: { "Условия применения": text } }), null, String(text));
  }
});

test("известное условие ammo не порождает ложного unknown, чужое или испорченное сохраняется", () => {
  assert.ok(!equipmentEngine.getItemBonuses(ammo, "ammo").unresolved.some((entry) => entry.label === "Условия применения"));
  for (const record of [{ ...item(411), specs_extra: { "Условия применения": "Уровень оружия неизвестен" } },
    { ...item(22), specs_extra: item(411).specs_extra }]) {
    const result = equipmentEngine.getItemBonuses(selected(record), record.slot);
    assert.ok(result.unresolved.some((entry) => entry.label === "Условия применения" && entry.value === null));
  }
});

test("стрела411 требует активное оружие с рангом4–16, тип не подменяет проверку ранга", () => {
  const alone = resolveEquipment({ ...character, equipment: { ammo } });
  assert.equal(alone.status.ammo.usable, false);
  const required = alone.status.ammo.requirements.find((entry) => entry.key === "weapon_grade");
  assert.equal(required.required, "4–16");
  assert.equal(required.met, false);
  const ordinary = resolveEquipment({ ...character, equipment: { ammo, weapon } });
  assert.equal(ordinary.status.weapon.usable, true);
  assert.equal(ordinary.status.ammo.usable, true);
  for (const type of ["Оружие дальнего боя", "Магическое оружие", "Мечи"]) {
    const result = resolveEquipment({ ...character, equipment: { ammo, weapon: selected({ ...item(22), type }) } });
    assert.equal(result.status.ammo.usable, true, type);
    assert.equal(result.status.ammo.requirements.find((entry) => entry.key === "weapon_grade").current, 4);
  }
});

test("границы ранга оружия, красное оружие и его снятие отключают выбранные боеприпасы", () => {
  for (const grade of [3, 17, null, "4", NaN]) {
    const result = resolveEquipment({ ...character, equipment: { ammo, weapon: selected({ ...item(22), grade }) } });
    assert.equal(result.status.ammo.usable, false, String(grade));
  }
  for (const grade of [4, 16]) assert.equal(resolveEquipment({ ...character, equipment: { ammo, weapon: selected({ ...item(22), grade }) } }).status.ammo.usable, true);
  const red = resolveEquipment({ ...character, attrs: { ...attrs, str: 60 }, equipment: { ammo, weapon } });
  assert.equal(red.status.weapon.usable, false);
  assert.equal(red.status.ammo.usable, false);
  assert.equal(resolveEquipment({ ...character, equipment: { ammo } }).status.ammo.usable, false);
  const unknown = selected({ ...item(411), specs_extra: { "Условия применения": "неизвестно" } });
  const status = resolveEquipment({ ...character, equipment: { ammo: unknown, weapon } }).status.ammo;
  assert.equal(status.usable, false);
  assert.equal(status.requirements.find((entry) => entry.key === "weapon_grade").required, "неизвестно");
});

test("боеприпасы не запускают взаимную поддержку, отрицательный бонус не ломает активное оружие", () => {
  const granted = { ...item(411), addons: { count: 1, options: [{ text: "Сила +10" }, { text: "Сила -10" }] } };
  const circular = resolveEquipment({ ...character, attrs: { ...attrs, str: 51 }, equipment: { ammo: selected(granted, ["Сила +10"]), weapon } });
  assert.equal(circular.status.weapon.usable, false);
  assert.equal(circular.status.ammo.usable, false);
  const conflict = resolveEquipment({ ...character, equipment: { ammo: selected(granted, ["Сила -10"]), weapon } });
  assert.equal(conflict.status.weapon.usable, true);
  assert.equal(conflict.status.ammo.usable, false);
  assert.match(conflict.status.ammo.reasons.join(" "), /требования другой активной вещи/);
});

test("боеприпасы и их условие переживают прежний формат JSON и не изменяют источник", () => {
  const before = JSON.stringify(item(411));
  const json = serializeBuild({ ...character, equipment: { ammo, weapon } });
  const compact = JSON.parse(json);
  assert.deepEqual(compact.equipment.ammo, { itemId: 411, refine: 0, stones: [], addons: [], addonsConfigured: true });
  delete compact.equipment.ammo.addonsConfigured; // Прежний version1 JSON не имел этого маркера.
  const restored = parseBuild(JSON.stringify(compact), items, []);
  assert.equal(restored.equipment.ammo.item, item(411));
  assert.equal(resolveEquipment(restored).status.ammo.usable, true);
  assert.equal(JSON.stringify(item(411)), before);
});
