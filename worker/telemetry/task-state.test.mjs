import assert from "node:assert/strict";
import test from "node:test";
import { TelemetryStore } from "./store.mjs";
import { runTelemetryTask } from "./service.mjs";

function fixture(row) {
  const writes = [];
  const db = { from: () => {
    let update;
    const filters = [];
    const query = {
      select: () => query, eq: (key, value) => { filters.push([key, value]); return query; },
      update: value => { update = value; return query; },
      maybeSingle: async () => ({ data: { ...row }, error: null }),
      then: resolve => { if (update && filters.every(([key, value]) => row[key] === value)) { Object.assign(row, update); writes.push(update); } return Promise.resolve({ error: null }).then(resolve); },
    };
    return query;
  } };
  return { db, writes };
}
const id = "20000000-0000-4000-8000-000000000001";
test("task failure is persisted and visible to the API", async () => {
  const row = { id, status: "queued", job_id: "job", error_code: null };
  const { db } = fixture(row), store = new TelemetryStore(db);
  await store.fail(id, "INVALID_TASK", "job");
  assert.equal(row.status, "failed");
  assert.equal((await store.task(id)).error_code, "INVALID_TASK");
});
test("late completion and failure cannot overwrite a newer attempt", async () => {
  const row = { id, status: "queued", job_id: "new", error_code: null };
  const { db, writes } = fixture(row), store = new TelemetryStore(db);
  await store.fail(id, "PROVIDER_UNAVAILABLE", "old");
  await store.finish(id, "old-result", "old");
  assert.equal(row.status, "queued"); assert.equal(writes.length, 0);
  const result = await runTelemetryTask({ db, taskId: id, jobId: "old", fetchRows: () => { throw new Error("unexpected provider call"); } });
  assert.equal(result.metadata.skipped, "superseded_attempt"); assert.equal(writes.length, 0);
});
test("legacy queued tasks with an error are consistently exposed as failed", async () => {
  const { db } = fixture({ id, status: "queued", job_id: null, error_code: "INVALID_TASK" });
  assert.equal((await new TelemetryStore(db).task(id)).status, "failed");
});
