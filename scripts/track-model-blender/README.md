# Blender track builder

Miami: `pnpm track:3d:build miami --offline` rebuilds the pinned 2026 scene.
Set `PYTHON_BIN` to Python with NumPy, rasterio and Pillow. Geometry uses UTM
17N/NAVD88, USGS 1 m DTM and Miami-Dade county orthophoto. The validator decodes
the GLB and checks all driving corridors, paint support and bridge clearance.
Sources and limitations: `docs/track-model-miami-source-card.md`.

Baku: `pnpm track:3d:build baku --offline` rebuilds the pinned-source scene.
Set `PYTHON_BIN` to a Python runtime with rasterio, OpenCV, NumPy and Pillow.
The source card is `docs/track-model-baku-source-card.md`. Baku's urban road
profile is regularised from coarse GEDTM and explicitly approximate. The GLB
validator decodes Meshopt to check terrain/paint clearance and the pit exit.

This directory contains the reproducible real-scale builders for RaceSide Blender track assets.

Requirements:

- Blender 5.2 LTS available as `blender` (or set `BLENDER_BIN`);
- Node.js 22 or newer;
- Python 3 with Pillow.

Build and validate:

```bash
pnpm track:3d:build zandvoort
pnpm track:3d:validate zandvoort
pnpm track:3d:build spa
pnpm track:3d:validate spa
pnpm track:3d:build hungaroring
pnpm track:3d:validate hungaroring
pnpm track:3d:build silverstone
pnpm track:3d:validate silverstone
pnpm track:3d:build red-bull-ring
pnpm track:3d:validate red-bull-ring
pnpm track:3d:build catalunya
pnpm track:3d:validate catalunya
pnpm track:3d:build monaco
pnpm track:3d:validate monaco
pnpm track:3d:build montreal
pnpm track:3d:validate montreal
pnpm track:3d:build monza
pnpm track:3d:validate monza
pnpm track:3d:build madring
pnpm track:3d:validate madring
```

The build does not use the former hand-authored `src/data/zandvoort-model.ts` geometry. It performs this deterministic pipeline:

1. `download-zandvoort-data.mjs` fetches and SHA-256-pins OSM raceway geometry, AHN4 DTM/DSM, BGT objects, 3DBAG LoD2.2 buildings and the PDOK 2026 orthophoto.
2. `prepare-zandvoort-rasters.py` converts the height rasters and samples real roof colors from the orthophoto.
3. `export-track-data.mjs` adds the official FIA lap length, turn, sector, speed-trap, pit-lane and DRS control points plus the Dutch GP 2026 grandstand zones.
4. `build-zandvoort-digital-twin.py` creates the Blender scene at `1 unit = 1 metre` with no vertical exaggeration, keeps BGT ground classes in the measured 2026 orthophoto instead of duplicating them as synthetic overlays, renders the preview and exports a Meshopt-compressed GLB.
5. `write-zandvoort-client-model.mjs` regenerates lightweight UI/controller metadata from the same geodata.
6. `validate-track.mjs` checks checksums, FIA length tolerance, required anchors, scene completeness and web budgets.

The Hungaroring branch follows the same contract with dedicated scripts: it pins the current OSM circuit and ground-detail snapshot, FIA 2026 circuit/pit drawing, the current 2026 event map, the public Hungary 2022 orthophoto overview and open Terrarium elevation tiles; composes a crisp hybrid digital-twin ground layer in EPSG:32634; builds the 1:1 scene; regenerates `src/data/hungaroring-model.ts`; then validates hashes, anchors, geometry and web budgets.

The Silverstone branch pins the current OSM circuit and site objects, the FIA British GP 2026 circuit/pit drawing, the official Silverstone grandstand guide, Environment Agency LIDAR Composite DTM 1 m, first-return DSM 1 m and National LIDAR Programme intensity 1 m. It builds the site in EPSG:32630 + ODN at 1:1 scale with no vertical exaggeration, writes `src/data/silverstone-model.ts`, and validates source hashes, FIA anchors, scene completeness and delivery budgets.

The Red Bull Ring branch pins the current OSM circuit and venue objects, FIA Austrian GP 2026 Document 7, the official Formula1.com circuit map, the Land Steiermark 2024 orthophoto and official 1 m ALS DTM/DSM. It builds the site in EPSG:32633 with orthometric source heights at 1:1 scale, creates the FIA 32-box pit lane and current nine mapped grandstands, writes `src/data/red-bull-ring-model.ts`, and validates source hashes, FIA anchors, terrain clearance and web budgets.

The Catalunya branch patches the legacy OSM circuit ring with the current three-way T13-T14 bypass, pins the three connected pit-lane ways and venue objects, the FIA Barcelona 2026 circuit and pit-lane drawings, the official 2026 Circuit de Barcelona-Catalunya event map, the ICGC 2025 25 cm RGB orthophoto, the ICGC territorial DTM, and 2024 ICGC surface-height samples. It builds the site in EPSG:25831 at 1:1 scale with no vertical exaggeration, keeps the detailed 40-garage pit complex while excluding its duplicate grey OSM `Boxes` footprint, adds the 475 m pit-wall debris fence, regenerates `src/data/catalunya-model.ts`, and validates source hashes, the 4.657 km FIA lap, all 14 anchors, pit continuity, scene completeness and web budgets.

The Monaco branch uses pinned OSM relation 148194 (including building multipolygons), IGN LiDAR HD MNT/MNS in IGN69, correctly reprojected DPUM Orthophoto 2020 and FIA/ACM 2026 circuit, pit and grandstand plans. It builds at 1:1 scale in EPSG:32632, separates the 361.75 m tunnel from the 18 m Portier cover, preserves 11 three-storey garages and 19 stand sections, and audits the decoded Meshopt asset for road, paint and structural conflicts. Rebuild with `pnpm track:3d:build monaco`; validate with `pnpm track:3d:validate monaco`. The downloader verifies cached hashes and only refreshes with `--force-sources`. See `docs/track-model-monaco-source-card.md` and `docs/track-model-monaco-build-report.md` for the source age, geometry estimates, unverified 2026 motorhomes and DPUM redistribution limitation.

The Montreal branch pins the current OSM circuit and venue objects, FIA Canadian GP 2026 Document 8, the official 2026 promoter grandstand catalogue, the official 2024 spectator map used as the geolocation baseline, the CMM 2019 25 cm orthophoto and NRCan HRDEM DTM/DSM. It builds Circuit Gilles-Villeneuve in EPSG:32188 + CGVD2013 at 1:1 scale with no vertical exaggeration, creates the FIA 43-box pit lane, the 10 visually accepted current-event grandstand zones, the smooth pit entry/exit with a continuous exit guide line, and the concrete pit wall with its high debris fence and gate sections. It regenerates `src/data/montreal-model.ts` and validates source hashes, FIA anchors, reviewed placement corrections, terrain clearance, scene completeness and web budgets.

The Monza branch uses the pinned GP alignment and rebuilds the variable-width pit road, garage apron and wall from OSM and the FIA pit-lane drawing. The 720-sample client driving path comes from the delivered road, avoiding chicane shortcuts. Venue architecture uses pinned OSM footprints and official Monza 2026 map/hospitality references. It adds individual stepped grandstands, garage facades and galleries, the podium, towers, reconstructed banked oval, safety barriers and wooded-pixel vegetation. The PCN 2012 ground mosaic is 4096 px with simplified distant context. Heights, trees and temporary paddock layouts are reconstructions, not survey data; see `docs/track-model-monza-source-card.md`. The build regenerates the versioned client asset URLs and validates checksums, decoded road clearance, scene completeness and delivery budgets.

The historic oval has a flat north spectator approach and a distance-smoothed alignment computed in local metres: float32 global UTM vectors previously produced metre-scale zigzags in the edge normals. Its cross-section interpolates the archived 1954 drawing's stations, rising 6.20 m across a 12 m bank with a 5 m inner apron and 265 m transitions. The toe follows the terrain except at reconstructed bridge approaches. Open concrete frames replace solid triangular ribs. Bridge grades, transition placement and frame dimensions remain approximate. Concrete tags do not determine bank angle. Physical-distance UVs carry embedded weathered-concrete colour and normal textures. Pit and GP paint are clipped at their carriageway joins. The Monza corridor audit clips every structural triangle against the GP and pit surfaces, including wall edges and vertical faces; only the mapped north bridge, podium and start gantry may cross overhead. Run `node --experimental-strip-types --test scripts/track-model-blender/monza-venue.test.mjs` for decoded-edge smoothness, archived section dimensions, complete-lap/pit clearance, paint intersections, flat approaches, rib containment and material checks.

Raw sources and prepared rasters stay in `.track-model-build/`. Production assets are written to `public/f1/tracks/3d/`. Do not hand-edit generated GLBs, previews, metadata files or their generated client model modules.

Madring uses native EPSG:25830 municipal CAD, June 13 2026 LiDAR/orthophoto,
original municipal LoD2 roofs, IGN gap-fill heights, current OSM and the official
2026 F1/promoter maps. Its preparation needs Pillow, numpy, `laspy==2.6.1` and
`lazrs==0.8.0` in a build-only Python environment. Set `PYTHON_BIN` accordingly
(this workspace: `.track-model-build/madring-python/bin/python`). These are not
web dependencies. Raw archives and extracted LAZ need about 2.7 GB. On macOS
Blender requires Metal access even in background mode. Source uncertainties and
licenses: `docs/track-model-madring-source-card.md`.

Madring overrides Blender 5.2's 12-bit Meshopt position filter with 18-bit
positions: the default rounds kilometre-scale geometry to half-metre steps and
collapses narrow road paint. `audit-madring-surfaces.mjs` checks decoded delivery
geometry for collapsed paint and intersections with asphalt/terrain; it runs as
part of the Madring validator. The generated GLB URL includes its content hash
to invalidate stale viewer caches. Build metrics and visual checks are recorded
in `docs/track-model-madring-build-report.md`.
