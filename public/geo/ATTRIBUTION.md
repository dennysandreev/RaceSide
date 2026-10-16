# Season globe geography source

- Dataset: Natural Earth, Admin 0 - Countries
- Version: 5.1.2
- Scale: 1:110m
- Retrieved: 2026-08-26
- Worldview: Natural Earth default Admin 0 country boundaries
- Source: https://github.com/nvkelso/natural-earth-vector/blob/v5.1.2/geojson/ne_110m_admin_0_countries.geojson
- Terms: Natural Earth data is in the public domain: https://www.naturalearthdata.com/about/terms-of-use/
- Source GeoJSON SHA-256: `6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f`
- Runtime mask SHA-256: `43ea8edb1c1c16cd8403cd9259e3d11d18bf18359a8db1dd3acdedd6e7fd1359`

The source polygons are projected to a 2048x1024 equirectangular texture by
`scripts/generate-season-globe-mask.mjs`. Red stores land coverage, green stores
country boundaries, blue stores countries hosting a Grand Prix in the active
2026 calendar, and black stores ocean. The runtime shader maps those channels to
RaceSide semantic theme tokens; the host-country tint is a calendar highlight,
not a political category. Monaco and Singapore remain represented by their race
markers because their silhouettes are not present at the 1:110m dataset scale.

## Globe relief

- Dataset: NASA Earth Observatory, Blue Marble Next Generation, global land topography.
- Source: https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/topography-bathymetry-maps/
- Original: https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/topography/gebco_08_rev_elev_5400x2700.jpg
- Retrieved: 2026-10-03.
- Credit: NASA Earth Observatory; the source collection credits Jesse Allen and GEBCO / British Oceanographic Data Centre.
- Usage guidance: https://www.nasa.gov/nasa-brand-center/images-and-media/
- Source JPEG SHA-256: `97828a87bcb6549a527232455e478c5f9e4556f761b37d620a46446da17593ab`.
- Runtime WebP SHA-256: `0a867efe14774c2026785ad1b2b88d95a56dc9d9d6dfb1427bb3b79a4af2f6eb`.
- Runtime: `world-relief.webp`, 2048 × 1024, 142636 bytes.
- Conversion: `node scripts/generate-season-globe-relief.mjs elevation.jpg`.

The RGB asset stores horizontal slope, vertical slope and height. It creates
surface relief in the shader, with no external browser requests. Relief and
the red lighting around the selected race are visual treatments, not a live
satellite view, telemetry data or a geographically accurate height scale.
