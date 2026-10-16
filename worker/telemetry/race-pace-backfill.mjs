import { resultKey } from "./service.mjs";

export function completedSeasonRaces(season, sessions, now = Date.now()) {
  return [
    ...new Map(
      sessions
        .filter(
          (session) =>
            session.year === season &&
            session.session_name === "Race" &&
            !session.is_cancelled &&
            Number.isInteger(session.session_key) &&
            session.session_key > 0 &&
            Number.isInteger(session.meeting_key) &&
            session.meeting_key > 0 &&
            Number.isFinite(Date.parse(session.date_end)) &&
            Date.parse(session.date_end) + 31 * 60000 < now,
        )
        .map((session) => [session.session_key, session]),
    ).values(),
  ].sort((a, b) => Date.parse(a.date_end) - Date.parse(b.date_end));
}

// Reuse the normal versioned cache; rerunning never creates per-user copies.
export async function backfillRacePace({
  season,
  sessions,
  service,
  onProgress = () => {},
}) {
  const races = completedSeasonRaces(season, sessions);
  const report = { season, races: [], errors: [] };
  for (const race of races) {
    try {
      const task = { kind: "race-pace", session: race.session_key };
      const existing = await service.store.get(resultKey(task));
      const data = existing ?? (await service.prepare(task));
      if (!data.drivers.length || !data.points.some((point) => point.time > 0))
        throw new Error("RACE_PACE_UNAVAILABLE");
      await service.prepare({ kind: "catalog", session: race.session_key });
      const entry = {
        session: race.session_key,
        meeting: race.meeting_key,
        circuit: race.circuit_short_name,
        cached: Boolean(existing),
        drivers: data.drivers.length,
        laps: data.points.length,
        bytes: Buffer.byteLength(JSON.stringify(data)),
        warnings: data.warnings,
      };
      report.races.push(entry);
      await onProgress(entry);
    } catch (error) {
      const entry = { session: race.session_key, error: error.message };
      report.errors.push(entry);
      await onProgress(entry);
    }
  }
  return report;
}
