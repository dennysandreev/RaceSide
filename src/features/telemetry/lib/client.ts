import type {
  TelemetryBootstrapData,
  TelemetryBootstrapStage,
} from "./types";

export async function telemetryBootstrapRequest(
  selection: { season?: number; meeting?: number; session?: number },
  options: {
    signal?: AbortSignal;
    onProgress?: (data: TelemetryBootstrapData) => void;
  } = {},
): Promise<TelemetryBootstrapData> {
  const params = new URLSearchParams();
  if (selection.season) params.set("season", String(selection.season));
  if (selection.meeting) params.set("meeting", String(selection.meeting));
  if (selection.session) params.set("session", String(selection.session));
  const url = `/api/telemetry/bootstrap${params.size ? `?${params}` : ""}`;
  const deadline = Date.now() + 240_000;

  while (Date.now() < deadline) {
    const response = await fetch(url, {
      signal: options.signal,
      cache: "no-store",
    });
    let payload: { data?: TelemetryBootstrapData; error?: string };
    try {
      payload = await response.json();
    } catch {
      throw new Error("Не удалось загрузить телеметрию. Попробуйте ещё раз.");
    }
    if (!response.ok && response.status !== 202)
      throw new Error(
        payload.error ?? "Не удалось загрузить телеметрию.",
      );
    if (!payload.data)
      throw new Error("Не удалось загрузить телеметрию. Попробуйте ещё раз.");
    options.onProgress?.(payload.data);
    if (response.status !== 202 && payload.data.stage === "ready")
      return payload.data;

    await waitForTelemetryRetry(
      Math.max(3_000, Number(response.headers.get("Retry-After") ?? 3) * 1000),
      options.signal,
    );
  }
  throw new Error("Подготовка ещё продолжается. Откройте телеметрию чуть позже.");
}

async function waitForTelemetryRetry(ms: number, signal?: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

export const telemetryBootstrapLabel: Record<
  TelemetryBootstrapStage,
  string
> = {
  demo: "Готовим демо-этап",
  seasons: "Загружаем сезоны",
  meetings: "Загружаем этапы сезона",
  sessions: "Загружаем сессии",
  catalog: "Готовим пилотов и круги",
  ready: "Готовим данные",
};

export async function telemetryRequest<T>(
  path: string,
  options: {
    body?: unknown;
    signal?: AbortSignal;
    onPreparing?: (id: string) => void;
  } = {},
): Promise<T> {
  let url = `/api/telemetry/${path}`;
  let init: RequestInit = {
    signal: options.signal,
    cache: "no-store",
    ...(options.body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options.body),
        }
      : {}),
  };
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    const res = await fetch(url, init);
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error("Не удалось загрузить телеметрию. Попробуйте ещё раз.");
    }
    if (!res.ok && res.status !== 202)
      throw new Error(data.error ?? "Не удалось загрузить телеметрию.");
    if (res.status !== 202) return data.data as T;
    options.onPreparing?.(data.taskId);
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      };
      const timer = setTimeout(() => {
        options.signal?.removeEventListener("abort", abort);
        resolve();
      }, 3000);
      if (options.signal?.aborted) abort();
      else options.signal?.addEventListener("abort", abort, { once: true });
    });
    url = `/api/telemetry/tasks/${data.taskId}`;
    init = { signal: options.signal, cache: "no-store" };
  }
  throw new Error(
    "Подготовка ещё продолжается. Откройте сравнение чуть позже.",
  );
}
export function trackTelemetry(event: string, comparisonId?: string) {
  void fetch("/api/telemetry/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, comparisonId }),
    keepalive: true,
  }).catch(() => {});
}
export function createCursorStore() {
  let distance = 0;
  const listeners = new Set<() => void>();
  let frame: number | null = null;
  return {
    get: () => distance,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (value: number) => {
      distance = value;
      if (frame == null)
        frame = requestAnimationFrame(() => {
          frame = null;
          listeners.forEach((fn) => fn());
        });
    },
    destroy: () => {
      if (frame != null) cancelAnimationFrame(frame);
      frame = null;
      listeners.clear();
    },
  };
}
export type CursorStore = ReturnType<typeof createCursorStore>;
