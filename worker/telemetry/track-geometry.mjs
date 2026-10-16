import tracks from "./tracks.json" with { type: "json" };
import { cornerMetrics } from "./core.mjs";

const normalizeName = (name) =>
  String(name)
    .normalize("NFKD")
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export function verifiedTrack(name, season, id = "") {
  const circuit = normalizeName(name);
  return tracks.find((track) => {
    if (!track.seasons.includes(season)) return false;
    if (id === track.id) return true;
    const names = [track.name, track.id, ...track.aliases];
    return names.some((candidate) => normalizeName(candidate) === circuit);
  });
}

// The relocated event can retain its old meeting name in OpenF1. Resolve the
// venue first so a genuine Bahrain event is never renamed by name alone.
export function normalizeTelemetryMeeting(meeting) {
  const circuit = normalizeName(meeting.circuit);
  const country = normalizeName(meeting.country);
  const isMalaysia = ["kuala lumpur", "sepang", "sepang international circuit"].includes(circuit) || country === "malaysia";
  return isMalaysia && /bahrain|malays/i.test(meeting.name)
    ? { ...meeting, name: "Malaysian Grand Prix" }
    : meeting;
}

export function orientEstimatedTrack(track) {
  if (
    !track.estimated ||
    !track.source?.startsWith("OpenF1") ||
    track.version.endsWith(":svg-y")
  ) return track;
  return {
    ...track,
    version: `${track.version}:svg-y`,
    points: track.points.map((point) => ({ ...point, y: -point.y })),
  };
}

// Keep cached telemetry measurements on their original distance scale while
// replacing only the map plane with the verified circuit model.
export function orientComparison(comparison) {
  const { track } = comparison;
  const season = comparison.traces[0]?.session.season;
  const venue = comparison.traces[0]?.session.circuit;
  const model = verifiedTrack(venue, season) ?? verifiedTrack(track.name, season, track.id);
  if (!model) {
    const corrected = orientEstimatedTrack(track);
    return corrected === track ? comparison : { ...comparison, track: corrected };
  }
  const ratio = track.length / model.length;
  const corners = model.corners.map((corner) => ({
    ...corner, start: corner.start * ratio, apex: corner.apex * ratio, end: corner.end * ratio,
  }));
  const cornersChanged = JSON.stringify(track.corners) !== JSON.stringify(corners);
  const needsCornerMetrics = (trace) => trace.points?.length > 1 &&
    (cornersChanged || trace.corners?.length !== corners.length);
  if (track.version === model.version && track.id === model.id && track.name === model.name &&
    !comparison.traces.some(needsCornerMetrics)) return comparison;
  return {
    ...comparison,
    // Corner details must follow the corrected venue, including old cached laps.
    traces: comparison.traces.some(needsCornerMetrics)
      ? comparison.traces.map((trace) => needsCornerMetrics(trace)
        ? { ...trace, corners: corners.map((corner) => cornerMetrics(trace.points, corner)) }
        : trace)
      : comparison.traces,
    track: {
      ...track,
      id: model.id,
      name: model.name,
      version: model.version,
      source: model.source,
      estimated: model.estimated,
      points: model.points.map((point) => ({
        ...point,
        distance: point.distance * ratio,
      })),
      sectors: model.sectors.map((distance) => distance * ratio),
      corners,
    },
  };
}
