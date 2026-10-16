import "../worker/load-env.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { LiveReplayAdapter } from "../src/features/live/lib/replay.ts";
import { withVerifiedReplayPitLane } from "../src/lib/replay-pit-lane.mjs";
import { alignPitTrackProgress, connectModelPitLane } from "../src/features/race-replay/lib/pit-path.ts";

async function loadModel(name) {
  const names = [
    [/madr|ifema/i, "madring", "MADRING"], [/catal|barcel/i, "catalunya", "CATALUNYA"],
    [/hungar/i, "hungaroring", "HUNGARORING"], [/gilles|montreal/i, "montreal", "MONTREAL"],
    [/red bull/i, "red-bull-ring", "RED_BULL_RING"], [/silverstone/i, "silverstone", "SILVERSTONE"],
    [/spa/i, "spa", "SPA"], [/zandvoort/i, "zandvoort", "ZANDVOORT"],
  ];
  const match = names.find(([pattern]) => pattern.test(name));
  if (!match) return null;
  const [, id, prefix] = match;
  const modelData = await import(`../src/data/${id}-model.ts`);
  const path = id === "madring"
    ? JSON.parse(await readFile("src/data/madring-live-path.json", "utf8"))
    : modelData[`${prefix}_REPLAY_PATH`];
  const track = path.trackPoints ?? modelData[`${prefix}_MODEL`].points;
  const pit = connectModelPitLane(track, path.pitLanePoints);
  const length = track.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[1] - track[i][1], p[2] - track[i][2]), 0);
  return {id, track, pit, length};
}

function modelPoint(model, location) {
  const inPit = location.pitLaneProgress != null;
  const points = inPit ? model.pit.points : model.track;
  const progress = inPit ? location.pitLaneProgress : alignPitTrackProgress(location.progress, location.pitTrackProgress, model.pit.anchors);
  let low = 0, high = points.length - 1;
  while (low < high - 1) {
    const mid = (low + high) >> 1;
    if (points[mid][0] <= progress) low = mid; else high = mid;
  }
  const a = points[low], b = points[high];
  const ratio = Math.max(0, Math.min(1, (progress - a[0]) / Math.max(b[0] - a[0], 1e-9)));
  return {x: a[1] + (b[1] - a[1]) * ratio, y: a[2] + (b[2] - a[2]) * ratio};
}

const directory = "output/replay-audit";
await mkdir(directory, { recursive: true });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let sessionQuery = db.from("race_replay_sessions")
  .select("id,source_session_key,source_season,status,duration_ms,total_laps,source_session_name,races!inner(round,race_name,season_year)")
  .eq("races.season_year", 2026).eq("status", "ready");
if (!process.argv.includes("--all-versions")) sessionQuery = sessionQuery.eq("source_season", 2026);
const { data: sessions, error } = await sessionQuery;
if (error) throw error;
const reports = [];
for (const session of sessions.sort((a, b) => a.races.round - b.races.round)) {
  const path = `${directory}/${session.source_session_key}.json`;
  let replay;
  try {
    if (process.argv.includes("--refresh") || process.argv.includes(`--refresh=${session.source_session_key}`)) throw new Error("refresh");
    replay = JSON.parse(await readFile(path, "utf8"));
  } catch {
    const { data, error } = await db.from("race_replay_sessions").select("snapshot").eq("id", session.id).single();
    if (error) throw error;
    replay = { ...data.snapshot, replaySessionId: session.id, sourceSessionKey: session.source_session_key };
    const fields = { position: "positions", lap_timing: "lapTimings", position_timing: "positionTimings", interval_timing: "intervalTimings" };
    const stored = Object.fromEntries(Object.values(fields).map((field) => [field, []]));
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db.from("race_replay_events").select("event_type,payload")
        .eq("replay_session_id", session.id).in("event_type", Object.keys(fields))
        .order("offset_ms").order("id").range(offset, offset + 999);
      if (error) throw error;
      for (const item of data) stored[fields[item.event_type]].push(item.payload);
      if (data.length < 1000) break;
    }
    for (const [field, rows] of Object.entries(stored)) if (rows.length) replay[field] = rows;
    await writeFile(path, JSON.stringify(replay));
  }
  // The database stores lap timings as compact tuples, the page expands them.
  replay.lapTimings = (replay.lapTimings ?? []).map((lap) => Array.isArray(lap) ? {
    driverNumber: lap[0], lapNumber: lap[1], startOffsetMs: lap[2], durationMs: lap[3] > 0 ? lap[3] : null,
  } : lap);
  replay.track = withVerifiedReplayPitLane(replay.track);
  const adapter = new LiveReplayAdapter(replay);
  const model = await loadModel(replay.circuitName);
  const points = replay.track.centerline;
  const length = points.reduce((sum, p, i) => {
    const next = points[(i + 1) % points.length];
    return sum + Math.hypot(next.svgX - p.svgX, next.svgY - p.svgY);
  }, 0);
  const issues = [];
  let largestStep = 0;
  let largest3dStep = 0;
  for (const driver of replay.drivers) {
    let previous = null;
    for (let elapsed = adapter.playbackStartMs; elapsed <= adapter.durationMs; elapsed += 250) {
      const current = adapter.sampleLocation(driver.driverNumber, elapsed);
      if (current && previous) {
        const step = Math.hypot(current.x - previous.x, current.y - previous.y) / length;
        largestStep = Math.max(largestStep, step);
        if (!Number.isFinite(step) || step > 0.025) {
          if (issues.length < 12) issues.push({driver: driver.driverNumber, elapsed, step: +step.toFixed(4), pit: [previous.pitLaneProgress, current.pitLaneProgress]});
        }
        if (model && current.pitTrackProgress) {
          const a = modelPoint(model, previous), b = modelPoint(model, current);
          const step3d = Math.hypot(b.x - a.x, b.y - a.y) / model.length;
          largest3dStep = Math.max(largest3dStep, step3d);
          if ((!Number.isFinite(step3d) || step3d > 0.025) && issues.length < 12) {
            issues.push({driver: driver.driverNumber, elapsed, step3d: +step3d.toFixed(4)});
          }
        }
      }
      previous = current;
    }
  }
  const report = {key: session.source_session_key, race: session.races.race_name,
    session: session.source_session_name, positions: replay.positions.length, laps: replay.lapTimings?.length ?? 0,
    duration: Math.round(replay.durationMs / 60000), drivers: replay.drivers.length,
    largestStep: +largestStep.toFixed(4), model: model?.id ?? null, largest3dStep: model ? +largest3dStep.toFixed(4) : null, issues};
  reports.push(report);
  console.log(JSON.stringify(report));
}
await writeFile(`${directory}/report.json`, JSON.stringify(reports, null, 2));
if (reports.some((report) => report.issues.length)) process.exitCode = 1;
