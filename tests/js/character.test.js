import assert from "node:assert/strict";
import { test } from "node:test";
import { changeClass, changeGender, normalizeGender } from "../../static/js/engine/character.js";

const state = { cls: "by", gender: "female", effects: [6], effectSettings: { 6: { level: 10 } },
  addedEffects: [29], hiddenEffects: [1], attrs: { vit: 5 }, equipment: { ring1: {} }, titles: { hp: 100 } };

test("смена класса сбрасывает бафы и сохраняет экипировку, очки и титулы", () => {
  const next = changeClass(state, "rg");
  assert.equal(next.cls, "rg"); assert.equal(next.gender, "female");
  assert.deepEqual(next.effects, []); assert.deepEqual(next.effectSettings, {});
  assert.deepEqual(next.addedEffects, []); assert.deepEqual(next.hiddenEffects, []);
  assert.equal(next.attrs, state.attrs); assert.equal(next.equipment, state.equipment); assert.equal(next.titles, state.titles);
  assert.deepEqual(state.effects, [6]);
});

test("Мистик и Страж имеют оба пола и остаются разными классами", () => {
  for (const cls of ["rg", "ej"]) for (const gender of ["male", "female"]) {
    const next = changeGender({ ...state, cls }, gender);
    assert.equal(next.cls, cls); assert.equal(next.gender, gender);
    assert.deepEqual(next.effects, [6]);
  }
});

test("как на оригинале: смена пола переводит оборотня в друида и обратно", () => {
  const female = changeGender({ ...state, cls: "ya", gender: "male" }, "female");
  assert.equal(female.cls, "rl"); assert.equal(female.gender, "female"); assert.deepEqual(female.effects, []);
  const male = changeGender(female, "male");
  assert.equal(male.cls, "ya"); assert.equal(male.gender, "male");
  assert.equal(normalizeGender("ya", "female"), "male");
  assert.equal(normalizeGender("rl", "male"), "female");
  assert.throws(() => changeClass(state, "he"), /Неизвестный класс/);
});
