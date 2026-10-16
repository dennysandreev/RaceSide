import assert from "node:assert/strict";
import test from "node:test";
import { loadNewsContext, selectNewsContext } from "./news-context.mjs";

function database(rows, failure) {
  const calls = [];
  return { calls, from(table) {
    const filters = [];
    const query = {
      select() { return query; },
      eq(key, value) { filters.push([key, value]); return query; },
      in(key, value) { filters.push([key, value]); return query; },
      order() { return query; }, limit() { return query; },
      then(resolve) { calls.push({ table, filters }); return Promise.resolve({ data: rows[table] ?? [], error: failure === table ? new Error("unavailable") : null }).then(resolve); },
    };
    return query;
  } };
}

const now = new Date("2026-09-22T10:00:00Z");
const rows = {
  drivers: [{ id: "ham", full_name: "Lewis Hamilton", last_name: "Hamilton", updated_at: now.toISOString(), teams: { name: "Scuderia Ferrari", short_name: "Ferrari" } }],
  races: [{ id: "race", race_name: "Italian Grand Prix", round: 14, status: "completed", race_start_at: "2026-09-01T12:00:00Z" }],
  driver_standings: [{ id: "s1", driver_id: "ham", round: 14, points: 123, position: 4, wins: 1 }, { id: "s0", driver_id: "ham", round: 13, points: 99, position: 5, wins: 0 }],
  sessions: [{ id: "session", race_id: "race", session_type: "race" }],
  session_results: [{ id: "result", session_id: "session", driver_id: "ham", position: 3 }],
};

test("context uses current database teams, latest standings round and explicit result scope", async () => {
  const client = database(rows);
  const context = await loadNewsContext(client, { season: 2026, now });
  assert.equal(context.facts.find(fact => fact.kind === "driver_team").value, "Ferrari");
  assert.deepEqual(context.facts.filter(fact => fact.kind === "championship_points").map(fact => [fact.value, fact.scope]), [[123, "season_2026_after_round_14"]]);
  assert.equal(context.facts.find(fact => fact.kind === "session_position").scope, "2026:Italian Grand Prix:race");
  for (const table of ["races", "driver_standings", "constructor_standings"]) {
    assert.ok(client.calls.find(call => call.table === table).filters.some(([key, value]) => key === "season_year" && value === 2026));
  }
  assert.ok(!selectNewsContext(context, { title: "New regulations" }, []).facts.some(fact => fact.kind === "session_position"));
  assert.ok(selectNewsContext(context, { title: "Hamilton speaks after Italian Grand Prix practice results" }, []).facts.some(fact => fact.kind === "session_position"));
});

test("missing context or an outdated season fails closed", async () => {
  await assert.rejects(loadNewsContext(database(rows), { season: 2025, now }), /season_mismatch/);
  await assert.rejects(loadNewsContext(database({}), { season: 2026, now }), /context_unavailable/);
  await assert.rejects(loadNewsContext(database(rows, "drivers"), { season: 2026, now }), /unavailable/);
});

test("venue aliases, accented surnames and Russian names retain current race and team context", async () => {
  const context = await loadNewsContext(database({ ...rows,
    drivers: [...rows.drivers, { id: "hul", full_name: "Nico Hülkenberg", last_name: "Hülkenberg", teams: { name: "Audi" } }],
    races: [...rows.races, { id: "baku", round: 17, race_name: "Azerbaijan Grand Prix", circuits: { name: "Baku City Circuit" } }],
  }), { season: 2026, now });
  const selected = selectNewsContext(context, { title: "Hulkenberg and Хэмилтон after Baku qualifying", text: "Хэмилтона ждёт следующий этап." }, []);
  assert.deepEqual(selected.races.map(race => race.id), ["baku"]);
  assert.equal(selected.races[0].season_year, 2026);
  assert.deepEqual(selected.facts.filter(fact => fact.kind === "driver_team").map(fact => fact.value), ["Ferrari", "Audi"]);
  assert.equal(selectNewsContext(context, { title: "Hamilton at Monza" }, []).races[0].id, "race");
  assert.ok(!selectNewsContext(context, { title: "Spaulding announcement" }, []).races.some(race => race.race_name === "Belgian Grand Prix"));
});

test("editorial context excludes unrelated session results and stays bounded for broad articles", () => {
  const drivers = Array.from({ length: 20 }, (_, index) => ({ id: `d${index}`, full_name: `Driver ${index}`, last_name: `Driver ${index}` }));
  const facts = drivers.flatMap(driver => [
    { id: `${driver.id}:team`, kind: "driver_team", subject: driver.full_name, value: "Ferrari", scope: "current" },
    ...Array.from({ length: 30 }, (_, index) => ({ id: `${driver.id}:result:${index}`, kind: "session_position", subject: driver.full_name, value: index + 1, scope: "2026:Italian Grand Prix:practice" })),
  ]);
  const snapshot = { current_date: now.toISOString(), season: 2026, drivers, races: [{ id: "race", race_name: "Italian Grand Prix", round: 14 }], facts };
  const selected = selectNewsContext(snapshot, { title: "Formula 1 weekend preview", text: drivers.map(driver => driver.full_name).join(" ") }, []);
  assert.ok(selected.facts.some(fact => fact.id === "d0:team"));
  assert.ok(!selected.facts.some(fact => fact.kind === "session_position"));
  assert.ok(JSON.stringify(selected).length < 10_000);
});

test("Barcelona and Madrid remain distinct events in the same season", () => {
  const snapshot = { current_date: now.toISOString(), season: 2026, drivers: [], facts: [], races: [
    { id: "barcelona", race_name: "Barcelona Grand Prix", round: 7, circuits: { name: "Circuit de Barcelona-Catalunya" } },
    { id: "madrid", race_name: "Spanish Grand Prix", round: 14, circuits: { name: "Madring" } },
  ] };
  assert.deepEqual(selectNewsContext(snapshot, { title: "Barcelona practice" }, []).races.map(race => race.id), ["barcelona"]);
  assert.deepEqual(selectNewsContext(snapshot, { title: "Madring practice" }, []).races.map(race => race.id), ["madrid"]);
});

test("a country name identifies an adjectivally named Grand Prix without a circuit mention", () => {
  const snapshot = { current_date: now.toISOString(), season: 2026, drivers: [], facts: [], races: [
    { id: "malaysia", race_name: "Malaysian Grand Prix", round: 16, circuits: { name: "Sepang International Circuit", country: "Malaysia" } },
    { id: "bahrain", race_name: "Bahrain Grand Prix", round: 4, circuits: { name: "Bahrain International Circuit", country: "Bahrain" } },
  ] };
  assert.deepEqual(selectNewsContext(snapshot, { title: "Verstappen's run plan in Malaysia", text: "Bahrain Grand Prix in Malaysia" }, []).races.map(race => race.id), ["malaysia"]);
});
