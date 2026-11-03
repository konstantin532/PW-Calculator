import assert from "node:assert/strict";
import { test } from "node:test";
import { computeStats } from "../../static/js/engine/stats.js";
import { parseBuild, serializeBuild } from "../../static/js/engine/build.js";
import {
  APPLY_MESSAGE, COMPARISON_METRICS, STATE_MESSAGE, compareSnapshots,
  comparisonUrl, createComparisonSnapshot, encodeBuildHash, isComparisonBuild, isComparisonSnapshot,
} from "../../static/js/engine/comparison.js";
import { createComparisonBridge } from "../../static/js/comparison-bridge.js";

const state = { name: "Мой воин", cls: "by", level: 105, reputation: 0,
  attrs: { vit: 5, int: 5, str: 5, dex: 5 }, equipment: {}, effects: [] };
const snapshot = (candidate = state) => createComparisonSnapshot(candidate, computeStats(candidate));

test("снимок использует реальные итоговые показатели и не хранит ссылку на диапазон", () => {
  const stats = computeStats(state), result = createComparisonSnapshot(state, stats);
  assert.equal(result.name, "Мой воин");
  assert.equal(result.className, "Воин");
  assert.equal(result.level, 105);
  assert.equal(result.metrics.hp, 3195);
  assert.deepEqual(result.metrics.physAtk, stats.physAtk);
  stats.physAtk[0] = 999;
  assert.notEqual(result.metrics.physAtk[0], 999);
  assert.equal(Object.keys(result.metrics).length, COMPARISON_METRICS.length);
  assert.equal(isComparisonSnapshot(result), true);
  assert.equal(snapshot({ ...state, name: "Новое имя" }).name, "Новое имя");
});

test("две сборки дают разницу второго относительно первого без изменения исходников", () => {
  const first = snapshot(), second = snapshot({ ...state, attrs: { ...state.attrs, vit: 15 } });
  const before = JSON.stringify([first, second]);
  const rows = compareSnapshots(first, second);
  assert.equal(rows.find((row) => row.key === "hp").delta, 150);
  assert.equal(rows.find((row) => row.key === "hp").trend, "better");
  assert.equal(rows.find((row) => row.key === "mp").trend, "equal");
  assert.equal(JSON.stringify([first, second]), before);
  assert.equal(compareSnapshots(second, first).find((row) => row.key === "hp").trend, "worse");
});

test("меньшее время пения лучше, смешанная разница диапазона не объявляется улучшением", () => {
  const first = snapshot(), second = snapshot();
  second.metrics.castTime = -6;
  second.metrics.atkSpeed = 1.35;
  second.metrics.physAtk = [first.metrics.physAtk[0] - 10, first.metrics.physAtk[1] + 10];
  const rows = compareSnapshots(first, second);
  assert.equal(rows.find((row) => row.key === "castTime").trend, "better");
  assert.equal(rows.find((row) => row.key === "castTime").delta, -6);
  assert.equal(rows.find((row) => row.key === "atkSpeed").delta, 0.1);
  assert.deepEqual(rows.find((row) => row.key === "physAtk").delta, [-10, 10]);
  assert.equal(rows.find((row) => row.key === "physAtk").trend, "mixed");
});

test("неверные снимки, бесконечные числа, чужой класс и неполные диапазоны отклоняются", () => {
  for (const invalid of [null, [], { ...snapshot(), name: 123 }, { ...snapshot(), className: "Жнец" },
    { ...snapshot(), level: 106 }, { ...snapshot(), metrics: {} }]) assert.equal(isComparisonSnapshot(invalid), false);
  for (const invalid of [NaN, Infinity, -Infinity, "15"]) {
    const value = snapshot(); value.metrics.hp = invalid;
    assert.equal(isComparisonSnapshot(value), false);
    assert.throws(() => compareSnapshots(snapshot(), value), /сравнен/i);
  }
  const value = snapshot(); value.metrics.physAtk = [1];
  assert.equal(isComparisonSnapshot(value), false);
});

test("хеш сравнения сохраняет UTF-8 и загружается существующим разбором сборки", () => {
  const json = serializeBuild({ ...state, name: "Ёж 🐉" });
  const hash = encodeBuildHash(json);
  assert.match(hash, /^#build=[A-Za-z0-9_-]+$/u);
  assert.equal(comparisonUrl(json), `/compare/${hash}`);
  const decoded = new TextDecoder().decode(Uint8Array.from(atob(hash.slice(7).replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0)));
  assert.equal(parseBuild(decoded, [], []).name, "Ёж 🐉");
  assert.throws(() => encodeBuildHash("я".repeat(6001)), /велика|больш|файл/i);
});

test("ограничение сборки проверяется по UTF-8 байтам, а не числу символов", () => {
  assert.equal(isComparisonBuild(serializeBuild(state)), true);
  for (const value of [null, {}, "", "я".repeat(524289)]) assert.equal(isComparisonBuild(value), false);
});

function withFrame(callback, embedded = true) {
  const original = Object.fromEntries(["window", "document", "ResizeObserver"].map((key) => [key, globalThis[key]]));
  const listeners = new Map(), parentListeners = new Map(), styles = new Map(), queue = [], sent = [];
  const parent = { postMessage: (message, origin) => sent.push({ message, origin }), innerHeight: 900,
    addEventListener: (name, handler) => parentListeners.set(name, handler) };
  const frame = { parent, location: { origin: "http://127.0.0.1:8000" }, scrollY: 0,
    innerHeight: 1000, frameElement: { getBoundingClientRect: () => ({ top: -700 }) },
    addEventListener: (name, handler) => listeners.set(name, handler),
    requestAnimationFrame: (callback) => { queue.push(callback); return queue.length; } };
  const calc = { getBoundingClientRect: () => ({ top: 20, height: 900 }) };
  globalThis.window = frame;
  globalThis.document = { body: { classList: { contains: () => embedded } }, querySelector: () => calc,
    documentElement: { style: { setProperty: (key, value) => styles.set(key, value) } } };
  globalThis.ResizeObserver = class { observe() {} };
  try { return callback({ frame, parent, listeners, parentListeners, styles, sent, flush: () => { while (queue.length) queue.shift()(); } }); }
  finally { for (const [key, value] of Object.entries(original)) if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
}

test("мост объединяет публикации, передаёт высоту и новое имя без перерисовки страницы", () => withFrame(({ sent, flush }) => {
  let name = "Первый";
  const bridge = createComparisonBridge({ getPayload: () => ({ build: serializeBuild(state), snapshot: snapshot({ ...state, name }), ready: true }), onApply() {} });
  bridge.publish(); bridge.publish(); flush();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].message.type, STATE_MESSAGE);
  assert.equal(sent[0].message.height, 944);
  assert.equal(sent[0].origin, "http://127.0.0.1:8000");
  name = "После переименования";
  bridge.publish(); flush();
  assert.equal(sent.at(-1).message.snapshot.name, name);
}));

test("команда копирования принимается только от своего родителя после готовности каталога", () => withFrame(({ parent, listeners }) => {
  let ready = false;
  const received = [];
  createComparisonBridge({ getPayload: () => ({ build: serializeBuild(state), snapshot: snapshot(), ready }), onApply: (json) => received.push(json) });
  const message = listeners.get("message"), data = { type: APPLY_MESSAGE, build: serializeBuild(state) };
  const accepted = { source: parent, origin: "http://127.0.0.1:8000", data };
  message(accepted); assert.equal(received.length, 0);
  ready = true;
  for (const event of [{ ...accepted, source: {} }, { ...accepted, origin: "https://example.com" },
    { ...accepted, data: { ...data, type: "unrelated" } }, { ...accepted, data: { ...data, build: {} } }]) message(event);
  assert.equal(received.length, 0);
  message(accepted);
  assert.deepEqual(received, [data.build]);
}));

test("обычный калькулятор не создаёт мост и не отправляет состояние", () => withFrame(({ sent, listeners, flush }) => {
  const bridge = createComparisonBridge({ getPayload: () => { throw new Error("standalone must not publish"); }, onApply() {} });
  bridge.publish(); flush();
  assert.equal(sent.length, 0);
  assert.equal(listeners.size, 0);
}, false));

test("диалог получает видимую часть высокого iframe и обновляется при прокрутке родителя", () => withFrame(({ frame, parentListeners, styles }) => {
  createComparisonBridge({ getPayload: () => ({ build: serializeBuild(state), snapshot: snapshot(), ready: true }), onApply() {} });
  assert.equal(styles.get("--comparison-visible-top"), "700px");
  assert.equal(styles.get("--comparison-visible-height"), "300px");
  frame.frameElement.getBoundingClientRect = () => ({ top: 100 });
  parentListeners.get("scroll")();
  assert.equal(styles.get("--comparison-visible-top"), "0px");
  assert.equal(styles.get("--comparison-visible-height"), "800px");
}));
