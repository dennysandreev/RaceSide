# Replay clock audit — 2026-09-22

## Corrected cause

Legacy archives store the current lap's number and duration from its start.
The fallback subtracted that duration from the first location timestamp, putting
cars approximately one lap ahead of the classification feed. Each driver also
had a different origin because location samples arrive asynchronously.

The fallback now uses one race start, preserves source lap numbers, and resumes
at the next observed lap after missing duration/lap data. Official lap timings
still take precedence. No database contents or finishing positions were edited.

The compact Miami 2026 fixture comes from cached session 11280. It retains the
first sample of each lap for drivers 12, 16 and 81 and classification samples at
selected race times. Tests verify the first line crossing, current lap, late-race
map order, Leclerc's archived final P6 and backward seeking. Sprint 11275 has P3
for Leclerc; these are separate sessions.

## Validation

- 43 replay/LIVE library tests passed.
- ESLint, TypeScript and production build passed.
- Browser: Miami at 30 minutes, final P6, then rewind to P1 at 10 minutes.
- `node --experimental-strip-types scripts/check-race-replays.mjs --all-versions`
  sampled every driver's movement every 250 ms in all 27 ready archive versions
  associated with the 2026 calendar, including 2025 source versions. Available
  3D models were sampled as well.

## Remaining, independently reproduced failures

The movement audit is **not fully green**: 25 archives passed; sessions 11353
(Netherlands 2026) and 11361 (Italy 2026) retain discontinuities at red-flag
transitions and pit re-entry during suspension. Their red-flag branch switches
from timed motion to raw location progress. The affected coordinates were also
reproduced using the unmodified HEAD adapter/motion modules; this clock change
does not cause or fix those discontinuities.

Lap-based interpolation remains an approximation between timing checkpoints;
this audit does not certify exact mid-corner positions or overtake timestamps.
Detailed movement results are generated locally at
`output/replay-audit/report.json` (not committed).
