import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCursorStore,
  telemetryBootstrapRequest,
} from './client.ts';

test('telemetry bootstrap loads the initial setup in one request', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const progress = [];
  const data = {
    seasons: [2026],
    season: 2026,
    meetings: [{ id: 1294 }],
    meeting: 1294,
    sessions: [{ id: 11365 }],
    session: 11365,
    catalog: { session: { id: 11365 }, drivers: [], laps: [] },
    stage: 'ready',
  };
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    return new Response(JSON.stringify({ status: 200, data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const result = await telemetryBootstrapRequest(
      { season: 2026, meeting: 1294, session: 11365 },
      { onProgress: (value) => progress.push(value.stage) },
    );
    assert.deepEqual(result, data);
    assert.deepEqual(progress, ['ready']);
    assert.deepEqual(requests, [
      '/api/telemetry/bootstrap?season=2026&meeting=1294&session=11365',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('telemetry bootstrap reports partial data and stops polling when selection changes', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const progress = [];
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return new Response(JSON.stringify({
      status: 202,
      data: {
        seasons: [2026], season: 2026, meetings: [], meeting: null,
        sessions: [], session: null, catalog: null, stage: 'meetings',
      },
    }), { status: 202, headers: { 'Retry-After': '3' } });
  };
  try {
    await assert.rejects(
      telemetryBootstrapRequest({}, {
        signal: controller.signal,
        onProgress: (data) => {
          progress.push(data.stage);
          controller.abort();
        },
      }),
      { name: 'AbortError' },
    );
    assert.deepEqual(progress, ['meetings']);
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('cursor resumes notifications after cleanup cancels a pending frame', () => {
  const originalRequest = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  const pending = new Map();
  let nextFrame = 0;
  globalThis.requestAnimationFrame = (callback) => {
    pending.set(++nextFrame, callback);
    return nextFrame;
  };
  globalThis.cancelAnimationFrame = (id) => pending.delete(id);
  try {
    const cursor = createCursorStore();
    cursor.set(100);
    cursor.destroy();
    assert.equal(pending.size, 0);
    const positions = [];
    const unsubscribe = cursor.subscribe(() => positions.push(cursor.get()));
    cursor.set(1500);
    cursor.set(3000);
    assert.equal(pending.size, 1, 'pointer updates share one animation frame');
    const flush = () => {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback(0));
    };
    flush();
    assert.deepEqual(positions, [3000], 'map and slider receive the latest position');
    unsubscribe();
    cursor.set(4000);
    flush();
    assert.deepEqual(positions, [3000]);
    cursor.destroy();
  } finally {
    globalThis.requestAnimationFrame = originalRequest;
    globalThis.cancelAnimationFrame = originalCancel;
  }
});
