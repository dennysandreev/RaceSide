# Front brake circuit — 14 October 2026

## Evidence and limits

[Mercedes' brake-system explanation](https://www.mercedesamgf1.com/news/formula-one-brake-systems-explained) describes separate pedal-operated front and rear master cylinders. Front pressure goes directly to the front calipers. Rear pressure is an input to brake-by-wire, with a direct hydraulic fallback. This historical explanation establishes the topology, not W17 dimensions or a 2026 piston count. The [W17 specification](https://www.mercedesamgf1.com/f1-w17-2026-technical-specifications) confirms rear brake-by-wire; it does not publish the plumbing layout.

The model's routing, brackets, distribution tee, sockets and fitting dimensions are reconstructed around its existing survival cell and suspension. They are not Mercedes manufacturing data. Neither braking loads nor hose behaviour during suspension/steering travel are simulated.

## Installation

The left-hand master outlet now connects to a three-way distribution tee and separate left/right front brake hoses. The tee has intersecting bores and a plug at the unused manufacturing drilling. A retained foot seats it on the tub. Each branch passes through a hollow bulkhead union; actual passages are cut in the structural laminate and removable nose skin.

The external hoses follow the underside of the forward upper wishbones with seated saddles, then form free loops into the calipers. Straight sections at each union prevent sideways entry and kinks. Caliper unions extend through dedicated openings in the inboard heat shields. The installation is omitted from isolated wheel-brake previews, so whole-car plumbing does not shrink those views.

The existing two rear hoses and placeholder rear brake-control block have not been replaced by this change. They require a separate BBW/bypass reconstruction. Internal master-cylinder fluid chambers, caliper galleries, operating pressure and exact flexible-hose construction remain unverified; the connected installation is a visual reconstruction, not a fluid simulation.

## Checks

Dedicated tests follow the connection graph from the master to both calipers, check tangent-aligned ends, full-radius clearance against neighbouring triangles, bend radii, real tee and bulkhead openings, shield passages and contact between carriers and their structural supports. General cockpit, steering, wheel-brake and prepared-asset regressions also apply. Regenerate model and airflow assets together after geometry changes.

Validation: all 170 anatomy tests, scoped ESLint, project typecheck and production build pass. Browser checks cover the installed front assembly, the wheel-brake detail with its removable shield, axle selection and a 390 × 844 viewport; no console errors or horizontal overflow occurred. The prepared Mercedes asset is 15.80 MiB compressed (previously 15.67 MiB). Small-bore geometry is sampled to its physical size rather than using the large-component tessellation density. Logs: `/tmp/anatomy-brake-{all-tests,lint,types,build}.txt`. This local change has not been deployed.
