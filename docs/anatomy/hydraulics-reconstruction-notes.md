# Hydraulic assembly reconstruction — 14 October 2026

The previous model contained a rectangular control block, an unsupported accumulator and one hose with a loose endpoint. The replacement is a connected rear hydraulic assembly for the gearbox selector and clutch, fitted to the existing engine/gearbox geometry.

## Reference boundary

- [Mercedes W17 technical specifications](https://www.mercedesamgf1.com/f1-w17-2026-technical-specifications) confirm hydraulic sequential gear selection, a carbon plate clutch and power-assisted rack-and-pinion steering. They do not publish the hydraulic pack layout, working pressure, hardpoints or pump dimensions.
- [Moog 24 Series product reference](https://www.moog.com/products/servovalves-servo-proportional-valves/industrial/miniature-servo-valves/direct-operated-servo-valves-for-analog-signals-E024-series.html) provides the compact valve silhouette and motorsport application context. The current manufacturer's photograph was inspected. The indexed [E024 dimensional sheet](https://www.moog.com/content/dam/moog/literature/products/servovalves/industrial/mfb/E024_Series_Datasheet.pdf) gives a roughly 35 × 31 mm mounting envelope; direct PDF retrieval currently returns 404. No Moog branding or claim that these are the exact W17 units is applied to the model.
- [Moog miniature actuation brochure](https://www.moog.co.uk/content/dam/moog/literature/ICD/motorsport/Ultimate_Power_Density_Miniature_Actuation_for_High_Performance_Applications.pdf) describes miniature motorsport actuators. Its historic examples do not establish 2026 Mercedes packaging or permit copying obsolete active-suspension systems.

## Implemented geometry

- Engine-mounted pump with drive quill, seal, flange and fasteners.
- Thin-walled reservoir with filler, baffle, return standpipe, straps and a gearbox-supported carrier.
- Pressure filter, manifold, two compact control valves, gallery plugs, relief cartridge, pressure sensor and service cap.
- Hollow piston accumulator with separate fluid and gas ends, separator piston, seals, straps and case inserts.
- Coaxial clutch slave, release bearing, support sleeve and flange aligned with the existing input shaft/release ring.
- Double-acting selector cylinder, gland, rod, pinned eye and indexing arm joined to the selector barrel.
- Nine hollow hydraulic lines with tangent-aligned ends and crimp sleeves. Pressure supply, return and actuator connections terminate at fittings. The gearbox, pan, tank and engine end cover have actual bored passages where needed.

The same geometry is used in the full car, engine view and component dialog. The prepared model and airflow files must be regenerated together using the commands in [loading-and-airflow.md](loading-and-airflow.md).

## Validation and remaining work

Seven focused tests check assembly supports, hose endpoints/tangents/curvature, real passage openings, actuator contact, triangle-level line clearance against the car and local brackets, vessel clearance and shared detail geometry. These supplement the general model/asset tests; they are geometric checks, not hydraulic or thermal simulation.

Final validation: all **146 anatomy tests pass**, scoped ESLint, project typecheck and production build pass. Desktop and 390 × 844 browser checks cover the installed assembly, engine view and hydraulic detail; no JavaScript exceptions or page overflow occurred. The existing watertight-pan regression also passes after adding the inner laminate. Logs: `/tmp/anatomy-hydraulics-{all-tests,lint,typecheck,build}.txt`.

This is a functional visual reconstruction. Pump internals, valve spool passages, exact capacities, pressures, thermal shielding, electrical connection to the main loom, and the supply/return branches for active aero are not established by this work. Those remain part of the wider internal-system audit. The assembly must not be described as factory CAD or verified 1:1 Mercedes geometry.

This change was developed after deployment snapshot `4b9c1caff0aa`. It belongs to a subsequent release and has not been published by this task.

## Steering supply follow-up

Two additional hollow lines now join dedicated manifold take-offs to the steering metering valve. The former gallery plugs at these positions are replaced by bored unions. Lines clear the exhaust, coolant hardware and body skins, and have structural carriers and protected service passages. The front-running installation is omitted from the engine-only view; the rear hydraulic pack remains visible. See [steering reconstruction notes](steering-reconstruction-notes.md). These are reconstructed installation coordinates, not factory plumbing dimensions or a hydraulic simulation.


## Mechanical pump take-off — 16 October 2026

The previous drive quill stopped inside the engine timing cover without a driving gear. A separate enclosed cassette now connects it to the rear extension of the existing right intake camshaft. Two equal 30-tooth involute gears share the measured installed centre distance and turn the pump opposite to the cam at half crankshaft speed. The original pump position and hose endpoints are retained. This closes the represented mechanical connection; the pump's pressure-generating internals are still concealed and remain to be reconstructed.

The fixed-speed mechanical arrangement is consistent with the hydraulic-ancillary provision in C5.11.3 of the [FIA 2026 technical regulations, issue 20](https://www.fia.com/system/files/documents/fia_2026_f1_regulations_-_section_c_technical_-_iss_20_-_2026-08-05.pdf). This is not evidence that Mercedes uses this camshaft take-off, tooth count, ratio or packaging. The publicly confirmed hydraulic sequential gear selection and power-assisted steering do not establish the pump design. [Parker Aerospace's engine-driven pump reference](https://www.parker.com/content/dam/Parker-com/Literature/Hydraulic-Systems-Division/HSD-literature-files/HSD_Aircraft-Engine-Driven-Pumps.pdf) describes the separate rotating cylinder barrel, pistons, shoes, valve plate and compensator that a future internal reconstruction needs; the current solid pump envelope is not presented as those completed parts or as Parker/W17 hardware.

The new cassette has native closed perimeter and end plates, four supported shaft journals, matching shaft flats and gear bores, axial retainers, a blind output end cap and four mounting bolts through the existing timing cover. The cam extension joins the original shaft coaxially; the original pump quill now belongs to the driven rotating group. The pump flange seats on the cover and contains real fastener holes and a seal recess. The timing-cover profile is rebuilt with native holes rather than overlapping sequential cuts.

The hydraulic dialog adds «Привод насоса» beside «Вся система». It uses the installed drive and pump, with removable drive housings and the existing engine-angle animation. The pump body stays closed. Exact Mercedes dimensions, pump displacement/compensation, accessory lubrication and loaded gear/bearing validation remain outside the demonstrated result.


Validation: **54 distinct relevant checks pass** across the new drive, existing hydraulics, engine-core, timing, powertrain-fit, steering-supply, prepared-asset, model-cache and render-batch suites. The initial failing check reproduced the unconnected shaft; the finished checks cover shaft continuity and rotation ratio, full tooth engagement, closed cover topology, fastener/shaft bores, clearance from neighboring surfaces and retained geometry/material independence. The collision check covers new drive surfaces; the unchanged quill inside the still-concealed solid pump envelope is excluded from that new-surface test and is part of the unfinished pump-internals work. Feature ESLint, the production build and post-build project typecheck pass. The complete anatomy suite and repository-wide lint were not rerun.

The prepared Mercedes revision is `f38eb7bbf440`: 5,667 geometries, 27.50 MiB compressed, approximately 0.10 MiB above the oil-pump revision. All three airflow variants were regenerated with 50 paths each. Desktop and 390×844 checks cover whole-system/drive selection, closed/open covers, matched opposite gear rotations, driven-quill parenting, pause, reduced motion and independent main/detail transforms. All four main modes, all three wing variants and the visible airflow button were exercised; no browser console errors or document overflow were observed. The main model was returned to assembled Mercedes, airflow off and the default camera.

A 240-frame local desktop orbit sample measured median 16.7 ms, p95 16.8 ms and maximum 18.5 ms, with 805 draw calls and 4,783,158 triangles. It does not establish cold-download speed or mobile GPU performance. Captures: `output/playwright/hydraulic-drive-{open,closed,mobile,final}.png`; measurement: `output/playwright/hydraulic-drive-validation.json`. Logs: `/tmp/w17-hydraulic-drive-{before,path,fit,integration,assets-tests,lint,build,types,bake,airflow}.txt`. No deployment was performed.

## Pump working group — 16 October 2026

The installed pump now contains a seven-bore rotating barrel, a matching six-spline shaft, two shaft bushes, hollow pistons with spherical ends, seven cupped slippers, a shoe retaining plate, a stationary kidney-port plate and a supported swashplate. Its rotor shares the existing camshaft take-off ratio and phase. Piston travel and slipper orientation follow the swashplane, while the retaining plate turns in that plane. This displays one fixed 15-degree operating angle, not a pressure-compensated simulation. The compensator, variable-angle actuation and the retainer's axial preload mechanism remain unfinished.

The principle follows the separate barrel/piston/shoe/valve-plate mechanism described by [Parker Aerospace](https://www.parker.com/content/dam/Parker-com/Literature/Hydraulic-Systems-Division/HSD-literature-files/HSD_Aircraft-Engine-Driven-Pumps.pdf). This aerospace reference does not establish the Mercedes supplier, number of pistons, dimensions, displacement, pressure, case-drain arrangement or control calibration. Those details remain inferred. The model must not be described as verified W17 CAD.

The former solid cylinder is a hollow case with native end plates, actual mounting holes and a sealed delivery gallery separate from its low-pressure inlet cavity. The barrel's inlet and discharge windows connect through the valve plate and port block. A taller top wall contains the delivery passage without moving the existing external hose endpoints. The pressure union seats on that wall. The two hose end sections are made exactly coplanar with their unions to remove finite-difference tangent errors. Small transverse bores are constructed in a normalized local frame; collinear cut-rim vertices are joined without moving the surface.

«Насос» in the hydraulic dialog isolates these parts; «Показать внутри» opens the case, and pause/reduced-motion controls use the shared engine clock. The closed pump stays visible when opening only its mechanical drive. Geometry is prepared offline and static surfaces retain batching.

Validation: **54 relevant tests pass** (5 pump, 5 drive, 32 engine/timing/powertrain/hydraulic integration, 12 prepared-asset/cache/batching checks), with feature ESLint, post-build TypeScript and production build passing. Checks include closed positive-volume solids, separate fluid passages, piston engagement and slipper contact over a full revolution, installed clearances, shared animation phase and prepared geometry/metadata. The drive-clearance test now includes its quill, allowing only the intended flexible seal contact.

Desktop and 390 × 844 browser checks cover opening/closing, focus switching, pause, reduced motion, independent main/detail transforms and control layout. Four assembly modes, three rear-wing variants and airflow toggling remain usable with no page exceptions. A local 240-frame monotonic orbit sample at 1440 × 900 measured median/p95 16.7 ms, maximum 18.4 ms, 828 draw calls and 4,845,578 triangles. This does not establish performance on remote networks or mobile GPUs.

Prepared Mercedes asset `86917874c61d` contains 5,693 geometries and is 27.73 MiB compressed (previously 27.50 MiB). All three airflow variants were regenerated. Captures and measurements: `output/playwright/hydraulic-pump-{final-open,closed,mobile}.png` and `hydraulic-pump-validation.json`. Logs: `/tmp/w17-pump-{fit6,integration,assets-tests,final-lint,types,build}.txt`. The full repository/anatomy test suites were not rerun.

## Retainer preload — 16 October 2026

The retaining plate previously turned in the swashplane without an axial support. It now rests on a bored spherical guide carried by three thrust pins. A closed wire spring and two annular washers inside a stepped barrel bore push the pins and guide toward the plate. The rear washer seats on a native barrel shoulder; the front washer has free travel before the pin guide wall instead of bottoming against it. The barrel retains splined front/rear lands and seven uninterrupted piston bores, with a 20 μm display clearance at the valve plate.

The spring/spacer/pin/ball-seat arrangement follows the rotating-group assembly in [Parker C081 Service Manual, pages 28–29](https://www.parker.com/content/dam/Parker-com/Literature/Hydraulic-Pump-Division/Hydraulic-Pump-Division-STATIC-FILES/Sales-Catalogs---Thumbnails/Piston-Pumps-Open-Circuit/Axial-Piston-Pumps-for-Closed-Circuit-Applications/HY28-2687-02_C081ServiceManual_OCT2014.pdf). That reference has nine pistons; the model retains its inferred seven-piston layout and compact installation envelope. This establishes a plausible mechanical principle, not Mercedes geometry or supplier identity. Spring rate, preload force, friction, loads and pressure regulation are not simulated.

The retainer's rotation centre is now the intersection of its tilted plane with the spherical guide. Its neck-hole clearances still accommodate the slippers' elliptical orbit. A larger swashplate centre opening clears the spherical guide and drive shaft. The spring uses flattened end coils, closed wire ends and controlled cross-section orientation so both washer faces are seated without a small Frenet-frame gap.

The hydraulic pump viewer adds «Снять блок цилиндров» / «Вернуть блок» to expose this normally enclosed mechanism while retaining the piston group and camera. The assembled car, closed pump and drive-only view keep the block installed. The pressure compensator and variable-angle actuator remain the next unfinished pump mechanisms; the swashplate still shows a fixed operating angle on its existing support.

Validation: **57 relevant checks pass** across the pump/preload, hydraulic drive, engine/timing, powertrain, cache, prepared-asset and render-batch suites. Feature ESLint, production build and post-build TypeScript pass. Desktop and 390 × 844 inspection cover removing/returning the barrel without moving the camera, closed-pump visibility, pause, reduced motion and independent main/detail transforms. Captures are `output/playwright/hydraulic-pump-preload-{open,mobile,final}.png`. A local 240-frame orbit sample recorded median 16.7 ms, p95 16.8 ms and maximum 17.6 ms; it does not establish mobile GPU or cold-download performance. The initial prepared revision was `e1b704837433` (5,700 geometries, 27.81 MiB); the later final-drive correction supersedes that asset without changing the pump. No deployment was performed.
