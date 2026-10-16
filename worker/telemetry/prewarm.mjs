import { resultKey } from "./service.mjs";
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
    const selected = meetingSessions.slice(0, meeting === meetingIds[0] ? 2 : 0);
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
