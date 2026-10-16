# Fuel-system reconstruction evidence — 14 October 2026

Status: functional geometry and the inspection cut are implemented. Six fuel tests cover enclosure, real service openings, line endpoints, injector wells, surrounding-surface clearance and shared detail geometry. Factory dimensions, usable capacity and a complete packaging audit remain unverified.

## Confirmed sources

- [Mercedes W17 specifications](https://www.mercedesamgf1.com/f1-w17-2026-technical-specifications): ATL Kevlar-reinforced rubber bladder, high-pressure direct injection, maximum 350 bar, one injector per cylinder. No private tank shape, pump installation coordinates or usable capacity are disclosed here.
- [FIA 2026 Section C, Issue 20](https://www.fia.com/system/files/documents/fia_2026_f1_regulations_-_section_c_technical_-_iss_20_-_2026-08-05.pdf): C5.9.3 places the flow meter wholly inside the tank; C5.9.7 requires a camshaft-driven high-pressure pump. C6.1–6.3 describe the flexible cell, its pressure protection, independently fastened bonded-ring closures and fillers. C6.6.4's schematic on printed page C88 is the authoritative functional sequence for reconstruction. It was rendered and visually inspected, not inferred solely from extracted text.
- [ATL fuel-system construction](https://atlinside.com/technology/fuel-systems): collection chambers, lift pumps, check valves, filters, baffles and connections. The linked hardware photograph shows a bolted service plate, hose unions and an electrical connector. This is a generic manufacturing reference, not a W17 photograph.
- [ATL custom fuel cells](https://atlinside.com/industries/motorsport/custom-fia-approved-fuel-cells): custom geometry and flexible reinforced materials; use as a manufacturing reference without asserting a particular undisclosed W17 material thickness.

## Previous geometry and implemented replacement

The previous model used a solid three-section bladder, a filler cylinder, six isolated injectors and two disconnected rails. The replacement in `w17-fuel.ts` adds a hollow bladder, supported collector/pumps, internal filter and flow meter, pressure protection, service-plate unions, a breakaway valve, cam-driven high-pressure pump and continuous rails/feed lines. Injector wells and fluid feedthroughs are actual openings.

The detail view shares the installed geometry and starts with an illustrative side cut. The tank shape, shortened packaging behind the seat and internal hardware locations are approximations; the model does not establish a real usable capacity. Six fuel tests and the full anatomy suite pass. A complete factory-dimensional and ancillary-clearance audit is still outside the evidence established here.

Local review files: `/tmp/anatomy-fuel-regulations.pdf`, `/tmp/anatomy-fuel-schematic.png`, `/tmp/anatomy-atl-hardware.jpg`, `/tmp/anatomy-fuel-before.png`. These are temporary source-review files, not product assets.
