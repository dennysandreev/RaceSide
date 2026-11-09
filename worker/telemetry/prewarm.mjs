import { resultKey, DISCOVERY_TTL_MS } from "./service.mjs";
import { OpenF1Provider, mapSession } from "./provider.mjs";
import { completedSeasonRaces } from "./race-pace-backfill.mjs";

// Result polling already knows the latest weekend's local sessions. Queue pace
// independently of classification completeness, without another OpenF1 call.
export function localRacePaceTasks(sessions, now = Date.now()) {
  return [...new Set(sessions.filter((session) =>
    String(session.session_type).toLowerCase() === "race" &&
    !["cancelled", "canceled"].includes(session.status) &&
    Number.isInteger(Number(session.openf1_session_key)) && Number(session.openf1_session_key) > 0 &&
    Number.isFinite(Date.parse(session.end_at)) && Date.parse(session.end_at) + 31 * 60_000 < now,
  ).map((session) => Number(session.openf1_session_key)))].map((session) => ({ kind: "race-pace", session }));
}

export function recentTelemetryTasks(season, sessions, now = Date.now()) {
  const finished = sessions
    .filter((session) =>
      !session.is_cancelled &&
      Number.isInteger(Number(session.meeting_key)) && Number(session.meeting_key) > 0 &&
      Number.isInteger(Number(session.session_key)) && Number(session.session_key) > 0 &&
      Number.isFinite(Date.parse(session.date_end)) &&
      Date.parse(session.date_end) + 31 * 60_000 < now,
    )
    .sort((a, b) => Date.parse(b.date_end) - Date.parse(a.date_end));
  const meetingIds = [...new Set(finished.map((session) => Number(session.meeting_key)))].slice(0, 3);
  const tasks = [{ kind: "seasons" }, { kind: "meetings", season }];

  for (const meeting of meetingIds) {
    tasks.push({ kind: "sessions", meeting });
    const meetingSessions = finished.filter((session) => Number(session.meeting_key) === meeting);
    const selected = meeting === meetingIds[0] ? [...meetingSessions] : [];
    const qualifying = meetingSessions.find((session) => session.session_type === "Qualifying");
    if (qualifying && !selected.includes(qualifying)) selected.push(qualifying);
    for (const session of selected) {
      tasks.push({ kind: "catalog", session: Number(session.session_key) });
    }
  }
  for (const race of completedSeasonRaces(season, sessions, now)) {
    tasks.push({ kind: "race-pace", session: race.session_key });
  }
  return tasks;
}

export async function refreshRecentTelemetry({ store, fetchRows, season, now = Date.now() }) {
  const sessions = await fetchRows("sessions", { year: season });
  if (!Array.isArray(sessions)) throw new Error("PROVIDER_UNAVAILABLE");
  const recent = sessions.filter((session) => session.year === season &&
    !session.is_cancelled && Date.parse(session.date_end) > now - 48 * 3600000 &&
    Date.parse(session.date_end) + 31 * 60_000 < now);
  if (!recent.length) return { itemsProcessed: 0, metadata: { season, skipped: "no_recent_completed_sessions" } };
  // These lists come from fresh source reads, not from a cache about to expire
  // just after the five-minute scheduler tick.
  const meetings = await new OpenF1Provider({ fetchRows }).getMeetings(season);
  await store.put(resultKey({ kind: "meetings", season }), meetings, DISCOVERY_TTL_MS);
  for (const meeting of new Set(recent.map((session) => session.meeting_key))) {
    const completed = sessions.filter((session) => session.meeting_key === meeting &&
      !session.is_cancelled && Date.parse(session.date_end) + 31 * 60_000 < now);
    await store.put(resultKey({ kind: "sessions", meeting }), completed.map(mapSession), DISCOVERY_TTL_MS);
  }
  const queued = await enqueueMissingTelemetryTasks(store, recentTelemetryTasks(season, recent, now));
  return { itemsProcessed: queued, metadata: { season, sessions: recent.length, queued } };
}

export async function enqueueMissingTelemetryTasks(store, tasks) {
  let queued = 0;
  // The report's compact timing has its own readiness/retries. A cached pace
  // result or a Replay that still needs map data must not suppress this job.
  const reportTasks = tasks.flatMap((task) => task.kind === "race-pace"
    ? [task, { kind: "report-timing", session: task.session }] : [task]);
  for (const task of new Map(reportTasks.map((task) => [resultKey(task), task])).values()) {
    if (await store.get(resultKey(task))) continue;
    await store.enqueue(task, resultKey(task));
    queued += 1;
  }
  return queued;
}
