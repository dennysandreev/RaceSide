import assert from "node:assert/strict";
import test from "node:test";
import { cachedWeatherCondition, loadLiveWeatherCondition } from "./weather.mjs";
import { LiveState } from "./state.mjs";
import { LiveTimeline, TimelineViewer } from "./timeline.mjs";

const now = Date.parse("2026-10-31T12:20:00Z");
const row = (overrides = {}) => ({ weather_code: 0, observed_at: "2026-10-31T12:15:00Z",
  updated_at: "2026-10-31T12:17:00Z", raw_payload: { current: { is_day: 1, cloud_cover: 5 } }, ...overrides });

test("sky conditions retain clear-sky zero, daylight and the provider's UTC observation", () => {
  assert.deepEqual(cachedWeatherCondition(row({ observed_at: "2026-10-31T12:15" }), now), {
    code: 0, isDay: true, cloudCover: 5, observedAt: "2026-10-31T12:15:00.000Z",
    expiresAt: "2026-10-31T13:15:00.000Z", source: "Open-Meteo",
  });
  assert.equal(cachedWeatherCondition(row({ raw_payload: { current: { is_day: 0, cloud_cover: 0 } } }), now).isDay, false);
});

test("stale, future, malformed and unknown conditions never invent sunshine", () => {
  for (const overrides of [
    { updated_at: "2026-10-30T12:15:00Z" }, { observed_at: "2026-10-30T12:15:00Z" },
    { observed_at: "2026-10-31T13:15:00Z" }, { updated_at: "2026-10-31T13:15:00Z" },
    { weather_code: 999 }, { weather_code: false }, { weather_code: null },
    { observed_at: "bad" }, { updated_at: null },
  ]) assert.equal(cachedWeatherCondition(row(overrides), now), null);
  assert.equal(cachedWeatherCondition(null, now), null);
  assert.equal(cachedWeatherCondition(row({ raw_payload: { current: { cloud_cover: 999 } } }), now).cloudCover, null);
});

test("legacy caches use a fresh past hour, never a future or old forecast", () => {
  const legacy = row({ weather_code: null, raw_payload: { hourly: {
    time: ["2026-10-31T11:00", "2026-10-31T12:00", "2026-10-31T13:00"], weather_code: [1, 3, 0],
  } } });
  const result = cachedWeatherCondition(legacy, now);
  assert.equal(result.code, 3);
  assert.equal(result.isDay, null);
  assert.equal(result.observedAt, "2026-10-31T12:00:00.000Z");
  assert.equal(cachedWeatherCondition({ ...legacy, updated_at: "2026-10-30T12:00:00Z" }, now), null);
  assert.equal(cachedWeatherCondition({ ...legacy, raw_payload: { hourly: { time: ["2026-10-31T13:00"], weather_code: [0] } } }, now), null);
});

test("LIVE reads only the selected race's existing provider cache and surfaces database failures", async () => {
  const calls = [];
  const query = {
    from(value) { calls.push(["from", value]); return this; },
    select() { return this; }, eq(...args) { calls.push(args); return this; },
    maybeSingle() { return this; }, abortSignal() { return Promise.resolve({ data: row(), error: null }); },
  };
  assert.equal((await loadLiveWeatherCondition(query, { race_id: "selected-race" }, now)).code, 0);
  assert.deepEqual(calls, [["from", "circuit_weather"], ["race_id", "selected-race"], ["provider", "open-meteo"]]);
  calls.length = 0;
  assert.equal(await loadLiveWeatherCondition(query, {}, now), null);
  assert.equal(calls.length, 0);
  query.abortSignal = () => Promise.resolve({ data: null, error: new Error("Unavailable") });
  await assert.rejects(loadLiveWeatherCondition(query, { race_id: "selected-race" }, now), /Unavailable/);
});

test("track weather updates preserve sky conditions, session changes clear them, rewind keeps the old sky", () => {
  const state = new LiveState();
  const session = { session_key: 1, session_type: "Practice", date_start: new Date(now - 60000).toISOString() };
  state.setSession(session);
  state.state.weather = { condition: cachedWeatherCondition(row({ weather_code: 3 }), now) };
  state.apply("weather", { session_key: 1, date: new Date(now).toISOString(), rainfall: 0, air_temperature: 25 });
  assert.equal(state.state.weather.condition.code, 3);
  assert.equal(state.state.weather.air, 25);
  const timeline = new LiveTimeline();
  timeline.captureState(state.snapshot(), now);
  state.state.weather = { ...state.state.weather, condition: cachedWeatherCondition(row(), now + 60000) };
  timeline.captureState(state.snapshot(), now + 60000);
  const viewer = new TimelineViewer(timeline, { mode: "rewind", delayMs: 60000 }, now + 60000);
  assert.equal(viewer.snapshot(now + 60000).data.weather.condition.code, 3);
  state.setSession({ ...session, session_key: 2 });
  assert.equal(state.state.weather, null);
});
