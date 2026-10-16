import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { auditRepositoryFile, missingDocumentLinks } from "./check-repository-hygiene.mjs";

test("local artifacts and private environment variants cannot enter the repository", () => {
  for (const path of [".env", ".env.telegram", ".env.production", "worker/.env.local", ".playwright-cli/page.yml", "test-results/.last-run.json", "output/check.json", "Avatars f1/Driver.png", "docs/codemap/codemap.html", "private.key"]) {
    assert.ok(auditRepositoryFile(path, Buffer.from("example")).length, path);
  }
});

test("source, migrations, fixtures and required prepared assets remain allowed", () => {
  for (const path of [".env.example", "src/lib/env.ts", "supabase/migrations/0019_prediction_share_flow.sql", "docs/telemetry/fixtures/comparison.json", "public/anatomy/model-mercedes.bin.gz", "scripts/anatomy/vendor/LICENSE"]) {
    assert.deepEqual(auditRepositoryFile(path, Buffer.from("example")), [], path);
  }
});

test("known credential formats fail without disclosing their values", () => {
  const examples = [
    ["sk", "or", "v1", "a".repeat(64)].join("-"),
    ["sbp", "a".repeat(40)].join("_"),
    "123456789:" + "A".repeat(35),
    ["-----BEGIN", "OPENSSH PRIVATE KEY-----"].join(" "),
  ];
  for (const value of examples) {
    const errors = auditRepositoryFile("example.txt", Buffer.from(value));
    assert.ok(errors.length);
    assert.ok(errors.every(error => !error.includes(value)));
  }
});

test("service-role JWTs are rejected but public anon JWTs are permitted", () => {
  const jwt = role => ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify({ role })).toString("base64url"), "example"].join(".");
  assert.ok(auditRepositoryFile("example.txt", Buffer.from(jwt("service_role"))).length);
  assert.deepEqual(auditRepositoryFile("example.txt", Buffer.from(jwt("anon"))), []);
});

test("documentation links resolve against tracked files, not local artifacts", () => {
  const files = ["README.md", "docs/README.md", "src/app/page.tsx", "docs/telemetry/fixtures/comparison.json"];
  const text = "[Root](../README.md) [Source](../src/app/) [Fixture](telemetry/fixtures/comparison.json#case) [Missing](local.png) [Web](https://example.com)";
  assert.deepEqual(missingDocumentLinks("docs/README.md", text, files), ["local.png"]);
});

test("the production Docker runtime retains the shared LIVE replay modules", () => {
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  for (const name of ["motion.ts", "track-geometry.ts"]) {
    const path = `src/features/race-replay/lib/${name}`;
    assert.ok(dockerfile.includes(`COPY --from=builder /app/${path} ./${path}`), `${path} is imported by worker/live/replay-motion.mjs`);
  }
});
