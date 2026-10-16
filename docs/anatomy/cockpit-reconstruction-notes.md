# Cockpit reconstruction — 14 October 2026

## References and limits

- [Mercedes W17 technical specification](https://www.mercedesamgf1.com/f1-w17-2026-technical-specifications) confirms an anatomically formed removable carbon seat, a six-point restraint and a carbon steering wheel. HANS belongs to the driver's personal equipment; the empty cockpit does not contain a detached HANS device.
- [Mercedes' steering-wheel explanation](https://www.mercedesamgf1.com/news/how-does-an-f1-steering-wheel-work) informs the guarded buttons, rotary controls, paddles and driver-specific grips. Its 2019 switch count and DRS/MGU-H functions are not treated as W17 specifications.
- [Brembo's Formula 1 overview](https://www.brembo.com/en/motorsport/formula1) confirms the use of master cylinders and rear brake-by-wire equipment. It does not establish this model's pedal geometry, suppliers, mount coordinates or cylinder layout.

The exact seat contour, restraint anchor positions, pedal mechanism, controls and lettering are illustrative. This is not factory CAD or a certified restraint/braking design. The neutral indication on the steering display is static, not live telemetry. Pedal movement, braking forces, clutch actuation and button input are not simulated.

## Implemented

The seat keeps the established installation envelope, with a smooth concave shell, closed laminate edges, four real belt passages, local pads, rolled edges and side retaining lugs. Six separate webbing straps terminate at a common rotary buckle and retained anchors. The visible portions conform to the seat; rear and lower sections pass through the belt openings. Adjuster frames, edge stitching and anchor hardware remain geometry when zoomed in.

The former solid pedal block and two flat plates are replaced by an open frame, heel rest, two perforated pedal faces, levers, pivot bearings, return springs, stops, a brake balance bar, two master cylinders with local reservoirs and a throttle-position sensor with a terminated local lead. Four frame mounts seat on the existing survival-cell laminate. Cylinder outlet unions are the boundary of the isolated pedal module. The [front brake installation](front-brake-circuit-notes.md) now joins the front master to both calipers; rear brake plumbing and BBW remain unfinished.

The steering wheel retains its connection to the existing column. It now includes hand openings, formed grips, guarded buttons, thumb encoders, three marked selectors, a recessed screen, shift-light lenses, separate gearshift and clutch paddles, pivots, rear housing and retained boss. Physical lettering uses a licensed subset of the project's existing Geist outlines, baked as geometry without runtime fonts or textures.

The cockpit explanation now reuses the installed wheel as well as the seat and pedals. The complete car still contains only one wheel. A higher initial view reveals the seat, and «Снять обрамление» removes the cockpit lining and padded rim without removing the seat, restraints or controls. The steering explanation continues to include the whole column and rack.

### Close inspection

The cockpit detail now has compact «Всё», «Сиденье», «Руль» and «Педали» views. These use the same installed meshes, without moving or duplicating controls in the car. The wheel opens from the driver's side; the camera fits the actual visible geometry, including after removing the lining. Hidden parts no longer leave unused space around a close-up. Orbit and zoom remain available in each view.

Added geometry includes knurled rotary and thumb encoders, a retained quick-release collar with grip ribs, raised pedal tread between the perforations, and rail adjustment inserts. Restraint webbing uses a matte, nonmetallic material. These details follow the established reconstruction envelope; the exact control layout is not claimed to be Mercedes factory geometry.

## Validation

Dedicated geometry tests cover the closed seat and open belt passages, six strap terminations and surface clearance, pedestal/cylinder support, contact between frame mounts and the tub, the pedal hardware's envelope inside the survival cell, shared preview geometry and independent materials. Further checks cover complete and mutually exclusive close-up assemblies, open pedal perforations with raised tread, and preservation of cockpit grouping in the baked model. Existing steering, battery, electronics and baked-asset regressions remain applicable. The model and airflow assets must be rebuilt together after geometry changes.
