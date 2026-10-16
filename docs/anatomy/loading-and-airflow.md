# Model loading and airflow — 14 October 2026

The browser loads prepared geometry instead of executing `createW17()` on each page opening. The procedural model remains the editable source and is used by geometry tests and asset-generation scripts. No new dependency is required.

## Regeneration

After changing geometry or wing kinematics, run from the repository root:

```sh
node --experimental-strip-types scripts/build-anatomy-model.mjs
node --experimental-strip-types scripts/build-anatomy-airflow.mjs
```

Commit the generated files in `public/anatomy/` and both manifests alongside the source change. Model export explicitly updates world matrices before serialization: omitting this step displaced the wheels and suspension, and is now covered by the asset comparison test.

The gzip model payload includes the complete object hierarchy, materials, assembly metadata and moving-wing linkages, including fixed axial offsets for rigid cylinders and rods. Repeated attribute blocks share storage; unused UVs are omitted because the model has no texture maps. Per-mesh position quantization and welded vertices retain the original triangles, with tested sampled position deviation below 0.06 mm. Transform matrices and linkage endpoints are checked separately. With the reconstructed hydraulics and steering, the full car payload is about 15.3 MiB; each alternate rear wing is below 0.5 MiB. Slow-network loading has not been benchmarked.

Airflow assets contain surface-cleared paths for each rear-wing variant, including intermediate rotating-wing states. Slope-limited envelopes are smoothed with an outward clearance correction. The illustration has fewer overlapping paths, softer entry/exit fades and mild wake roll-up instead of repeated corkscrews. Dense surface sampling runs offline. Toggling flows only fetches/decodes the selected asset and then reuses it in memory.

These are prescribed educational streamlines, not CFD. The qualitative reference is [Formula 1's 2026 aerodynamics explanation](https://www.formula1.com/en/latest/article/2026-regulations-explained-all-you-need-to-know-about-f1s-new-aerodynamics.7IAt0auc32UkCEFE5ypkTB): active wings, a flatter underfloor/diffuser and control of wheel wake. The displayed colors remain relative visual cues without measured speed or pressure units.

## Exploded mode

All assemblies translate only along positive Y. Wheels no longer have a separate sideways offset. Bodywork/mirrors, battery/inverter and other paired parts share their lift. Entering the mode fits the taller model while keeping the current viewing direction; leaving restores the previous camera. Reduced motion applies the final positions immediately.

## Validation

- 159 anatomy tests pass, including geometry, clearances, hydraulics, steering, rigid actuator travel, all three wing transitions, asset round-trip transforms and vertical offsets.
- Scoped ESLint, TypeScript and production build pass.
- Private browser checks at 1440×1000 and 390×844: all modes, three wings, opening/closing, flows, fuel-detail cutaway, reduced motion, no page errors or horizontal overflow.
- Fresh local browser contexts, without network/CPU throttling: page-to-ready approximately 1.6–2.3 s, versus the earlier 6–9 s; first airflow toggle approximately 0.26–0.29 s. These are local measurements, not remote-device guarantees.
- After the hydraulic update, two fresh desktop contexts with reduced motion and an already-running local server reached ready in 1.24 and 1.19 s. All three wings, opening/closing, airflow and vertical disassembly were exercised without page exceptions. This is a separate small local sample, not a production-network benchmark.

After the steering-supply installation, two fresh desktop contexts on the idle local dev server reached the first ready model frame in 1.268 and 1.240 s. The earlier check during concurrent compilation/tests took 4.095 s. These samples use no CPU/network throttling and do not establish performance over a production network.
