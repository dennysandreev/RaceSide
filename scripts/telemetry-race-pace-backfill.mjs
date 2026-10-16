import { setTimeout as sleep } from "node:timers/promises";
import { OpenF1Provider, mapSession } from "../worker/telemetry/provider.mjs";
import { TelemetryService, resultKey } from "../worker/telemetry/service.mjs";
import {
  createTelemetryDb,
  TelemetryStore,
} from "../worker/telemetry/store.mjs";
import {
  backfillRacePace,
  completedSeasonRaces,
} from "../worker/telemetry/race-pace-backfill.mjs";

const season = Number(process.argv[2] ?? new Date().getUTCFullYear());
if (
  !Number.isInteger(season) ||
  season < 2023 ||
  season > new Date().getUTCFullYear()
)
  throw new Error("Use an OpenF1 season from 2023 to the current year");
const db = createTelemetryDb();
let queue = Promise.resolve(),
  lastRequest = 0;
const fetchRows = async (topic, query) => {
  if (["car_data", "location"].includes(topic))
    throw new Error("High-frequency data is outside this backfill");
  const operation = queue.then(async () => {
    const url = new URL(
      `${process.env.OPENF1_BASE_URL ?? "https://api.openf1.org/v1"}/${topic}`,
    );
    for (const [key, value] of Object.entries(query))
      url.searchParams.set(key, String(value));
    for (let attempt = 0; attempt < 4; attempt++) {
      await sleep(Math.max(0, lastRequest + 2200 - Date.now()));
      lastRequest = Date.now();
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(45000),
        });
        if (response.status === 429 || response.status >= 500)
          throw new Error(`OpenF1 ${topic} HTTP ${response.status}`);
        if (response.status === 404) return [];
        if (!response.ok)
          throw new Error(`OpenF1 ${topic} HTTP ${response.status}`);
        const rows = await response.json();
        if (!Array.isArray(rows))
          throw new Error(`Invalid OpenF1 ${topic} response`);
        return rows;
      } catch (error) {
        if (attempt === 3) throw error;
        await sleep(5000 * (attempt + 1));
      }
    }
  });
  queue = operation.catch(() => {});
  return operation;
};
const store = new TelemetryStore(db);
const provider = new OpenF1Provider({ fetchRows });
const service = new TelemetryService({ store, provider });
const sessions = await fetchRows("sessions", { year: season });
const races = completedSeasonRaces(season, sessions);
console.log(
  JSON.stringify({
    season,
    completed: races.length,
    skipped:
      sessions.filter((s) => s.session_name === "Race").length - races.length,
  }),
);
// Refresh the navigation metadata as well as the compact race datasets.
const meetings = await provider.getMeetings(season);
await store.put(`meetings:${season}`, meetings, 86400000);
await store.put(resultKey({ kind: "meetings", season }), meetings, 3600000);
for (const race of races) {
  const list = sessions.filter(
    (s) =>
      s.meeting_key === race.meeting_key &&
      !s.is_cancelled &&
      Date.parse(s.date_end) + 31 * 60000 < Date.now(),
  );
  const mapped = list.map(mapSession);
  await store.put(`sessions:${race.meeting_key}`, mapped, 3600000);
  await store.put(
    resultKey({ kind: "sessions", meeting: race.meeting_key }),
    mapped,
    3600000,
  );
}
const report = await backfillRacePace({
  season,
  sessions,
  service,
  onProgress: (entry) => console.log(JSON.stringify(entry)),
});
console.log(
  JSON.stringify({
    season,
    saved: report.races.length,
    failed: report.errors.length,
    jsonBytes: report.races.reduce((total, race) => total + race.bytes, 0),
  }),
);
if (report.errors.length) process.exitCode = 1;
