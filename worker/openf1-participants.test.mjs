import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { getOpenF1ParticipantIdentity } from "./openf1-session-results.mjs";

const source = ts.createSourceFile("index.mjs", readFileSync(new URL("./index.mjs", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const names = ["extendDriverMapWithOpenF1SessionParticipants", "resolveExactTeamId", "resolveTeamId", "normalizeFantasyTeamKey"];
const functions = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText(source));
assert.equal(functions.length, names.length);
const haas = { id: "haas", name: "Haas F1 Team", code: "HAA", external_id: "haas" };
const camara = { driver_number: 51, first_name: "Rafael", last_name: "Câmara", full_name: "Rafael CAMARA", name_acronym: "CAM", team_name: "Haas F1 Team" };

function fixture(participants, existing) {
  const writes = [];
  const supabase = { from(table) {
    let rows = table === "teams" ? [haas] : existing;
    const query = {
      select() { return this; }, eq() { return this; },
      in(column, values) { rows = rows.filter(row => values.includes(row[column])); return this; },
      then(resolve, reject) { return Promise.resolve({ data: rows }).then(resolve, reject); },
      upsert(row) { writes.push(row); return { select: () => ({ single: async () => ({ data: { ...row, id: "new-camara" } }) }) }; },
    };
    return query;
  } };
  const extend = new Function("supabase", "fetchJson", "getOpenF1ParticipantIdentity", `${functions.join("\n")}\nreturn extendDriverMapWithOpenF1SessionParticipants;`)(supabase, async () => participants, getOpenF1ParticipantIdentity);
  return { extend, writes };
}

test("Brazil's number 51 belongs to Rafael Camara, not historical Pietro Fittipaldi", async () => {
  const pietro = { id: "pietro", full_name: "Pietro Fittipaldi", external_id: "pietro_fittipaldi", permanent_number: 51, current_team_id: null };
  const base = new Map([[51, pietro]]);
  const { extend, writes } = fixture([camara], [pietro]);
  const mapped = await extend({ baseUrl: "https://openf1.test", drivers: base, sessionKey: 11408 });
  assert.deepEqual(mapped.get(51), { id: "new-camara", current_team_id: "haas" });
  assert.equal(base.get(51).id, "pietro");
  assert.equal(writes[0].full_name, "Rafael Camara");
  assert.equal(writes[0].is_active, false);
});

test("an existing driver is matched by accent-normalized identity and gets the session team", async () => {
  const existing = { id: "rafael", full_name: "Rafael Câmara", slug: "rafael-camara", external_id: "camara", permanent_number: 51, current_team_id: null };
  const { extend, writes } = fixture([camara], [existing]);
  const mapped = await extend({ baseUrl: "https://openf1.test", drivers: new Map([[51, { id: "pietro" }]]), sessionKey: 11408 });
  assert.deepEqual(mapped.get(51), { id: "rafael", current_team_id: "haas" });
  assert.deepEqual(writes, []);
});

test("a returning main driver replaces a practice substitute even when both use the same number", async () => {
  const bearman = { id: "bearman", full_name: "Oliver Bearman", slug: "oliver-bearman", external_id: "bearman", permanent_number: 87, current_team_id: "old-team" };
  const { extend } = fixture([{ ...camara, driver_number: 87, full_name: "Oliver BEARMAN", first_name: "Oliver", last_name: "Bearman", name_acronym: "BEA" }], [bearman]);
  const mapped = await extend({ baseUrl: "https://openf1.test", drivers: new Map([[87, { id: "reserve" }], [99, { id: "absent" }]]), sessionKey: 11408 });
  assert.deepEqual(mapped.get(87), { id: "bearman", current_team_id: "haas" });
  assert.equal(mapped.has(99), false);
});

test("OpenF1's shortened Kimi Antonelli name reuses Andrea Kimi Antonelli without a duplicate", async () => {
  const antonelli = { id: "antonelli", full_name: "Andrea Kimi Antonelli", slug: "andrea-kimi-antonelli", external_id: "antonelli", code: "ANT", current_team_id: "mercedes" };
  const { extend, writes } = fixture([{ ...camara, driver_number: 12, full_name: "Kimi ANTONELLI", first_name: "Kimi", last_name: "Antonelli", name_acronym: "ANT", team_name: "Unknown" }], [antonelli]);
  const mapped = await extend({ baseUrl: "https://openf1.test", sessionKey: 11408 });
  assert.equal(mapped.get(12).id, "antonelli");
  assert.deepEqual(writes, []);
});

test("Norris's exact name cannot be shadowed by an inactive legacy external-ID alias", async () => {
  const canonical = { id: "norris", full_name: "Lando Norris", external_id: "norris", slug: "lando-norris", code: "NOR", current_team_id: "mclaren" };
  const legacy = { id: "legacy-norris", full_name: "Ландо Норрис", external_id: "lando_norris", slug: "driver-legacy", code: "NOR", current_team_id: null };
  const participant = { ...camara, driver_number: 1, first_name: "Lando", last_name: "NORRIS", full_name: "Lando NORRIS", name_acronym: "NOR", team_name: "McLaren" };
  for (const existing of [[canonical, legacy], [legacy, canonical]]) {
    const { extend, writes } = fixture([participant], existing);
    const mapped = await extend({ baseUrl: "https://openf1.test", sessionKey: 11408 });
    assert.equal(mapped.get(1).id, "norris");
    assert.deepEqual(writes, []);
  }
});

test("an empty session roster cannot silently publish a historical number mapping", async () => {
  const { extend } = fixture([], []);
  await assert.rejects(extend({ baseUrl: "https://openf1.test", drivers: new Map([[51, { id: "pietro" }]]), sessionKey: 11408 }), /roster/i);
});

test("results and starting-grid sync always verify the roster even when every number is known", () => {
  for (const name of ["syncOpenF1Laps", "syncOpenF1StartingGrid"]) {
    const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    let unconditional = false;
    function visit(node, insideIf = false) {
      if (ts.isCallExpression(node) && node.expression.getText(source) === "extendDriverMapWithOpenF1SessionParticipants") unconditional ||= !insideIf;
      ts.forEachChild(node, child => visit(child, insideIf || ts.isIfStatement(node)));
    }
    visit(declaration);
    assert.equal(unconditional, true, `${name} must not trust driver number alone`);
  }
});
