import { CLASSES } from "./stats.js";

export function normalizeGender(cls, gender = "male") {
  if (cls === "ya") return "male";
  if (cls === "rl") return "female";
  return gender === "female" ? "female" : "male";
}

// Observed on mypers: choosing a class resets its skill panel and active buffs.
export function changeClass(state, cls) {
  if (!Object.hasOwn(CLASSES, cls)) throw new Error("Неизвестный класс персонажа");
  return { ...state, cls, gender: normalizeGender(cls, state.gender), effects: [],
    effectSettings: {}, addedEffects: [], hiddenEffects: [] };
}

export function changeGender(state, gender) {
  if (!["male", "female"].includes(gender)) throw new Error("Неизвестный пол персонажа");
  if (state.cls === "ya" && gender === "female") return changeClass(state, "rl");
  if (state.cls === "rl" && gender === "male") return changeClass(state, "ya");
  return { ...state, gender };
}
