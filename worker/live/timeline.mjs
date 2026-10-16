// Presentation history uses publication time, not the timestamp inside a late
// provider packet. A transcript or corrected result cannot appear before it was
// actually available. The same immutable frames serve every connected viewer.
export const REWIND_WINDOW_MS = 180000;
const SAMPLE_HISTORY_MS = 90000;
const RETENTION_MS = REWIND_WINDOW_MS + SAMPLE_HISTORY_MS + 10000;
const MAX_RECORDS = 8000;
const safeKey = (key) => !["__proto__", "prototype", "constructor"].includes(key);
const object = (value) => value !== null && typeof value === "object";

function reconcile(previous, next, path, patch) {
  if (Object.is(previous, next)) return previous;
  if (Array.isArray(previous) && Array.isArray(next)) {
    const keyed = new Map(previous.filter(object).map((item) => [item.id ?? item.lap, item]));
    const shared = next.map((value, index) => reconcile(
      object(value) && (value.id != null || value.lap != null)
        ? keyed.get(value.id ?? value.lap) : previous[index], value, [], [],
    ));
    if (previous.length === shared.length && shared.every((value, i) => value === previous[i])) return previous;
    patch.push({ path, value: shared });
    return shared;
  }
  if (object(previous) && object(next) && !Array.isArray(previous) && !Array.isArray(next)) {
    let changed = false;
    const shared = {};
    for (const key of Object.keys(next).filter(safeKey)) {
      shared[key] = reconcile(previous[key], next[key], [...path, key], patch);
      if (shared[key] !== previous[key] || !(key in previous)) changed = true;
    }
    for (const key of Object.keys(previous).filter(safeKey)) if (!(key in next)) {
      patch.push({ path: [...path, key], remove: true });
      changed = true;
    }
    return changed ? shared : previous;
  }
  const value = object(next) ? structuredClone(next) : next;
  patch.push({ path, value });
  return value;
}

export function applyTimelinePatch(state, patches) {
  let result = state;
  for (const patch of patches) {
    if (!Array.isArray(patch.path) || patch.path.some((key) => !safeKey(String(key))))
      throw new Error("Invalid timeline path");
    if (!patch.path.length) {
      result = patch.value;
      continue;
    }
    const update = (value, index) => {
      const copy = Array.isArray(value) ? [...value] : { ...value };
      const key = patch.path[index];
      if (index < patch.path.length - 1) copy[key] = update(value?.[key], index + 1);
      else if (patch.remove) delete copy[key];
      else copy[key] = patch.value;
      return copy;
    };
    result = update(result, 0);
  }
  return result;
}

function upperBound(rows, time) {
  let low = 0, high = rows.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (rows[mid].time <= time) low = mid + 1;
    else high = mid;
  }
  return low;
}

export class LiveTimeline {
  records = [];
  sequence = 0;
  state = null;

  captureState(data, time = Date.now()) {
    const patch = [];
    this.state = reconcile(this.state, data, [], patch);
    this.append({ type: "patch", patch, data: this.state }, time);
  }

  captureSamples(samples, sessionKey, time = Date.now()) {
    if (!samples.length || sessionKey == null) return;
    this.append({ type: "samples", sessionKey, samples: structuredClone(samples) }, time);
  }

  append(record, time) {
    if (!Number.isFinite(time)) throw new Error("Invalid timeline time");
    this.records.push({ ...record, time: Math.max(time, this.records.at(-1)?.time ?? time), seq: ++this.sequence });
    this.prune(time);
  }

  prune(now = Date.now()) {
    const cutoff = upperBound(this.records, now - RETENTION_MS);
    let baseline = cutoff - 1;
    while (baseline > 0 && this.records[baseline]?.type !== "patch") baseline--;
    if (baseline > 0) this.records.splice(0, baseline);
    // Protect the service if a misconfigured source publishes at unbounded Hz.
    if (this.records.length > MAX_RECORDS) {
      let start = this.records.length - MAX_RECORDS;
      while (start < this.records.length && this.records[start].type !== "patch") start++;
      this.records.splice(0, start);
    }
  }

  range(now = Date.now()) {
    const first = this.records.find((record) => record.type === "patch");
    return { earliestTime: Math.max(now - REWIND_WINDOW_MS, first?.time ?? now), latestTime: now };
  }

  historyAt(time, topic, before) {
    const end = upperBound(this.records, time);
    let frameIndex = end - 1;
    while (frameIndex >= 0 && this.records[frameIndex].type !== "patch") frameIndex--;
    const key = this.records[frameIndex]?.data.session?.session_key;
    if (key == null) return null;
    const known = new Map();
    for (let i = 0; i < end; i++) {
      const record = this.records[i];
      if (record.data?.session?.session_key !== key) continue;
      for (const item of record.data[topic === "radio" ? "radio" : "events"] ?? [])
        if (topic !== "radio" || item.status === "ready") known.set(item.id, item);
    }
    return { sessionKey: key, items: [...known.values()]
      .filter((item) => (!before || Date.parse(item.timestamp) < Date.parse(before)) && Date.parse(item.timestamp) <= time)
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, 100) };
  }

  snapshotAt(time) {
    const end = upperBound(this.records, time);
    let frameIndex = end - 1;
    while (frameIndex >= 0 && this.records[frameIndex].type !== "patch") frameIndex--;
    const frame = this.records[frameIndex];
    if (!frame) return null;
    const key = frame.data.session?.session_key;
    const groups = new Map();
    const add = (sample) => {
      if (!Number.isFinite(Date.parse(sample.timestamp)) || Date.parse(sample.timestamp) > time) return;
      const id = `${sample.type}:${sample.driverNumber}`;
      if (!groups.has(id)) groups.set(id, new Map());
      groups.get(id).set(sample.timestamp, sample);
    };
    for (const [field, type] of [["locations", "location"], ["telemetry", "telemetry"]])
      for (const [driver, sample] of Object.entries(frame.data[field] ?? {}))
        add({ ...sample, type, driverNumber: Number(driver) });
    for (let i = Math.max(0, upperBound(this.records, time - SAMPLE_HISTORY_MS) - 1); i < end; i++) {
      const record = this.records[i];
      if (record.type === "samples" && record.sessionKey === key)
        for (const sample of record.samples) add(sample);
    }
    const data = { ...frame.data, locations: {}, telemetry: {} }, samples = [];
    for (const group of groups.values()) {
      const sorted = [...group.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
      const last = sorted.at(-1);
      const tail = last.type === "location" ? sorted.slice(-24)
        : sorted.filter((sample) => Date.parse(sample.timestamp) >= Date.parse(last.timestamp) - 60000).slice(-300);
      samples.push(...tail);
      data[last.type === "location" ? "locations" : "telemetry"][last.driverNumber] = last;
    }
    return { data, samples, seq: this.records[end - 1]?.seq ?? frame.seq };
  }

  after(sequence, time) {
    // Sequences never decrease, including across session changes.
    let low = 0, high = this.records.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.records[mid].seq <= sequence) low = mid + 1;
      else high = mid;
    }
    return this.records.slice(low, upperBound(this.records, time));
  }

  export(now = Date.now()) {
    this.prune(now);
    let first = true;
    return { version: 1, records: this.records.map(({ data, ...record }) => {
      if (record.type !== "patch") return record;
      const patch = first ? [{ path: [], value: data }] : record.patch;
      first = false;
      return { ...record, patch };
    }) };
  }

  restore(cache, now = Date.now()) {
    if (cache?.version !== 1 || !Array.isArray(cache.records) || cache.records.length > MAX_RECORDS)
      throw new Error("Invalid timeline cache");
    const restored = new LiveTimeline();
    let state = null, previous = -Infinity;
    for (const record of cache.records) {
      if (!Number.isFinite(record.time) || record.time < previous || record.time > now + 1000)
        throw new Error("Invalid timeline cache clock");
      previous = record.time;
      if (record.type === "patch") {
        state = applyTimelinePatch(state, record.patch);
        if (!state || typeof state !== "object") throw new Error("Invalid cached state");
        restored.captureState(state, record.time);
      } else if (record.type === "samples" && Array.isArray(record.samples))
        restored.captureSamples(record.samples, record.sessionKey, record.time);
      else throw new Error("Invalid timeline record");
    }
    restored.prune(now);
    if (!restored.records.length || now - restored.records.at(-1).time > RETENTION_MS) return false;
    this.records = restored.records;
    this.sequence = restored.sequence;
    this.state = restored.state;
    return true;
  }
}

export function parseTimelineView(params) {
  const pausedAt = Number(params.get("pausedAt"));
  const delayMs = Number(params.get("delayMs") ?? 0);
  if (!Number.isFinite(delayMs) || (params.has("pausedAt") && !Number.isFinite(pausedAt)))
    throw new Error("Invalid timeline view");
  return {
    mode: params.get("view") === "rewind" ? "rewind" : "live",
    delayMs: Math.max(0, Math.min(REWIND_WINDOW_MS, delayMs)),
    ...(params.has("pausedAt") ? { pausedAt } : {}),
  };
}

export class TimelineViewer {
  constructor(timeline, view = {}, now = Date.now()) {
    this.timeline = timeline;
    this.requestId = 0;
    this.setView(view, now);
  }

  setView(view, now = Date.now()) {
    const range = this.timeline.range(now);
    this.mode = view.mode === "rewind" ? "rewind" : "live";
    this.delayMs = this.mode === "live" ? 0 : Math.max(0, Math.min(REWIND_WINDOW_MS, Number(view.delayMs) || 0));
    this.paused = this.mode === "rewind" && Number.isFinite(view.pausedAt);
    const target = this.paused ? view.pausedAt : now - this.delayMs;
    this.expired = this.paused && target < range.earliestTime;
    this.cursorTime = Math.max(range.earliestTime, Math.min(now, target));
    if (!this.paused) this.delayMs = now - this.cursorTime;
  }

  presentation(now = Date.now()) {
    const range = this.timeline.range(now);
    if (!this.paused) this.cursorTime = Math.max(range.earliestTime, now - this.delayMs);
    if (this.paused && this.cursorTime < range.earliestTime) this.expired = true;
    return { ...range, cursorTime: this.cursorTime, mode: this.mode, delayMs: this.delayMs,
      paused: this.paused, expired: this.expired, requestId: this.requestId };
  }

  snapshot(now = Date.now()) {
    const presentation = this.presentation(now);
    const frame = this.timeline.snapshotAt(Math.max(presentation.earliestTime, presentation.cursorTime));
    this.sequence = frame?.seq ?? 0;
    return { type: "snapshot", data: frame?.data, samples: frame?.samples ?? [], reset: true,
      serverTime: now, presentation };
  }

  seek(view, requestId, now = Date.now()) {
    this.requestId = Number.isSafeInteger(requestId) ? requestId : this.requestId + 1;
    this.setView(view, now);
    return this.snapshot(now);
  }

  next(now = Date.now()) {
    const presentation = this.presentation(now);
    if (this.paused) return [];
    if (this.sequence < (this.timeline.records[0]?.seq ?? 0)) return [this.snapshot(now)];
    const records = this.timeline.after(this.sequence, presentation.cursorTime);
    this.sequence = records.at(-1)?.seq ?? this.sequence;
    return records.map((record) => ({
      type: record.type,
      ...(record.type === "patch" ? { patch: record.patch } : { samples: record.samples }),
      serverTime: now, presentation,
    }));
  }
}
