export const REPORT_TIMING_VERSION = "report-timing-1";

// OpenF1 timestamps are UTC, including feeds that omit an explicit offset.
function timestamp(value) {
  if (typeof value !== "string" || !value.trim()) return NaN;
  const text = value.trim();
  return Date.parse(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text}Z`);
}

function number(value) {
  if ((typeof value !== "number" && typeof value !== "string") ||
      (typeof value === "string" && !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function history(rows, start) {
  const drivers = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const driver = number(row?.driver_number), at = timestamp(row?.date) - start;
    if (!Number.isSafeInteger(driver) || driver <= 0 || !Number.isFinite(at)) continue;
    if (!drivers.has(driver)) drivers.set(driver, []);
    drivers.get(driver).push({ ...row, at });
  }
  for (const rows of drivers.values()) rows.sort((a, b) => a.at - b.at);
  return drivers;
}

function sample(rows = [], end, maxAge = Infinity) {
  let low = 0, high = rows.length - 1, found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (rows[mid].at <= end) { found = mid; low = mid + 1; }
    else high = mid - 1;
  }
  return found >= 0 && end - rows[found].at <= maxAge ? rows[found] : null;
}

export function buildReportTiming(catalog, positions, intervals) {
  if (String(catalog?.session?.name).toLowerCase() !== "race") throw new Error("REPORT_TIMING_ONLY");
  const start = timestamp(catalog.session.start);
  if (!Number.isFinite(start)) throw new Error("REPORT_TIMING_UNAVAILABLE");
  const positionHistory = history(positions, start), intervalHistory = history(intervals, start);
  const laps = new Map();
  for (const lap of catalog.laps ?? []) {
    const driver = number(lap?.driverNumber), lapNumber = number(lap?.number);
    const duration = number(lap?.time), offset = timestamp(lap?.start) - start;
    if (!Number.isSafeInteger(driver) || driver <= 0 || !Number.isSafeInteger(lapNumber) || lapNumber <= 0 ||
        duration === null || duration <= 0 || !Number.isFinite(offset) || offset < 0 ||
        (lap.sessionId !== undefined && lap.sessionId !== catalog.session.id)) continue;
    const end = offset + duration * 1000;
    const position = number(sample(positionHistory.get(driver), end)?.position);
    const gap = sample(intervalHistory.get(driver), end, 15_000)?.gap_to_leader;
    laps.set(`${driver}:${lapNumber}`, {
      driverNumber: driver, lapNumber, offsetMs: end,
      position: Number.isSafeInteger(position) && position > 0 ? position : null,
      gapToLeader: typeof gap === "string" && gap.trim() ? gap.trim()
        : typeof gap === "number" && Number.isFinite(gap) && gap >= 0 ? String(gap) : null,
    });
  }
  if (!laps.size) throw new Error("REPORT_TIMING_UNAVAILABLE");
  const lapSamples = [...laps.values()].sort((a, b) => a.driverNumber - b.driverNumber || a.lapNumber - b.lapNumber);
  const measuredDrivers = [...new Set(lapSamples.map((lap) => lap.driverNumber))];
  return {
    version: REPORT_TIMING_VERSION,
    session: catalog.session,
    complete: measuredDrivers.every((driver) =>
      lapSamples.some((lap) => lap.driverNumber === driver && lap.position !== null) &&
      lapSamples.some((lap) => lap.driverNumber === driver && lap.gapToLeader !== null)),
    lapSamples,
  };
}

export function reportTimingTtl(data, now = Date.now()) {
  if (!data.complete) return 60_000;
  const age = now - timestamp(data.session.end);
  if (!Number.isFinite(age)) return 60_000;
  // Recheck late publication and corrections during the same two-week window
  // as the report. The final compact dataset is then retained indefinitely.
  return age < 24 * 3600_000 ? 15 * 60_000 : age < 14 * 24 * 3600_000 ? 24 * 3600_000 : null;
}
