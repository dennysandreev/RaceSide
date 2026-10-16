import assert from "node:assert/strict";
import test from "node:test";

import { selectTelemetryDemoCandidates, selectTelemetryDemoSession, configUsesDemoSessions } from "./demo-selection.ts";

const meeting = (id, start) => ({ id, start });

test("telemetry demo selects the Grand Prix completed two stages ago", () => {
  const candidates = selectTelemetryDemoCandidates([
    {
      year: 2026,
      meetings: [
        meeting("round-1", "2026-03-01T12:00:00Z"),
        meeting("round-2", "2026-03-15T12:00:00Z"),
        meeting("round-3", "2026-03-29T12:00:00Z"),
        meeting("round-4", "2026-04-12T12:00:00Z"),
      ],
    },
  ], Date.parse("2026-04-20T12:00:00Z"));

  assert.equal(candidates[0]?.id, "round-2");
});

test("telemetry demo falls back to the latest completed round of the previous season", () => {
  const candidates = selectTelemetryDemoCandidates([
    { year: 2026, meetings: [meeting("current-1", "2026-03-01T12:00:00Z")] },
    {
      year: 2025,
      meetings: [
        meeting("previous-1", "2025-11-01T12:00:00Z"),
        meeting("previous-2", "2025-12-01T12:00:00Z"),
      ],
    },
  ], Date.parse("2026-03-05T12:00:00Z"));

  assert.equal(candidates[0]?.id, "previous-2");
});

const now = Date.parse("2026-04-20T12:00:00Z");
test("demo opens only a completed main race, excluding qualifying, sprint and ongoing races", () => {
  const sessions = [
    { id: 1, name: "Qualifying", end: "2026-04-18T12:00:00Z" },
    { id: 2, name: "Sprint", end: "2026-04-18T14:00:00Z" },
    { id: 3, name: "Race", end: "2026-04-20T14:00:00Z" },
    { id: 4, name: "Race", end: "invalid" },
    { id: 5, name: "Race", end: "2026-04-19T14:00:00Z" },
  ];
  assert.equal(selectTelemetryDemoSession(sessions, now)?.id, 5);
  assert.equal(selectTelemetryDemoSession(sessions.slice(0, 4), now), null);
});
test("any drivers and laps can be compared inside the sole demo session", () => {
  const scope = { sessions: [{ id: 10 }] };
  for (const config of [
    { mode: "lap", traces: [{ session: 10, driver: 1, lap: 3 }, { session: 10, driver: 44, lap: 20 }] },
    { mode: "best", traces: [{ session: 10, driver: 4, lap: "best" }] },
    { mode: "teammate", traces: [{ session: 10, driver: 44, lap: "best" }] },
    { mode: "lap", traces: [{ session: 10, driver: 16, lap: "race_average" }] },
    { mode: "evolution", window: "session", traces: [{ session: 10, driver: 1, lap: "best" }] },
  ]) assert.equal(configUsesDemoSessions(config, scope), true);
});
test("demo rejects other or mixed sessions and evolution that fetches the whole weekend", () => {
  const scope = { sessions: [{ id: 10 }] };
  for (const config of [
    null, {}, { traces: [] }, { traces: [null] },
    { traces: [{ session: "10" }] },
    { traces: [{ session: 11 }] },
    { traces: [{ session: 10 }, { session: 11 }] },
    { mode: "evolution", traces: [{ session: 10 }] },
    { mode: "evolution", window: "weekend", traces: [{ session: 10 }] },
  ]) assert.equal(configUsesDemoSessions(config, scope), false);
  assert.equal(configUsesDemoSessions({ traces: [{ session: 10 }] }, { sessions: [{ id: 10 }, { id: 11 }] }), false);
});
