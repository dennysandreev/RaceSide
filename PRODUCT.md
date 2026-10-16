# Product

## Register

product

## Users

RaceSide is for Russian-speaking Formula 1 fans who want one place to follow the season without jumping between feeds, tables, calendars, and chats. They may open it quickly before a session, read the latest stories during the day, check standings after a race, or submit predictions with friends before a weekend starts.

Core user groups:
- Casual fans who need clear news, calendar, standings, and race context.
- Engaged fans who follow drivers, teams, race weekends, and post-session results.
- Competitive fans who want predictions, mini-leagues, polls, reactions, and leaderboards.
- Admin/editor users who manage sources, ingestion, AI processing, jobs, and data quality.

## Product Purpose

RaceSide is a premium motorsport companion for the F1 season. It combines cached official and third-party F1 data, RSS/API news ingestion, Russian AI summaries, race weekend context, favorites, predictions, leagues, polls, reactions, and an operational admin surface.

The current-weekend context includes the three dry Pirelli compounds confirmed for that Grand Prix. The worker discovers official Formula 1 tyre announcements, validates the race and season from the article URL, and caches the allocation on the race record before it is shown publicly.

Success means a user can:
- understand what matters in F1 today in under a minute;
- see what happens next in the season or current race weekend;
- open a published 2020-2026 sporting archive on a specific screen without changing the current season elsewhere;
- follow favorite drivers and teams;
- make and compare predictions without friction;
- trust that news, standings, schedules, and results are sourced and current.

Telemetry also helps users compare where the selected laps gain time: slow, medium and fast corners, straights, and corner exits. The same workspace checks repeatability on individual sections of nearby laps, with tyre conditions shown as context rather than eligibility gates, and shows signals such as superclipping, coasting before braking and weakening acceleration. Whole-lap yellow flags, deleted status and unknown or different tyre ages do not veto a section with usable telemetry. In product UI, «Суперклиппинг» means the car slows while throttle is pressed and brake is released. Local time gains are estimates with visible coverage and precision limits; these channels do not provide battery charge or energy quantities.

Race pace also compares the distribution of measured lap times across drivers: typical pace (median), average time, spread and the number of included laps. Its box plots share the existing tyre, safety-car and race-range filters, with statistics independent of smoothing. These values describe the selected laps; they do not attribute differences to the car alone.

The car anatomy workspace at `/anatomy` lets fans inspect a generic Formula 1 2026 reconstruction and open an assembly explanation directly by clicking its geometry. The car and its controls stay in one viewport. Detailed explanations, the component catalog, ERS lab and model information open on demand. All 31 assemblies have five detailed operating steps, a parts summary and related assemblies; old flat mechanism drawings are omitted. Icon-only previous/next arrows browse the full catalog without closing the detail dialog, wrapping at both ends. The About dialog omits external links, the Anatomy credit, the basic mouse-control introduction and the CAD disclaimer sentence. Research references remain in project documentation. Photographic reconstruction and illustrative internal geometry must not be presented as factory CAD or verified 1:1 measurements.

The «Двигатель» view keeps the installed powertrain together with its battery/inverter, engine electronics, fuel supply, cooling and lubrication. It reveals the gearbox internals while preserving the assembled positions and current camera. All visible assemblies remain selectable for their existing explanations.

MGU-K inspection uses the installed motor cartridge, with a removable explanatory upper section, windings, rotor and bearings. A hollow removable transmission contains four meshing gears, supported idlers, a keyed crank connection and the motor's splined coupling. Its animation shares the engine clock and a fixed ratio. Power and cooling connections pass outside the gear envelope through bored end-shield bosses. The cartridge sits behind the main coolant-pump drive, retaining its shaft connection and routed coolant return. The transmission layout and ratio are reconstructed, not published Mercedes specifications; the hydraulic pump has a separate camshaft take-off and an inspectable seven-piston working group at a fixed illustrative swash angle. A barrel spring, three guided pins and a spherical seat preload the shoe retainer. Its pressure compensator and variable-angle actuation remain unfinished. Inboard suspension shows connected pushrods, rockers, supported damper eyes and spring seats. Internal topology, hardpoints and coolant circuits are illustrative reconstructions; they are not measured team specifications.

Engine inspection shares the installed crank-and-piston assembly: three common crankpins, six rods, hollow pistons with three rings each, wrist pins, liners and supported main bearings. Bore, bore pitch, rod length and deck height follow the published 2026 dimensions; the stroke is derived from 1.6 litres. Its two heads contain 24 valves, guides, pneumatic return chambers and four supported camshafts. An enclosed mechanical timing train connects the crank to all four cams through supported intermediate gears. Opening the engine animates this train and the camshafts at half crank speed with matching valve motion, a pause control and reduced-motion support. Short intake runners enter the plenum from below. A retained gas bottle, passive pressure regulator, two head feeds, four distribution headers and 24 non-return cartridges supply the pneumatic chambers. The pressure sensor connects to the engine harness through a sealed front-cover passage. Timing topology and tooth counts, head castings, chamber shape, valve events, lift and pneumatic packaging remain illustrative. Ignition wiring and the complete accessory drive and its enclosure are still unfinished, not verified Mercedes internals.

The fire bottle sits inside the survival cell, with a supported tray, retaining bands and a cockpit discharge line/nozzle. A separate activation battery, guarded driver controls and two external pull handles share an insulated trigger loom routed beside the fuel compartment. Its packaging follows public cockpit-only fire-system references; exact Mercedes dimensions and supplier are unknown. The exterior E decals are omitted at the user's request; the pull handles and switches remain. The external switches' separate master-cutoff circuit still needs integration with the car's power-control hardware.

In «Под кузовом», the front suspension access cover leaves with the bodywork so both dampers and rockers remain visible in their supported bay. Wishbone hardpoints stay attached to the survival cell. Mirrors have their own component explanation and leave with the body panels that carry their supports.

Steering inspection includes the wheel, supported straight shafts, a universal joint, rack and pinion, bellows and the local hydraulic-assist mechanism. «Показать внутри» removes its housings to reveal the shared installed parts. Pressure and return lines connect the valve to the rear hydraulic manifold, with supported routes and service passages. The engine view omits these front-running lines. Hidden dimensions and valve packaging remain reconstructed.

Differential inspection includes a bored crown-to-carrier flange, paired internal gears, clutch packs and output shafts. Stationary bearing cartridges attach it to the hollow gearbox casing. Two annular pistons apply the clutch packs through thrust bearings and shaft shoulders, with a proportional valve and protected pressure lines. Removing the housings exposes the same installed mechanism. Its hidden construction is inferred from published general mechanisms; it is not measured Mercedes hardware or a validated loaded transmission.

The energy-store explanation uses an opened, shared enclosure containing cell modules, monitoring and protection devices, and the CU-K inverter. The inverter remains separately selectable for inspection. Cell count, packaging and circuit layout are illustrative; the display does not claim the team's capacity, voltage or proprietary construction.

The «В разборе» view lifts assemblies vertically above their installed positions, with no sideways wheel displacement. It fits the taller view and restores the previous camera on return. The car and airflow use prepared local assets so the browser does not rebuild their geometry on entry.

An optional airflow illustration follows the body, underfloor, active wings and wake, and passes through both main radiator cores and the charge-air/ERS low-temperature core to the rear cooling outlet. A single «Потоки» button switches the entire illustration on or off. In «В сборе», all parts stay opaque during hover and airflow; the gentle hover highlight remains. Other assembly modes allow hover inspection and translucent body panels/radiator inlet ducts while the paths are shown; internal machinery stays opaque. Returning to «В сборе» immediately restores opaque surfaces. Coloured tubes and moving particles convey qualitative relative speed; they are not a CFD solution or measured pressure/speed data. Reduced motion freezes the particles.

The rear-wing selector compares Mercedes with the Ferrari and Red Bull rotating designs from Miami 2026. Only the rear assembly changes on the comparison model. The selection is shared by the full car, component preview and detail dialog. Alternative geometry and mechanism dimensions are photographic reconstructions, not interchangeable factory parts.

The W17 front-wing reconstruction moves the two halves of the rearmost profile and keeps the nose-supported second profile stationary, following the public shakedown footage. Linear wing actuators have fixed-length barrels and rods with sliding pistons; the same linkage data is retained in prepared assets and component views. Hidden actuation hardware and hydraulic supply routing are not verified Mercedes dimensions.

Brake details let users inspect a front or rear assembly and remove its carbon shroud. The explanation and car share the same geometry. Carbone Industries discs/pads and Brembo monobloc calipers are confirmed W17 specifications; the model's exact diameters, six-piston layout, channels and mounting details remain reconstructed within the 2026 regulation limits.

Cooling details expose the radiator cores by removing their air ducts. Tubes, fins, headers and coolant/oil circuits use the same geometry as the car. Their construction follows public heat-exchanger examples; the W17's exact core specification, circuit layout and mounts remain inferred.

The engine cover opens into the hollow tail, with a cooling-air outlet around the retained exhaust sleeve. The thin shell has returned rims and two lateral sleeve supports. Three illustrative cooling paths pass through real open fin cells in the two main radiators and the separate charge-air/ERS low-temperature radiator, around the installed engine-bay hardware and out of the tail. A recessed carbon divider splits the right inlet into the main and low-temperature branches; each duct covers its core through a perimeter seal. Their packaging, relative speed and widths are illustrative; outlet area, mass flow and thermal performance are not measured W17 data. These paths do not yet cover the separate oil cooler, brake cooling or combustion-air circuit.

The cooling viewer can isolate either main engine pump or the pump serving charge-air cooling and ERS. Removing their housings reveals impellers, bearings and seals. Both main pumps connect to the crankshaft through an enclosed five-gear transmission, with supported shafts and retained bearings. The shared low-temperature pump connects to the intake camshaft through a supported, enclosed two-gear drive. Each isolated open pump view animates its gears and impeller together. These fixed-ratio branches are reconstructed; their layout and ratios are not published Mercedes specifications. The three-stage oil pump has a separate fixed-ratio take-off, two supported shafts and connected pressure/scavenge chambers. Its open detail animates the installed gears. The hydraulic pump has a supported, enclosed two-gear take-off from the right intake camshaft. Hydraulic inspection can isolate this drive, open its covers and animate the installed gears and quill. Its hidden placement and half-crank speed ratio are inferred. Pumping internals, accessory lubrication and complete engine accessory validation remain unfinished.

## Brand Personality

Fast, sharp, and composed.

RaceSide should feel like a serious sport product, not a meme page or a generic dashboard. It can be energetic, but the energy should come from timing, contrast, data, motorsport texture, and confident hierarchy rather than noisy decoration.

Voice:
- Russian-first, concise, human, and editorial.
- No internal/system wording in UI.
- No dry admin-style labels for users.
- Buttons use direct actions like "Сохранить", "Сделать прогноз", "Создать лигу".

## Anti-references

RaceSide must not look like:
- a generic dark SaaS dashboard with purple gradients;
- an overloaded racing game HUD;
- a crypto/fintech leaderboard clone;
- a plain news blog with no product interaction;
- a F1 trademark imitation or unofficial copy of Formula 1 branding.

Avoid these patterns:
- glassmorphism as default;
- identical icon-card grids;
- huge decorative gradients with no product meaning;
- tiny uppercase eyebrows on every section;
- UI copy that sounds like database fields, API states, or technical specs.

## Design Principles

1. Put the next useful racing moment first: the current weekend, next session, latest result, or strongest story should be easy to find.
2. Make news feel sourced and calm: summarize, tag, dedupe, and link out instead of pretending to be the original publisher.
3. Keep competition legible: predictions, leagues, and leaderboards should be exciting but never confusing.
4. Use density with discipline: motorsport data can be rich, but scanning must stay fast on mobile.
5. Design admin surfaces as operational tools: quiet, dense, and reliable, with clear job states and recovery actions.

## Accessibility & Inclusion

Target WCAG 2.2 AA for core public and authenticated flows.

Required:
- keyboard-visible focus states;
- readable contrast for body, muted, placeholder, and table text;
- responsive support for 375px, 768px, 1024px, and 1440px widths;
- reduced-motion alternatives for all animation;
- color-independent status communication;
- touch targets appropriate for mobile;
- clear empty, loading, error, and stale-data states.

## Scope Defaults

The public `/feedback` page accepts suggestions without an account and an optional reply contact. Feedback stays private in the admin reader inbox and is delivered to the existing Telegram support bot with retries. The footer links to «Обратная связь»; the former data-sources page redirects there. The «Авторы и лицензии» page is removed.

Included in V1:
- public news, AI summaries, digests, calendar, race hub, results, standings, teams, drivers, circuits;
- published Formula 1 season archives from 2020 onward: calendar, session results, standings, season-specific driver/team profiles, cars, logos, and race-specific track maps;
- email/password auth через Supabase с подтверждением почты и восстановлением доступа;
- onboarding, favorites, personal feed;
- predictions, mini-leagues, leaderboards, polls, reactions;
- operational admin for sources, jobs, articles, AI usage, and sync tasks;
- worker-based external API ingestion and caching.
- one RaceSide Plus subscription at 390 ₽ per month or 3 900 ₽ per year;
- subscriber access to RaceSide LIVE, the full Telemetry Hub, and Telegram linking and notifications;
- one authenticated Telemetry Demo with unrestricted analysis inside one completed race session from the Grand Prix two completed rounds back;
- advertising on free surfaces and an ad-free experience across the whole site for subscribers;
- mandatory spoiler protection for qualifying, sprint, and race results in Telegram.

Deferred from V1:
- web push and notification channels other than Telegram;
- YouTube/video;
- native mobile apps.

## RaceSide LIVE

- `/live` is part of RaceSide Plus. Guests and signed-in users without an active subscription may open the route but must not receive LIVE data; they see the subscription offer instead. `15_raceside_live.md` and `16_raceside_live_weekend_sessions.md` continue to define the session and interface scope.
- The existing Replay and watch-online link remain available. LIVE uses a shared server-side paid OpenF1 stream and records racing history for Replay.
- Team Radio is transcribed with OpenRouter `openai/gpt-transcribe`; Russian translation uses the existing text integration. Audio exists only in temporary memory, never in permanent storage.

## Subscription

- `18_subscription_concept.md` is the source of truth for subscription pricing and product access.
- `19_subscription_payment_integration.md` defines the billing architecture and provider contracts; `20_subscription_development_plan.md` defines staged implementation and acceptance.
- RaceSide Plus costs 390 ₽ per month or 3 900 ₽ per year. Only RUB prices appear on the Plus offer page.
- Russian and international cards use recurring Lava.top subscriptions (390 ₽ / 3 900 ₽ or $5 / $49.90 respectively). Lava.top is the only provider for new purchases; cryptocurrency checkout is not offered. Historical orders and payment notifications remain supported with their original provider identities.
- The full LIVE section, full Telemetry Hub, and Telegram notifications require an active subscription.
- Telemetry Demo requires an account and opens one completed race session from the Grand Prix two completed rounds back. Users can choose any available drivers and laps, use race pace, save links and export within that session; other sessions require Plus. A compact notice in the selection form and change-comparison dialog identifies the demo scope and explains that Plus opens all Grand Prix and sessions. Loaded chart screens do not show the notice.
- Subscribers do not see advertising anywhere on the site.

## Historical seasons

- The current Formula 1 season opens by default. A selected archive year is stored only in `?season=YYYY` on the calendar, championship, team list, and driver/team profile currently being viewed.
- Main navigation never carries an archive year between sections, and the sidebar always shows the next session of the current season. Direct links from an archive table or team list may preserve the year when opening the related driver or team profile.
- Unknown, malformed, and unpublished years return 404. Historical seasons are published only as one complete 2020-2025 batch after the launch gate passes.
- Historical race pages are a sporting archive: schedule, classifications, statistics, and the verified map for that exact race. Race Replay, AI reports, current news, weather, odds, and notifications remain current-season features.
- Driver and team profiles show only published years in which that driver or team lineage participated. Renault/Alpine, Racing Point/Aston Martin, AlphaTauri/RB/Racing Bulls, and Alfa Romeo/Sauber/Audi share stable lineage pages while retaining their season names and identity.
- A historical season never falls back to current-season cars, logos, driver portraits, or track maps. Verified seasonal cars, logos, and race maps remain required for publication.
- Historical driver portraits are optional and do not block publication. Until a seasonal portrait is added, the interface uses the driver's number or initials without substituting a 2026 image.
- Official car, logo, and map images require source records, checksums, attribution, manual visual review, and a separate rights review before publication. A generated portrait follows the same seasonal review process when it is added later.

## Race pace analytics

Telemetry Hub includes «Темп гонки» for RaceSide Plus: all-driver lap-time comparison by race lap or tyre age, independent tyre toggles and an all-tyres preset including unknowns, permanent pit-lap and red-flag exclusions, optional SC/VSC exclusion, tyre strategy history and PNG sharing. Completed races are prepared through scheduled result/session polling and the existing worker queue. It uses compact shared per-session timing data, without fetching car telemetry or creating per-user copies. The feature is defined in `21_race_pace_analytics.md`; it does not claim fuel-corrected tyre degradation.
