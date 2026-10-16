import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LiveTimeline, TimelineViewer, applyTimelinePatch, parseTimelineView, REWIND_WINDOW_MS } from "./timeline.mjs";
import { readTimelineCache, writeTimelineCache } from "./timeline-cache.mjs";
import { emptyState, newDriver } from "./state.mjs";

const start = Date.parse("2026-10-14T12:00:00Z");
const state = (key = 1) => ({ ...emptyState(),
  session: { session_key: key, session_name: "Qualifying", session_type: "Qualifying" },
  drivers: { 3: { ...newDriver(3), lapHistory: [{ lap: 1, duration: 93 }] } },
  status: "live", phase: "Q1", flag: "GREEN", track: { circuitKey: String(key) },
});
const sample = (seconds, speed = seconds) => ({ type: "telemetry", driverNumber: 3,
  timestamp: new Date(start + seconds * 1000).toISOString(), speed });

test("every panel uses one historical frame and cannot see later corrections or transcripts", () => {
  const timeline = new LiveTimeline(), data = state();
  timeline.captureState(data, start);
  timeline.captureSamples([sample(0)], 1, start);
  data.drivers[3].position = 1;
  data.drivers[3].compound = "SOFT";
  data.drivers[3].maxSpeed = 320;
  data.weather = { rain: 0 };
  timeline.captureState(data, start + 10000);
  const before = timeline.snapshotAt(start + 10000);
  data.flag = "RED";
  data.phase = "Q2";
  data.timerPausedAt = new Date(start + 20000).toISOString();
  data.drivers[3].position = 8;
  data.drivers[3].eliminatedIn = "Q1";
  data.drivers[3].status = "DNF";
  data.drivers[3].lapHistory[0].duration = 90;
  data.events = [{ id: "flag", timestamp: new Date(start).toISOString() }];
  data.pits = [{ id: "pit" }];
  data.stints = [{ stintNumber: 2 }];
  data.radio = [{ id: "radio", status: "ready", ru: "Готово", timestamp: new Date(start).toISOString() }];
  data.weather.rain = 1;
  data.championship = { results: [{ points: 25 }] };
  data.replayReady = true;
  timeline.captureState(data, start + 20000);
  timeline.captureSamples([sample(20, 0)], 1, start + 20000);
  const old = timeline.snapshotAt(start + 15000).data;
  assert.deepEqual(old, before.data);
  assert.equal(old.drivers[3].lapHistory[0].duration, 93);
  assert.equal(old.radio.length, 0);
  const current = timeline.snapshotAt(start + 20000).data;
  assert.equal(current.flag, "RED");
  assert.equal(current.telemetry[3].speed, 0);
  assert.equal(current.championship.results[0].points, 25);
});

test("viewers seek independently, play at fixed delay, pause and return to LIVE", () => {
  const timeline = new LiveTimeline();
  for (let i = 0; i <= 200; i++) {
    const data = state(); data.currentLap = i;
    timeline.captureState(data, start + i * 1000);
    timeline.captureSamples([sample(i)], 1, start + i * 1000);
  }
  const viewer = new TimelineViewer(timeline, { mode: "rewind", delayMs: 45000 }, start + 200000);
  const live = new TimelineViewer(timeline, {}, start + 200000);
  assert.equal(viewer.snapshot(start + 200000).data.currentLap, 155);
  assert.equal(live.snapshot(start + 200000).data.currentLap, 200);
  const messages = viewer.next(start + 201000);
  assert.equal(messages[0].presentation.cursorTime, start + 156000);
  const paused = viewer.seek({ mode: "rewind", pausedAt: start + 156000 }, 1, start + 201000);
  assert.equal(paused.presentation.paused, true);
  assert.deepEqual(viewer.next(start + 205000), []);
  assert.equal(viewer.presentation(start + 205000).cursorTime, start + 156000);
  assert.equal(viewer.seek({ mode: "live" }, 2, start + 205000).data.currentLap, 200);
  assert.equal(viewer.mode, "live");
});

test("the three-minute limit, shorter startup window and expired pauses are explicit", () => {
  const timeline = new LiveTimeline();
  timeline.captureState(state(), start);
  const viewer = new TimelineViewer(timeline, { mode: "rewind", delayMs: 999999 }, start + 10000);
  assert.equal(viewer.snapshot(start + 10000).presentation.delayMs, 10000);
  viewer.seek({ mode: "rewind", pausedAt: start }, 1, start + 10000);
  timeline.captureState(state(), start + 181000);
  assert.equal(viewer.presentation(start + 181000).expired, true);
  const resumed = viewer.seek({ mode: "rewind", delayMs: REWIND_WINDOW_MS }, 2, start + 181000);
  assert.equal(resumed.presentation.cursorTime, start + 1000);
  assert.equal(resumed.presentation.expired, false);
});

test("a session switch keeps the old map, roster and samples available until the cursor crosses it", () => {
  const timeline = new LiveTimeline();
  timeline.captureState(state(1), start);
  timeline.captureSamples([sample(5, 111)], 1, start + 5000);
  timeline.captureState(state(2), start + 10000);
  timeline.captureSamples([sample(11, 222)], 2, start + 11000);
  assert.equal(timeline.snapshotAt(start + 9000).data.session.session_key, 1);
  const next = timeline.snapshotAt(start + 11000);
  assert.equal(next.data.track.circuitKey, "2");
  assert.deepEqual(next.samples.map((s) => s.speed), [222]);
});

test("structural sharing and patches preserve history without copying unchanged lap arrays", () => {
  const timeline = new LiveTimeline();
  timeline.captureState(state(), start);
  const first = timeline.state;
  const next = state(); next.drivers[3].position = 1;
  timeline.captureState(next, start + 1000);
  assert.equal(first.drivers[3].lapHistory, timeline.state.drivers[3].lapHistory);
  assert.deepEqual(applyTimelinePatch(first, timeline.records.at(-1).patch), timeline.state);
  assert.throws(() => applyTimelinePatch({}, [{ path: ["__proto__", "polluted"], value: true }]));
  assert.equal({}.polluted, undefined);
});

test("three hours of running retain a bounded window and restored clients recover it", () => {
  const timeline = new LiveTimeline();
  for (let i = 0; i <= 10800; i++) {
    const data = state(); data.currentLap = Math.floor(i / 90);
    timeline.captureState(data, start + i * 1000);
    timeline.captureSamples([sample(i)], 1, start + i * 1000);
  }
  const now = start + 10800000;
  assert.ok(timeline.records.length < 600);
  assert.equal(timeline.range(now).earliestTime, now - REWIND_WINDOW_MS);
  const restored = new LiveTimeline();
  assert.equal(restored.restore(JSON.parse(JSON.stringify(timeline.export(now))), now), true);
  assert.deepEqual(restored.snapshotAt(now - 45000).data, timeline.snapshotAt(now - 45000).data);
  assert.equal(new LiveTimeline().restore(timeline.export(now), now + 400000), false);
});

test("disk cache restores all view data and tolerates missing or damaged files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raceside-timeline-"));
  try {
    const timeline = new LiveTimeline();
    assert.equal(await readTimelineCache(timeline, directory, start), false);
    timeline.captureState(state(), start);
    timeline.captureSamples([sample(1)], 1, start + 1000);
    await writeTimelineCache(timeline, directory, start + 1000);
    const restored = new LiveTimeline();
    assert.equal(await readTimelineCache(restored, directory, start + 2000), true);
    assert.equal(restored.snapshotAt(start + 1000).data.telemetry[3].speed, 1);
    await writeFile(join(directory, "timeline", "window.json.gz"), "interrupted");
    assert.equal(await readTimelineCache(new LiveTimeline(), directory, start + 3000), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("view parameters reject invalid numbers and bound the delay", () => {
  assert.throws(() => parseTimelineView(new URLSearchParams("delayMs=Infinity")));
  assert.equal(parseTimelineView(new URLSearchParams("view=rewind&delayMs=999999")).delayMs, REWIND_WINDOW_MS);
  assert.deepEqual(parseTimelineView(new URLSearchParams("view=rewind&delayMs=45000&pausedAt=123")),
    { mode: "rewind", delayMs: 45000, pausedAt: 123 });
});

test("historical feed pagination excludes late-published events even with an old source date", () => {
  const timeline = new LiveTimeline(), data = state();
  const timestamp = new Date(start).toISOString();
  data.events = [{ id: "known", timestamp }];
  timeline.captureState(data, start);
  data.events.push({ id: "late", timestamp });
  data.radio = [{ id: "radio", timestamp, status: "ready" }];
  timeline.captureState(data, start + 10000);
  assert.deepEqual(timeline.historyAt(start + 5000, "events").items.map((event) => event.id), ["known"]);
  assert.deepEqual(timeline.historyAt(start + 5000, "radio").items, []);
  assert.deepEqual(timeline.historyAt(start + 10000, "radio").items.map((event) => event.id), ["radio"]);
});
