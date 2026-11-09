import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as openF1 from "../../worker/openf1-session-results.mjs";
import { chooseSessionWithControls, sessionHistoryEnd } from "../../worker/live/session-mode.mjs";

const fixture = JSON.parse(readFileSync(new URL("../../worker/live/fixtures/brazil-qualifying-delay-2026.json", import.meta.url), "utf8"));
const now = Date.parse("2026-11-07T19:44:00Z");
class Clock extends Date { static now() { return now; } }

function load(file, names, bindings) {
  const source = ts.createSourceFile(file, readFileSync(new URL(file, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const functions = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText(source).replace(/^export /, ""));
  assert.equal(functions.length, names.length);
  const { outputText } = ts.transpileModule(functions.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } });
  return new Function(...Object.keys(bindings), `${outputText}\nreturn {${names.join(",")}};`)(...Object.values(bindings));
}

test("public session and sidebar never infer completion from the scheduled end", () => {
  const { getRuntimeSessionStatus } = load("./racemate-repository.ts", ["getRuntimeSessionStatus", "mapSessionStatus"], {
    Date: Clock, getTimeMs: value => value ? Date.parse(value) : null,
  });
  const { getRuntimeState } = load("../components/racemate/sidebar-session-status.tsx", ["getRuntimeState", "formatCountdown"], {});
  const input = { startsAt: fixture.session.date_start, sessionName: "Квалификация", sessionType: "qualifying" };
  assert.equal(getRuntimeSessionStatus({ ...input, rawStatus: "scheduled" }), "Live");
  assert.equal(getRuntimeSessionStatus({ ...input, rawStatus: "completed" }), "Завершена");
  assert.equal(getRuntimeSessionStatus({ ...input, rawStatus: "finished" }), "Завершена");
  assert.equal(getRuntimeState({ now, startsAtIso: input.startsAt, status: "Live" }).live, true);
  assert.equal(getRuntimeState({ now, startsAtIso: input.startsAt, status: "Завершена" }).live, false);
});

test("LIVE keeps delayed qualifying after Q1, including cold-start recovery after the stale end", async () => {
  const next = { session_key: 11412, session_type: "Race", date_start: "2026-11-08T17:00:00Z", date_end: "2026-11-08T19:00:00Z" };
  const choice = await chooseSessionWithControls([fixture.session, next], {
    now, loadControls: async () => fixture.controls,
  });
  assert.equal(choice.session.session_key, 11408);
  assert.equal(choice.active, true);
  assert.equal(sessionHistoryEnd(fixture.session, fixture.controls, true, now), now);
});

test("calendar refresh preserves a known status and never marks elapsed scheduled sessions complete", async () => {
  for (const previous of [null, { id: "session", status: "scheduled" }, { id: "session", status: "completed" }]) {
    const written = [];
    const supabase = { from: () => ({
      select() { return this; }, eq() { return this; },
      maybeSingle: async () => ({ data: previous }),
      upsert(row) { written.push(row); return { select: () => ({ single: async () => ({ data: { id: "session" } }) }) }; },
    }) };
    const { upsertScheduleSessions } = load("../../worker/index.mjs", ["upsertScheduleSessions"], { supabase });
    await upsertScheduleSessions("race", { Qualifying: { date: "2026-11-07", time: "18:00:00Z" } }, { suppressNotifications: true });
    assert.equal(written[0].status, previous?.status ?? "scheduled");
  }
});

test("even a forced worker refresh cannot publish results or prewarm telemetry during delayed Q1", async () => {
  const requests = [];
  const session = { id: "qualifying", session_type: "qualifying", openf1_session_key: 11408,
    start_at: fixture.session.date_start, end_at: fixture.session.date_end,
    races: { id: "race", race_name: "Brazilian Grand Prix", round: 20 } };
  const query = { select() { return this; }, not() { return this; }, in() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: session }) };
  let warmedSessions;
  const { syncOpenF1Laps } = load("../../worker/index.mjs", ["syncOpenF1Laps"], {
    ...openF1, Date: Clock, process: { env: {} }, supabase: { from: () => query },
    firstRelation: value => value,
    hasOpenF1LiveCredentials: () => true,
    getStoredSessionResultStates: async () => new Map([[session.id, { rows: [], hasOfficialClassification: false }]]),
    enqueueMissingTelemetryTasks: async () => 0, TelemetryStore: class {},
    localRacePaceTasks: sessions => { warmedSessions = sessions; return []; },
    fetchJson: async url => { requests.push(url); assert.match(url, /\/race_control\?/); return fixture.controls; },
  });
  const result = await syncOpenF1Laps({ forceProbe: true, forceOpenF1Refresh: true, targetSessionKey: 11408 });
  assert.equal(result.itemsProcessed, 0);
  assert.equal(result.metadata.waitingForSessionEnd, 1);
  assert.equal(requests.length, 1);
  assert.deepEqual(warmedSessions, []);
});

test("lap-only qualifying rows stay hidden while genuine qualifying and practice results remain visible", () => {
  const { mapSessionResultRows } = load("./racemate-repository.ts", ["mapSessionResultRows", "isLapOnlyResult"], {
    getRelationObject: value => value,
    deduplicateSessionResultRows: rows => rows,
    getTeamVisualFields: () => ({}), getRelationName: () => "Driver",
    getDriverSeasonNumberOverride: () => null, getSessionResultDriverNumber: () => null,
    getFastestLapTimeFromPayload: () => null, getFastestLapNumberFromPayload: () => null,
  });
  const row = { position: 1, points: null, drivers: {}, status: "Лучшее время", sessions: { session_type: "qualifying" }, raw_payload: { _racemate_source: "openf1_laps_fallback" } };
  assert.equal(mapSessionResultRows([row], 2026).length, 0);
  assert.equal(mapSessionResultRows([{ ...row, sessions: { session_type: "fp3" } }], 2026).length, 1);
  assert.equal(mapSessionResultRows([{ ...row, status: "Q3", raw_payload: { _racemate_source: "openf1_session_result" } }], 2026).length, 1);
});
