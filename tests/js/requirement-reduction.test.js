import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolveEquipment } from "../../static/js/engine/eligibility.js";

const items = JSON.parse(readFileSync(new URL("../../data/catalog_items.json", import.meta.url), "utf8"));
const item = (id) => items.find((entry) => entry.id === id);
const attrs = { vit: 5, int: 5, str: 5, dex: 5 };
const state = { cls: "by", level: 105, reputation: 0, attrs };
const entry = (record, addons) => ({ item: record, addons });
const value = (result, slot, key) => result.status[slot].requirements.find((requirement) => requirement.key === key);

test("146 меч22: собственное снижение требований10% округляет силу и ловкость", () => {
  const equipment = { weapon: entry(item(22), ["Требования -10%"]) };
  const low = resolveEquipment({ ...state, attrs: { ...attrs, str: 54, dex: 42 }, equipment });
  assert.equal(value(low, "weapon", "str").required, 55);
  assert.equal(value(low, "weapon", "dex").required, 42);
  assert.equal(low.status.weapon.usable, false);
  const met = resolveEquipment({ ...state, attrs: { ...attrs, str: 55, dex: 42 }, equipment });
  assert.equal(met.status.weapon.usable, true);
});

test("146 меч32261: четверть требований округляется и не меняет уровень, репутацию, класс", () => {
  const equipment = { weapon: entry(item(32261), ["Требования -25%"]) };
  const input = { ...state, cls: "ga", attrs: { ...attrs, str: 37, int: 225 }, reputation: 200000, equipment };
  const met = resolveEquipment(input);
  assert.equal(value(met, "weapon", "str").required, 37); // 50 − round(12.5).
  assert.equal(value(met, "weapon", "int").required, 225);
  assert.equal(met.status.weapon.usable, true);
  for (const [patch, key] of [[{ level: 99 }, "level"], [{ reputation: 199999 }, "reputation"], [{ cls: "by" }, "class"]]) {
    const blocked = resolveEquipment({ ...input, ...patch });
    assert.equal(blocked.status.weapon.usable, false);
    assert.equal(value(blocked, "weapon", key).met, false);
  }
});

test("снижение требований принадлежит только своей вещи и не разрешает собственную силу", () => {
  const weapon = { slot: "weapon", req: { str: 50 }, addons: { count: 2, options: [{ text: "Требования -10%" }, { text: "Сила +100" }] } };
  const equipment = { weapon: entry(weapon, ["Требования -10%", "Сила +100"]) };
  const low = resolveEquipment({ ...state, attrs: { ...attrs, str: 44 }, equipment });
  assert.equal(value(low, "weapon", "str").required, 45);
  assert.equal(low.status.weapon.usable, false);
  assert.equal(resolveEquipment({ ...state, attrs: { ...attrs, str: 45 }, equipment }).status.weapon.usable, true);
  const ring = { slot: "ring", addons: { count: 1, options: [{ text: "Требования -50%" }] } };
  const other = resolveEquipment({ ...state, attrs: { ...attrs, str: 44 }, equipment: {
    ring1: entry(ring, ["Требования -50%"]), weapon: entry({ slot: "weapon", req: { str: 50 } }, []),
  } });
  assert.equal(other.status.ring1.usable, true);
  assert.equal(value(other, "weapon", "str").required, 50);
  assert.equal(other.status.weapon.usable, false);
});

test("проценты требований отсекаются для каждой строки и сумма ограничена100%", () => {
  const record = { slot: "weapon", req: { str: 61, dex: 47, int: 30, vit: 5 },
    addons: { count: 2, options: [{ text: "Требования -10.9%" }, { text: "Требования -60%" }] } };
  const truncated = resolveEquipment({ ...state, attrs: { ...attrs, str: 48, dex: 38, int: 24 }, equipment: {
    weapon: entry(record, ["Требования -10.9%", "Требования -10.9%"]),
  } });
  assert.equal(value(truncated, "weapon", "str").required, 49); // 20%, не21%.
  assert.equal(value(truncated, "weapon", "dex").required, 38);
  assert.equal(value(truncated, "weapon", "int").required, 24);
  assert.equal(truncated.status.weapon.usable, false);
  const clamped = resolveEquipment({ ...state, attrs: { vit: 0, int: 0, str: 0, dex: 0 }, equipment: {
    weapon: entry(record, ["Требования -60%", "Требования -60%"]),
  } });
  assert.equal(clamped.status.weapon.usable, true);
  assert.ok(clamped.status.weapon.requirements.every((requirement) => requirement.required === 0));
});
