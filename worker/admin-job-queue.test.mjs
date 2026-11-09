import assert from "node:assert/strict";
import test from "node:test";

import { getUnexpectedWorkerExitMessage, validateQueuedJob, toWorkerArguments } from "./admin-job-queue.mjs";

test("records a deterministic failure when an attached worker exits early", () => {
  assert.equal(
    getUnexpectedWorkerExitMessage(1),
    "Worker завершился с кодом 1 до сохранения результата.",
  );
  assert.equal(
    getUnexpectedWorkerExitMessage(0),
    "Worker завершился с кодом 1 до сохранения результата.",
  );
});

test("periodic telemetry discovery is allowed by the normal worker queue without arguments", () => {
  const result = validateQueuedJob({ job_name: "telemetry.refresh_recent", metadata: { args: {} } });
  assert.equal(result.ok, true);
  assert.equal(result.definition.expectedIntervalMinutes, 5);
  assert.deepEqual(toWorkerArguments(result.definition, result.args), []);
  assert.equal(validateQueuedJob({ job_name: "telemetry.refresh_recent", metadata: { args: { force: true } } }).ok, false);
});
