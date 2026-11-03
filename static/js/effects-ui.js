import { canUseEffect, canUseEffectState, EFFECT_VALUE_LABELS, getEffectStates, resolveEffect } from "./engine/effects.js?v=20261103-bonuses";

const KINDS = ["buff", "debuff"];
const KIND_NAMES = { buff: "баф", debuff: "дебаф" };
const fmt = (value) => Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 1 });
const uniqueIds = (values = []) => [...new Set(values.map(Number).filter(Number.isSafeInteger))];
const plain = (text) => String(text ?? "").replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

function node(tag, props = {}, children = []) {
  const element = Object.assign(document.createElement(tag), props);
  element.append(...children);
  return element;
}

function skillIcon(sprite) {
  return node("span", { className: `ref-skill ref-skill-${Number(sprite) || 0}`, ariaHidden: "true" });
}

/** Owns presentation only; the current build always comes from getState(). */
export function createEffectsUI({ getState, onChange }) {
  const host = document.querySelector(".calc");
  const lists = Object.fromEntries(KINDS.map((kind) => [kind, document.getElementById(`${kind}-list`)]));
  const all = Object.fromEntries(KINDS.map((kind) => [kind, document.getElementById(`${kind}s-all`)]));
  const expand = document.getElementById("effects-expand");
  let catalog = [], byId = new Map(), panels = {}, labels = EFFECT_VALUE_LABELS;
  let popup = null, opened = null, anchor = null, rendered = 0, build = null, renderedClass = null;

  function settingsFor(effect) {
    return { level: Math.max(1, Number(effect.record?.ue) || 1), variant: "normal", activeStates: [], ...getState().effectSettings?.[effect.id] };
  }
  function active(id) { return getState().effects?.includes(id) ?? false; }
  function defaults() { return panels[getState().cls] ?? catalog.filter((effect) => effect.panel_default).map((effect) => effect.id); }
  function visible(kind) {
    const state = getState();
    return uniqueIds([...defaults(), ...(state.addedEffects ?? []), ...(state.effects ?? [])])
      .filter((id) => !(state.hiddenEffects ?? []).includes(id)).map((id) => byId.get(id)).filter((effect) => effect?.kind === kind && canUseEffect(effect, state.cls));
  }
  function change(mutator) {
    const previous = rendered;
    mutator(getState());
    onChange();
    if (previous === rendered) render();
  }
  function saveSettings(effect, patch) {
    change((state) => {
      state.effectSettings ??= {};
      const next = { ...settingsFor(effect), ...patch };
      const available = new Set(getEffectStates(effect, next).map((entry) => entry.key));
      next.activeStates = next.activeStates.filter((key) => available.has(key));
      state.effectSettings[effect.id] = next;
    });
  }
  function toggle(effect, checked) {
    change((state) => { state.effects = checked ? uniqueIds([...(state.effects ?? []), effect.id]) : (state.effects ?? []).filter((id) => id !== effect.id); });
  }
  function linkedStates(effect, entry) {
    return entry.group ? getEffectStates(effect, settingsFor(effect)).filter((other) => other.group === entry.group && canUseEffectState(effect, other, getState().cls)) : [entry];
  }
  function assignStates(state, effect, entries, checked) {
    const settings = settingsFor(effect);
    const keys = new Set(settings.activeStates);
    for (const other of entries) {
      if (!other.base && checked) keys.add(other.key); else keys.delete(other.key);
    }
    state.effectSettings ??= {};
    state.effectSettings[effect.id] = { ...settings, activeStates: [...keys] };
    if (entries.some((other) => other.base)) state.effects = checked ? uniqueIds([...(state.effects ?? []), effect.id]) : (state.effects ?? []).filter((id) => id !== effect.id);
  }
  function toggleState(effect, entry, checked) {
    if (!canUseEffectState(effect, entry, getState().cls)) return;
    const linked = linkedStates(effect, entry);
    change((state) => {
      if (checked) {
        const exclusive = new Set(linked.map((other) => other.exclusiveId).filter((id) => id !== null));
        for (const otherEffect of catalog.filter((candidate) => candidate.kind === effect.kind)) for (const other of getEffectStates(otherEffect, settingsFor(otherEffect))) {
          if (exclusive.has(other.exclusiveId) && stateIsActive(otherEffect, other) && !(otherEffect.id === effect.id && linked.some((current) => current.key === other.key))) assignStates(state, otherEffect, [other], false);
        }
      }
      assignStates(state, effect, linked, checked);
    });
  }
  function stateIsActive(effect, entry) {
    if (!canUseEffectState(effect, entry, getState().cls)) return false;
    const settings = settingsFor(effect);
    return entry.base ? active(effect.id) : settings.activeStates.includes(entry.key);
  }
  function anyActive(effect) {
    return active(effect.id) || getEffectStates(effect, settingsFor(effect)).some((entry) => stateIsActive(effect, entry));
  }
  function allSelection(items) {
    const claimed = new Set(), result = [];
    for (const effect of items) {
      const states = getEffectStates(effect, settingsFor(effect));
      const chosen = [];
      for (const entry of states) {
        if (!canUseEffectState(effect, entry, getState().cls)) continue;
        if (entry.exclusiveId !== null && claimed.has(entry.exclusiveId)) continue;
        chosen.push(entry);
        if (entry.exclusiveId !== null) claimed.add(entry.exclusiveId);
      }
      result.push({ effect, entries: chosen, fallback: !states.length });
    }
    return result;
  }
  function stateControl(effect, entry, detailed = false) {
    const checked = stateIsActive(effect, entry);
    const disabled = !canUseEffectState(effect, entry, getState().cls);
    const label = `${entry.base ? "Основное состояние" : "Дополнительное состояние"}: ${plain(entry.label)}${disabled ? " · Недоступно текущему классу" : ""}`;
    if (entry.checkbox || !entry.icon) {
      const input = node("input", { type: "checkbox", checked, disabled, ariaLabel: label });
      input.dataset.control = entry.key;
      input.addEventListener("change", () => toggleState(effect, entry, input.checked));
      return node("label", { className: detailed ? "effects-state-option" : "effects-passive", title: label }, detailed ? [input, node("span", { textContent: plain(entry.label) })] : [input]);
    }
    const button = node("button", { type: "button", disabled, className: detailed ? "effects-state-option" : "effect-state", ariaLabel: label, title: label });
    button.setAttribute("aria-pressed", String(checked));
    button.dataset.control = entry.key;
    const icon = node("span", { className: `ref-state ref-state-${Number(entry.icon)}`, ariaHidden: "true" });
    button.append(icon);
    if (detailed) button.append(node("span", { textContent: plain(entry.label) }));
    button.addEventListener("click", () => toggleState(effect, entry, !checked));
    return button;
  }

  function tile(effect) {
    const resolved = resolveEffect(effect, settingsFor(effect));
    const entries = getEffectStates(effect, settingsFor(effect));
    const item = node("li", { className: `effect effect--${effect.kind} effect--editable` });
    item.dataset.effectId = String(effect.id);
    const button = node("button", { type: "button", className: "effect__tile", title: `${resolved.name} · ${resolved.level} ур.\n${plain(resolved.description)}`, ariaLabel: `Настроить: ${resolved.name}, ${resolved.level} ур.` }, [skillIcon(resolved.sprite_id)]);
    button.dataset.variant = resolved.variant;
    button.setAttribute("aria-controls", "ie");
    button.setAttribute("aria-expanded", String(opened?.id === effect.id && opened.mode === "detail"));
    if (anyActive(effect)) button.classList.add("is-active");
    button.addEventListener("click", () => openDetail(effect, button));
    const controls = node("div", { className: "effects-state-row" });
    if (entries.length) controls.append(...entries.map((entry) => stateControl(effect, entry)));
    else {
      const input = node("input", { type: "checkbox", checked: active(effect.id), ariaLabel: `Использовать: ${resolved.name}` });
      input.dataset.control = "use-effect";
      input.addEventListener("change", () => toggle(effect, input.checked));
      controls.append(node("label", { className: "effects-passive" }, [input]));
    }
    item.append(button, controls);
    return item;
  }

  function close(restoreFocus = true) {
    const target = anchor;
    const id = opened?.id, kind = opened?.kind;
    popup?.remove(); popup = null; opened = null; anchor = null;
    expand?.setAttribute("aria-expanded", "false");
    document.querySelectorAll(".effect__tile[aria-expanded=true]").forEach((button) => button.setAttribute("aria-expanded", "false"));
    if (restoreFocus) (target?.isConnected ? target : id ? host.querySelector(`[data-effect-id="${id}"] .effect__tile`) : lists[kind]?.querySelector(".effect-add"))?.focus({ preventScroll: true });
  }
  function frame(title) {
    const window = node("section", { id: "ie", className: "game-dialog effects-popup" });
    window.setAttribute("role", "dialog");
    window.setAttribute("aria-modal", "false");
    window.setAttribute("aria-labelledby", "effects-window-title");
    const closeButton = node("button", { type: "button", className: "dialog-close", textContent: "×", ariaLabel: "Закрыть окно умений" });
    closeButton.addEventListener("click", () => close());
    window.append(node("header", { className: "dialog-title" }, [node("h2", { id: "effects-window-title", textContent: title }), closeButton]));
    return window;
  }
  function positionPopup() {
    if (!popup) return;
    if (!anchor?.isConnected) anchor = opened?.id ? host.querySelector(`[data-effect-id="${opened.id}"] .effect__tile`) : lists[opened?.kind]?.querySelector(".effect-add");
    const viewport = window.visualViewport;
    const leftEdge = viewport?.offsetLeft ?? 0, topEdge = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight;
    const margin = 8;
    popup.style.maxHeight = `${Math.max(100, height - margin * 2)}px`;
    const rect = anchor?.getBoundingClientRect() ?? host.getBoundingClientRect();
    const dimensions = popup.getBoundingClientRect(), hostRect = host.getBoundingClientRect();
    const x = Math.max(leftEdge + margin, Math.min(rect.left, leftEdge + width - dimensions.width - margin));
    let y = rect.bottom + margin;
    if (y + dimensions.height > topEdge + height - margin) y = Math.max(topEdge + margin, rect.top - dimensions.height - margin);
    popup.style.left = `${Math.round(x - hostRect.left)}px`;
    popup.style.top = `${Math.round(y - hostRect.top)}px`;
  }
  function openDetail(effect, target) {
    close(false); anchor = target; opened = { mode: "detail", id: effect.id, kind: effect.kind };
    renderPopup();
    target.setAttribute("aria-expanded", "true");
    popup.querySelector(".dialog-close").focus({ preventScroll: true });
  }
  function remove(effect) {
    close(false);
    change((state) => {
      state.effects = (state.effects ?? []).filter((id) => id !== effect.id);
      state.addedEffects = (state.addedEffects ?? []).filter((id) => id !== effect.id);
      state.hiddenEffects = uniqueIds([...(state.hiddenEffects ?? []), effect.id]);
      if (state.effectSettings) delete state.effectSettings[effect.id];
    });
    lists[effect.kind].querySelector(".effect-add")?.focus({ preventScroll: true });
  }
  function renderDetail(effect) {
    const settings = settingsFor(effect), resolved = resolveEffect(effect, settings);
    const window = frame(resolved.name);
    const content = node("div", { className: "effects-popup__content" });
    const summary = node("div", { className: "effects-skill-heading" }, [skillIcon(resolved.sprite_id), node("strong", { textContent: `${resolved.level} ур.${resolved.variant === "rs" ? " · светл." : resolved.variant === "je" ? " · темн." : ""}` })]);
    const removeButton = node("button", { type: "button", className: "text-button effects-remove", textContent: "Удалить", ariaLabel: `Удалить: ${resolved.name}` });
    removeButton.addEventListener("click", () => remove(effect));
    summary.append(removeButton); content.append(summary);
    const parameters = node("dl", { className: "effects-parameters" });
    for (const [key, value] of Object.entries(resolved.values)) {
      if (!Number.isFinite(value)) continue;
      parameters.append(node("div", {}, [node("dt", { textContent: plain(labels[key] ?? key) }), node("dd", { textContent: fmt(value) })]));
    }
    content.append(parameters);
    const max = Math.max(1, Number(effect.record?.ue) || 1);
    const controls = node("div", { className: "effects-level-controls", ariaLabel: "Уровень умения" });
    const levelButton = (text, level, disabled) => {
      const button = node("button", { type: "button", textContent: text, disabled });
      button.dataset.control = `level-${text}`;
      button.addEventListener("click", () => saveSettings(effect, { level, variant: "normal" }));
      controls.append(button);
    };
    levelButton("1 ур.", 1, resolved.variant === "normal" && resolved.level === 1);
    levelButton("−1 ур.", Math.max(1, resolved.level - 1), resolved.variant === "normal" && resolved.level === 1);
    levelButton("+1 ур.", Math.min(max, resolved.level + 1), resolved.variant === "normal" && resolved.level === max);
    levelButton(`${max} ур.`, max, resolved.variant === "normal" && resolved.level === max);
    for (const [variant, text] of [["rs", "светл."], ["je", "темн."]]) {
      if (!Object.values(effect.record?.addition_hf ?? {}).some((entry) => Object.hasOwn(entry, variant))) continue;
      const button = node("button", { type: "button", textContent: text });
      button.dataset.control = variant;
      button.setAttribute("aria-pressed", String(resolved.variant === variant));
      button.addEventListener("click", () => saveSettings(effect, { level: max, variant }));
      controls.append(button);
    }
    content.append(controls);
    const states = getEffectStates(effect, settings);
    const options = node("div", { className: "effects-state-options", ariaLabel: "Активные состояния" });
    if (states.length) options.append(...states.map((entry) => stateControl(effect, entry, true)));
    else {
      const input = node("input", { type: "checkbox", checked: active(effect.id) });
      input.dataset.control = "use-effect";
      input.addEventListener("change", () => toggle(effect, input.checked));
      options.append(node("label", { className: "effects-state-option" }, [input, node("span", { textContent: "Использовать умение" })]));
    }
    content.append(options, node("p", { className: "effects-description", textContent: plain(resolved.description) }));
    const warnings = [...resolved.warnings];
    if (/\{[^}]+\}/.test(resolved.description)) warnings.push("Часть параметров описания отсутствует в локальных данных.");
    if (warnings.length) content.append(node("ul", { className: "effects-warnings" }, warnings.map((warning) => node("li", { textContent: warning }))));
    window.append(content);
    return window;
  }

  function openChooser(kind, target) {
    close(false); anchor = target; opened = { mode: "choose", kind, term: "" };
    renderPopup();
    expand?.setAttribute("aria-expanded", "true");
    popup.querySelector("input[type=search]").focus({ preventScroll: true });
  }
  function addEffect(effect) {
    opened = { mode: "detail", id: effect.id, kind: effect.kind };
    change((state) => {
      state.hiddenEffects = (state.hiddenEffects ?? []).filter((id) => id !== effect.id);
      state.addedEffects = uniqueIds([...(state.addedEffects ?? []), effect.id]);
    });
    anchor = host.querySelector(`[data-effect-id="${effect.id}"] .effect__tile`);
    popup?.querySelector(".dialog-close").focus({ preventScroll: true });
  }
  function chooserResults(container, count) {
    const term = opened.term.trim().toLocaleLowerCase("ru-RU").replaceAll("ё", "е");
    const displayed = new Set(visible(opened.kind).map((effect) => effect.id));
    const items = catalog.filter((effect) => effect.kind === opened.kind && canUseEffect(effect, getState().cls) && !displayed.has(effect.id) && (!term || `${effect.name} ${effect.id}`.toLocaleLowerCase("ru-RU").replaceAll("ё", "е").includes(term)));
    count.textContent = `Найдено: ${items.length}`;
    container.replaceChildren(...items.map((effect) => {
      const resolved = resolveEffect(effect, settingsFor(effect));
      const button = node("button", { type: "button", className: "effects-choice", title: plain(resolved.description) }, [skillIcon(resolved.sprite_id), node("span", { textContent: resolved.name })]);
      button.addEventListener("click", () => addEffect(effect));
      return button;
    }));
    if (!items.length) container.append(node("p", { className: "muted", textContent: term ? "Умений не найдено. Измените поиск." : "Все доступные умения уже на панели." }));
  }
  function renderChooser() {
    const window = frame(opened.kind === "buff" ? "Добавить баф" : "Добавить дебаф");
    window.classList.add("effects-popup--chooser");
    const search = node("input", { type: "search", placeholder: "Название или ID умения", ariaLabel: `Найти ${KIND_NAMES[opened.kind]}`, value: opened.term, autocomplete: "off" });
    const count = node("p", { className: "effects-choice-count", role: "status" });
    const results = node("div", { className: "effects-choices" });
    search.addEventListener("input", () => { opened.term = search.value; chooserResults(results, count); });
    window.append(node("div", { className: "effects-popup__content" }, [search, count, results]));
    chooserResults(results, count);
    return window;
  }
  function renderPopup() {
    if (!opened) return;
    const focus = popup?.contains(document.activeElement) ? document.activeElement.dataset.control : null;
    popup?.remove();
    const effect = byId.get(opened.id);
    if (opened.mode === "detail" && (!effect || !canUseEffect(effect, getState().cls))) { close(); return; }
    popup = opened.mode === "detail" ? renderDetail(effect) : renderChooser();
    host.append(popup); positionPopup();
    if (focus) {
      const next = [...popup.querySelectorAll("[data-control]")].find((control) => control.dataset.control === focus && !control.disabled);
      (next ?? popup.querySelector(".dialog-close")).focus({ preventScroll: true });
    }
  }
  function render() {
    rendered++;
    const focused = document.activeElement;
    const focusedItem = focused?.closest("[data-effect-id]");
    const focusId = focusedItem?.dataset.effectId, focusControl = focused?.dataset.control;
    if (build !== getState() || renderedClass !== getState().cls) { close(false); build = getState(); renderedClass = build.cls; }
    for (const kind of KINDS) {
      const items = visible(kind);
      const add = node("button", { type: "button", className: "effect-add", textContent: "+", title: `Добавить ${KIND_NAMES[kind]}`, ariaLabel: `Добавить ${KIND_NAMES[kind]}` });
      add.addEventListener("click", () => openChooser(kind, add));
      lists[kind].replaceChildren(...items.map(tile), node("li", { className: "effect effect--add" }, [add]));
      const selection = allSelection(items);
      all[kind].checked = selection.length > 0 && selection.every(({ effect, entries, fallback }) => fallback ? active(effect.id) : entries.every((entry) => stateIsActive(effect, entry)));
      all[kind].indeterminate = !all[kind].checked && items.some(anyActive);
      all[kind].disabled = !items.length;
    }
    renderPopup();
    if (focusId && !focused.isConnected) {
      const item = host.querySelector(`[data-effect-id="${focusId}"]`);
      const next = focusControl ? [...(item?.querySelectorAll("[data-control]") ?? [])].find((control) => control.dataset.control === focusControl) : item?.querySelector(".effect__tile");
      next?.focus({ preventScroll: true });
    }
  }
  for (const kind of KINDS) all[kind].addEventListener("change", () => {
    const checked = all[kind].checked, items = visible(kind), ids = items.map((effect) => effect.id);
    const selection = checked ? allSelection(items) : [];
    change((state) => {
      state.effects = (state.effects ?? []).filter((id) => !ids.includes(id));
      for (const id of ids) if (state.effectSettings?.[id]) state.effectSettings[id] = { ...state.effectSettings[id], activeStates: [] };
      for (const { effect, entries, fallback } of selection) {
        if (fallback) state.effects = uniqueIds([...state.effects, effect.id]);
        else assignStates(state, effect, entries, true);
      }
    });
  });
  expand?.addEventListener("click", () => openChooser("buff", expand));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && popup) { event.preventDefault(); close(); } });
  document.addEventListener("pointerdown", (event) => { if (popup && !popup.contains(event.target) && event.target !== anchor && !anchor?.contains(event.target)) close(false); });
  window.addEventListener("resize", positionPopup);
  window.addEventListener("scroll", positionPopup, { passive: true });
  window.visualViewport?.addEventListener("resize", positionPopup);
  return {
    setCatalog({ effects = [], panels: nextPanels = {}, parameter_labels = {} }) {
      catalog = effects; byId = new Map(effects.map((effect) => [effect.id, effect])); panels = nextPanels;
      labels = { ...EFFECT_VALUE_LABELS, ...parameter_labels }; render();
    },
    render,
    close,
  };
}
