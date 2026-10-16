import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

import { MEXICO_TRACK_MODEL as model } from "./mexico-model.ts";
import { getThreeDimensionalTrackModelId } from "./track-models.ts";
import { validateTrackAsset } from "../../scripts/track-model-blender/validate-track.mjs";

const root = new URL("../../", import.meta.url);
const metadata = JSON.parse(await readFile(new URL("public/f1/tracks/3d/mexico-metadata.json", root), "utf8"));

test("Mexico delivery keeps its driving and event surfaces clear and every physical object textured", async () => {
  const metrics = await validateTrackAsset({
    modelId: "mexico",
    glbPath: new URL("public/f1/tracks/3d/mexico.glb", root),
    previewPath: new URL("public/f1/tracks/3d/mexico-preview.webp", root),
    metadataPath: new URL("public/f1/tracks/3d/mexico-metadata.json", root),
  });
  const audit = metrics.decodedSurfaceAudit;
  assert.equal(audit.road.intersections, 0);
  assert.equal(audit.paint.intersections, 0);
  assert.ok(audit.surfaces.triangles > 0, "The current green field and event surfaces must be present");
  assert.ok(audit.surfaces.sampleCount > audit.surfaces.triangles * 4,
    "Broad event surfaces need interior grid probes in addition to triangle samples");
  assert.equal(audit.surfaces.intersections, 0, "Event surfaces must stay above terrain throughout their interiors");
  assert.equal(audit.surfaces.missingSupport, 0);
  assert.ok(audit.surfaces.minimumClearanceMeters > .005);
  assert.ok(audit.longitudinalRoad.referenceAvailable);
  assert.equal(audit.longitudinalRoad.missingSamples, 0);
  assert.ok(audit.longitudinalRoad.maximumAbsoluteGradePercent < 2);
  assert.ok(audit.longitudinalRoad.maximumSmoothedGradeChangePerMeter < .05);
  assert.ok(audit.longitudinalRoad.finishSeamHeightGapMeters <= .01);
  for (const anchor of audit.elevationAnchors) {
    assert.equal(anchor.roadSupported, true, `${anchor.name} must be on the actual road`);
    assert.ok(anchor.roadHeightErrorMeters <= .05);
    assert.ok(anchor.extremumErrorMeters <= .01);
    assert.ok(anchor.elevationMeters > 2200 && anchor.elevationMeters < 2300,
      "Mexico altitude and the 4304 m lap length must remain distinct");
  }
  assert.deepEqual(audit.structuralConflicts, {});
  assert.ok(audit.textures.physicalPrimitives > 0);
  assert.equal(audit.textures.texturedPrimitives, audit.textures.physicalPrimitives);
  assert.deepEqual(audit.textures.missingTextures, []);
  assert.deepEqual(audit.textures.invalidUvs, []);
});

test("Mexico follows the official 17-turn lap in metres without vertical exaggeration", () => {
  const { points, turns, sectorBreaks, speedTrapProgress } = model.data;
  assert.equal(model.data.lapLengthKm, 4.304);
  assert.equal(points[0][0], 0);
  assert.deepEqual(points.at(-1), [1, ...points[0].slice(1)]);
  assert.ok(points.every((point, index) => point.every(Number.isFinite) &&
    (index === 0 || point[0] > points[index - 1][0])));
  assert.deepEqual(turns.map(({ number }) => number), Array.from({ length: 17 }, (_, index) => index + 1));
  assert.ok(turns.every((turn, index) => turn.progress > (turns[index - 1]?.progress ?? 0) && turn.progress < 1));
  assert.ok(sectorBreaks[0] > 0 && sectorBreaks[0] < sectorBreaks[1] && sectorBreaks[1] < 1);
  assert.ok(speedTrapProgress >= 0 && speedTrapProgress < 1);
  assert.equal(metadata.lapLength.officialFiaMeters, 4304);
  assert.ok(metadata.lapLength.relativeErrorPercent < .5);
  assert.equal(model.camera.verticalExaggeration, 1);
  assert.equal(metadata.verticalExaggeration, 1);
  assert.equal(model.webgl.turnCount, 17);
  assert.equal(metadata.objects.pitGarageBoxes, 33);
  assert.equal(metadata.controlPointReference.pitBoxes, 33);
});

test("Mexico stadium preserves its author-plan terrace seams, continuous cantilever roof and painted apron", async () => {
  const reference = JSON.parse(await readFile(new URL("docs/track-model-mexico-stadium-reference.json", root), "utf8"));
  const { decodedSurfaceAudit: { stadium } } = await validateTrackAsset({
    modelId: "mexico",
    glbPath: new URL("public/f1/tracks/3d/mexico.glb", root),
    previewPath: new URL("public/f1/tracks/3d/mexico-preview.webp", root),
    metadataPath: new URL("public/f1/tracks/3d/mexico-metadata.json", root),
  });
  assert.equal(stadium.genericStadiumTriangles, 0, "The former generic stadium blocks must be replaced");
  assert.ok(stadium.eastHospitality.triangles > 0, "The eastern T12–T13 spectator wing must be delivered");
  assert.ok(stadium.eastHospitality.sampleCount > 250);
  assert.equal(stadium.eastHospitality.missingSamples, 0, "The mapped east frontage must be continuously covered");
  assert.equal(stadium.eastHospitality.outsideCentroids, 0, "Eastern event geometry must stay inside the frontage and north connector");
  assert.equal(stadium.eastHospitality.deckLevels.length, 2);
  for (const deck of stadium.eastHospitality.deckLevels) {
    assert.ok(deck.sampleCount > 250);
    assert.equal(deck.missingSamples, 0, "Both occupied balcony levels need continuous floors, independently of the roof");
  }
  assert.ok(stadium.eastHospitality.connectionSamples > 100);
  assert.equal(stadium.eastHospitality.connectionMissingSamples, 0, "Both seams of the north concourse must meet in the decoded GLB");
  assert.ok(stadium.eastHospitality.maximumConnectionHeightErrorMeters < .08);
  for (const [material, count] of Object.entries(stadium.eastHospitality.palette)) {
    assert.ok(count > 0, `Missing eastern hospitality source color: ${material}`);
  }
  assert.equal(stadium.seatingOutsideCentroids, 0);
  assert.equal(stadium.banks.length, reference.seatingBanks.length);
  for (const bank of stadium.banks) {
    assert.ok(bank.sampleCount > 0);
    assert.equal(bank.missingSamples, 0, `Mapped terrace ${bank.osmWayId} has holes`);
    assert.ok(bank.frontSamples > 0);
    assert.equal(bank.frontMissingSamples, 0, `Terrace ${bank.osmWayId} has a broken front edge`);
  }
  assert.equal(stadium.canopy.missingSamples, 0);
  assert.equal(stadium.canopy.outsideCentroids, 0);
  assert.ok(Math.abs(stadium.canopy.projectedAreaSquareMeters / stadium.canopy.referenceAreaSquareMeters - 1) < .02);
  assert.equal(stadium.westPassageMissingSamples, 0);
  assert.equal(reference.roof.trusses, 58);
  assert.equal(reference.roof.cantileverMeters, 24);
  assert.equal(stadium.cantileverTipSamples, reference.roof.trusses);
  assert.equal(stadium.missingCantileverTips, 0, "Every published roof frame must reach the cantilever tip");
  assert.ok(stadium.maximumTipHeightErrorMeters < .5);
  assert.equal(stadium.palette.canopyTriangles, stadium.canopyTriangles);
  assert.ok(stadium.palette.concreteTriangles > 0 && stadium.palette.seatTriangles > 0 && stadium.palette.steelTriangles > 0);
  for (const surface of stadium.eventSurfaces) {
    assert.ok(surface.sampleCount > 0);
    assert.equal(surface.missingSamples, 0, `Painted apron ${surface.id} has unsupported gaps`);
    assert.ok(surface.heightRangeMeters <= .05,
      `Stadium apron ${surface.id} must be level, not draped over coarse DEM waves`);
  }
  assert.ok(stadium.frontWalls.triangles > 0, "Stadium front walls must have an independently checked concrete surface");
  assert.equal(stadium.frontWalls.darkTriangles, 0, "The lower terraces must not have a black facade");
  assert.ok(stadium.frontWalls.maximumHeightMeters <= reference.seatingSection.frontHeightMeters + .2,
    "The stadium front wall must not be stretched by a DEM height outlier");
  for (const overlay of stadium.paintOverlays) {
    assert.equal(overlay.intersections, 0);
    assert.ok(overlay.minimumClearanceMeters > 0, "Blue paint must remain above the green apron after compression");
  }
  for (const overlay of stadium.roadPaintOverlays) {
    assert.ok(overlay.sampleCount > 0);
    assert.equal(overlay.intersections, 0, "Stadium paint must not flicker through the asphalt after compression");
    assert.ok(overlay.minimumClearanceMeters > .005);
  }
  const delivered = metadata.layoutQuality.stadiumReference;
  assert.equal(delivered.sourceUrl, reference.sourceUrl);
  assert.equal(delivered.roof.trusses, reference.roof.trusses);
  assert.equal(delivered.roof.cantileverMeters, reference.roof.cantileverMeters);
  assert.equal(delivered.continuousCanopyOverWesternPassage, true);
  for (const bank of delivered.seatingBanks) {
    assert.equal(bank.lowerRows, reference.seatingSection.lowerRows);
    assert.equal(bank.upperRows, reference.seatingSection.upperRows);
  }
  for (const file of reference.sourceFiles) {
    assert.ok(metadata.sourceManifest.sources.some((source) => source.file === file), `Unpinned stadium reference: ${file}`);
  }
});

test("Mexico keeps the distinct race-start line and timing anchors at their source distances", async () => {
  const glb = await readFile(new URL("public/f1/tracks/3d/mexico.glb", root));
  const gltf = JSON.parse(glb.toString("utf8", 20, 20 + glb.readUInt32LE(12)));
  const nodes = new Map(gltf.nodes.map((node) => [node.name, node]));
  assert.equal(metadata.finishDistanceMeters, 0);
  assert.ok(Math.abs(metadata.raceStartDistanceMeters - 134.08266848090983) < .001);
  assert.ok(Math.abs(nodes.get("RaceStart").extras.distance_m - metadata.raceStartDistanceMeters) < .001);
  assert.equal(nodes.get("StartFinish").extras.distance_m, 0);
  for (const turn of model.data.turns) {
    const anchor = nodes.get(`Turn_${String(turn.number).padStart(2, "0")}`);
    assert.ok(Math.abs(anchor.extras.distance_m - turn.progress * metadata.lapLength.geometryMeters) < .01);
  }
  assert.ok(Math.abs(nodes.get("SpeedTrap").extras.distance_m -
    metadata.controlPointReference.speedTrapDistanceMeters) < .001);
  for (const [index, distance] of metadata.sectorBoundaryDistancesMeters.entries()) {
    assert.ok(Math.abs(nodes.get(`SectorBoundary_${String(index + 2).padStart(2, "0")}`).extras.distance_m - distance) < .001);
  }
});

test("Mexico embedded surface and facade textures retain visible detail after Blender export", async () => {
  const glb = await readFile(new URL("public/f1/tracks/3d/mexico.glb", root));
  const jsonLength = glb.readUInt32LE(12);
  const gltf = JSON.parse(glb.toString("utf8", 20, 20 + jsonLength));
  const binary = glb.subarray(28 + jsonLength);
  for (const name of ["Mexico_Physical_Surface_Detail", "Mexico_Facade_Glazing_Detail"]) {
    const image = gltf.images.find((candidate) => candidate.name === name);
    assert.ok(image, `Missing embedded ${name}`);
    const view = gltf.bufferViews[image.bufferView];
    const statistics = await sharp(binary.subarray(view.byteOffset, view.byteOffset + view.byteLength)).stats();
    assert.ok(statistics.channels.slice(0, 3).some((channel) => channel.max - channel.min > 5),
      `${name} was exported as a uniform texture`);
  }
});

test("Mexico exported asphalt and venue structures retain their sourced colors", async () => {
  const glb = await readFile(new URL("public/f1/tracks/3d/mexico.glb", root));
  const jsonLength = glb.readUInt32LE(12);
  const gltf = JSON.parse(glb.toString("utf8", 20, 20 + jsonLength));
  const binary = glb.subarray(28 + jsonLength);
  const asphalt = gltf.materials.find((material) => material.name === "Mexico_Asphalt");
  const srgbToLinear = (value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  for (const [index, value] of [.28, .29, .29].entries()) {
    assert.ok(Math.abs(asphalt.pbrMetallicRoughness.baseColorFactor[index] - srgbToLinear(value)) < .00001,
      "Asphalt must preserve its dark source color rather than the untinted detail image");
  }
  await MeshoptDecoder.ready;
  for (const name of ["Mexico_Buildings_Mesh", "Mexico_Grandstands_Mesh"]) {
    const mesh = gltf.meshes.find((candidate) => candidate.name === name);
    const primitive = mesh.primitives[0];
    const accessor = gltf.accessors[primitive.attributes.COLOR_0];
    assert.equal(accessor.componentType, 5126);
    const view = gltf.bufferViews[accessor.bufferView];
    const compression = view.extensions.EXT_meshopt_compression;
    const bytes = new Uint8Array(compression.count * compression.byteStride);
    MeshoptDecoder.decodeGltfBuffer(bytes, compression.count, compression.byteStride,
      binary.subarray(compression.byteOffset, compression.byteOffset + compression.byteLength),
      compression.mode, compression.filter);
    const colors = new DataView(bytes.buffer);
    const uniqueColors = new Set();
    for (let index = 0; index < accessor.count; index += 1) {
      const offset = (accessor.byteOffset ?? 0) + index *
        (view.byteStride ?? (accessor.type === "VEC4" ? 16 : 12));
      uniqueColors.add([0, 4, 8].map((channel) => colors.getFloat32(offset + channel, true).toFixed(2)).join(","));
    }
    assert.ok(uniqueColors.size >= 3, `${name} lost its individual sourced colors`);
  }
});

test("Mexico includes the current white baseball-stadium roof on its mapped footprint", async () => {
  assert.ok(metadata.layoutQuality.baseballStadiumRoof, "The current stadium roof needs explicit source metadata");
  assert.equal(metadata.layoutQuality.baseballStadiumRoof.osmWayId, 828705077);
  const glb = await readFile(new URL("public/f1/tracks/3d/mexico.glb", root));
  const jsonLength = glb.readUInt32LE(12);
  const gltf = JSON.parse(glb.toString("utf8", 20, 20 + jsonLength));
  const binary = glb.subarray(28 + jsonLength);
  const mesh = gltf.meshes.find((candidate) => candidate.name === "Mexico_Baseball_Stadium_Roof_Mesh");
  assert.ok(mesh, "The roof completed after the 2018 satellite image must be modeled separately");
  assert.ok(gltf.meshes.some((candidate) => candidate.name === "Mexico_Baseball_Stadium_Roof_Supports_Mesh"));
  await MeshoptDecoder.ready;
  function readAccessor(index) {
    const accessor = gltf.accessors[index];
    const view = gltf.bufferViews[accessor.bufferView];
    const compression = view.extensions.EXT_meshopt_compression;
    const bytes = new Uint8Array(compression.count * compression.byteStride);
    MeshoptDecoder.decodeGltfBuffer(bytes, compression.count, compression.byteStride,
      binary.subarray(compression.byteOffset, compression.byteOffset + compression.byteLength),
      compression.mode, compression.filter);
    const [size, reader] = { 5123: [2, "getUint16"], 5125: [4, "getUint32"], 5126: [4, "getFloat32"] }[accessor.componentType];
    const components = { SCALAR: 1, VEC3: 3, VEC4: 4 }[accessor.type];
    const data = new DataView(bytes.buffer);
    const stride = view.byteStride ?? components * size;
    return Array.from({ length: accessor.count }, (_, row) => Array.from({ length: components }, (_, column) =>
      data[reader]((accessor.byteOffset ?? 0) + row * stride + column * size, true)));
  }
  const footprint = metadata.layoutQuality.baseballStadiumRoof.footprint.map(([x, y]) =>
    [x - metadata.originMeters.x, metadata.originMeters.y - y]);
  const footprintArea = Math.abs(footprint.reduce((sum, [x, z], index) => {
    const next = footprint[(index + 1) % footprint.length];
    return sum + x * next[1] - next[0] * z;
  }, 0)) / 2;
  function insideFootprint([x, z]) {
    let inside = false;
    for (let index = 0, previous = footprint.length - 1; index < footprint.length; previous = index++) {
      const a = footprint[index], b = footprint[previous];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const along = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
      // Delivery positions are lossy Meshopt floats; allow five centimetres at an edge.
      if (Math.hypot(x - a[0] - along * dx, z - a[1] - along * dz) <= .05) return true;
      if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }
  let projectedRoofArea = 0;
  let roofVertices = 0;
  for (const primitive of mesh.primitives) {
    assert.ok(primitive.attributes.TEXCOORD_0 !== undefined);
    const material = gltf.materials[primitive.material];
    const texture = gltf.textures[material.pbrMetallicRoughness.baseColorTexture.index];
    const image = gltf.images[texture.source];
    assert.ok(image.bufferView !== undefined);
    assert.notEqual(image.name, "mexico-orthophoto", "The current white roof must not show the pre-construction aerial image");
    const accessor = gltf.accessors[primitive.attributes.COLOR_0];
    assert.ok(accessor, "The stadium roof must retain its independently sourced white vertex color");
    assert.equal(accessor.componentType, 5126);
    const colors = readAccessor(primitive.attributes.COLOR_0);
    assert.ok(colors.every((color) => color.slice(0, 3).every((channel) => channel > .6)),
      "Every reconstructed roof panel should retain its white source color");
    roofVertices += colors.length;
    const positions = readAccessor(primitive.attributes.POSITION);
    const indices = readAccessor(primitive.indices).flat();
    for (let index = 0; index < indices.length; index += 3) {
      const [a, b, c] = indices.slice(index, index + 3).map((vertex) => positions[vertex]);
      const area = ((b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2])) / 2;
      if (area <= .00001) continue;
      projectedRoofArea += area;
      const centroid = [(a[0] + b[0] + c[0]) / 3, (a[2] + b[2] + c[2]) / 3];
      assert.ok(insideFootprint(centroid),
        `The reconstructed roof must follow the mapped trident footprint: ${centroid}, area=${area}`);
    }
  }
  assert.ok(roofVertices >= 3, "The separately reconstructed roof should be white");
  assert.ok(Math.abs(projectedRoofArea - footprintArea) / footprintArea < .005,
    "The roof must cover the full mapped trident, including its stepped wings");
});

test("Mexico provenance preserves licenses, coordinates, checksums and the control-map year", async () => {
  const lock = JSON.parse(await readFile(new URL("docs/track-model-mexico-source-manifest.json", root), "utf8"));
  assert.deepEqual(metadata.sourceManifest.sources, lock.sources);
  assert.ok(lock.sources.length > 0);
  for (const source of lock.sources) {
    for (const field of ["file", "url", "role", "license", "attribution", "retrievedAt", "resolution"]) {
      assert.ok(source[field], `${source.file} lacks ${field}`);
    }
    assert.ok(Object.hasOwn(source, "crs"), `${source.file} must disclose whether it is georeferenced`);
    assert.ok(source.crs === null || (typeof source.crs === "string" && source.crs.length > 0));
    assert.ok(Object.hasOwn(source, "bbox"));
    assert.ok(source.bbox === null || (source.bbox.length === 4 && source.bbox.every(Number.isFinite)));
    if (source.bbox !== null) assert.ok(source.crs, `${source.file} needs a CRS for its geographic bounding box`);
    assert.ok(Object.hasOwn(source, "verticalDatum"));
    assert.match(source.sha256, /^[0-9a-f]{64}$/);
    assert.ok(source.bytes > 0);
  }
  assert.ok(Number.isInteger(metadata.controlPointReference.referenceYear));
  assert.equal(typeof metadata.controlPointReference.currentEventVerified, "boolean");
  if (metadata.controlPointReference.currentEventVerified) {
    assert.equal(metadata.controlPointReference.referenceYear, 2026);
  }
  assert.ok(metadata.limitations.length > 0);
  const smoothing = metadata.layoutQuality.roadGrading.smoothing;
  assert.equal(smoothing.method, "normalized Gaussian");
  assert.equal(smoothing.sigmaMeters, 90);
  assert.equal(smoothing.sourceResolutionMeters, 30);
  assert.equal(smoothing.sigmaNativeCells, 3);
  assert.equal(smoothing.heightScale, 1);
  assert.equal(smoothing.closedBoundary, "periodic");
  assert.ok(smoothing.supportRadiusMeters >= 269 && smoothing.supportRadiusMeters <= 272);
});

test("Mexico resolves in both languages and loads a separate versioned asset", async () => {
  for (const name of ["Autódromo Hermanos Rodríguez", "Autodromo Hermanos Rodriguez", "Hermanos Rodríguez", "rodriguez",
    "Mexico City Grand Prix", "Mexican Grand Prix", "Мехико", "Гран-при Мексики", "Гран-при Мехико"]) {
    assert.equal(getThreeDimensionalTrackModelId(name), "mexico");
  }
  const [lazy, registry] = await Promise.all([
    readFile(new URL("src/components/racemate/track-model-3d-lazy.tsx", root), "utf8"),
    readFile(new URL("src/data/track-models.ts", root), "utf8"),
  ]);
  assert.match(lazy, /import\("@\/data\/mexico-model"\)/);
  assert.doesNotMatch(registry, /from ["']@\/data\/.*-model["']/);
  for (const [field, file] of [["assetPath", "mexico.glb"], ["previewPath", "mexico-preview.webp"]]) {
    const data = await readFile(new URL(`public/f1/tracks/3d/${file}`, root));
    assert.equal(new URL(model.webgl[field], "https://raceside.test").searchParams.get("v"),
      createHash("sha256").update(data).digest("hex").slice(0, 12));
  }
});
