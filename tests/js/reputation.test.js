import assert from "node:assert/strict";
import { test } from "node:test";
import { getRequiredReputation, MAX_REPUTATION, validateReputation } from "../../static/js/engine/reputation.js";

test("репутация принимает только безопасные целые неотрицательные числа", () => {
  assert.equal(MAX_REPUTATION, Number.MAX_SAFE_INTEGER);
  for (const value of [0, 1, 300000, MAX_REPUTATION]) assert.equal(validateReputation(value), value);
  assert.equal(validateReputation(), 0);
  assert.equal(Object.is(validateReputation(-0), -0), false);
  for (const value of ["0", "300000", "abc", null, true, {}, [], -1, 0.5, NaN, Infinity, MAX_REPUTATION + 1]) {
    assert.throws(() => validateReputation(value), /репутац/i);
  }
});

test("требование репутации читается из исходной строки базы 146 с пробелами", () => {
  for (const value of ["200 000", "200\u00a0000", "200\u202f000", " 200 000 "]) {
    assert.equal(getRequiredReputation({ specs_extra: { "Требуемая репутация": value } }), 200000);
  }
  assert.equal(getRequiredReputation({ specs_extra: { "Требуемая репутация": "0" } }), 0);
  assert.equal(getRequiredReputation({}), 0);
  assert.equal(getRequiredReputation({ specs_extra: {} }), 0);
});

test("непрочитанное требование репутации не превращается в разрешающий ноль", () => {
  for (const value of ["", " ", "abc", "1e6", "+300", "-1", "300.0", "200,000", "٢٠٠٠٠٠", null, {}, [], "9007199254740992"]) {
    assert.equal(getRequiredReputation({ specs_extra: { "Требуемая репутация": value } }), null);
  }
});
