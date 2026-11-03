import { APPLY_MESSAGE, STATE_MESSAGE, compareSnapshots, encodeBuildHash, isComparisonBuild, isComparisonSnapshot } from "./engine/comparison.js?v=20261103-explanations";

const sides = ["left", "right"];
const frames = Object.fromEntries(sides.map((side) => [side, document.getElementById(`frame-${side}`)]));
const states = { left: null, right: null };
const buttons = ["copy-left-to-right", "copy-right-to-left", "swap-builds"].map((id) => document.getElementById(id));
const status = document.getElementById("comparison-status");
const single = document.getElementById("single-calculator");
const rows = document.getElementById("comparison-rows");
const numberFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
let comparisonVisible = true;

function message(text, error = false) {
  status.textContent = text;
  status.dataset.error = String(error);
}

function modeStatus() {
  if (!comparisonVisible) message("Открыт один персонаж. Второй сохранён — нажмите «Сравнить с другим персонажем», чтобы вернуться к двум окнам.");
  else if (sides.every((side) => states[side]?.ready)) message("Оба персонажа готовы. Изменения одной сборки не затрагивают другую.");
  else message("Загрузка двух калькуляторов…");
}

single.addEventListener("click", () => {
  comparisonVisible = !comparisonVisible;
  document.body.classList.toggle("comparison-single", !comparisonVisible);
  for (const id of ["comparison-right", "comparison-actions", "comparison-summary"]) {
    document.getElementById(id).hidden = !comparisonVisible;
  }
  single.textContent = comparisonVisible ? "Один персонаж" : "Сравнить с другим персонажем";
  single.setAttribute("aria-expanded", String(comparisonVisible));
  document.getElementById("comparison-page-title").textContent = comparisonVisible ? "Сравнение персонажей" : "Один персонаж";
  document.getElementById("comparison-intro").textContent = comparisonVisible
    ? "Две независимые сборки. Меняйте вещи, характеристики и бафы на каждой стороне."
    : "Можно менять первого персонажа. Второй сохраняется при переключении между одним и двумя окнами.";
  document.title = comparisonVisible ? "Сравнение персонажей · Comeback PW 1.4.6" : "Персонаж · Comeback PW 1.4.6";
  modeStatus();
});

function valueText(value, unit, signed = false) {
  const format = (number) => `${signed && number > 0 ? "+" : ""}${numberFormat.format(number)}`;
  const text = Array.isArray(value) ? value.map(format).join("–") : format(value);
  return `${text}${unit ? ` ${unit}` : ""}`;
}

function renderComparison() {
  const ready = sides.every((side) => states[side]?.ready);
  for (const button of buttons) button.disabled = !ready;
  for (const side of sides) {
    const state = states[side];
    if (!state) continue;
    document.getElementById(`${side}-name`).textContent = state.snapshot.name || "Без имени";
    document.getElementById(`${side}-class`).textContent = `${state.snapshot.className} · ур. ${state.snapshot.level}`;
    document.getElementById(`frame-status-${side}`).hidden = state.ready;
    const link = frames[side].parentElement.querySelector(".comparison-frame-fallback a");
    try { link.href = `/${encodeBuildHash(state.build)}`; } catch { link.href = "/"; }
  }
  if (!ready) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.textContent = "Ожидаем данные обоих персонажей…";
    row.append(cell);
    rows.replaceChildren(row);
    return;
  }
  rows.replaceChildren(...compareSnapshots(states.left.snapshot, states.right.snapshot).map((entry) => {
    const row = document.createElement("tr");
    const label = document.createElement("th");
    label.scope = "row";
    label.textContent = entry.label;
    const left = document.createElement("td");
    left.textContent = valueText(entry.left, entry.unit);
    const right = document.createElement("td");
    right.textContent = valueText(entry.right, entry.unit);
    const delta = document.createElement("td");
    delta.textContent = valueText(entry.delta, entry.unit, true);
    delta.dataset.trend = entry.trend;
    row.append(label, left, right, delta);
    return row;
  }));
}

function isStateMessage(data) {
  return data !== null && typeof data === "object" && !Array.isArray(data)
    && data.type === STATE_MESSAGE && isComparisonBuild(data.build)
    && isComparisonSnapshot(data.snapshot) && typeof data.ready === "boolean"
    && Number.isInteger(data.height) && data.height >= 320 && data.height <= 12000;
}

window.addEventListener("message", (event) => {
  if (event.origin !== location.origin) return;
  const side = sides.find((key) => event.source === frames[key].contentWindow);
  if (!side || !isStateMessage(event.data)) return;
  const wasReady = sides.every((key) => states[key]?.ready);
  states[side] = { build: event.data.build, snapshot: event.data.snapshot, ready: event.data.ready };
  frames[side].style.height = `${event.data.height}px`;
  renderComparison();
  if (!wasReady && sides.every((key) => states[key]?.ready)) modeStatus();
});

function apply(side, build) {
  frames[side].contentWindow.postMessage({ type: APPLY_MESSAGE, build }, location.origin);
}

document.getElementById("copy-left-to-right").addEventListener("click", () => {
  if (!states.left?.ready || !states.right?.ready) return;
  apply("right", states.left.build);
  message("Второй персонаж заменён копией первого. Теперь можно менять его отдельно.");
});
document.getElementById("copy-right-to-left").addEventListener("click", () => {
  if (!states.left?.ready || !states.right?.ready) return;
  apply("left", states.right.build);
  message("Первый персонаж заменён копией второго. Теперь можно менять его отдельно.");
});
document.getElementById("swap-builds").addEventListener("click", () => {
  if (!states.left?.ready || !states.right?.ready) return;
  const left = states.left.build, right = states.right.build;
  apply("left", right);
  apply("right", left);
  message("Сборки поменялись местами.");
});

for (const side of sides) {
  frames[side].addEventListener("error", () => {
    states[side] = null;
    renderComparison();
    document.getElementById(`frame-status-${side}`).textContent = "Не удалось открыть калькулятор. Используйте ссылку под панелью или обновите страницу.";
    message("Один из калькуляторов не загрузился.", true);
  });
}
// Assign sources after the listener is attached so the first state cannot be missed.
frames.left.src = `/calculator/${location.hash.startsWith("#build=") && location.hash.length <= 20007 ? location.hash : ""}`;
frames.right.src = "/calculator/";
setTimeout(() => {
  for (const side of sides) {
    if (!states[side]?.ready) document.getElementById(`frame-status-${side}`).textContent = "Калькулятор ещё загружается. Если загрузка не завершается, откройте его отдельно по ссылке ниже.";
  }
}, 15000);
