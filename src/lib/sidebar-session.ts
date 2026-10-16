import type { NextSession } from "../types/racemate";

const NORMAL_REFRESH_MS = 5 * 60_000;
const ACTIVE_REFRESH_MS = 60_000;
const ACTIVE_WINDOW_MS = 15 * 60_000;
const RETRY_MS = 30_000;
const MIN_REFRESH_GAP_MS = 15_000;

export type SidebarSessionSnapshot = {
  session: NextSession | null;
  loaded: boolean;
};

export const EMPTY_SIDEBAR_SESSION: SidebarSessionSnapshot = {
  session: null,
  loaded: false,
};

export function getSidebarSessionDurationMs(sessionName?: string | null) {
  const name = (sessionName ?? "").toLowerCase();
  if (name.includes("гонка") || name.includes("race")) return 3 * 60 * 60_000;
  if (name.includes("спринт") || name.includes("sprint")) return 75 * 60_000;
  return 90 * 60_000;
}

export function getSidebarSessionRefreshAt(session: NextSession | null, checkedAt: number, now: number) {
  if (!session) return now;

  const start = Date.parse(session.startsAtIso ?? "");
  const completed = /^завершен[а]?$/i.test(session.status);
  if (!Number.isFinite(start) || completed) return checkedAt + NORMAL_REFRESH_MS;

  const end = start + getSidebarSessionDurationMs(session.session);
  const active = now >= start - ACTIVE_WINDOW_MS && now < end + ACTIVE_WINDOW_MS;
  let refreshAt = checkedAt + (active ? ACTIVE_REFRESH_MS : NORMAL_REFRESH_MS);

  // A cached card must not wait for its normal interval across a session boundary.
  for (const boundary of [start, end]) {
    if (boundary > checkedAt) refreshAt = Math.min(refreshAt, boundary);
  }
  return refreshAt;
}

export function isSidebarSession(value: unknown): value is NextSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Record<string, unknown>;
  return ["race", "circuit", "session", "startsAt", "status"].every(
    (key) => typeof session[key] === "string",
  ) && (session.startsAtIso === undefined || typeof session.startsAtIso === "string");
}

export function createSidebarSessionCache(load: () => Promise<NextSession>, now = Date.now) {
  let snapshot = EMPTY_SIDEBAR_SESSION;
  let checkedAt = 0;
  let attemptedAt = Number.NEGATIVE_INFINITY;
  let retryAt = 0;
  let pending: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  function nextRefreshAt() {
    return retryAt || getSidebarSessionRefreshAt(snapshot.session, checkedAt, now());
  }

  function publish(next: SidebarSessionSnapshot) {
    snapshot = next;
    listeners.forEach((listener) => listener());
  }

  return {
    getSnapshot: () => snapshot,
    getRefreshDelay: () => Math.max(1_000, nextRefreshAt() - now()),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    refresh(force = false): Promise<void> {
      if (pending) return pending;
      const time = now();
      if (time < retryAt || (force
        ? time - attemptedAt < MIN_REFRESH_GAP_MS
        : time < nextRefreshAt())) return Promise.resolve();

      attemptedAt = time;
      pending = Promise.resolve().then(load).then((session) => {
        if (!isSidebarSession(session)) throw new Error("Invalid sidebar session");
        checkedAt = now();
        retryAt = 0;
        const previous = snapshot.session;
        const changed = !previous || Object.keys(session).some(
          (key) => session[key as keyof NextSession] !== previous[key as keyof NextSession],
        ) || previous.startsAtIso !== session.startsAtIso;
        if (changed) publish({ session, loaded: true });
      }).catch(() => {
        retryAt = now() + RETRY_MS;
        if (!snapshot.loaded) publish({ session: null, loaded: true });
      }).finally(() => {
        pending = null;
      });
      return pending;
    },
  };
}
