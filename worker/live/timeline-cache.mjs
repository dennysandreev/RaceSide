import { mkdir, readFile, writeFile, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
const compress = promisify(gzip), decompress = promisify(gunzip);

export async function readTimelineCache(timeline, directory, now = Date.now()) {
  const file = join(directory, "timeline", "window.json.gz");
  try {
    if ((await stat(file)).size > 16 * 1024 * 1024) return false;
    const data = await decompress(await readFile(file), { maxOutputLength: 64 * 1024 * 1024 });
    return timeline.restore(JSON.parse(data.toString()), now);
  } catch {
    // A missing, old or interrupted cache must never prevent live ingestion.
    return false;
  }
}

export async function writeTimelineCache(timeline, directory, now = Date.now()) {
  const folder = join(directory, "timeline");
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const data = await compress(JSON.stringify(timeline.export(now)));
  const file = join(folder, "window.json.gz");
  await writeFile(`${file}.tmp`, data, { mode: 0o600 });
  await rename(`${file}.tmp`, file);
}
