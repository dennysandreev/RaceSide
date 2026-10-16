import { readFile } from "node:fs/promises";
import registry from "./tracks/2026.json" with { type: "json" };

const loadedTracks = new Map();
const normalize = (value) => String(value ?? "").normalize("NFKD")
  .replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function bundledTrackEntry(session) {
  const season = Number(session.year ?? session.date_start?.slice(0, 4));
  const tracks = registry.filter((track) => track.season === season);
  const key = Number(session.circuit_key);
  const keyed = tracks.find((track) => track.circuitKey === key);
  if (keyed) return keyed;
  // A known OpenF1 key identifies the venue even when the meeting has moved.
  // Do not reinterpret Bahrain/Sakhir as Sepang through the meeting name.
  if (Number.isFinite(key) && key > 0) return null;
  const names = [session.circuit_short_name, session.location, session.circuit_key].map(normalize).filter(Boolean);
  return tracks.find((track) => track.aliases.some((alias) => names.includes(normalize(alias)))) ?? null;
}

export async function bundledSessionTrack(session) {
  const entry = bundledTrackEntry(session);
  if (!entry) return null;
  if (!loadedTracks.has(entry.id)) {
    loadedTracks.set(entry.id, JSON.parse(await readFile(
      new URL(`./tracks/${entry.id}-${entry.season}.json`, import.meta.url), "utf8",
    )));
  }
  // Hydration adds session-specific metadata; never mutate the cached contour.
  return structuredClone(loadedTracks.get(entry.id));
}

export async function resolveSessionTrack(session, maps = [], circuitId = null) {
  const entry = bundledTrackEntry(session);
  const bundled = await bundledSessionTrack(session);
  if (entry?.preferBundled) return bundled;
  const season = Number(session.year ?? session.date_start?.slice(0, 4));
  const candidates = maps.filter((map) => map.season_source <= season && map.definition?.centerline?.length >= 8);
  const matches = (map) => (circuitId && map.circuit_id === circuitId) ||
    String(map.circuit_key) === String(session.circuit_key) ||
    entry?.aliases.some((alias) => normalize(alias) === normalize(map.circuit_key));
  const current = candidates.find((map) => map.season_source === season && matches(map));
  return current?.definition ?? bundled ?? candidates.find(matches)?.definition ?? null;
}
