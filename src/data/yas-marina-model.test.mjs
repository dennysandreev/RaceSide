import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";

import { YAS_MARINA_TRACK_MODEL as model } from "./yas-marina-model.ts";
import { getThreeDimensionalTrackModelId } from "./track-models.ts";
import { validateTrackAsset } from "../../scripts/track-model-blender/validate-track.mjs";
import { auditYasMarinaSurfaces } from "../../scripts/track-model-blender/audit-yas-marina-surfaces.mjs";

const root = new URL("../../", import.meta.url);
const metadata = JSON.parse(await readFile(new URL("public/f1/tracks/3d/yas-marina-metadata.json", root), "utf8"));
const glb = await readFile(new URL("public/f1/tracks/3d/yas-marina.glb", root));
const jsonLength = glb.readUInt32LE(12);
const gltf = JSON.parse(glb.toString("utf8", 20, 20 + jsonLength));

test("Painted aprons follow observed current boundaries and sit on the delivered terrain", async () => {
  const audit = await auditYasMarinaSurfaces(glb,metadata);
  assert.deepEqual(audit.paintedSurfaces.missing,[]);
  assert.deepEqual(audit.paintedSurfaces.unwantedPaint,[]);
  assert.ok(audit.paintedSurfaces.maximumGroundGapMeters < .13);
});

test("North Grandstand exports a continuous blue seating bowl across both tiers", async () => {
  const audit = await auditYasMarinaSurfaces(glb,metadata);
  assert.equal(audit.northGrandstand.missingTerraces,0,JSON.stringify(audit.northGrandstand.failures));
  assert.equal(audit.northGrandstand.missingSeatRows,0,JSON.stringify(audit.northGrandstand.failures));
  assert.ok(metadata.layoutQuality.grandstands.rendered.some((stand) => stand.osmWayId === 1455866679));
});

test("Yas Marina uses the current closed 16-turn lap at native metre scale", () => {
  assert.equal(model.data.lapLengthKm, 5.281);
  assert.equal(metadata.coordinateReferenceSystem, "EPSG:32640");
  assert.equal(model.camera.verticalExaggeration, 1);
  assert.ok(metadata.lapLength.relativeErrorPercent < .5);
  const { points, turns } = model.data;
  assert.deepEqual(points.at(-1), [1, ...points[0].slice(1)]);
  assert.equal(points.length, 181);
  assert.ok(points.every((p, i) => p.every(Number.isFinite) && (i === 0 || p[0] > points[i-1][0])));
  assert.deepEqual(turns.map((t) => t.number), Array.from({ length: 16 }, (_, i) => i+1));
  assert.ok(turns.every((t, i) => t.progress > (turns[i-1]?.progress ?? 0) && t.progress < 1));
  for (const alias of [model.data.circuitName, ...model.aliases]) assert.equal(getThreeDimensionalTrackModelId(alias), "yas-marina");
});

test("Delivered Yas Marina road, tunnel, textures and budgets pass the decoded asset audit", async () => {
  const metrics = await validateTrackAsset({ modelId: "yas-marina",
    glbPath: new URL("public/f1/tracks/3d/yas-marina.glb", root),
    previewPath: new URL("public/f1/tracks/3d/yas-marina-preview.webp", root),
    metadataPath: new URL("public/f1/tracks/3d/yas-marina-metadata.json", root) });
  assert.deepEqual(metrics.decodedSurfaceAudit.structuralConflicts, {});
  assert.equal(metrics.decodedSurfaceAudit.textures.physicalPrimitives, metrics.decodedSurfaceAudit.textures.texturedPrimitives);
  assert.ok(metrics.decodedSurfaceAudit.undergroundPitTriangles > 100);
  assert.equal(metrics.decodedSurfaceAudit.tunnel.missingRoof,0);
  assert.ok(metrics.decodedSurfaceAudit.tunnel.minimumHeadroomMeters >= 4.5);
  assert.equal(metadata.layoutQuality.pitLane.undergroundSourceWayId, 176695255);
  assert.ok(metadata.layoutQuality.pitLane.coveredDistanceRangeMeters[0] > 630);
  assert.ok(metadata.layoutQuality.pitLane.coveredDistanceRangeMeters[1] < 730);
});

test("FIA reference anchors distinguish control line, race start, sectors and speed trap", () => {
  const nodes = new Map(gltf.nodes.map((node) => [node.name, node]));
  assert.equal(nodes.get("StartFinish").extras.distance_m, 0);
  assert.equal(nodes.get("RaceStart").extras.distance_m, 130);
  const length = metadata.lapLength.geometryMeters;
  assert.ok(Math.abs(model.data.turns[4].progress*length-metadata.sectorBoundaryDistancesMeters[0]-205) < .01);
  assert.ok(Math.abs(model.data.turns[8].progress*length-metadata.sectorBoundaryDistancesMeters[1]-100) < .01);
  assert.ok(Math.abs(model.data.turns[5].progress*length-nodes.get("SpeedTrap").extras.distance_m-150) < .01);
  for (const turn of model.data.turns) assert.ok(Math.abs(nodes.get(`Turn_${String(turn.number).padStart(2,"0")}`).extras.distance_m-turn.progress*length) < .01);
  assert.equal(metadata.objects.hotelWings, 2);
  assert.ok(metadata.layoutQuality.buildings.rendered.some((b) => b.osmWayId === 133907082));
});

test("Source lock uses current native georeferencing and discloses resolution and event limits", async () => {
  const lock = JSON.parse(await readFile(new URL("docs/track-model-yas-marina-source-manifest.json", root), "utf8"));
  assert.deepEqual(metadata.sourceManifest.sources, lock.sources);
  for (const source of lock.sources) {
    assert.ok(source.url && source.license && source.role && source.crs && source.acquisitionDate);
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
    assert.ok(source.bytes > 0);
  }
  assert.equal(metadata.controlPointReference.currentEventVerified, false);
  assert.ok(metadata.limitations.some((s) => /4 October 2026.*10 m/.test(s)));
  assert.ok(!lock.sources.some((s) => /skysat-2018/.test(s.file)));
  const raster = metadata.layoutQuality.sourceRasterAudit;
  assert.equal(raster.acquisitionDate, "2026-10-04");
  assert.equal(raster.coordinateReferenceSystem, metadata.coordinateReferenceSystem);
  assert.deepEqual(raster.nativeResolutionMeters, [10, 10]);
  assert.deepEqual(raster.manualTranslationMeters, [0, 0]);
  assert.equal(raster.historicalImageEmbedded, false);
  assert.equal(raster.peripheralEdgePaddingPixels, 0);
  const water = raster.waterRestoration;
  assert.equal(water.historicalGeographyEmbedded, false);
  assert.equal(water.protectedRoadBuildingsPiersMaximumAlpha, 0);
  assert.ok(water.coveragePercent > 10 && water.coveragePercent < 60);
  assert.equal(water.featherMeters, 1.4);
  assert.ok(water.coastlineWayIds.includes(188215354));
  const waterSource = lock.sources.find((s) => s.file === "water-albedo.png");
  assert.equal(waterSource.downloadMethod, "project-file");
  assert.equal(createHash("sha256").update(await readFile(new URL(waterSource.projectPath, root))).digest("hex"), waterSource.sha256);
  assert.deepEqual(raster.outputBounds, {minX:256530,minY:2707520,maxX:257930,maxY:2709435});
  assert.ok(metadata.limitations.some((s) => /not surveyed/.test(s)));
  assert.match(gltf.asset.copyright, /Copernicus Sentinel data \(2026\)/);
  assert.match(gltf.asset.copyright, /CC BY-SA 4\.0/);
});

test("Every embedded image retains texture detail and asset cache revisions match delivery", async () => {
  const binary = glb.subarray(jsonLength+28);
  for (const image of gltf.images) {
    const view = gltf.bufferViews[image.bufferView];
    assert.ok(view);
    const pixels = sharp(binary.subarray(view.byteOffset,view.byteOffset+view.byteLength));
    const dimensions = await pixels.metadata();
    assert.ok(dimensions.width >= 64 && dimensions.height >= 64);
    const stats = await pixels.stats();
    assert.ok(stats.channels.some((c) => c.stdev > 1), `${image.name} requires visible image detail`);
  }
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex").slice(0,12);
  assert.equal(new URL(model.webgl.assetPath,"https://raceside.test").searchParams.get("v"),hash(glb));
  assert.equal(new URL(model.webgl.previewPath,"https://raceside.test").searchParams.get("v"),
    hash(await readFile(new URL("public/f1/tracks/3d/yas-marina-preview.webp",root))));
});

test("Delivered water is teal across the marina and open channel", async () => {
  const ground = gltf.materials.find((m) => m.name === "YasMarina_Copernicus_2026_Georeferenced_Ground");
  const texture = gltf.textures[ground.pbrMetallicRoughness.baseColorTexture.index];
  const view = gltf.bufferViews[gltf.images[texture.source].bufferView];
  const binary = glb.subarray(jsonLength+28);
  const { data, info } = await sharp(binary.subarray(view.byteOffset,view.byteOffset+view.byteLength)).removeAlpha().raw().toBuffer({resolveWithObject:true});
  for (const [u,v] of [[.015,.25],[.9,.65],[.71,.79],[.7,.66]]) {
    const offset = (Math.round(v*info.height)*info.width+Math.round(u*info.width))*info.channels;
    const [red,green,blue] = data.subarray(offset,offset+3);
    assert.ok(green > 75 && blue > 80 && red < green*.65, `Expected teal water at ${u},${v}`);
  }
});

test("The marina hotel retains its dry quay at turns 13–14", async () => {
  const ground = gltf.materials.find((m) => m.name === "YasMarina_Copernicus_2026_Georeferenced_Ground");
  const texture = gltf.textures[ground.pbrMetallicRoughness.baseColorTexture.index];
  const view = gltf.bufferViews[gltf.images[texture.source].bufferView];
  const binary = glb.subarray(jsonLength+28);
  const { data, info } = await sharp(binary.subarray(view.byteOffset,view.byteOffset+view.byteLength)).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const at = (x,y) => {
    const column = Math.round((x-256530)/1400*info.width);
    const row = Math.round((2709435-y)/1915*info.height);
    const offset = (row*info.width+column)*info.channels;
    return [...data.subarray(offset,offset+3)];
  };
  // A pale quay is present in the native 2026 source outside the OSM building
  // footprint; the coarse OSM coast chord had incorrectly painted it as water.
  const land = at(257455,2708075);
  assert.ok(land.every((channel) => channel > 190), `Hotel quay must remain dry: ${land}`);
  const [red,green,blue] = at(257490,2708075);
  assert.ok(green > 75 && blue > 80 && red < green*.65, "The adjacent marina must remain water");
});
