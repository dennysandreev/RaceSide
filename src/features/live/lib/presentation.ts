import type { LivePresentation, LiveView } from "./types";
export const LIVE_VIEW_STORAGE_KEY = "raceside.live.view.v1";

export function savedLiveView(value: string | null): LiveView {
  try {
    const view = JSON.parse(value ?? "null") as LiveView | null;
    if (view?.mode !== "rewind") return { mode: "live" };
    return {
      mode: "rewind",
      delayMs: Math.max(0, Math.min(180000, Number(view.delayMs) || 0)),
      ...(Number.isFinite(view.pausedAt) ? { pausedAt: view.pausedAt } : {}),
    };
  } catch { return { mode: "live" }; }
}
export function presentationView(presentation: LivePresentation): LiveView {
  return { mode: presentation.mode, delayMs: presentation.delayMs,
    ...(presentation.paused ? { pausedAt: presentation.cursorTime } : {}) };
}
export function viewQuery(view: LiveView) {
  const params = new URLSearchParams({ timeline: "1", view: view.mode });
  if (view.mode === "rewind") {
    params.set("delayMs", String(view.delayMs ?? 0));
    if (view.pausedAt != null) params.set("pausedAt", String(view.pausedAt));
  }
  return params;
}
