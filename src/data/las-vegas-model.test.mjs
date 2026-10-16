import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { LAS_VEGAS_TRACK_MODEL as model } from "./las-vegas-model.ts";
import { getThreeDimensionalTrackModelId } from "./track-models.ts";
import { validateTrackAsset } from "../../scripts/track-model-blender/validate-track.mjs";

const root = new URL("../../", import.meta.url);
const asset = (name) => new URL(`public/f1/tracks/3d/las-vegas${name}`, root);
const metadata = JSON.parse(await readFile(asset("-metadata.json"), "utf8"));

test("Las Vegas compressed delivery has supported surfaces, textures and clear driving corridors", async () => {
  const metrics = await validateTrackAsset({ modelId: "las-vegas", glbPath: asset(".glb"),
    previewPath: asset("-preview.webp"), metadataPath: asset("-metadata.json") });
  const audit = metrics.decodedSurfaceAudit;
  assert.deepEqual(audit.structuralConflicts, {});
  assert.equal(audit.road.intersections, 0);
  assert.equal(audit.paint.intersections, 0);
  assert.equal(Object.keys(audit.ribbonTopology).length, 4);
  for (const [name, topology] of Object.entries(audit.ribbonTopology)) {
    assert.equal(topology.degenerate, 0, `${name} contains a collapsed apex`);
    assert.equal(topology.adjacentWindingFlips, 0, `${name} folds across itself`);
  }
  assert.equal(audit.textures.physicalPrimitives, audit.textures.texturedPrimitives);
  assert.equal(audit.textures.collapsedKerbUvTriangles,0);
  assert.ok(audit.facadeTileScaleMeters.horizontal.samples > 100);
  assert.ok(Math.abs(audit.facadeTileScaleMeters.horizontal.median - 12.8) < .01);
  assert.ok(audit.facadeTileScaleMeters.vertical.minimum > 6.35 && audit.facadeTileScaleMeters.vertical.maximum < 6.45);
});

test("Las Vegas keeps the FIA lap and timing references on the rounded native-metre line", () => {
  const { points, turns, sectorBreaks, speedTrapProgress } = model.data;
  const length = metadata.lapLength.geometryMeters;
  assert.deepEqual(points.at(-1), [1, ...points[0].slice(1)]);
  assert.deepEqual(turns.map(({ number }) => number), Array.from({ length: 17 }, (_, i) => i + 1));
  assert.ok(turns.every((turn, i) => turn.progress > (turns[i - 1]?.progress ?? 0)));
  assert.ok(Math.abs((sectorBreaks[0] - turns[4].progress) * length - 90) < .01);
  assert.ok(Math.abs((sectorBreaks[1] - turns[11].progress) * length - 140) < .01);
  assert.ok(Math.abs((turns[13].progress - speedTrapProgress) * length - 140) < .01);
  assert.equal(model.data.lapLengthKm, 6.201);
  assert.ok(metadata.lapLength.relativeErrorPercent < .5);
  assert.equal(model.camera.verticalExaggeration, 1);
  assert.ok(model.webgl.camera.narrowFitWidth / 1.25 >= metadata.boundsMeters.width);
  // The opening straight travels northeast; inversion must not be hidden by camera rotation.
  assert.ok(points[3][1] > points[0][1] && points[3][2] > points[0][2]);
});

test("Las Vegas corner rounding remains local and preserves surveyed finish and source references", () => {
  const audit=metadata.layoutQuality.cornerGeometry;
  assert.ok(audit.maximumCorrespondingPointShiftMeters<6);
  assert.ok(audit.sourceLengthMeters>6200 && audit.sourceLengthMeters<6210);
  assert.equal(audit.renderLengthMeters,metadata.lapLength.geometryMeters);
  assert.ok(Math.abs(model.data.points[0][1]+metadata.originMeters.x-audit.sourceCenterline[0][0])<.0001);
  assert.ok(Math.abs(model.data.points[0][2]+metadata.originMeters.y-audit.sourceCenterline[0][1])<.0001);
  assert.equal(audit.turnReferenceDistancesMeters.length,17);
  assert.ok(audit.pit.endpointProjectionShiftsMeters.every(value=>value<.25));
});

test("Las Vegas pit pavilion, landmarks and 2026 stand groups keep traceable footprints", () => {
  const pit = metadata.layoutQuality.pitLane;
  assert.equal(pit.entryGapMeters, 0);
  assert.equal(pit.exitGapMeters, 0);
  assert.equal(pit.pitGarageBoxes, 43);
  assert.ok(pit.wall.lengthMeters > 300);
  assert.ok(metadata.layoutQuality.buildings.rendered.some((b) => b.osmWayId === 1198427833));
  assert.equal(metadata.objects.sphere.osmWayId, 976405284);
  assert.equal(metadata.objects.sphere.diameterMeters, 157.2768);
  assert.equal(metadata.objects.sphere.displayArtwork, "official-f1-logo");
  assert.ok(metadata.layoutQuality.grandstands.rendered.every((stand) => stand.frontFacesTrack && stand.guardrailRuns > 0 && stand.aislesPerBlock > 0));
  assert.ok(metadata.layoutQuality.buildings.rendered.some((building) => building.osmRelationId === 5342155 && building.heightMeters === 183));
  assert.ok(metadata.layoutQuality.buildings.rendered.some((building) => building.osmWayId === 1468774558 && building.heightMeters === 201.168));
  assert.ok(metadata.layoutQuality.buildings.courtyardRings > 0);
  assert.ok(metadata.layoutQuality.buildings.boundaryClippedBuildings > 0);
  assert.equal(metadata.objects.highRoller.gondolas, 28);
  assert.ok(metadata.objects.grandstandFootprints >= 25);
  assert.equal(metadata.layoutQuality.buildings.sourceToRenderCentroidDriftMeters, 0);
});

test("Las Vegas source lock and reconstruction limits remain explicit", async () => {
  const lock = JSON.parse(await readFile(new URL("docs/track-model-las-vegas-source-manifest.json", root), "utf8"));
  assert.deepEqual(metadata.sourceManifest.sources, lock.sources);
  assert.equal(lock.sources.length, 19);
  assert.ok(lock.sources.some((source) => source.file === "f1-logo-official.svg"));
  for (const source of lock.sources) {
    for (const key of ["file", "url", "role", "license", "attribution", "retrievedAt", "resolution", "crs"]) assert.ok(source[key], `${source.file}: ${key}`);
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
    assert.ok(source.bytes > 0);
  }
  assert.equal(metadata.controlPointReference.referenceYear, 2025);
  assert.equal(metadata.controlPointReference.currentEventVerified, false);
  assert.match(metadata.limitations.join(" "), /2022.*2026.*6.2 m estimate/s);
  assert.equal(model.webgl.elevationApproximate, true);
});

test("Las Vegas replaces its ordinary map through a separate lazy module and versioned assets", async () => {
  for (const name of model.aliases) assert.equal(getThreeDimensionalTrackModelId(name), "las-vegas");
  assert.equal(getThreeDimensionalTrackModelId("Las Vegas Strip Circuit"), "las-vegas");
  const lazy = await readFile(new URL("src/components/racemate/track-model-3d-lazy.tsx", root), "utf8");
  assert.match(lazy, /import\("@\/data\/las-vegas-model"\)/);
  for (const [suffix, url] of [[".glb", model.webgl.assetPath], ["-preview.webp", model.webgl.previewPath]]) {
    const bytes = await readFile(asset(suffix));
    assert.equal(new URL(url, "https://raceside.test").searchParams.get("v"), createHash("sha256").update(bytes).digest("hex").slice(0, 12));
  }
});

test("Las Vegas delivers emissive night lighting with visible windows and a lit F1 Sphere", async () => {
  const bytes=await readFile(asset('.glb'));
  const gltf=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
  const materials=new Map(gltf.materials.map(material=>[material.name,material]));
  for(const name of ['LasVegas_Textured_Facades','LasVegas_NAIP_2022_Orthophoto','LasVegas_F1_LED_Exosphere']) {
    const material=materials.get(name);
    assert.ok(material.emissiveFactor.some(value=>value>0),`${name} must emit`);
    const image=gltf.images[gltf.textures[material.emissiveTexture.index].source];
    assert.ok(Number.isInteger(image.bufferView),`${name} emission must be embedded`);
  }
  assert.equal(metadata.lighting.timeOfDay,'night');
  assert.deepEqual(materials.get('LasVegas_Textured_Facades').emissiveTexture.extensions.KHR_texture_transform.scale,[.25,.25]);
  assert.equal(metadata.lighting.floodlightEmitters,metadata.objects.lightingMasts);
  assert.ok(gltf.meshes.some(mesh=>mesh.name==='LasVegas_Floodlight_Emitters_Mesh'));
});
