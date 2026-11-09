import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  calculateLoopDelayMs,
  getItemsProcessed,
  parseLoopArguments,
  runChildProcess,
} from "./cli-loop.mjs";

test("worker loop polls quickly while work remains and backs off while idle", () => {
  const options = {
    busyDelayMs: 1_000,
    idleDelayMs: 15_000,
    maxBackoffMs: 300_000,
  };

  assert.equal(calculateLoopDelayMs({ ...options, exitCode: 0, failureCount: 0, itemsProcessed: 2 }), 1_000);
  assert.equal(calculateLoopDelayMs({ ...options, exitCode: 0, failureCount: 0, itemsProcessed: 0 }), 15_000);
  assert.equal(calculateLoopDelayMs({ ...options, exitCode: 1, failureCount: 1, itemsProcessed: null }), 30_000);
  assert.equal(calculateLoopDelayMs({ ...options, exitCode: 1, failureCount: 10, itemsProcessed: null }), 300_000);
});

test("worker loop reads the last structured result without swallowing worker output", () => {
  assert.equal(getItemsProcessed('{"jobName":"one","itemsProcessed":0}\n'), 0);
  assert.equal(getItemsProcessed('progress\n{"jobName":"two","itemsProcessed":3}\n'), 3);
  assert.equal(getItemsProcessed('not-json\n'), null);
});

test("worker loop terminates a child command that exceeds its timeout", async () => {
  const startedAt = Date.now();
  const result = await runChildProcess({
    args: ["-e", "setInterval(() => {}, 1_000)"],
    commandName: "test.hang",
    executable: process.execPath,
    onSpawn() {},
    timeoutMs: 50,
  });

  assert.equal(result.exitCode, 124);
  assert.ok(Date.now() - startedAt < 2_000);
});

test("worker loop keeps its own options away from the worker command", () => {
  assert.deepEqual(parseLoopArguments([
    "--loop-idle-ms=15000",
    "--loop-busy-ms=1000",
    "--loop-max-backoff-ms=300000",
    "--loop-command-timeout-ms=1800000",
    "--loop-heartbeat-timeout-ms=45000",
    "--loop-heartbeat-service=admin-job-runner",
    "jobs.consume_queued",
    "--limit",
    "3",
  ]), {
    busyDelayMs: 1_000,
    commandTimeoutMs: 1_800_000,
    commandArgs: ["jobs.consume_queued", "--limit", "3"],
    heartbeatService: "admin-job-runner",
    heartbeatTimeoutMs: 45_000,
    idleDelayMs: 15_000,
    maxBackoffMs: 300_000,
  });
});

test("production workers use resilient polling intervals", () => {
  const compose = readFileSync(
    new URL("../deploy/docker-compose.server.yml", import.meta.url),
    "utf8",
  );
  const warmer = readFileSync(
    new URL("../scripts/warm-public-pages.mjs", import.meta.url),
    "utf8",
  );

  assert.match(compose, /worker\/cli-loop\.mjs/);
  assert.match(compose, /--loop-idle-ms=15000/);
  assert.match(compose, /--loop-idle-ms=60000/);
  assert.match(compose, /--loop-idle-ms=300000/);
  assert.match(compose, /--loop-command-timeout-ms=120000/);
  assert.match(compose, /--loop-command-timeout-ms=1800000/);
  assert.match(compose, /--loop-heartbeat-timeout-ms=45000/);
  assert.doesNotMatch(compose, /sleep 3|sleep 15/);
  assert.match(warmer, /isApplicationHealthy/);
  assert.match(warmer, /const intervalMs = 4 \* 60_000/);
});

test("web image cache survives recreation without sharing the LIVE spool", () => {
  for (const path of ["../docker-compose.yml", "../deploy/docker-compose.server.yml"]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    const web = source.slice(source.indexOf("  web:"), source.indexOf("  live:"));
    assert.match(web, /web-image-cache:\/app\/\.next\/cache\/images/);
    assert.doesNotMatch(web, /live-spool/);
    assert.match(source, /^volumes:\n(?:.*\n)*?  web-image-cache:/m);
  }
});
