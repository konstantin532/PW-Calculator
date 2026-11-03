// Данные — только из загруженного каталога. Формулы: mypers pwscripts,
// sd.hs / jt / hw / tq; соответствие серверу Comeback отдельно не доказано.
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const numeric = (value) => typeof value === "number" && Number.isFinite(value) ? value : 0;
export const sourceRound = (value) => Math.round(Number(value.toFixed(8)));

export function validateEffectSettings(settings = {}) {
  if (!isRecord(settings) || Object.keys(settings).length > 1000) throw new Error("Неверные настройки эффектов");
  const result = {};
  for (const [id, saved] of Object.entries(settings)) {
    if (!/^[1-9]\d{0,15}$/.test(id) || !Number.isSafeInteger(Number(id)) || !isRecord(saved)) throw new Error("Неверный ID в настройках эффектов");
    if (!Number.isInteger(saved.level) || saved.level < 1 || saved.level > 13) throw new Error("Уровень эффекта должен быть от 1 до 13");
    if (!["normal", "rs", "je"].includes(saved.variant)) throw new Error("Неизвестный светлый/тёмный вариант эффекта");
    const activeStates = saved.activeStates ?? [];
    if (!Array.isArray(activeStates) || activeStates.length > 64 || activeStates.some((key) => typeof key !== "string" || !/^\d{1,3}:\d{1,3}:(normal|rs|je)$/.test(key))) throw new Error("Неверный список состояний эффекта");
    result[id] = { level: saved.level, variant: saved.variant, activeStates: [...new Set(activeStates)] };
  }
  return result;
}

// Подписи тех параметров исходного fuState, которые выводятся/считаются здесь.
export const EFFECT_VALUE_LABELS = {
  oj_for_fu: "требуемый уровень", ve: "дальность", mp: "маг. энергия", channel: "время активации", vy: "призывание", vw: "перезарядка", vj: "время действия",
  tb: "повышает физ. защиту", od: "повышает физ. защиту от снаряжения", va: "уменьшает физ. защиту",
  xk: "повышает маг. защиту", og: "повышает маг. защиту от снаряжения", pt: "уменьшает маг. защиту",
  fw: "увеличивает макс. здоровье", eh: "уменьшает макс. здоровье", vd: "увеличивает макс. запас маны", ef: "уменьшает макс. запас маны", zk: "добавляет здоровье",
  bx: "увеличивает меткость", gs_ae: "увеличивает меткость", yr: "уменьшает меткость", br: "увеличивает уклонение", na: "уменьшает уклонение",
  jk: "увеличивает шанс крит. удара", gs_crit_rage_ghk: "увеличивает урон от крит. удара",
  yh: "повышает физ. атаку", xp: "уменьшает физ. атаку", gs_oi_av: "повышает физ. атаку",
  sq: "повышает маг. атаку", so: "уменьшает маг. атаку", gs_xq: "повышает маг. атаку",
  ln: "увеличивает скорость передвижения", la: "уменьшает скорость передвижения", gs_cl: "увеличивает скорость передвижения",
  re: "увеличивает скорость подготовки заклинаний", xj: "уменьшает скорость подготовки заклинаний",
  wh: "увеличивает скорость атаки", gn: "уменьшает скорость атаки",
  gs_ad: "увеличивает показатель атаки", gs_sx: "увеличивает показатель защиты", vh_ad: "уменьшает показатель атаки", vh_sx: "уменьшает показатель защиты",
  uu: "увеличивает уровень скрытности", uu_detect: "увеличивает уровень обнаружения",
  gs_ad_from_sx_eg: "увеличивает уровень атаки от защиты", vh_sx_min_20_eg: "уменьшает уровень защиты (мин. на 20)",
};
const ELEMENTS = { lw: "металла", mo: "дерева", dn: "воды", vt: "огня", sp: "земли" };
for (const [key, label] of Object.entries(ELEMENTS)) {
  EFFECT_VALUE_LABELS[`gs_${key}_gq_eg`] = `повышает защиту от ${label}`;
  EFFECT_VALUE_LABELS[`vh_${key}_gq_eg`] = `уменьшает защиту от ${label}`;
}
const PERCENT_TYPES = new Set(["tb", "od", "va", "xk", "og", "pt", "fw", "eh", "vd", "ef", "bx", "yr", "br", "na", "jk", "gs_crit_rage_ghk", "yh", "xp", "sq", "so", "ln", "la", "re", "xj", "wh", "gn", "gs_ad_from_sx_eg", "vh_sx_min_20_eg",
  ...Object.keys(ELEMENTS).flatMap((key) => [`gs_${key}_gq_eg`, `vh_${key}_gq_eg`])]);
export const SUPPORTED_EFFECT_TYPES = new Set([...Object.keys(EFFECT_VALUE_LABELS)].filter((key) => !["oj_for_fu", "ve", "mp", "channel", "vy", "vw", "vj"].includes(key)));

function recordOf(effect) {
  const record = effect?.record ?? effect?.source_record;
  return isRecord(record) ? record : {};
}

// Исходный sd.xz: порядок классов в визуальной панели ему не равен.
export const EFFECT_CLASS_IDS = { by: 1, ga: 2, ya: 3, rl: 4, ij: 5, js: 6, fx: 7, sj: 8, ej: 9, rg: 10 };

function classAllowed(restriction, cls) {
  const classes = Array.isArray(restriction) ? restriction : Number.isInteger(restriction) ? [restriction] : [];
  return classes.length === 0 || classes.includes(EFFECT_CLASS_IDS[cls]);
}

export function canUseEffect(effect, cls) {
  return classAllowed(recordOf(effect).hi, cls);
}

export function canUseEffectState(effect, state, cls) {
  return canUseEffect(effect, cls) && classAllowed(state?.hi, cls);
}

function selection(effect, settings = {}) {
  const record = recordOf(effect);
  const maximum = Math.max(1, Math.trunc(numeric(record.ue)) || 1);
  let level = Number.isInteger(settings.level) ? settings.level : maximum;
  level = Math.max(1, Math.min(maximum, level));
  let variant = ["rs", "je"].includes(settings.variant) ? settings.variant : "normal";
  if (variant !== "normal") {
    const variantLevel = Object.keys(record.addition_hf ?? {}).map(Number).filter((key) => Number.isInteger(key) && key >= 1 && Object.hasOwn(record.addition_hf[key] ?? {}, variant)).sort((a, b) => a - b)[0];
    if (variantLevel) level = variantLevel;
    else variant = "normal";
  }
  return { record, level, variant };
}

function fill(text, values) {
  return String(text ?? "").replace(/\{([a-zA-Z0-9_ -]+)\}/g, (token, key) => Object.hasOwn(values, key) ? String(values[key]) : token);
}

export function resolveEffect(effect, settings = {}) {
  const { record, level, variant } = selection(effect, settings);
  const values = {};
  const keys = new Set([...Object.keys(record.lm ?? {}), ...Object.keys(record.qc ?? {})]);
  for (const key of keys) {
    const qc = record.qc?.[key];
    const correction = qc?.[level];
    const extra = isRecord(correction) ? (variant === "normal" ? 0 : numeric(correction[variant])) : numeric(correction);
    const value = numeric(record.lm?.[key]) + numeric(qc?.[0]) * (level - 1) + extra;
    // sd.hs displays one decimal after level arithmetic.
    values[key] = Number(value.toFixed(1));
  }
  const suffix = variant === "normal" ? "" : ` ${variant}`;
  const names = effect?.names ?? {};
  const descriptions = effect?.descriptions ?? {};
  const name = names[`mi${suffix}`] ?? names.mi ?? effect?.name ?? `Эффект ${effect?.id ?? ""}`;
  const baseDescription = descriptions.desc ?? effect?.description ?? "";
  const extraDescription = suffix ? descriptions[`desc${suffix}`] : "";
  const warnings = [];
  if (settings.variant && settings.variant !== variant) warnings.push(`${name}: выбранный вариант недоступен, используется обычный.`);
  if (settings.variant === "normal" && settings.level !== undefined && settings.level !== level) warnings.push(`${name}: уровень ограничен доступным диапазоном.`);
  const variantIcon = variant === "normal" ? 0 : numeric(record.addition_hf?.[level]?.[variant]?.an);
  return { id: effect?.id, name, description: fill([baseDescription, extraDescription].filter(Boolean).join("\n"), values),
    sprite_id: variantIcon || effect?.sprite_id || record.an || 0, level, variant, values, warnings };
}

export function getEffectStates(effect, settings = {}) {
  const { record, level, variant } = selection(effect, settings);
  const resolved = resolveEffect(effect, settings);
  const result = [];
  for (const [threshold, entries] of Object.entries(record.states ?? {}).sort(([a], [b]) => Number(a) - Number(b))) {
    if (Number(threshold) > level || !Array.isArray(entries)) continue;
    entries.forEach((entry, index) => {
      if (!isRecord(entry)) return;
      const wrapped = !entry.type && !entry.types;
      const state = wrapped ? (variant !== "normal" ? entry[variant] : null) : entry;
      if (!isRecord(state)) return;
      const types = state.types ?? (state.type ? [state.type] : []);
      if (!Array.isArray(types) || types.some((type) => typeof type !== "string")) return;
      const values = Object.fromEntries(types.map((type, typeIndex) => [type, numeric(state.vals?.[typeIndex]) || numeric(state.val) || numeric(resolved.values[type])]));
      const label = types.map((type) => `${EFFECT_VALUE_LABELS[type] ?? type}: ${values[type]}${PERCENT_TYPES.has(type) ? "%" : ""}`).join("; ");
      result.push({ key: `${threshold}:${index}:${wrapped ? variant : "normal"}`, icon: numeric(state.an), label, types: [...types], values,
        base: result.length === 0, checkbox: Boolean(state.checkbox), exclusiveId: state.id ?? null, group: state.group ?? null,
        hi: Array.isArray(state.hi) ? [...state.hi] : Number.isInteger(state.hi) ? [state.hi] : [] });
    });
  }
  return result;
}

// Эти исторические поправки — дословная арифметика sd.tq, а не догадки
// о сервере. Они применяются к выбранным состояниям в исходном порядке.
function sourceCorrections(id, resolved, entries) {
  const values = entries.map((entry) => ({ ...entry }));
  if (!values.length) return values;
  if ([4, 98, 104, 162].includes(id)) values[0].value -= 1;
  if ([62, 71, 16, 68, 65, 74, 80, 77, 86, 83, 270, 273].includes(id) && [1, 2, 3, 4, 6, 8].includes(resolved.level) && values[1]) {
    values[0].value -= 1; values[1].value -= 1;
  }
  if ([116, 140, 144, 148, 152].includes(id) && values[1]) values[1].value += 1;
  if (id === 196) values[0].value = 30;
  if (id === 5 && resolved.level === 11 && resolved.variant === "rs") values[0].value -= 0.5;
  if (id === 341) values[0].value += 6;
  return values;
}

export function collectEffects(ids, settings = {}, catalog = [], context = {}) {
  const modifiers = {}, warnings = [], contributions = [];
  const map = new Map((Array.isArray(catalog) ? catalog : []).map((effect) => [effect.id, effect]));
  const selected = [];
  const baseIds = new Set(ids);
  const extraIds = Object.entries(settings).filter(([, saved]) => saved?.activeStates?.length).map(([id]) => Number(id));
  for (const id of new Set([...ids, ...extraIds])) {
    const effect = map.get(id);
    if (!effect) {
      const reason = `Эффект ${id}: отсутствует в загруженном каталоге, не учтён.`;
      warnings.push(reason);
      contributions.push({ label: `Эффект ${id}`, kind: "effect", active: false, reason,
        entries: [{ label: "Неизвестное влияние", stat: "unknown", value: null, percent: false }] });
      continue;
    }
    const resolved = resolveEffect(effect, settings[id]);
    warnings.push(...resolved.warnings);
    const skipped = (reason) => {
      warnings.push(reason);
      contributions.push({ label: resolved.name, kind: "effect", active: false, reason,
        entries: [{ label: "Не применяется", stat: "unknown", value: null, percent: false }] });
    };
    if (!canUseEffect(effect, context.cls)) { skipped(`${resolved.name}: недоступно выбранному классу, не учтено.`); continue; }
    const requiredForm = id === 12 ? 8 : id === 21 ? 27 : null;
    if (requiredForm && !ids.includes(requiredForm)) { skipped(`${resolved.name}: действует только в соответствующем облике.`); continue; }
    if ([55, 56, 109].includes(id) && context.hasWeapon === false) { skipped(`${resolved.name}: действует только с оружием.`); continue; }
    const states = getEffectStates(effect, settings[id]);
    const active = new Set(settings[id]?.activeStates ?? []);
    if (!states.length) warnings.push(`${resolved.name}: нет распознанных состояний, влияние не учтено.`);
    const wanted = (state) => (state.base && baseIds.has(id)) || active.has(state.key);
    const available = states.filter((state) => canUseEffectState(effect, state, context.cls));
    // Группа синхронизирует щелчок в UI. Затем отдельный конфликт может
    // выключить лишь один её значок; расчёт сохраняет точный явный выбор.
    const entries = available.filter(wanted);
    for (const state of states) if (wanted(state) && !canUseEffectState(effect, state, context.cls)) warnings.push(`${resolved.name}: состояние ${state.key} недоступно выбранному классу.`);
    const kind = effect.kind === "debuff" ? "debuff" : "buff";
    for (const state of entries) {
      const variantLabel = { normal: "обычный", rs: "светлый", je: "тёмный" }[resolved.variant];
      const source = { label: `${resolved.name} · ур. ${resolved.level} · ${variantLabel}`, kind: "effect", active: true, reason: "",
        entries: state.types.map((type) => ({ label: EFFECT_VALUE_LABELS[type] ?? type, stat: type,
          value: SUPPORTED_EFFECT_TYPES.has(type) ? state.values[type] : null, percent: PERCENT_TYPES.has(type) })) };
      contributions.push(source);
      // Красные состояния с общим id заменяют друг друга в исходном UI.
      if (state.exclusiveId !== null) {
        const duplicate = selected.findIndex((entry) => entry.kind === kind && entry.exclusiveId === state.exclusiveId);
        if (duplicate !== -1) {
          warnings.push(`${resolved.name}: заменяет несовместимое состояние ${selected[duplicate].name}.`);
          selected[duplicate].source.active = false;
          selected[duplicate].source.reason = `Несовместимое состояние заменено: ${resolved.name}.`;
          selected.splice(duplicate, 1);
        }
      }
      selected.push({ ...state, id, kind, name: resolved.name, resolved, source });
    }
    for (const key of active) if (!states.some((state) => state.key === key)) warnings.push(`${resolved.name}: состояние ${key} недоступно для выбранного уровня.`);
  }
  for (const id of new Set(selected.map((state) => state.id))) {
    const states = selected.filter((state) => state.id === id);
    const resolved = states[0].resolved;
    const entries = states.flatMap((state) => state.types.map((type, index) => ({ type, value: state.values[type], source: state.source, index })));
    for (const { type, value, source, index } of sourceCorrections(id, resolved, entries)) {
      if (!SUPPORTED_EFFECT_TYPES.has(type)) { warnings.push(`${resolved.name}: состояние ${type} пока не поддержано и не учтено.`); continue; }
      modifiers[type] = (modifiers[type] ?? 0) + value;
      source.entries[index].value = value;
    }
  }
  return { modifiers, warnings, contributions };
}
