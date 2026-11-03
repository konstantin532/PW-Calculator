import { APPLY_MESSAGE, STATE_MESSAGE, isComparisonBuild, isComparisonSnapshot } from "./engine/comparison.js?v=20261103-comparison";

/** Each embedded calculator keeps its state and DOM; only validated snapshots cross the boundary. */
export function createComparisonBridge({ getPayload, onApply }) {
  if (window.parent === window || !document.body.classList.contains("comparison-embedded")) return { publish() {} };
  const origin = window.location.origin;
  const calc = document.querySelector(".calc");
  if (!calc) return { publish() {} };
  let scheduled = false, previous = "";
  const updateViewport = () => {
    try {
      const frame = window.frameElement?.getBoundingClientRect();
      if (!frame) return;
      const top = Math.max(0, -frame.top);
      const bottom = Math.min(window.innerHeight, window.parent.innerHeight - frame.top);
      document.documentElement.style.setProperty("--comparison-visible-top", `${top}px`);
      document.documentElement.style.setProperty("--comparison-visible-height", `${Math.max(0, bottom - top)}px`);
    } catch { /* A parent from another origin cannot supply viewport geometry. */ }
  };
  const publish = () => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      let payload;
      try { payload = getPayload(); } catch { return; }
      if (!payload || !isComparisonBuild(payload.build) || !isComparisonSnapshot(payload.snapshot) || typeof payload.ready !== "boolean") return;
      const rect = calc.getBoundingClientRect();
      const height = Math.min(12000, Math.max(320, Math.ceil(rect.top + window.scrollY + rect.height + 24)));
      const packet = { type: STATE_MESSAGE, build: payload.build, snapshot: payload.snapshot, ready: payload.ready, height };
      updateViewport();
      const signature = JSON.stringify(packet);
      if (signature === previous) return;
      previous = signature;
      window.parent.postMessage(packet, origin);
    });
  };
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.origin !== origin || event.data?.type !== APPLY_MESSAGE || !isComparisonBuild(event.data.build)) return;
    try {
      if (getPayload()?.ready !== true) return;
      onApply(event.data.build);
    } catch { return; }
  });
  window.addEventListener("resize", () => { updateViewport(); publish(); });
  try {
    window.parent.addEventListener("scroll", updateViewport, { passive: true });
    window.parent.addEventListener("resize", updateViewport);
  } catch { /* postMessage remains origin-restricted even without geometry access. */ }
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(publish).observe(calc);
  updateViewport();
  return { publish };
}
