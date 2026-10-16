import { readFile, writeFile } from "node:fs/promises";
import { TRACK_MODEL_ALIASES } from "../src/data/track-models.ts";

// Reuse the same horizontal plane as track-model-renderer. worldZ is elevation.
const registryUrl = new URL("../worker/telemetry/tracks.json", import.meta.url);
const tracks = JSON.parse(await readFile(registryUrl, "utf8"));
for (const id of Object.keys(TRACK_MODEL_ALIASES)) {
  if (tracks.some((track) => track.id === id)) continue;
  const source = `src/data/${id}-model.ts`;
  const exports = await import(new URL(`../${source}`, import.meta.url));
  const model = Object.values(exports).find(
    (value) => value.points && value.lapLengthKm,
  );
  if (!model) throw new Error(`Track model missing: ${id}`);
  const length = Math.round(model.lapLengthKm * 1000);
  const apexes = model.turns.map((turn) => turn.progress * length);
  tracks.push({
    id,
    seasons: [2026],
    name: model.circuitName,
    length,
    sectors: model.sectorBreaks.map((progress) => progress * length),
    corners: model.turns.map((turn, index) => ({
      number: turn.number,
      start: index === 0 ? 0 : (apexes[index - 1] + apexes[index]) / 2,
      apex: apexes[index],
      end: index === apexes.length - 1 ? length : (apexes[index] + apexes[index + 1]) / 2,
    })),
    source: `RaceSide track model: ${source}`,
    estimated: true,
  });
}
for (const track of tracks) {
  const source = track.source.split(": ")[1];
  const exports = await import(new URL(`../${source}`, import.meta.url));
  const model = Object.values(exports).find(
    (value) => value.points && value.lapLengthKm,
  );
  if (!model) throw new Error(`Track model missing: ${track.id}`);
  track.points = model.points.map(([progress, worldX, worldY]) => ({
    distance: progress * track.length,
    x: worldX,
    y: -worldY, // SVG's vertical axis runs south, worldY runs north.
  }));
  track.aliases = [...TRACK_MODEL_ALIASES[track.id]];
  track.version = "raceside-2026-09-12-planar-v2";
}
await writeFile(registryUrl, JSON.stringify(tracks));
console.info(`Updated planar geometry for ${tracks.length} circuits.`);
