import test from "node:test";
import assert from "node:assert/strict";
import { LiveStore } from "./store.ts";
import { savedLiveView, presentationView, viewQuery } from "./presentation.ts";
import { LiveTimeline, TimelineViewer } from "../../../../worker/live/timeline.mjs";
import { emptyState, newDriver } from "../../../../worker/live/state.mjs";

const start = Date.parse("2026-10-14T12:00:00Z");
function recording() {
  const timeline = new LiveTimeline();
  for (let second = 0; second <= 200; second++) {
    const red = second >= 180;
    timeline.captureState({ ...emptyState(),
      session: { session_key: 1, session_type: "Practice", date_end: new Date(start + 3600000).toISOString() },
      drivers: { 3: { ...newDriver(3), bestLap: second, status: red ? "DNF" : "RUNNING", maxSpeed: second } },
      status: red ? "paused" : "live", flag: red ? "RED" : "GREEN",
      timerPausedAt: red ? new Date(start + 180000).toISOString() : null,
      currentLap: second,
      pits: red ? [{ id: "new-pit" }] : [],
      stints: red ? [{ stintNumber: 2 }] : [],
      radio: red ? [{ id: "late-radio", status: "ready", ru: "В боксы", original: "Box", timestamp: new Date(start).toISOString() }] : [],
      events: red ? [{ id: "red" }] : [],
      weather: { rain: red ? 1 : 0 },
      championship: { results: red ? [{ points: 25 }] : null },
    }, start + second * 1000);
    timeline.captureSamples([
      { type: "location", driverNumber: 3, timestamp: new Date(start + second * 1000).toISOString(), x: second, y: 0, z: 0, progress: second / 201 },
      { type: "telemetry", driverNumber: 3, timestamp: new Date(start + second * 1000).toISOString(), speed: second, gear: 7 },
    ], 1, start + second * 1000);
  }
  return timeline;
}

test("seeking moves every field and telemetry together and removes future retirement, radio and points", () => {
  const timeline = recording(), store = new LiveStore();
  const viewer = new TimelineViewer(timeline, {}, start + 200000);
  store.accept(viewer.snapshot(start + 200000));
  assert.equal(store.state.flag, "RED");
  assert.equal(store.sample(3, start + 200000), null);
  let notification;
  store.subscribe("flag", () => { notification = { flag: store.state.flag, speed: store.telemetry.get(3).at(-1).speed, pits: store.state.pits.length }; });
  store.accept(viewer.seek({ mode: "rewind", delayMs: 45000 }, 1, start + 200000));
  assert.equal(store.getPlaybackDelay(), 900, "history samples are not network jitter");
  assert.deepEqual(notification, { flag: "GREEN", speed: 155, pits: 0 });
  assert.equal(store.state.drivers[3].maxSpeed, 155);
  assert.equal(store.state.currentLap, 155);
  assert.deepEqual(store.state.radio, []);
  assert.deepEqual(store.state.events, []);
  assert.deepEqual(store.state.stints, []);
  assert.equal(store.state.weather.rain, 0);
  assert.equal(store.state.championship.results, null);
  assert.equal(store.state.timerPausedAt, null);
  assert.equal(store.sample(3, start + 155000).x, 155);
  assert.ok(store.telemetry.get(3).every((sample) => sample.speed <= 155));
  for (const message of viewer.next(start + 201000)) store.accept(message);
  assert.equal(store.state.currentLap, 156);
  assert.equal(store.telemetry.get(3).at(-1).speed, 156);
  store.accept(viewer.seek({ mode: "live" }, 2, start + 201000));
  assert.equal(store.state.flag, "RED");
  assert.equal(store.state.radio[0].id, "late-radio");
});

test("the presentation clock freezes on pause and does not use the computer's wall clock", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: start + 200000 });
  const store = new LiveStore(), viewer = new TimelineViewer(recording(), { mode: "rewind", delayMs: 45000 }, start + 200000);
  store.accept(viewer.snapshot(start + 200000));
  assert.equal(store.getPresentationNow(), start + 155000);
  t.mock.timers.tick(500);
  assert.equal(store.getPresentationNow(), start + 155500);
  store.accept(viewer.seek({ mode: "rewind", pausedAt: start + 155500 }, 1, start + 200500));
  t.mock.timers.tick(10000);
  assert.equal(store.getPresentationNow(), start + 155500);
  assert.equal(store.sample(3).x, store.sample(3).x);
});

test("reload and reconnect preserve delay or paused position; invalid storage is harmless", () => {
  for (const view of [{ mode: "live" }, { mode: "rewind", delayMs: 45000 }, { mode: "rewind", delayMs: 0, pausedAt: start }]) {
    const stored = savedLiveView(JSON.stringify(view));
    assert.deepEqual(stored, view);
    assert.equal(viewQuery(stored).get("timeline"), "1");
    assert.equal(viewQuery(stored).get("view"), view.mode);
  }
  assert.deepEqual(savedLiveView("broken"), { mode: "live" });
  assert.equal(savedLiveView('{"mode":"rewind","delayMs":999999}').delayMs, 180000);
  const viewer = new TimelineViewer(recording(), { mode: "rewind", delayMs: 45000 }, start + 200000);
  const stored = presentationView(viewer.snapshot(start + 200000).presentation);
  const reconnected = new TimelineViewer(viewer.timeline, stored, start + 205000).snapshot(start + 205000);
  assert.equal(reconnected.presentation.cursorTime, start + 160000);
});
