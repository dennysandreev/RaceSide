# Race Replay Algorithm

## Purpose

`Race replay` in RaceSide is a user-facing historical replay. V1 does not use live timing. It replays a completed race from OpenF1, normalizes it in the worker, stores it in Supabase, and serves the UI only from RaceSide data.

## Source Selection

1. For `/weekend` and calendar race pages, show a replay entry only when the displayed Grand Prix has completed. A ready replay record alone does not make an ongoing or upcoming Grand Prix eligible.
2. Do not show previous-season reference replays on upcoming or ongoing Grand Prix pages.
3. For completed RaceSide races, use the main race session from the same season and round context whenever OpenF1 has data.
4. Use the OpenF1 main race session for that circuit and source season.
4. Store the prepared link in `race_replay_sessions`.

For already completed 2026 Grands Prix, `race_replay.prepare_completed` prepares 2026 OpenF1 race data. Older 2025 reference replays can stay in the database, but the UI should prefer the latest ready replay for the race. The frontend must never call OpenF1 directly.

## Worker Data Fetch

The prepare job loads and caches:

- car locations;
- position and interval snapshots;
- laps and sector times;
- pit lane / pit stop records;
- stints and tyre compounds;
- race control messages;
- weather snapshots.

The normalized output is saved as replay events and a compact session snapshot.

After a main race finishes, LIVE queues archive recovery after 2 minutes, 15
minutes and 1 hour. An enabled `race_replay.prepare_completed` schedule also
checks once per day as a fallback, including after worker restarts. Ready
replays are skipped before any external fetch or preparation. Only a ready main
race from the same season satisfies recovery; a sprint does not. Preparation
waits until the source session has ended, rejects missing locations/laps, and
retries failures. Duration includes the final lap timing even if coordinates
end earlier. Availability still depends on the source and running workers.

## Track Construction

1. Build a technical centerline from OpenF1 location points.
2. Remove extreme outliers and stale points.
3. Normalize coordinates into a stable SVG viewBox.
4. Generate an SVG path from the centerline.
5. Store bounds, transform metadata, sectors, and pit lane geometry with the map.

The centerline is always treated as a closed loop. Smoothing wraps from the last
sample back to the first, and total distance includes that closing segment. This
prevents an artificial sharp corner and zero-length progress span at start/finish.

The UI renders the track from the cached map definition. Sectors are visual only; replay positions still come from normalized timing/location events.

## Snapping And Interpolation

1. Each car event is snapped to the closest valid point on the centerline or pit lane.
2. Between telemetry samples, the player interpolates by replay time.
3. Around the start / finish line, interpolation must prefer lap continuity so a car does not jump backward between the end of one lap and the beginning of the next.
4. Stale or missing telemetry is not drawn as an active car. Retired cars move into the `OUT` list instead of staying on the track.

The replay uses the shared LIVE terminal with playback controls below the
workspace. Its monotonic clock starts at 1× and is sampled on every animation
frame by both 2D and 3D renderers, without the LIVE network jitter buffer.
Lap-based motion follows the circuit, including long timed laps; pit entry and
exit anchor the trajectory. The 3D model aligns those anchors to its own pit
geometry. Seeking restores only events and timing available at that moment.

Legacy snapshots without dedicated lap timings attach the **current** lap's
number and archived duration to location samples from that lap's start. Do not
subtract that duration from the first sample: that puts the map a lap ahead of
the timing tower. Recover a shared start from the first `SESSION STARTED` event
(or the earliest first-lap sample), then accumulate each driver's lap durations.
Preserve missing lap numbers and re-anchor after an unknown duration to the next
observed lap, so missing telemetry cannot shift the remaining race. Dedicated
lap timings remain authoritative. The Miami 2026 fixture covers this clock,
classification changes, the final position, and backward seeking.

## Pit Lane

Pit lane windows are built per driver:

- `startMs`: first detected pit lane entry;
- `endMs`: pit lane exit, preferably from reported pit lane duration;
- `pitLaneSeconds`: full time from pit entry to exit;
- `pitStopSeconds`: stationary stop duration when available.

Pit-lane geometry must be checked against the official FIA circuit map before a
replay is published. OpenF1 location streams can contain interleaved or displaced
coordinates around the garages, so a verified circuit override takes precedence
over telemetry. The reference records its FIA source, entry and exit. The 14
completed 2026 circuits use surveyed/digital-twin pit paths from
`src/data/replay-pit-layouts.json`, registered against the complete replay contour
(scale, rotation, reflection and cyclic origin), not a generic parallel offset.
Both archived snapshots on read and newly prepared worker snapshots use this
geometry. The malformed Monaco 2026 contour is restored from the reviewed model
before registration; already valid contours remain unchanged. See
`docs/replay-pit-lanes.md` for sources and validation.

UI rule:

- while the driver is in pit lane, show only the live pit lane timer;
- after exit, keep the card for 15 replay seconds and show `pit lane (pit stop)`;
- pit cards are sorted by entry time so their positions do not jump when another driver pits.

## Race Status And Flags

Race control messages are normalized into timed statuses:

- green;
- yellow / double yellow;
- safety car;
- virtual safety car;
- red flag;
- chequered flag.

Status windows must end when race control announces green, restart, safety car in, VSC ending, red flag cleared, or the race finishes. If the chequered flag overlaps a neutralized status, show a combined status such as `Финиш · Пейс-кар`.

## Timing Order

Timing rows are sorted by race order:

1. drivers on the highest current lap first;
2. then by classified position or interval order;
3. retired / out drivers after active runners.

Lapped cars receive a visible `+1 круг` style marker and must not float above cars that are physically a lap ahead.

## Tyre Pace And Lap Analytics

The map overlay shows:

- best lap of the replay so far;
- best last lap among current runners;
- average last-lap pace by tyre compound.

Zero, empty, stale, pit-affected, and OUT laps are ignored. Pit-affected laps are detected by checking whether the last-lap time window intersects a driver pit window.

## Preparing Future Replays

To prepare replay for completed 2026 races:

1. ensure calendar, sessions, results, and circuit mapping are synced;
2. run `race_replay.prepare_completed` for the season, or pass `--season` / `--round` for a single race;
3. verify that a `race_replay_sessions` row exists;
4. verify that the track map has centerline, sectors, bounds, and pit lane;
5. open `/race-replay/[sessionKey]` and check track continuity, timing order, pit windows, flags, and OUT handling.

The replay is considered ready only when the map renders, cars move without start-line jumps, timing rows are ordered correctly, and no retired car remains parked on the active racing line.

`race_replay.prepare_current` stays focused on the `/weekend` race and uses the previous season when the upcoming race has not happened yet. `race_replay.prepare_completed` uses the same builder for every completed race in the target season, skips already ready same-season sessions unless `--force` is passed, and writes the same snapshot format used by the Silverstone replay.
