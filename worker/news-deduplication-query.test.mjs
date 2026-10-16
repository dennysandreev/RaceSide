import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

const workerSource = readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
const start = workerSource.indexOf("async function loadNewsDedupCandidates(");
const end = workerSource.indexOf("\nasync function saveNewsDedupDecision(", start);
assert.ok(start >= 0 && end > start);
// Exercise the worker query without starting its CLI or contacting external services.
const bindCandidateLoader = new Function("supabase", "rankNewsDedupCandidates",
  `${workerSource.slice(start, end)}\nreturn loadNewsDedupCandidates;`);

test("archived news candidates use a JSONB filter rather than a Postgres array", async () => {
  const requests = [];
  const supabase = createClient("https://example.supabase.co", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input) => {
      const url = new URL(input);
      requests.push(url);
      return new Response(JSON.stringify(url.searchParams.has("normalized_entities")
        ? [{ id: "archived-candidate" }] : []), {
        headers: { "Content-Type": "application/json" },
      });
    } },
  });
  const load = bindCandidateLoader(supabase, (_article, candidates) => candidates);
  const result = await load({
    original_title: "George Russell signs a new contract",
    normalizedEntities: [{ name: "George Russell", normalized_name: "george_russell" }],
  }, { windowHours: 168, preflight: true });

  assert.equal(requests.length, 2);
  assert.equal(requests[1].searchParams.get("normalized_entities"),
    'cs.[{"normalized_name":"george_russell"}]');
  assert.deepEqual(result, [{ id: "archived-candidate" }]);
});
