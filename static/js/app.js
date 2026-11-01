import { ATTRS, BASE_ATTR, CLASSES, MAX_LEVEL, clampLevel, computeStats, spentPoints, totalPoints } from "./engine/stats.js";

const ATTR_NAMES = { vit: "Внсл", int: "Интл", str: "Сила", dex: "Ловк" };
const fmt = (n) => Number(n).toLocaleString("ru-RU");
const pct = (n) => `${fmt(Math.round(n))}%`;
const STAT_ROWS = [
  ["Физ. атака", (s) => `${fmt(s.physAtk[0])}–${fmt(s.physAtk[1])}`, "Физ. защита", (s) => fmt(s.physDef), (s) => `Снижение урона ${pct(s.physDefPct)}`],
  ["Маг. атака", (s) => fmt(s.magAtk), "Маг. защита", (s) => fmt(s.magDef), (s) => `Снижение урона ${pct(s.magDefPct)}`],
  ["Шанс крит.", (s) => pct(s.crit), "Металл", (s) => fmt(s.elements.metal)],
  ["Атак/сек", (s) => `${s.atkSpeed.toFixed(2).replace(".", ",")} уд/сек`, "Дерево", (s) => fmt(s.elements.wood)],
  ["Время пения", (s) => pct(s.castTime), "Вода", (s) => fmt(s.elements.water)],
  ["Меткость", (s) => fmt(s.accuracy), "Огонь", (s) => fmt(s.elements.fire)],
  ["Уклонение", (s) => fmt(s.evasion), "Земля", (s) => fmt(s.elements.earth)],
  ["Атака ПА", (s) => fmt(s.attackLevel), "Защита ПЗ", (s) => fmt(s.defenseLevel)],
  ["Скорость", (s) => `${s.speed.toFixed(1).replace(".", ",")} м/сек`, "Крит. урон", (s) => pct(s.critDamage)],
  ["Боевой дух", () => "0", "Сила духа", (s) => fmt(s.spirit)],
  ["Скрытность", (s) => fmt(s.stealth), "Обнаружение", (s) => fmt(s.detection)],
];
const SLOTS = [
  ["Шлем", "left"], ["Ожерелье", "left"], ["Накидка", "left"], ["Доспех", "left"], ["Наручи", "left"],
  ["Пояс", "right"], ["Поножи", "right"], ["Обувь", "right"], ["Кольцо", "right"], ["Кольцо", "right"],
  ["Оружие", "bottom"], ["Снаряды", "bottom"], ["Талисман", "bottom"], ["Полёт", "bottom"],
];

const $ = (id) => document.getElementById(id);
const state = { cls: "by", level: MAX_LEVEL, attrs: Object.fromEntries(ATTRS.map((k) => [k, BASE_ATTR])) };

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function setupCharacter() {
  const select = $("char-class");
  for (const [code, cls] of Object.entries(CLASSES)) select.append(el("option", { value: code, textContent: cls.name }));
  select.addEventListener("change", () => { state.cls = select.value; render(); });

  $("char-level").addEventListener("change", (event) => {
    state.level = clampLevel(event.target.value);
    if (spentPoints(state.attrs) > totalPoints(state.level)) {
      resetAttrs();
      $("char-message").textContent = "На этом уровне меньше очков: распределение сброшено.";
    }
    render();
  });

  const list = $("attr-list");
  for (const key of ATTRS) {
    const input = el("input", { type: "number", min: BASE_ATTR, id: `attr-${key}`, inputMode: "numeric" });
    input.setAttribute("aria-label", ATTR_NAMES[key]);
    input.addEventListener("change", () => setAttr(key, Number(input.value)));
    const minus = el("button", { type: "button", textContent: "−", ariaLabel: `${ATTR_NAMES[key]} −1` });
    const plus = el("button", { type: "button", textContent: "+", ariaLabel: `${ATTR_NAMES[key]} +1` });
    minus.addEventListener("click", () => setAttr(key, state.attrs[key] - 1));
    plus.addEventListener("click", () => setAttr(key, state.attrs[key] + 1));
    list.append(el("div", { className: "attr" }, [el("span", { textContent: ATTR_NAMES[key] }), minus, input, plus]));
  }
  $("btn-reset").addEventListener("click", () => { resetAttrs(); render(); });
  $("btn-new").addEventListener("click", () => {
    Object.assign(state, { cls: "by", level: MAX_LEVEL });
    resetAttrs();
    $("char-name").value = "Без имени";
    document.querySelectorAll(".effect input, #buffs-all, #debuffs-all").forEach((box) => { box.checked = false; });
    render();
  });
}

function resetAttrs() {
  for (const key of ATTRS) state.attrs[key] = BASE_ATTR;
}

function setAttr(key, value) {
  const others = spentPoints(state.attrs) - (state.attrs[key] - BASE_ATTR);
  const max = BASE_ATTR + totalPoints(state.level) - others;
  const next = Number.isFinite(value) ? Math.trunc(value) : BASE_ATTR;
  state.attrs[key] = Math.min(max, Math.max(BASE_ATTR, next));
  $("char-message").textContent = next > max ? `Свободных очков не хватает: максимум ${max}.` : "";
  render();
}

function render() {
  const stats = computeStats(state);
  $("char-class").value = state.cls;
  $("char-level").value = stats.level;
  $("emblem").textContent = CLASSES[state.cls].name[0];
  $("out-hp").textContent = fmt(stats.hp);
  $("out-mp").textContent = fmt(stats.mp);
  $("out-free").textContent = fmt(stats.free);
  for (const key of ATTRS) {
    const input = $(`attr-${key}`);
    input.value = state.attrs[key];
    input.max = state.attrs[key] + stats.free;
    input.parentElement.children[1].disabled = state.attrs[key] <= BASE_ATTR;
    input.parentElement.children[3].disabled = stats.free <= 0;
  }
  $("stats-body").replaceChildren(
    ...STAT_ROWS.map(([l1, v1, l2, v2, hint]) => {
      const right = el("td", { className: "num", textContent: v2(stats) });
      if (hint) right.title = hint(stats);
      return el("tr", {}, [
        el("td", { className: "label", textContent: l1 }),
        el("td", { className: "num", textContent: v1(stats) }),
        el("td", { className: "label", textContent: l2 }),
        right,
      ]);
    }),
  );
}

function setupDoll() {
  const doll = $("paperdoll");
  let left = 0, right = 0, bottom = 0;
  for (const [name, side] of SLOTS) {
    const slot = el("button", { type: "button", className: `slot slot--${side}`, textContent: name });
    if (side === "left") slot.style.gridRow = String(++left);
    if (side === "right") slot.style.gridRow = String(++right);
    if (side === "bottom") slot.style.gridColumn = String(++bottom);
    slot.setAttribute("aria-label", `Слот: ${name}, пусто`);
    slot.addEventListener("click", () => {
      $("doll-message").textContent = `«${name}»: выбор предметов появится после завершения сбора базы Comeback.`;
    });
    doll.append(slot);
  }
  $("bag").append(...Array.from({ length: 32 }, () => el("span")));
}

function initials(name) {
  const words = name.replace(/[«»"]/g, "").split(/[\s·-]+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
}

async function setupEffects() {
  const buffList = $("buff-list");
  try {
    const response = await fetch("/api/effects/");
    if (!response.ok) throw new Error(response.status);
    const { effects } = await response.json();
    const lists = { buff: [], debuff: [] };
    for (const effect of effects) {
      const box = el("input", { type: "checkbox", value: effect.id });
      box.setAttribute("aria-label", effect.name);
      const tip = el("span", { className: "effect__tip", role: "tooltip" }, [
        el("b", { textContent: effect.name }),
        effect.class ? `${CLASSES[effect.class]?.name ?? ""}. ` : "",
        effect.description,
      ]);
      lists[effect.kind].push(
        el("li", { className: `effect effect--${effect.kind}` }, [box, el("span", { className: "effect__tile", textContent: initials(effect.name), ariaHidden: "true" }), tip]),
      );
    }
    buffList.replaceChildren(...lists.buff);
    $("debuff-list").replaceChildren(...(lists.debuff.length ? lists.debuff : [el("li", { className: "muted", textContent: "Нет дебаффов" })]));
    for (const kind of ["buff", "debuff"]) {
      $(`${kind}s-all`).addEventListener("change", (event) => {
        document.querySelectorAll(`.effect--${kind} input`).forEach((box) => { box.checked = event.target.checked; });
      });
    }
  } catch {
    buffList.replaceChildren(el("li", { className: "muted", textContent: "Не удалось загрузить баффы. Перезапустите сайт." }));
  }
}

setupCharacter();
setupDoll();
render();
setupEffects();
