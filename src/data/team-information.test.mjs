import assert from "node:assert/strict";
import test from "node:test";

import { getTeamInformation } from "./team-information.ts";

const teamSlugs = [
  "mercedes", "ferrari", "mclaren", "red-bull", "aston-martin", "alpine",
  "racing-bulls", "haas", "williams", "audi", "cadillac",
];

test("all 2026 teams have complete, sourced information", () => {
  for (const slug of teamSlugs) {
    const info = getTeamInformation(slug, 2026);
    assert.ok(info, slug);
    assert.equal(info.slug, slug);
    assert.ok(Number.isInteger(info.firstEntryYear) && info.firstEntryYear >= 1950 && info.firstEntryYear <= 2026);
    assert.ok(info.base.length > 0);
    assert.ok(info.chassis.length > 0);
    assert.ok(info.teamPrincipals.length > 0 && info.teamPrincipals.every((name) => name.length > 0));
    assert.ok(info.technicalDirectors.length > 0 && info.technicalDirectors.every((name) => name.length > 0));
    assert.equal(new URL(info.sourceUrl).hostname, "www.formula1.com");
  }
});

test("archive and future seasons never inherit 2026 leadership or chassis", () => {
  for (const season of [2020, 2021, 2022, 2023, 2024, 2025, 2027, NaN]) {
    for (const slug of teamSlugs) assert.equal(getTeamInformation(slug, season), null);
  }
});

test("lookup normalizes canonical slugs and rejects unknown teams", () => {
  assert.equal(getTeamInformation(" Mercedes ", 2026)?.chassis, "W17");
  for (const slug of ["", "unknown", "constructor", "__proto__"]) {
    assert.equal(getTeamInformation(slug, 2026), null);
  }
});

test("entry years follow the official team profiles, not a guessed current-brand debut", () => {
  assert.equal(getTeamInformation("mercedes", 2026)?.firstEntryYear, 1970);
  assert.equal(getTeamInformation("red-bull", 2026)?.firstEntryYear, 1997);
  assert.equal(getTeamInformation("audi", 2026)?.firstEntryYear, 2026);
});

test("shared technical and team leadership retain every listed person", () => {
  assert.deepEqual(getTeamInformation("ferrari", 2026)?.technicalDirectors, ["Loic Serra", "Enrico Gualtieri"]);
  assert.deepEqual(getTeamInformation("mclaren", 2026)?.technicalDirectors, ["Peter Prodromou", "Neil Houldey"]);
  assert.deepEqual(getTeamInformation("alpine", 2026)?.teamPrincipals, ["Flavio Briatore", "Steve Nielsen"]);
});
