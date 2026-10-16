import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createSidebarSessionCache,
  getSidebarSessionDurationMs,
  getSidebarSessionRefreshAt,
  isSidebarSession,
} from "./sidebar-session.ts";

const MINUTE = 60_000;
const BASE = Date.parse("2026-10-09T08:00:00Z");
const session = {
  race: "Гран-при Сингапура",
  circuit: "Marina Bay Street Circuit",
  session: "Практика 1",
  startsAt: "пт, 9 окт., 11:30",
  startsAtIso: "2026-10-09T08:30:00Z",
  status: "Ожидается",
};

test("normal reads refresh every five minutes and active windows every minute", () => {
  assert.equal(getSidebarSessionRefreshAt(session, BASE, BASE), BASE + 5 * MINUTE);
  const nearStart = BASE + 20 * MINUTE;
  assert.equal(getSidebarSessionRefreshAt(session, nearStart, nearStart), nearStart + MINUTE);
  assert.equal(getSidebarSessionRefreshAt({ ...session, startsAtIso: "invalid" }, BASE, BASE), BASE + 5 * MINUTE);
  assert.equal(getSidebarSessionRefreshAt({ ...session, status: "Завершен" }, BASE, BASE), BASE + 5 * MINUTE);
});

test("start and estimated end boundaries refresh without waiting for the interval", () => {
  const start = Date.parse(session.startsAtIso);
  assert.equal(getSidebarSessionRefreshAt(session, start - 5_000, start - 5_000), start);
  const end = start + getSidebarSessionDurationMs(session.session);
  assert.equal(getSidebarSessionRefreshAt(session, end - 5_000, end - 5_000), end);
  assert.equal(getSidebarSessionRefreshAt(session, end, end), end + MINUTE);
  assert.equal(getSidebarSessionDurationMs("Спринт"), 75 * MINUTE);
  assert.equal(getSidebarSessionDurationMs("Гонка"), 180 * MINUTE);
});

test("concurrent mounts share one request and warm navigation retains the snapshot", async () => {
  let calls = 0;
  let resolve;
  let now = BASE;
  const cache = createSidebarSessionCache(() => {
    calls++;
    return new Promise((done) => { resolve = done; });
  }, () => now);
  const first = cache.refresh();
  const second = cache.refresh();
  await Promise.resolve();
  assert.equal(calls, 1);
  resolve(session);
  await Promise.all([first, second]);
  const snapshot = cache.getSnapshot();
  const unsubscribe = cache.subscribe(() => {});
  unsubscribe();
  now += MINUTE;
  await cache.refresh();
  assert.equal(calls, 1);
  assert.equal(cache.getSnapshot(), snapshot);
  assert.equal(snapshot.session, session);
});

test("background failure preserves content and retries after a backoff", async () => {
  let now = BASE;
  let calls = 0;
  let fail = false;
  let value = session;
  const cache = createSidebarSessionCache(async () => {
    calls++;
    if (fail) throw new Error("offline");
    return value;
  }, () => now);
  await cache.refresh();
  const original = cache.getSnapshot();
  now += 5 * MINUTE;
  fail = true;
  await cache.refresh();
  assert.equal(cache.getSnapshot(), original);
  assert.equal(cache.getRefreshDelay(), 30_000);
  now += 10_000;
  await cache.refresh(true);
  assert.equal(calls, 2);
  now += 20_000;
  fail = false;
  value = { ...session, session: "Спринт-квалификация" };
  await cache.refresh();
  assert.equal(calls, 3);
  assert.equal(cache.getSnapshot().session.session, "Спринт-квалификация");
});

test("a failed first load exits the skeleton and can recover", async () => {
  let now = BASE;
  let value = { invalid: true };
  const cache = createSidebarSessionCache(async () => value, () => now);
  await cache.refresh();
  assert.deepEqual(cache.getSnapshot(), { session: null, loaded: true });
  now += 30_000;
  value = session;
  await cache.refresh();
  assert.equal(cache.getSnapshot().session, session);
});

test("focus refresh is throttled and identical data does not replace the snapshot", async () => {
  let now = BASE;
  let calls = 0;
  let notifications = 0;
  const cache = createSidebarSessionCache(async () => { calls++; return { ...session }; }, () => now);
  const unsubscribe = cache.subscribe(() => { notifications++; });
  await cache.refresh();
  const snapshot = cache.getSnapshot();
  now += 5_000;
  await cache.refresh(true);
  assert.equal(calls, 1);
  now += 10_000;
  await cache.refresh(true);
  assert.equal(calls, 2);
  assert.equal(cache.getSnapshot(), snapshot);
  assert.equal(notifications, 1);
  unsubscribe();
});

test("malformed data is rejected and the shell no longer awaits a session per page", () => {
  assert.equal(isSidebarSession(session), true);
  assert.equal(isSidebarSession(null), false);
  assert.equal(isSidebarSession({ ...session, startsAtIso: 42 }), false);
  assert.equal(isSidebarSession({ ...session, race: undefined }), false);
  const shell = readFileSync(new URL("../components/racemate/app-shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /<SidebarNextSession\s*\/>/);
  assert.doesNotMatch(shell, /getNextSession|NextSessionPanel/);
});
