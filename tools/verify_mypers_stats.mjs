// Verify numerical stages against reviewed, hash-pinned functions of mypers.
// The original scripts remain in the ignored cache and are never distributed.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { CLASSES, computeStats } from "../static/js/engine/stats.js";
import { collectEffects } from "../static/js/engine/effects.js";
import { getItemBonuses } from "../static/js/engine/equipment.js";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
const data = (path) => JSON.parse(read(path));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pinned = [
  { path: ".cache/mypers/pwscripts.min.js", url: "https://mypers.ru/js/pwscripts.min.js?v26",
    sha256: "365299f09ce10267b48f03693023875b5f601386fb4313e822b4b04baff04dea" },
  { path: ".cache/mypers/scripts.min.js", url: "https://mypers.ru/js/scripts.min.js?v3",
    sha256: "0c4610258c6a8ed66525680e9906c6bafa1c737ba584fccd279373a910d3d9d5" },
];
const [source, common] = pinned.map((entry) => {
  const bytes = read(entry.path);
  assert.equal(sha256(bytes), entry.sha256, `Source changed: ${entry.path}; review before updating its hash`);
  return bytes.toString("utf8");
});
const methodNames = ["ih", "iz", "gy", "ev", "yp", "xkw", "nt", "qv", "dd", "dgt", "uqf",
  "ts", "tsPerc", "getMaxPhysDefPerc", "getMaxMagDefPerc"];

function extractFunction(text, marker) {
  const start = text.indexOf(marker);
  assert.ok(start >= 0, `Missing reviewed function: ${marker}`);
  const open = text.indexOf("{", start);
  let depth = 0, quote = null;
  for (let index = open; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      if (char === "\\") { index++; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "{") depth++;
    if (char === "}" && --depth === 0) return text.slice(start, index + 1);
  }
  throw new Error(`Unterminated reviewed function: ${marker}`);
}

const functions = methodNames.map((name) => {
  const code = extractFunction(source, `sd.prototype.${name}=`);
  assert.ok(!/(?:fetch|require|document|window|eval|Function|\$)/.test(code), `Not a reviewed pure method: ${name}`);
  return code.replace(`sd.prototype.${name}`, `methods.${name}`) + ";";
});
const bootstrap = [extractFunction(common, "function round("), extractFunction(common, "function empty("),
  "const methods = {};", ...functions,
  // Eligibility is tested separately; the oracle receives only an already-active weapon.
  "methods.sl = () => true; globalThis.methods = methods;"].join("\n");
const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
new vm.Script(bootstrap).runInContext(context, { timeout: 1000 });
const methods = context.methods;

const definitions = data("data/catalog_sets.json").sets;
const defaults = data("data/catalog_defaults.json");
const speeds = new Map(defaults.weapon_speeds.map((entry) => [entry.item_id, entry.base_attack_speed]));
const items = new Map(data("data/catalog_items.json").map((raw) => {
  const item = structuredClone(raw), set = definitions.find((entry) => entry.members.includes(item.id));
  if (set) item.set_bonus = set;
  if (speeds.has(item.id)) item.stats.atk_speed = speeds.get(item.id);
  return [item.id, item];
}));
const effectCatalog = data("data/skills.json").skills.map((entry) => ({ ...entry, record: entry.source_record,
  name: entry.names?.mi ?? entry.name }));
const choice = (id, addons = []) => ({ item: items.get(id), addons, refine: 0, stones: [] });
const elements = { metal: "lw", wood: "mo", water: "dn", fire: "vt", earth: "sp" };
const seed = 146, casesPerClass = 200;
let states = 0, comparisons = 0, mismatchCount = 0;
const mismatches = [];

for (const cls of Object.keys(CLASSES)) for (let offset = 0; offset < casesPerClass; offset++) {
  const index = offset + seed, level = index % 3 ? 105 : 102;
  let attrs = { vit: 5 + index * 17 % 35, int: 5 + index * 29 % 90,
    str: 5 + index * 31 % 190, dex: 5 + index * 13 % 75 };
  const equipment = {};
  switch (index % 7) {
    case 0:
      equipment.necklace = choice(8368, ["Макс ХП +5%"]);
      equipment.belt = choice(9326, ["Мана +5%", "Физическая защита +35", "Здоровье +80"]);
      break;
    case 1:
      attrs.str = 252; attrs.dex = 54;
      equipment.boots = choice(25701, ["Физическая защита +4%", "Маг защита +4%", "Уменьшение физ урона +1%"]);
      break;
    case 2:
      equipment.ring1 = choice(26389, ["Крит +3%", "Время пения -6%", "Показатель атаки +2"]);
      equipment.ring2 = choice(26389, ["Крит +3%", "Время пения -6%", "Показатель атаки +2"]);
      break;
    case 3:
      attrs.str = 250; attrs.dex = 60;
      for (const id of [14927, 14933, 14939, 14945]) equipment[items.get(id).slot] = choice(id);
      break;
    case 4:
      equipment.weapon = choice(78, ["Пауза между атаками -0.1"]);
      equipment.tome = choice(17683);
      break;
    case 5:
      attrs = { vit: 5, int: 5, str: 5, dex: 5 };
      equipment.boots = choice(25701, ["Физическая защита +4%"]);
      equipment.weapon = choice(22, ["Требования -10%"]);
      break;
    case 6:
      equipment.necklace = choice(1895, ["Уклон +10%"]);
  }
  const effects = index % 2 ? [1, 6] : [3, 6];
  const state = { cls, level, attrs, equipment, effects, effectCatalog,
    titles: { hp: index % 10, phys_def: index % 4, mag_def: index % 6 } };
  const result = computeStats(state), flat = result.extraBonuses;
  const modifiers = collectEffects(effects, {}, effectCatalog,
    { cls, hasWeapon: Boolean(result.activeEquipment.weapon) }).modifiers;
  const dops = {
    hp: flat.hp ?? 0, mp: flat.mp ?? 0, co: flat.hp_percent ?? 0, cc: flat.mp_percent ?? 0,
    wf: flat.phys_def ?? 0, wf_eg: flat.phys_def_percent ?? 0, ab_gq_eg: flat.mag_def_percent ?? 0,
    cl: flat.speed ?? 0, cl_eg: flat.speed_percent ?? 0, ae: flat.accuracy ?? 0, ae_eg: flat.accuracy_percent ?? 0,
    qe: flat.evasion ?? 0, qe_eg: flat.evasion_percent ?? 0, ci: -(flat.cast_time ?? 0),
    xn: -(flat.attack_interval ?? 0), bu: flat.damage_reduction_phys ?? 0, ia: flat.damage_reduction_mag ?? 0,
  };
  for (const [key, code] of Object.entries(elements)) dops[`${code}_eq`] = (flat.mag_def ?? 0) + (flat[`def_${key}`] ?? 0);
  const effective = result.effectiveAttrs, entry = result.activeEquipment.weapon;
  const baseSpeed = entry ? getItemBonuses(entry, "weapon").atkSpeed ?? 1.25 : 1.25;
  const oracle = { ...methods, type: cls, hf: level,
    vu: { lf: effective.vit, tx: effective.int, om: effective.str, uy: effective.dex },
    dops, ib: modifiers, wx: Object.values(elements).map((code) => `${code}_eq`),
    xl: { pn: { en: entry ? { ta: { sy: baseSpeed } } : {} } },
  };
  for (const name of ["ih", "iz", "gy", "ev", "yp", "xkw", "nt", "qv", "dd", "dgt", "uqf"]) methods[name].call(oracle);
  const expected = { hp: oracle.hp, mp: oracle.mp, speed: Number(oracle.cl), accuracy: Number(oracle.ae),
    evasion: Number(oracle.qe), castTime: -Number(oracle.ci), atkSpeed: Number(oracle.zi),
    physDef: oracle.nsb, magDef: Number(oracle.iep), damageReductionPhys: Number(oracle.zen),
    damageReductionMag: Number(oracle.sfy) };
  for (const [key, code] of Object.entries(elements)) expected[key] = oracle[`${code}Def`];
  for (const [key, value] of Object.entries(expected)) {
    comparisons++;
    const current = result.elements[key] ?? result[key];
    if (current !== value) {
      mismatchCount++;
      if (mismatches.length < 20) mismatches.push({ cls, index, key, current, expected: value });
    }
  }
  states++;
}

const report = {
  version: 1, verified_on: "2026-11-03", command: "node tools/verify_mypers_stats.mjs", seed, cases_per_class: casesPerClass,
  classes: Object.keys(CLASSES), states, comparisons, mismatches: mismatchCount, examples: mismatches,
  sources: pinned, extracted_methods: methodNames, sandbox: { dynamic_strings: false, wasm: false, original_full_script_executed: false },
  input_files: ["data/catalog_items.json", "data/catalog_sets.json", "data/catalog_defaults.json", "data/skills.json"]
    .map((path) => ({ path, sha256: sha256(read(path)) })),
  checked_fields: ["hp", "mp", "speed", "accuracy", "evasion", "castTime", "atkSpeed", "physDef", "magDef",
    "damageReductionPhys", "damageReductionMag", ...Object.keys(elements)],
  limitations: [
    "This compares the numerical formula stage with the pinned mypers source, not with the Comeback game client.",
    "Eligibility, effective attributes, equipment aggregation and effect aggregation use the local implementation and are validated separately.",
    "Only the reviewed pure methods are evaluated; no original application, UI, network, filesystem or process API is injected into the VM.",
    "The local negative cast-time representation is compared with the negative of the original shortening percentage.",
    "This oracle does not cover physical/magic attack, damage skills, procs, PvP/PvE formulas or item availability.",
  ],
};
const destination = new URL("docs/mypers-stats-verification.json", root);
writeFileSync(destination, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ output: fileURLToPath(destination), states, comparisons, mismatches: mismatchCount }));
if (mismatchCount) process.exitCode = 1;
