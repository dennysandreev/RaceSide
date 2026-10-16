import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "../..");

const LIMITS = {
  bytes: 6_500_000,
  drawCalls: 32,
  materials: 24,
  triangles: 300_000,
};

export async function validateTrackAsset({
  glbPath,
  metadataPath,
  modelId = "zandvoort",
  previewPath,
  sourceDirectory,
}) {
  const [glbBuffer, glbStats, metadata, previewStats] = await Promise.all([
    readFile(glbPath),
    stat(glbPath),
    readFile(metadataPath, "utf8").then(JSON.parse),
    stat(previewPath),
  ]);
  const gltf = parseGlbJson(glbBuffer);
  const metrics = inspectGltf(gltf, glbStats.size, previewStats.size);
  const failures = [];

  if (modelId === "yas-marina") {
    const { auditYasMarinaSurfaces } = await import("./audit-yas-marina-surfaces.mjs");
    const audit = metrics.decodedSurfaceAudit = await auditYasMarinaSurfaces(glbBuffer, metadata);
    for (const layer of ["road", "paint", "runoff"]) {
      if (!audit[layer].triangles || audit[layer].intersections || audit[layer].missingSupport) failures.push(`Yas Marina ${layer} fails decoded surface clearance`);
    }
    if (Object.keys(audit.structuralConflicts).length) failures.push("Yas Marina structures intersect driving corridors");
    if (!(audit.road.maximumGradePercent < 16)) failures.push("Yas Marina reconstructed pit ramp exceeds the 16% grade limit");
    if (!(audit.undergroundPitTriangles > 100)) failures.push("Yas Marina mapped pit-exit tunnel is missing");
    if (!audit.tunnel.samples || audit.tunnel.missingRoof || !(audit.tunnel.minimumHeadroomMeters >= 4.5)) failures.push("Yas Marina pit-exit tunnel roof/headroom is incomplete");
    if (!audit.textures.physicalPrimitives || audit.textures.missingTextures.length || audit.textures.invalidUvs.length) failures.push("Every Yas Marina physical primitive requires an embedded texture and valid UVs");
    if (!(audit.aerialProjection.maximumErrorMeters < .15)) failures.push("Yas Marina aerial texture projection is misaligned");
    if (!(audit.bridgeSamples > 0 && audit.minimumBridgeClearanceMeters >= 4.5)) failures.push("Yas Marina W Hotel link bridge has insufficient clearance");
    for (const name of [...Array.from({ length: 16 }, (_, i) => `Turn_${String(i + 1).padStart(2, "0")}`),
      "RaceStart", "StartFinish", "SpeedTrap", "SectorBoundary_02", "SectorBoundary_03", "HighPoint", "LowPoint"]) {
      if (!(gltf.nodes ?? []).some((node) => node.name === name)) failures.push(`Missing Yas Marina anchor: ${name}`);
    }
    if (!metrics.extensionsRequired.includes("EXT_meshopt_compression")) failures.push("Yas Marina requires Meshopt compression");
    for (const [name, mode] of Object.entries(metrics.materialAlphaModes)) {
      if (!/Glow|Fence/.test(name) && mode !== "OPAQUE") failures.push(`${name} must be opaque`);
    }
    if (metadata.coordinateReferenceSystem !== "EPSG:32640" || metadata.verticalExaggeration !== 1 || !/EGM2008/.test(metadata.verticalDatum)) failures.push("Yas Marina must retain native UTM 40N metres and EGM2008 without vertical exaggeration");
    if (metadata.lapLength?.officialFiaMeters !== 5281 || !(metadata.lapLength.relativeErrorPercent < .5)) failures.push("Yas Marina length must match FIA 5281 m within 0.5%");
    if (metadata.objects?.turnAnchors !== 16 || metadata.objects.pitGarageBoxes !== 40 || !(metadata.objects.grandstandFootprints >= 20) || metadata.objects.hotelWings !== 2) failures.push("Yas Marina turn, pit, hotel or grandstand geometry is incomplete");
    const quality = metadata.layoutQuality;
    if (quality?.surfaceClearance?.terrainBreakthroughSamples !== 0 || quality?.pitLane?.surfaceClearance?.terrainBreakthroughSamples !== 0 || !(quality?.pitLane?.entryGapMeters <= .05) || !(quality?.pitLane?.exitGapMeters <= .05) || !(quality?.pitLane?.wall?.lengthMeters > 300)) failures.push("Yas Marina road/pit clearance, joins or physical pit wall are incomplete");
    if (!quality?.buildings?.rendered.some((item) => item.osmWayId === 133907082)) failures.push("Yas Marina main pit building is missing");
    if (metadata.controlPointReference?.referenceYear !== 2025 || metadata.controlPointReference.currentEventVerified !== false || !metadata.limitations?.length || metadata.materials?.physicalObjectsTextured !== true) failures.push("Yas Marina must disclose source dates, reconstruction limits and textured physical objects");
    const lock = JSON.parse(await readFile(path.join(projectRoot, "docs/track-model-yas-marina-source-manifest.json"), "utf8"));
    if (JSON.stringify(lock.sources) !== JSON.stringify(metadata.sourceManifest?.sources)) failures.push("Yas Marina source lock differs from delivery");
    if (sourceDirectory) await validateSourceFiles(sourceDirectory, metadata.sourceManifest, failures);
  }

  if (modelId === "qatar") {
    const { auditQatarSurfaces } = await import("./audit-qatar-surfaces.mjs");
    const audit = metrics.decodedSurfaceAudit = await auditQatarSurfaces(glbBuffer);
    for (const layer of ["road", "apron", "paint"]) {
      if (!audit[layer].triangles || audit[layer].intersections || audit[layer].missingSupport) failures.push(`Qatar ${layer} fails decoded surface clearance`);
    }
    if (Object.keys(audit.structuralConflicts).length) failures.push("Qatar structures intersect driving corridors");
    if (!(audit.road.maximumGradePercent < 6)) failures.push("Qatar road grades exceed the low-relief terrain limit");
    for (const [name, topology] of Object.entries(audit.ribbonTopology)) {
      if (topology.degenerate || topology.adjacentWindingFlips || (/Raceway|Pit_Lane/.test(name) && topology.negative)) failures.push(`${name} has folded or collapsed ribbon triangles`);
    }
    if (!audit.textures.physicalPrimitives || audit.textures.missingTextures.length || audit.textures.invalidUvs.length) failures.push("Every Qatar physical primitive requires embedded textures and valid UVs");
    if (!(audit.aerialProjection.samples > 1000) || !(audit.aerialProjection.maximumErrorMeters < .1)) failures.push("Qatar ground image is not geographically UV-aligned");
    const names = new Set((gltf.nodes ?? []).map((node) => node.name));
    for (const name of [...Array.from({ length: 16 }, (_, i) => `Turn_${String(i + 1).padStart(2, "0")}`),
      "RaceStart", "StartFinish", "SpeedTrap", "SectorBoundary_02", "SectorBoundary_03", "HighPoint", "LowPoint"]) {
      if (!names.has(name)) failures.push(`Missing Qatar anchor: ${name}`);
    }
    if (!metrics.extensionsRequired.includes("EXT_meshopt_compression")) failures.push("Qatar requires Meshopt compression");
    for (const [name, mode] of Object.entries(metrics.materialAlphaModes)) {
      if (!/Glow|Fence/.test(name) && mode !== "OPAQUE") failures.push(`${name} must be opaque`);
    }
    if (metadata.coordinateReferenceSystem !== "EPSG:32639" || metadata.verticalExaggeration !== 1 || !/EGM2008/.test(metadata.verticalDatum)) failures.push("Qatar must retain metric UTM 39N and EGM2008 without vertical exaggeration");
    if (metadata.lapLength?.officialFiaMeters !== 5419 || !(metadata.lapLength.relativeErrorPercent < .5)) failures.push("Qatar length must match FIA 5419 m within 0.5%");
    if (metadata.objects?.turnAnchors !== 16 || metadata.objects.pitGarageBoxes !== 50 || metadata.objects.grandstandFootprints !== 6 || metadata.objects.permanentTeamHospitality !== 4) failures.push("Qatar pit and spectator infrastructure is incomplete");
    const quality = metadata.layoutQuality;
    if (quality?.surfaceClearance?.terrainBreakthroughSamples !== 0 || quality?.pitLane?.surfaceClearance?.terrainBreakthroughSamples !== 0 || !(quality?.pitLane?.entryGapMeters <= .05) || !(quality?.pitLane?.exitGapMeters <= .05) || !(quality?.pitLane?.wall?.lengthMeters > 400)) failures.push("Qatar pit joins, road clearance or physical pit wall are incomplete");
    if (!quality?.buildings?.rendered.some((item) => item.osmWayId === 152483597)) failures.push("Qatar's post-2023 pit building is missing");
    if (metadata.controlPointReference?.referenceYear !== 2025 || metadata.controlPointReference.currentEventVerified !== false || !metadata.limitations?.length || metadata.materials?.physicalObjectsTextured !== true) failures.push("Qatar source dates, estimates and texture coverage must be explicit");
    const lock = JSON.parse(await readFile(path.join(projectRoot, "docs/track-model-qatar-source-manifest.json"), "utf8"));
    if (JSON.stringify(lock.sources) !== JSON.stringify(metadata.sourceManifest?.sources)) failures.push("Qatar source lock differs from delivery");
    if (sourceDirectory) for (const source of lock.sources) {
      const bytes = await readFile(path.join(sourceDirectory, source.file));
      if (bytes.length !== source.bytes || createHash("sha256").update(bytes).digest("hex") !== source.sha256) failures.push(`Qatar source checksum mismatch: ${source.file}`);
    }
  }

  if (modelId === "las-vegas") {
    const { auditLasVegasSurfaces } = await import("./audit-las-vegas-surfaces.mjs");
    const audit = metrics.decodedSurfaceAudit = await auditLasVegasSurfaces(glbBuffer);
    for (const layer of ["road", "paint"]) {
      if (!audit[layer].triangles || audit[layer].intersections || audit[layer].missingSupport) failures.push(`Las Vegas ${layer} fails decoded surface clearance`);
    }
    if (Object.keys(audit.structuralConflicts).length) failures.push("Las Vegas structures intersect driving corridors");
    if (!(audit.road.maximumGradePercent < 6)) failures.push("Las Vegas road grades exceed the low-relief terrain limit");
    for (const [name, topology] of Object.entries(audit.ribbonTopology)) {
      if (topology.degenerate || topology.adjacentWindingFlips || (/Raceway|Pit_Lane/.test(name) && topology.negative)) failures.push(`${name} has folded or collapsed ribbon triangles`);
    }
    if (!audit.textures.physicalPrimitives || audit.textures.missingTextures.length || audit.textures.invalidUvs.length) failures.push("Every Las Vegas physical primitive requires an embedded texture and valid UVs");
    if (audit.textures.collapsedKerbUvTriangles) failures.push("Las Vegas casino kerb artwork has collapsed UV triangles");
    for (const name of [...Array.from({ length: 17 }, (_, i) => `Turn_${String(i + 1).padStart(2, "0")}`),
      "RaceStart", "StartFinish", "SpeedTrap", "SectorBoundary_02", "SectorBoundary_03", "HighPoint", "LowPoint"]) {
      if (!(gltf.nodes ?? []).some((node) => node.name === name)) failures.push(`Missing Las Vegas anchor: ${name}`);
    }
    if (!metrics.extensionsRequired.includes("EXT_meshopt_compression")) failures.push("Las Vegas requires Meshopt compression");
    for (const [name, mode] of Object.entries(metrics.materialAlphaModes)) {
      if (!/Glow|Fence/.test(name) && mode !== "OPAQUE") failures.push(`${name} must be opaque`);
    }
    if (metadata.coordinateReferenceSystem !== "EPSG:32611" || metadata.verticalExaggeration !== 1 || !/NAVD88/.test(metadata.verticalDatum)) failures.push("Las Vegas must retain native UTM 11N metres and NAVD88 without vertical exaggeration");
    if (metadata.lapLength?.officialFiaMeters !== 6201 || !(metadata.lapLength.relativeErrorPercent < .5)) failures.push("Las Vegas length must match FIA 6201 m within 0.5%");
    if (metadata.objects?.turnAnchors !== 17 || metadata.objects.pitGarageBoxes !== 43 || !(metadata.objects.grandstandFootprints >= 25)) failures.push("Las Vegas turn, pit and event grandstand geometry is incomplete");
    const quality = metadata.layoutQuality;
    if (quality?.surfaceClearance?.terrainBreakthroughSamples !== 0 || quality?.pitLane?.surfaceClearance?.terrainBreakthroughSamples !== 0 || !(quality?.pitLane?.entryGapMeters <= .05) || !(quality?.pitLane?.exitGapMeters <= .05) || !(quality?.pitLane?.wall?.lengthMeters > 300)) failures.push("Las Vegas road/pit clearance, joins or physical pit wall are incomplete");
    if (!quality?.buildings?.rendered.some((item) => item.osmWayId === 1198427833)) failures.push("Las Vegas permanent pit pavilion is missing");
    if (!metadata.objects?.sphere || !metadata.objects?.eiffelTower || !metadata.objects?.highRoller) failures.push("Las Vegas mapped landmarks are missing");
    if (metadata.controlPointReference?.referenceYear !== 2025 || metadata.controlPointReference.currentEventVerified !== false || !metadata.limitations?.length || metadata.materials?.physicalObjectsTextured !== true) failures.push("Las Vegas must disclose source dates, reconstruction limits and textured physical objects");
    const lock = JSON.parse(await readFile(path.join(projectRoot, "docs/track-model-las-vegas-source-manifest.json"), "utf8"));
    if (JSON.stringify(lock.sources) !== JSON.stringify(metadata.sourceManifest?.sources)) failures.push("Las Vegas source lock differs from delivery");
    if (sourceDirectory) for (const source of lock.sources) {
      const bytes = await readFile(path.join(sourceDirectory, source.file));
      if (createHash("sha256").update(bytes).digest("hex") !== source.sha256) failures.push(`Las Vegas source checksum mismatch: ${source.file}`);
    }
  }

  if (modelId === "albert-park") {
    const { auditAlbertParkSurfaces } = await import("./audit-albert-park-surfaces.mjs");
    const audit = metrics.decodedSurfaceAudit = await auditAlbertParkSurfaces(glbBuffer);
    for (const layer of ["road", "paint"]) {
      if (!audit[layer].triangles || audit[layer].intersections || audit[layer].missingSupport) failures.push(`Albert Park ${layer} fails decoded surface clearance`);
    }
    if (Object.keys(audit.structuralConflicts).length) failures.push("Albert Park structures intersect driving corridors");
    if (!(audit.road.maximumGradePercent < 6)) failures.push("Albert Park road grade exceeds the low-relief terrain limit");
    if (!audit.textures.physicalPrimitives || audit.textures.missingTextures.length || audit.textures.invalidUvs.length) failures.push("Every Albert Park physical primitive requires an embedded texture and valid UVs");
    if (audit.bridgeSamples && !(audit.minimumBridgeClearanceMeters >= 4.5)) failures.push("Albert Park pedestrian bridge clearance is invalid");
    if (!(audit.reviewedMainStraight.samples > 100) || !(audit.reviewedMainStraight.maximumRoadEdgeDeviationMeters <= 6.4)) failures.push("Albert Park pit exit introduces a jog in the main straight");
    if (!(audit.reviewedPitExit.samples > 100) || !(audit.reviewedPitExit.maximumOppositeEdgeDeviationMeters <= 6.4)) failures.push("Albert Park pit exit crosses the opposite edge of the main straight");
    if (!(audit.reviewedPitFrontage.samples > 100) || audit.reviewedPitFrontage.mainRoadOverlapSamples) failures.push("Albert Park pit frontage overlaps the main racing surface");
    if (!(audit.reviewedRoadJoins.samples > 100) || !(audit.reviewedRoadJoins.maximumHeightDifferenceMeters <= .15)) failures.push("Albert Park pit junctions have incompatible road elevations");
    for (const number of [11, 12, 13, 14]) {
      const corner = audit.reviewedSouthernTurns[number];
      if (!(corner.samples >= 9) || corner.missingCrossSections || !(corner.maximumAxisDeviationMeters <= 2.4)) failures.push(`Albert Park T${number} deviates from reviewed native southern controls`);
    }
    if (!(audit.reviewedTurn14Exit.samples > 100) || !(audit.reviewedTurn14Exit.maximumRoadEdgeDeviationMeters <= 6.4)) failures.push("Albert Park T14 has an extra bend before the native main straight");
    const names = new Set((gltf.nodes ?? []).map((node) => node.name));
    for (const name of [...Array.from({ length: 14 }, (_, i) => `Turn_${String(i + 1).padStart(2, "0")}`),
      "RaceStart", "StartFinish", "SpeedTrap", "SectorBoundary_02", "SectorBoundary_03", "HighPoint", "LowPoint"]) {
      if (!names.has(name)) failures.push(`Missing Albert Park anchor: ${name}`);
    }
    if (!metrics.extensionsRequired.includes("EXT_meshopt_compression")) failures.push("Albert Park requires Meshopt compression");
    for (const [name, mode] of Object.entries(metrics.materialAlphaModes)) {
      if (!/Glow|Fence/.test(name) && mode !== "OPAQUE") failures.push(`${name} must be opaque`);
    }
    if (metadata.coordinateReferenceSystem !== "EPSG:7855" || metadata.verticalExaggeration !== 1) failures.push("Albert Park must retain native GDA2020/MGA55 metres");
    if (metadata.lapLength?.officialFiaMeters !== 5278 || !(metadata.lapLength.relativeErrorPercent < .5)) failures.push("Albert Park length must match FIA 5278 m within 0.5%");
    if (metadata.controlPointReference?.referenceYear !== 2026 || metadata.objects?.turnAnchors !== 14 || metadata.objects.pitGarageBoxes !== 45 || !(metadata.objects.grandstandFootprints >= 17)) failures.push("Albert Park sporting controls and mapped event infrastructure are incomplete");
    const quality = metadata.layoutQuality;
    if (quality?.surfaceClearance?.terrainBreakthroughSamples !== 0 || quality?.pitLane?.surfaceClearance?.terrainBreakthroughSamples !== 0 || !(quality?.pitLane?.entryGapMeters <= .05) || !(quality?.pitLane?.exitGapMeters <= .05) || !(quality?.pitLane?.wall?.lengthMeters > 200)) failures.push("Albert Park road/pit clearance, joins or physical pit wall are incomplete");
    if (!metadata.limitations?.length || metadata.materials?.physicalObjectsTextured !== true || !/CC BY-SA 4.0/.test(gltf.asset?.copyright ?? "")) failures.push("Albert Park texture license and reconstruction limits must be explicit");
    const lock = JSON.parse(await readFile(path.join(projectRoot, "docs/track-model-albert-park-source-manifest.json"), "utf8"));
    if (JSON.stringify(lock.sources) !== JSON.stringify(metadata.sourceManifest?.sources)) failures.push("Albert Park source lock differs from delivery");
    // Authored registration/event reference files live in docs rather than cache.
    if (sourceDirectory) for (const source of lock.sources) {
      const sourcePath = source.file.startsWith("docs/") ? path.join(projectRoot, source.file) : path.join(sourceDirectory, source.file);
      const bytes = await readFile(sourcePath);
      if (createHash("sha256").update(bytes).digest("hex") !== source.sha256) failures.push(`Albert Park source checksum mismatch: ${source.file}`);
    }
  }

  if (modelId === "shanghai") {
    const { auditShanghaiSurfaces } = await import("./audit-shanghai-surfaces.mjs");
    const audit = metrics.decodedSurfaceAudit = await auditShanghaiSurfaces(glbBuffer);
    for (const layer of ["road", "paint"]) {
      if (!audit[layer].triangles || audit[layer].intersections || audit[layer].missingSupport) failures.push(`Shanghai ${layer} fails decoded surface clearance`);
    }
    if (Object.keys(audit.structuralConflicts).length) failures.push("Shanghai structures intersect driving corridors");
    if (!(audit.road.maximumGradePercent < 6) || !(audit.minimumBridgeClearanceMeters >= 4.5) || !audit.bridgeSamples) failures.push("Shanghai road gradients or media-bridge clearance are invalid");
    if (!audit.textures.physicalPrimitives || audit.textures.missingTextures.length || audit.textures.invalidUvs.length) failures.push("Every Shanghai physical mesh requires embedded textures and valid UVs");
    if (audit.aerialProjection.meshes.length !== 4 || !(audit.aerialProjection.maximumErrorMeters < .1)) failures.push("Shanghai satellite UV projection differs from native-metre geometry");
    const names = new Set((gltf.nodes ?? []).map((node) => node.name));
    for (const name of [...Array.from({ length: 16 }, (_, i) => `Turn_${String(i + 1).padStart(2, "0")}`),
      "RaceStart", "StartFinish", "SpeedTrap", "SectorBoundary_02", "SectorBoundary_03", "HighPoint", "LowPoint"]) {
      if (!names.has(name)) failures.push(`Missing Shanghai anchor: ${name}`);
    }
    if (!metrics.extensionsRequired.includes("EXT_meshopt_compression")) failures.push("Shanghai requires Meshopt compression");
    for (const [name, mode] of Object.entries(metrics.materialAlphaModes)) {
      if (!/Glow|Fence/.test(name) && mode !== "OPAQUE") failures.push(`${name} must be opaque`);
    }
    if (metadata.coordinateReferenceSystem !== "EPSG:32651" || metadata.verticalExaggeration !== 1 ||
        metadata.realWorldScale !== "1 unit = 1 metre; no vertical exaggeration") failures.push("Shanghai must retain native UTM 51N metres");
    if (metadata.lapLength?.officialFiaMeters !== 5451 || !(metadata.lapLength.relativeErrorPercent <= .5)) failures.push("Shanghai must match FIA 5451 m within 0.5%");
    if (JSON.stringify(metadata.sectorBoundaryDistancesMeters) !== "[1430,2999]" || metadata.controlPointReference?.referenceYear !== 2026 ||
        metadata.controlPointReference.currentEventVerified !== true) failures.push("Shanghai requires pinned FIA 2026 controls");
    if (metadata.objects?.turnAnchors !== 16 || metadata.objects.pitGarageBoxes !== 33 || metadata.objects.fiaGarageBays !== 3 ||
        !(metadata.objects.grandstandFootprints >= 16) || !(metadata.objects.overWaterPavilions >= 20) ||
        metadata.objects.mainComplex?.bridges?.length !== 2) failures.push("Shanghai venue or pit infrastructure is incomplete");
    const quality = metadata.layoutQuality;
    if (quality?.surfaceClearance?.terrainBreakthroughSamples !== 0 || quality?.pitLane?.surfaceClearance?.terrainBreakthroughSamples !== 0 ||
        !(quality?.pitLane?.entryGapMeters <= .05) || !(quality?.pitLane?.exitGapMeters <= .05) ||
        !(quality?.pitLane?.wall?.lengthMeters > 200)) failures.push("Shanghai driving surface or pit wall is incomplete");
    if (!metadata.limitations?.length || metadata.materials?.physicalObjectsTextured !== true || metadata.elevationApproximate !== true ||
        metadata.assetLicense !== "CC BY-SA 4.0" || !metadata.rasterRegistration?.sourceSha256) failures.push("Shanghai source and reconstruction limits must be explicit");
    const registration = metadata.rasterRegistration;
    if (registration?.schemaVersion !== 2 || !(registration.groundControlPoints?.length >= 25) ||
        !(registration.independentCheckPoints?.length >= 9) || !(registration.independentRmsResidualPixels < 6) ||
        !(registration.independentMaximumResidualPixels < 8) || !(registration.jacobianDeterminantRange?.[1] < -.5) ||
        !(registration.jacobianDeterminantRange?.[0] > -3) || registration.buildingCorrections?.length !== 26 ||
        registration.buildingCorrections.some((control) => !(control.afterResidualPixels < .01))) {
      failures.push("Shanghai satellite alignment requires independent checkpoints, an unfolded mapping and corrected pavilion footprints");
    }
    if (registration.roofFootprintCorrections?.length !== 2 || registration.roofFootprintCorrections.some((control) => !(control.maximumReprojectionResidualPixels < .01)) ||
        ![1372223261, 1372223262].every((id) => quality.grandstands.rendered.some((stand) => stand.osmWayId === id))) failures.push("Shanghai must deliver both corrected H/K grandstands");
    const registrationFile = await readFile(path.join(projectRoot, "docs/track-model-shanghai-skysat-registration.json"));
    if (createHash("sha256").update(registrationFile).digest("hex") !== registration?.registrationSha256) failures.push("Shanghai registration controls differ from the delivered model");
    const lock = JSON.parse(await readFile(path.join(projectRoot, "docs/track-model-shanghai-source-manifest.json"), "utf8"));
    if (JSON.stringify(lock.sources) !== JSON.stringify(metadata.sourceManifest?.sources)) failures.push("Shanghai source lock differs from delivery");
    if (sourceDirectory) await validateSourceFiles(sourceDirectory, metadata.sourceManifest, failures);
  }

  if (modelId === "interlagos") {
    const { auditInterlagosSurfaces } = await import("./audit-interlagos-surfaces.mjs");
    const audit = metrics.decodedSurfaceAudit = await auditInterlagosSurfaces(glbBuffer, metadata);
    for (const layer of ["road", "paint"]) {
      if (!audit[layer].triangles || audit[layer].intersections || audit[layer].missingSupport) failures.push(`Interlagos ${layer} fails decoded surface clearance`);
    }
    if (Object.keys(audit.structuralConflicts).length) failures.push("Interlagos structures intersect driving surfaces");
    if (!audit.turn10Alignment.samples || audit.turn10Alignment.missingRoadSupport) failures.push("Interlagos T10 asphalt misses the independently traced orthophoto edges");
    if (!audit.textures.physicalPrimitives || audit.textures.missingTextures.length || audit.textures.invalidUvs.length) failures.push("Every Interlagos physical primitive needs an embedded texture and valid UVs");
    const names = new Set((gltf.nodes ?? []).map((node) => node.name));
    for (const name of [...Array.from({ length: 15 }, (_, i) => `Turn_${String(i + 1).padStart(2, "0")}`), "RaceStart", "SpeedTrap", "StartFinish", "SectorBoundary_02", "SectorBoundary_03", "HighPoint", "LowPoint"]) {
      if (!names.has(name)) failures.push(`Missing Interlagos anchor: ${name}`);
    }
    if (!metrics.extensionsRequired.includes("EXT_meshopt_compression")) failures.push("Interlagos requires Meshopt compression");
    if (metadata.coordinateReferenceSystem !== "EPSG:31983" || metadata.verticalExaggeration !== 1) failures.push("Interlagos must retain native SIRGAS/UTM23S metres");
    if (!(metadata.lapLength?.relativeErrorPercent < .5) || metadata.lapLength.officialFiaMeters !== 4309) failures.push("Interlagos lap must match FIA 4309 m within 0.5%");
    const quality = metadata.layoutQuality;
    if (quality?.surfaceClearance?.terrainBreakthroughSamples !== 0 || quality?.pitLane?.surfaceClearance?.terrainBreakthroughSamples !== 0 || !(quality?.pitLane?.entryGapMeters <= .05) || !(quality?.pitLane?.exitGapMeters <= .05) || !(quality?.pitLane?.wall?.lengthMeters > 240)) failures.push("Interlagos road/pit clearance, joins or physical wall are incomplete");
    if (metadata.objects?.turnAnchors !== 15 || metadata.objects.pitGarageBoxes !== 24 || metadata.objects.grandstandFootprints !== 3 || !(metadata.objects.buildingsTotal > 1000)) failures.push("Interlagos permanent circuit infrastructure is incomplete");
    if (!quality?.buildings?.rendered.some((building) => building.id === 33779114)) failures.push("Interlagos mapped pit pavilion is missing");
    if (!metadata.limitations?.length || metadata.controlPointReference?.referenceYear !== 2025 || metadata.controlPointReference.currentEventVerified !== false) failures.push("Interlagos must disclose source ages and event uncertainty");
    for (const [name, mode] of Object.entries(metrics.materialAlphaModes)) {
      if (!/Glow|Fence/.test(name) && mode !== "OPAQUE") failures.push(`${name} must be opaque`);
    }
    const lock = JSON.parse(await readFile(path.join(projectRoot, "docs/track-model-interlagos-source-manifest.json"), "utf8"));
    if (JSON.stringify(lock.sources) !== JSON.stringify(metadata.sourceManifest?.sources)) failures.push("Interlagos source lock differs from delivery");
    if (sourceDirectory) await validateSourceFiles(sourceDirectory, metadata.sourceManifest, failures);
  }

  if (modelId === "suzuka") {
    const { auditSuzukaSurfaces } = await import("./audit-suzuka-surfaces.mjs");
    const audit = metrics.decodedSurfaceAudit = await auditSuzukaSurfaces(glbBuffer);
    for (const layer of ["road", "paint"]) {
      if (!audit[layer].triangles || audit[layer].intersections || audit[layer].missingSupport) failures.push(`Suzuka ${layer} fails decoded surface clearance`);
    }
    if (Object.keys(audit.structuralConflicts).length) failures.push("Suzuka structures intersect driving corridors");
    if (!(audit.road.maximumGradePercent < 22) || !(audit.minimumBridgeClearanceMeters >= 4.5) || !audit.bridgeSamples) failures.push("Suzuka gradients or crossover clearance are invalid");
    if (!audit.textures.physicalPrimitives || audit.textures.missingTextures.length || audit.textures.invalidUvs.length) failures.push("Every Suzuka physical mesh requires embedded textures and valid UVs");
    const names = new Set((gltf.nodes ?? []).map((node) => node.name));
    for (const name of [...Array.from({ length: 18 }, (_, i) => `Turn_${String(i + 1).padStart(2, "0")}`),
      "RaceStart", "StartFinish", "SpeedTrap", "SectorBoundary_02", "SectorBoundary_03", "HighPoint", "LowPoint"]) {
      if (!names.has(name)) failures.push(`Missing Suzuka anchor: ${name}`);
    }
    if (!metrics.extensionsRequired.includes("EXT_meshopt_compression")) failures.push("Suzuka requires Meshopt compression");
    for (const [name, mode] of Object.entries(metrics.materialAlphaModes)) {
      if (!/Glow|Fence/.test(name) && mode !== "OPAQUE") failures.push(`${name} must be opaque`);
    }
    if (metadata.coordinateReferenceSystem !== "EPSG:32653" || metadata.verticalExaggeration !== 1 || metadata.realWorldScale !== "1 unit = 1 metre; no vertical exaggeration") failures.push("Suzuka must retain native UTM 53N metres without vertical exaggeration");
    if (metadata.lapLength?.officialFiaMeters !== 5807 || !(metadata.lapLength.relativeErrorPercent <= .5)) failures.push("Suzuka length must match the official 5807 m");
    if (JSON.stringify(metadata.sectorBoundaryDistancesMeters) !== "[2184,4710]" || metadata.controlPointReference?.referenceYear !== 2026 || metadata.controlPointReference.currentEventVerified !== true) failures.push("Suzuka requires the pinned FIA 2026 timing layout");
    if (metadata.objects?.turnAnchors !== 18 || metadata.objects.pitGarageBoxes !== 55 || metadata.objects.grandstandFootprints !== 29 || !(metadata.objects.buildingsTotal >= 200) || metadata.objects.wheel?.osmWayId !== 184107083) failures.push("Suzuka mapped venue or pit structures are incomplete");
    const quality = metadata.layoutQuality;
    if (quality?.surfaceClearance?.terrainBreakthroughSamples !== 0 || quality?.pitLane?.surfaceClearance?.terrainBreakthroughSamples !== 0 || !(quality?.pitLane?.entryGapMeters <= .05) || !(quality?.pitLane?.exitGapMeters <= .05) || !(quality?.pitLane?.wall?.lengthMeters > 250)) failures.push("Suzuka driving surfaces or physical pit wall are incomplete");
    if (!metadata.limitations?.length || metadata.materials?.physicalObjectsTextured !== true) failures.push("Suzuka reconstruction limits and texture provenance must be explicit");
    const lock = JSON.parse(await readFile(path.join(projectRoot, "docs/track-model-suzuka-source-manifest.json"), "utf8"));
    if (JSON.stringify(lock.sources) !== JSON.stringify(metadata.sourceManifest?.sources)) failures.push("Suzuka source lock differs from delivery");
    if (sourceDirectory) await validateSourceFiles(sourceDirectory, metadata.sourceManifest, failures);
  }

  if (modelId === "mexico") {
    const { auditMexicoSurfaces } = await import("./audit-mexico-surfaces.mjs");
    const stadiumReference = JSON.parse(await readFile(path.join(projectRoot,
      "docs/track-model-mexico-stadium-reference.json"), "utf8"));
    const audit = metrics.decodedSurfaceAudit = await auditMexicoSurfaces(glbBuffer, metadata, stadiumReference);
    for (const layer of ["road", "paint", "surfaces"]) {
      if (!audit[layer].triangles || audit[layer].intersections || audit[layer].missingSupport) {
        failures.push(`Mexico ${layer} fails decoded surface clearance`);
      }
    }
    if (Object.keys(audit.structuralConflicts).length) failures.push("Mexico structures intersect the driving corridors");
    if (!(audit.road.maximumGradePercent < 25)) failures.push("Mexico road has an unsupported steep slope");
    if (!audit.longitudinalRoad.referenceAvailable || audit.longitudinalRoad.missingSamples ||
        !(audit.longitudinalRoad.maximumAbsoluteGradePercent < 2) ||
        !(audit.longitudinalRoad.maximumSmoothedGradeChangePerMeter < .05) ||
        !(audit.longitudinalRoad.finishSeamHeightGapMeters <= .01)) {
      failures.push("Mexico road longitudinal profile has unresolved waves or a disconnected seam");
    }
    const stadium = audit.stadium;
    const eastHospitality = stadium.eastHospitality;
    if (!eastHospitality?.triangles || !eastHospitality.sampleCount || eastHospitality.missingSamples || eastHospitality.outsideCentroids ||
        eastHospitality.deckLevels.length !== 2 || eastHospitality.deckLevels.some((deck) => !deck.sampleCount || deck.missingSamples) ||
        !eastHospitality.connectionSamples || eastHospitality.connectionMissingSamples ||
        eastHospitality.maximumConnectionHeightErrorMeters > .08 ||
        Object.values(eastHospitality.palette).some((count) => !count)) {
      failures.push("Mexico eastern stadium hospitality or its connected north concourse has missing geometry or source colors");
    }
    if (audit.elevationAnchors.some((anchor) => !anchor.roadSupported ||
      !(anchor.roadHeightErrorMeters <= .05) || !(anchor.extremumErrorMeters <= .01))) {
      failures.push("Mexico height markers must match the highest and lowest road points");
    }
    if (!stadium.referenceAvailable || !stadium.seatingTriangles || !stadium.canopyTriangles || !stadium.trussTriangles ||
        stadium.genericStadiumTriangles || stadium.seatingOutsideCentroids ||
        stadium.banks.some((bank) => !bank.sampleCount || bank.missingSamples || bank.frontMissingSamples) ||
        !stadium.canopy.sampleCount || stadium.canopy.missingSamples || stadium.canopy.outsideCentroids ||
        !(Math.abs(stadium.canopy.projectedAreaSquareMeters / stadium.canopy.referenceAreaSquareMeters - 1) < .02) ||
        stadium.westPassageMissingSamples || stadium.missingCantileverTips || !(stadium.maximumTipHeightErrorMeters < .5)) {
      failures.push("Mexico stadium differs from the author-plan terraces or continuous cantilever canopy");
    }
    if (!stadium.palette.concreteTriangles || !stadium.palette.seatTriangles || !stadium.palette.steelTriangles ||
        stadium.palette.canopyTriangles !== stadium.canopyTriangles ||
        stadium.eventSurfaces.some((surface) => !surface.sampleCount || surface.missingSamples ||
          !(surface.heightRangeMeters <= .05)) ||
        !stadium.frontWalls.triangles || stadium.frontWalls.darkTriangles ||
        !(stadium.frontWalls.maximumHeightMeters <= stadiumReference.seatingSection.frontHeightMeters + .2) ||
        stadium.paintOverlays.some((overlay) => overlay.intersections) ||
        stadium.roadPaintOverlays.some((overlay) => !overlay.sampleCount || overlay.intersections)) {
      failures.push("Mexico stadium source materials or continuous painted apron are missing");
    }
    if (!audit.textures.physicalPrimitives || audit.textures.missingTextures.length || audit.textures.invalidUvs.length) {
      failures.push("Mexico physical objects require embedded textures and valid UV coordinates");
    }
    const names = new Set((gltf.nodes ?? []).map((node) => node.name));
    for (const name of [
      ...Array.from({ length: 17 }, (_, index) => `Turn_${String(index + 1).padStart(2, "0")}`),
      "RaceStart", "SpeedTrap", "StartFinish", "SectorBoundary_02", "SectorBoundary_03", "HighPoint", "LowPoint",
    ]) {
      if (!names.has(name)) failures.push(`Missing Mexico anchor: ${name}`);
    }
    if (!metrics.extensionsRequired.includes("EXT_meshopt_compression")) failures.push("Mexico requires Meshopt compression");
    for (const [name, mode] of Object.entries(metrics.materialAlphaModes)) {
      if (!/Glow|Fence/.test(name) && mode !== "OPAQUE") failures.push(`${name} must be opaque`);
    }
    if (metadata.coordinateReferenceSystem !== "EPSG:32614" || metadata.verticalExaggeration !== 1) {
      failures.push("Mexico must retain native UTM 14N metres without vertical exaggeration");
    }
    if (!(metadata.lapLength?.relativeErrorPercent < .5) || metadata.lapLength.officialFiaMeters !== 4304) {
      failures.push("Mexico lap must match 4304 m within 0.5%");
    }
    if (!(metadata.raceStartDistanceMeters > 100) || metadata.finishDistanceMeters !== 0) {
      failures.push("Mexico race-start and control lines must remain separate");
    }
    if (metadata.objects?.turnAnchors !== 17 || !(metadata.objects.buildingsTotal > 0) ||
        !(metadata.objects.grandstandSections > 0) || metadata.objects.pitGarageBoxes !== 33 ||
        metadata.controlPointReference?.pitBoxes !== 33) {
      failures.push("Mexico track, pit and mapped venue structures are incomplete");
    }
    if (metadata.layoutQuality?.surfaceClearance?.terrainBreakthroughSamples !== 0 ||
        metadata.layoutQuality?.pitLane?.surfaceClearance?.terrainBreakthroughSamples !== 0 ||
        !(metadata.layoutQuality?.pitLane?.entryGapMeters <= .05) ||
        !(metadata.layoutQuality?.pitLane?.exitGapMeters <= .05)) {
      failures.push("Mexico driving surface is disconnected or intersects terrain");
    }
    if (!Number.isInteger(metadata.controlPointReference?.referenceYear) ||
        typeof metadata.controlPointReference.currentEventVerified !== "boolean" || !metadata.limitations?.length) {
      failures.push("Mexico must disclose the official control-map year and source limitations");
    }
    const lock = JSON.parse(await readFile(path.join(projectRoot, "docs/track-model-mexico-source-manifest.json"), "utf8"));
    if (JSON.stringify(lock.sources) !== JSON.stringify(metadata.sourceManifest?.sources)) {
      failures.push("Mexico delivery differs from its pinned source lock");
    }
    if (sourceDirectory) await validateSourceFiles(sourceDirectory, metadata.sourceManifest, failures);
  }

  if (modelId === "singapore") {
    const { auditSingaporeSurfaces } = await import("./audit-singapore-surfaces.mjs");
    const audit = metrics.decodedSurfaceAudit = await auditSingaporeSurfaces(glbBuffer);
    for (const layer of ["road", "paint"]) {
      if (!audit[layer].triangles || audit[layer].intersections || audit[layer].missingSupport) {
        failures.push(`Singapore ${layer} fails compressed geometry clearance`);
      }
    }
    if (Object.keys(audit.structuralConflicts).length || audit.bridgeConflicts) {
      failures.push("Singapore structures intersect the driving corridors");
    }
    if (audit.bridgeGrandstandConflicts || metadata.layoutQuality.grandstands.waterConflicts ||
        metadata.objects.bridges.ungroundedInteriorEndpoints || metadata.objects.bridges.maximumJointHeightGapMeters > .001) {
      failures.push("Singapore bridge joints, approaches or grandstand clearance are invalid");
    }
    if (!(audit.road.maximumGradePercent < 25) || !(audit.minimumBridgeClearanceMeters > 4.5)) {
      failures.push("Singapore road gradient or bridge clearance is invalid");
    }
    const names = new Set((gltf.nodes ?? []).map(node => node.name));
    for (const name of [...Array.from({length:19}, (_,i)=>`Turn_${String(i+1).padStart(2,"0")}`),
      "RaceStart", "SpeedTrap", "StartFinish", "SectorBoundary_02", "SectorBoundary_03", "HighPoint", "LowPoint"]) {
      if (!names.has(name)) failures.push(`Missing Singapore anchor: ${name}`);
    }
    if (!metrics.extensionsRequired.includes("EXT_meshopt_compression")) failures.push("Singapore requires Meshopt");
    for (const [name, mode] of Object.entries(metrics.materialAlphaModes)) {
      if (!/Glow|Fence/.test(name) && mode !== "OPAQUE") failures.push(`${name} must be opaque`);
    }
    for (const imageName of ["singapore-orthophoto", "facade-glass", "facade-balcony", "facade-stone", "facade-garage"]) {
      if (!gltf.images?.some(image=>image.name===imageName && image.bufferView!==undefined)) failures.push(`Missing embedded ${imageName}`);
    }
    if (metadata.coordinateReferenceSystem !== "EPSG:32648" || metadata.verticalExaggeration !== 1 ||
        metadata.elevationApproximate !== true || metadata.verticalDatum !== null || !metadata.limitations?.length) {
      failures.push("Singapore native metres and reconstruction limits must remain explicit");
    }
    if (!(metadata.lapLength?.relativeErrorPercent < .5) || metadata.lapLength.officialFiaMeters !== 4927) failures.push("Singapore lap length is invalid");
    const buildings = metadata.layoutQuality?.buildings;
    for (const id of [49890775,116801004,172307471,172307472]) {
      if (!buildings?.rendered.some(building=>building.osmWayId===id)) failures.push(`Missing Singapore landmark footprint ${id}`);
    }
    if (metadata.objects.turnAnchors !== 19 || metadata.objects.flyerCapsules !== 28 || buildings.count < 1000 || metadata.objects.grandstandSections < 30) {
      failures.push("Singapore city and event geometry is incomplete");
    }
    if (metadata.layoutQuality.pitLane.entryGapMeters > .05 || metadata.layoutQuality.pitLane.exitGapMeters > .05) failures.push("Singapore pit lane is disconnected");
    const lock = JSON.parse(await readFile(path.join(projectRoot,"docs/track-model-singapore-source-manifest.json"),"utf8"));
    if (JSON.stringify(lock.sources)!==JSON.stringify(metadata.sourceManifest.sources)) failures.push("Singapore source lock differs from delivery");
    if (sourceDirectory) await validateSourceFiles(sourceDirectory, metadata.sourceManifest, failures);
  }

  if (modelId === "austin") {
    const { auditAustinSurfaces } = await import("./audit-austin-surfaces.mjs");
    metrics.decodedSurfaceAudit = await auditAustinSurfaces(glbBuffer);
    const audit = metrics.decodedSurfaceAudit;
    for (const layer of ["road", "paint"]) {
      if (!audit[layer].triangles || audit[layer].intersections || audit[layer].missingSupport) {
        failures.push(`Austin ${layer} fails decoded surface clearance`);
      }
    }
    if (Object.keys(audit.structuralConflicts).length || audit.bridgeConflicts) {
      failures.push("Austin driving corridors contain structural conflicts");
    }
    if (!(audit.road.maximumGradePercent < 22) || !(audit.minimumBridgeClearanceMeters >= 4.5)) {
      failures.push("Austin road gradient or bridge clearance is invalid");
    }
    const names = new Set((gltf.nodes ?? []).map((node) => node.name));
    for (const name of [
      ...Array.from({ length: 20 }, (_, i) => `Turn_${String(i + 1).padStart(2, "0")}`),
      "RaceStart", "SpeedTrap", "StartFinish", "SectorBoundary_02", "SectorBoundary_03", "HighPoint", "LowPoint",
    ]) {
      if (!names.has(name)) failures.push(`missing Austin anchor: ${name}`);
    }
    if (!metrics.extensionsRequired.includes("EXT_meshopt_compression")) failures.push("Austin requires Meshopt compression");
    if (!gltf.images?.some((image) => image.bufferView !== undefined && /austin-orthophoto/.test(image.name))) {
      failures.push("Austin NAIP orthophoto must be embedded");
    }
    if (metadata.coordinateReferenceSystem !== "EPSG:32614" || metadata.verticalExaggeration !== 1) {
      failures.push("Austin must retain native UTM 14N metres without vertical exaggeration");
    }
    if (!(metadata.lapLength?.relativeErrorPercent < .5) || metadata.lapLength.officialFiaMeters !== 5513) {
      failures.push("Austin lap must match 5513 m within 0.5%");
    }
    if (metadata.objects?.turnAnchors !== 20 || metadata.objects.pitGarageBoxes !== 34 ||
        metadata.objects.grandstandFootprints < 9 || metadata.objects.buildingsTotal < 40) {
      failures.push("Austin mapped track, pit or venue structures are missing");
    }
    if (!metadata.layoutQuality?.buildings?.rendered.some((building) => building.osmWayId === 376713391) ||
        !metadata.layoutQuality?.buildings?.rendered.some((building) => building.osmWayId === 847781224)) {
      failures.push("Austin pit complex or observation tower is missing");
    }
    if (metadata.layoutQuality?.surfaceClearance?.terrainBreakthroughSamples !== 0 ||
        metadata.layoutQuality?.pitLane?.surfaceClearance?.terrainBreakthroughSamples !== 0 ||
        metadata.layoutQuality?.pitLane?.entryGapMeters > .05 || metadata.layoutQuality?.pitLane?.exitGapMeters > .05) {
      failures.push("Austin driving surface is disconnected or intersects terrain");
    }
    if (metadata.controlPointReference?.referenceYear !== 2025 ||
        metadata.controlPointReference.currentEventVerified !== false || !metadata.limitations?.length) {
      failures.push("Austin must disclose provisional FIA controls and source limitations");
    }
    const lock = JSON.parse(await readFile(path.join(projectRoot, "docs/track-model-austin-source-manifest.json"), "utf8"));
    if (JSON.stringify(metadata.sourceManifest.sources) !== JSON.stringify(lock.sources)) {
      failures.push("Austin delivery source manifest differs from its pinned lock");
    }
    if (sourceDirectory) for (const source of lock.sources) {
      const data = await readFile(path.join(sourceDirectory, source.file));
      if (data.length !== source.bytes || createHash("sha256").update(data).digest("hex") !== source.sha256) {
        failures.push(`Austin source cache changed: ${source.file}`);
      }
    }
  }

  if (modelId === "miami") {
    const { auditMiamiSurfaces } = await import("./audit-miami-surfaces.mjs");
    metrics.decodedSurfaceAudit = await auditMiamiSurfaces(glbBuffer);
    const audit = metrics.decodedSurfaceAudit;
    for (const layer of ["road", "paint"]) {
      if (!audit[layer].triangles || audit[layer].intersections || audit[layer].missingSupport) failures.push(`Miami ${layer} fails decoded surface clearance`);
    }
    if (Object.keys(audit.structuralConflicts).length || audit.bridgeConflicts) failures.push("Miami driving corridors contain structural conflicts");
    if (!(audit.road.maximumGradePercent < 12)) failures.push("Miami decoded road has a false ramp or height step");
    const names = new Set((gltf.nodes ?? []).map((node) => node.name));
    for (const name of [...Array.from({ length: 19 }, (_, i) => `Turn_${String(i + 1).padStart(2, "0")}`), "RaceStart", "SpeedTrap", "StartFinish", "SectorBoundary_02", "SectorBoundary_03", "HighPoint", "LowPoint"]) {
      if (!names.has(name)) failures.push(`missing Miami anchor: ${name}`);
    }
    if (!metrics.extensionsRequired.includes("EXT_meshopt_compression")) failures.push("Miami requires Meshopt compression");
    if (!gltf.images?.some((image) => image.bufferView !== undefined && /miami-orthophoto/.test(image.name))) failures.push("Miami county orthophoto must be embedded");
    if (metadata.coordinateReferenceSystem !== "EPSG:32617" || metadata.verticalExaggeration !== 1) failures.push("Miami must retain native UTM 17N metres without vertical exaggeration");
    if (!(metadata.lapLength?.relativeErrorPercent < .5) || metadata.lapLength.officialFiaMeters !== 5412) failures.push("Miami lap must match 5412 m within 0.5%");
    if (metadata.objects?.turnAnchors !== 19 || metadata.objects.pitGarageBoxes !== 37 || metadata.objects.teamPavilions !== 11 || metadata.objects.grandstandSections < 80) failures.push("Miami required event geometry is missing");
    if (!metadata.layoutQuality?.buildings?.rendered.some((building) => building.id === 1017340353)) failures.push("Miami mapped pit building is missing");
    for (const key of ["entryGapMeters", "exitGapMeters"]) if (!(metadata.layoutQuality?.pitLane?.[key] < .05)) failures.push(`Miami pit ${key} is disconnected`);
    if (metadata.layoutQuality?.surfaceClearance?.terrainBreakthroughSamples !== 0) failures.push("Miami terrain breaks through the asphalt");
    if (metadata.layoutQuality?.flyovers?.maximumPanelJoinGapMeters !== 0 || !(metadata.layoutQuality.flyovers.highwayWaysWithConnectedApproaches > 13)) failures.push("Miami flyover approaches are disconnected");
    if (metadata.controlPointReference?.referenceYear !== 2026 || metadata.controlPointReference.currentEventVerified !== true || !metadata.limitations?.length) failures.push("Miami requires 2026 event references and source limitations");
    const lock = JSON.parse(await readFile(path.join(projectRoot, "docs/track-model-miami-source-manifest.json"), "utf8"));
    if (JSON.stringify(metadata.sourceManifest.sources) !== JSON.stringify(lock.sources)) failures.push("Miami delivery source manifest differs from its pinned lock");
    if (sourceDirectory) for (const source of lock.sources) {
      const data = await readFile(path.join(sourceDirectory, source.file));
      if (data.length !== source.bytes || createHash("sha256").update(data).digest("hex") !== source.sha256) failures.push(`Miami source cache changed: ${source.file}`);
    }
  }

  if (modelId === "sepang") {
    const { auditSepangSurfaces } = await import("./audit-sepang-surfaces.mjs");
    const { verifySepangSources, loadSepangBuildingColours } = await import("./download-sepang-data.mjs");
    const appearance = await loadSepangBuildingColours();
    metrics.decodedSurfaceAudit = await auditSepangSurfaces(glbBuffer, appearance);
    const audit = metrics.decodedSurfaceAudit;
    if (audit.appearance.missingBuildingColours.length || audit.appearance.missingGrandstandColours.length) failures.push("Sepang exported building colours differ from the researched linear palette");
    if (metadata.buildingAppearance?.auditSha256 !== appearance.auditSha256 || metadata.buildingAppearance.vertexColorSpace !== "linear") failures.push("Sepang building colour provenance or colour space is missing");
    if (metadata.layoutQuality?.buildings?.rendered.some((building) => !building.appearance?.group)) failures.push("Sepang buildings must carry roof colour evidence");
    for (const layer of ["road", "paint"]) {
      if (!audit[layer].triangles || audit[layer].intersections || audit[layer].missingSupport) failures.push(`Sepang ${layer} fails decoded surface clearance`);
    }
    if (audit.structuralRoadConflicts || audit.vegetationTrianglesAboveRoad || audit.roadBarrierTrianglesInsidePit) failures.push("Sepang driving corridors contain structural conflicts");
    const names = new Set((gltf.nodes ?? []).map((node) => node.name));
    for (const name of [...Array.from({ length: 15 }, (_, i) => `Turn_${String(i + 1).padStart(2, "0")}`), "SpeedTrap", "StartFinish", "SectorBoundary_02", "SectorBoundary_03", "HighPoint", "LowPoint"]) {
      if (!names.has(name)) failures.push(`missing Sepang anchor: ${name}`);
    }
    if (!metrics.extensionsRequired.includes("EXT_meshopt_compression")) failures.push("Sepang requires Meshopt compression");
    if (!gltf.images?.some((image) => image.bufferView !== undefined && image.name === "sepang-ground-surface")) failures.push("Sepang mapped ground texture must be embedded in GLB");
    const ground = metadata.layoutQuality?.terrainSurface;
    if (ground?.style !== "mapped-materials" || ground.detailSource !== "current OpenStreetMap ground geometry" || !(ground.currentGroundPolygons >= 90) || !(ground.textureWidth >= 4096)) failures.push("Sepang requires detailed mapped ground materials");
    if (metadata.coordinateReferenceSystem !== "EPSG:32647" || metadata.verticalExaggeration !== 1) failures.push("Sepang must retain metric UTM 47N geometry without vertical exaggeration");
    if (!(metadata.lapLength?.relativeErrorPercent < .5) || metadata.lapLength.officialFiaMeters !== 5543) failures.push("Sepang lap must match 5543 m within 0.5%");
    if (metadata.objects?.turnAnchors !== 15 || metadata.objects.pitGarageBoxes !== 33 || metadata.objects.grandstandSections < 100) failures.push("Sepang required turn, pit or grandstand geometry is missing");
    if (!metadata.layoutQuality?.buildings?.rendered.some((building) => building.id === 144362327)) failures.push("Sepang main pit building is missing");
    for (const key of ["entryGapMeters", "exitGapMeters"]) if (!(metadata.layoutQuality?.pitLane?.[key] < .05)) failures.push(`Sepang pit ${key} is disconnected`);
    if (metadata.layoutQuality?.surfaceClearance?.terrainBreakthroughSamples !== 0) failures.push("Sepang terrain breaks through its driving surface");
    if (metadata.controlPointReference?.referenceYear !== 2017 || metadata.controlPointReference.currentEventVerified !== false || !metadata.limitations?.length) failures.push("Sepang must disclose the historical control map and source limitations");
    if (sourceDirectory) await verifySepangSources(sourceDirectory, metadata.sourceManifest);
  }

  if (metrics.bytes > LIMITS.bytes) {
    failures.push(`GLB size ${metrics.bytes} exceeds ${LIMITS.bytes} bytes`);
  }

  if (metrics.triangles > LIMITS.triangles) {
    failures.push(`triangle count ${metrics.triangles} exceeds ${LIMITS.triangles}`);
  }

  if (metrics.drawCalls > LIMITS.drawCalls) {
    failures.push(`draw call estimate ${metrics.drawCalls} exceeds ${LIMITS.drawCalls}`);
  }

  if (metrics.materials > LIMITS.materials) {
    failures.push(`material count ${metrics.materials} exceeds ${LIMITS.materials}`);
  }

  if (metrics.previewBytes < 50_000) {
    failures.push(`preview ${metrics.previewBytes} bytes is unexpectedly small`);
  }

  if (metrics.animations > 0) {
    failures.push(`static track asset contains ${metrics.animations} animation(s)`);
  }

  for (const [materialName, alphaMode] of Object.entries(metrics.materialAlphaModes)) {
    if (/Motorhomes/.test(materialName) && alphaMode === "BLEND") {
      failures.push(`${materialName} must be opaque, not alpha-blended`);
    }
  }

  if (modelId === "baku") {
    const { auditBakuSurfaces } = await import("./audit-baku-surfaces.mjs");
    metrics.decodedSurfaceAudit = await auditBakuSurfaces(glbBuffer, metadata);
    const restored = metrics.decodedSurfaceAudit.restoredBuildings.find((building) => building.osmRelationId === 2249851);
    if (!restored || restored.courtyardSamples !== 10 || restored.coveredCourtyardSamples || restored.elevatedRoofSamples !== 4) failures.push("Baku restored building must have an elevated roof and two open courtyards");
    if (metrics.decodedSurfaceAudit.vegetationTrianglesAboveRoad) failures.push("Baku vegetation overlaps the track or pit lane");
    if (metrics.decodedSurfaceAudit.windowFacadeUVAlignmentErrors || metrics.decodedSurfaceAudit.roofUVRangeErrors) failures.push("Baku building UV coordinates are misaligned");
    if (metrics.decodedSurfaceAudit.road.intersections || metrics.decodedSurfaceAudit.road.missingSupport) failures.push("Baku decoded road intersects terrain");
    if (metrics.decodedSurfaceAudit.paint.intersections || metrics.decodedSurfaceAudit.paint.missingSupport) failures.push("Baku decoded paint intersects asphalt");
    if (metrics.decodedSurfaceAudit.roadBarrierTrianglesInsidePit) failures.push("Baku roadside fence blocks pit lane");
    const required = [...Array.from({ length: 20 }, (_, i) => `Turn_${String(i + 1).padStart(2, "0")}`),
      "RaceStart", "StartFinish", "SpeedTrap", "SectorBoundary_02", "SectorBoundary_03", "HighPoint", "LowPoint"];
    const names = new Set((gltf.nodes ?? []).map((node) => node.name));
    for (const name of required) if (!names.has(name)) failures.push(`missing Baku anchor: ${name}`);
    if (!metrics.extensionsRequired.includes("EXT_meshopt_compression")) failures.push("Baku requires Meshopt compression");
    if (metadata.coordinateReferenceSystem !== "EPSG:32639" || metadata.verticalExaggeration !== 1) failures.push("Baku must retain native metre geometry without vertical exaggeration");
    if (!(metadata.lapLength?.relativeErrorPercent < .5) || metadata.lapLength.officialFiaMeters !== 6003) failures.push("Baku length differs from the official 6003 m");
    if (!(metadata.raceStartDistanceMeters > 100) || metadata.finishDistanceMeters !== 0) failures.push("Baku race start and control lines must be separate");
    if (!(metadata.objects?.buildingsTotal > 500) || metadata.objects.turnAnchors !== 20 || metadata.objects.pitGarageBoxes !== 44) failures.push("Baku scene is missing required city/pit/turn geometry");
    if (!(metadata.objects?.grandstandSections > 20)) failures.push("Baku grandstands are missing");
    const clearance = metadata.layoutQuality?.surfaceClearance;
    if (clearance?.terrainBreakthroughSamples !== 0) failures.push("Baku road/terrain clearance audit failed");
    const coastal = metadata.elevationProfile.filter((p) => p.distanceMeters > 4190 || p.distanceMeters < 270).map((p) => p.elevationMeters);
    if (Math.max(...coastal) - Math.min(...coastal) > .1) failures.push("Baku coastal straight contains height waves");
    for (const key of ["entrySourceGapMeters", "exitSourceGapMeters"]) if (metadata.layoutQuality?.pitLane?.[key] > .01) failures.push(`Baku pit ${key} disconnected`);
  }

  if (modelId === "zandvoort") {
    const requiredAnchors = [
      ...Array.from({ length: 14 }, (_, index) => `Turn_${String(index + 1).padStart(2, "0")}`),
      "SpeedTrap",
      "StartFinish",
      "SectorBoundary_02",
      "SectorBoundary_03",
      "HighPoint",
      "LowPoint",
    ];
    const missingAnchors = requiredAnchors.filter(
      (anchorName) => !metrics.anchorNames.includes(anchorName),
    );

    if (missingAnchors.length > 0) {
      failures.push(`missing Zandvoort anchors: ${missingAnchors.join(", ")}`);
    }

    if (!metrics.extensionsRequired.includes("EXT_meshopt_compression")) {
      failures.push("Zandvoort GLB must use local Meshopt-compatible compression");
    }

    for (const materialName of [
      "Terrain_2026_Orthophoto",
      "Real_Asphalt",
      "Aerial_Sampled_Buildings",
      "Grandstand_Seats_Red",
      "PDOK_2026_Race_Motorhomes",
      "Pit_Wall_Concrete",
      "Sector_1_Glow",
      "Sector_2_Glow",
      "Sector_3_Glow",
    ]) {
      if (!metrics.materialNames.includes(materialName)) {
        failures.push(`missing real-world material: ${materialName}`);
      }
    }

    const forbiddenSurfaceMaterials = ["Water", "Concrete", "Brick_And_Pavers", "Sand_And_Gravel"];
    const presentForbiddenMaterials = forbiddenSurfaceMaterials.filter((name) =>
      metrics.materialNames.includes(name)
    );
    if (presentForbiddenMaterials.length > 0) {
      failures.push(`synthetic ground materials remain in GLB: ${presentForbiddenMaterials.join(", ")}`);
    }
    const syntheticSurfaceMeshes = metrics.meshNames.filter((name) =>
      /^BGT_(Asphalt|Concrete|Pavers|Gravel|Water)_Surfaces/.test(name)
    );
    if (syntheticSurfaceMeshes.length > 0) {
      failures.push(`synthetic BGT ground meshes remain in GLB: ${syntheticSurfaceMeshes.join(", ")}`);
    }

    validateZandvoortMetadata(metadata, failures);
    if (sourceDirectory) {
      await validateSourceFiles(sourceDirectory, metadata.sourceManifest, failures);
      await validateBuildingSourceAlignment(sourceDirectory, failures);
    }
  }

  if (modelId === "spa") {
    const requiredAnchors = [
      ...Array.from({ length: 19 }, (_, index) => `Turn_${String(index + 1).padStart(2, "0")}`),
      "SpeedTrap",
      "StartFinish",
      "SectorBoundary_02",
      "SectorBoundary_03",
      "HighPoint",
      "LowPoint",
    ];
    const missingAnchors = requiredAnchors.filter(
      (anchorName) => !metrics.anchorNames.includes(anchorName),
    );

    if (missingAnchors.length > 0) {
      failures.push(`missing Spa anchors: ${missingAnchors.join(", ")}`);
    }
    if (!metrics.extensionsRequired.includes("EXT_meshopt_compression")) {
      failures.push("Spa GLB must use local Meshopt-compatible compression");
    }
    for (const materialName of [
      "Terrain_SPW_Orthophoto_2023",
      "Spa_Real_Asphalt",
      "Spa_Current_OSM_DSM_Buildings",
      "Spa_Grandstand_Seats_Red",
      "SpaGP_2026_Race_Motorhomes",
      "Spa_Pit_Wall_Concrete",
      "Spa_Real_Gravel_Runoff",
      "Sector_1_Glow",
      "Sector_2_Glow",
      "Sector_3_Glow",
    ]) {
      if (!metrics.materialNames.includes(materialName)) {
        failures.push(`missing Spa real-world material: ${materialName}`);
      }
    }

    validateSpaMetadata(metadata, failures);
    if (sourceDirectory) {
      await validateSourceFiles(sourceDirectory, metadata.sourceManifest, failures);
    }
  }

  if (modelId === "hungaroring") {
    const requiredAnchors = [
      ...Array.from({ length: 14 }, (_, index) => `Turn_${String(index + 1).padStart(2, "0")}`),
      "SpeedTrap",
      "StartFinish",
      "SectorBoundary_02",
      "SectorBoundary_03",
      "HighPoint",
      "LowPoint",
    ];
    const missingAnchors = requiredAnchors.filter(
      (anchorName) => !metrics.anchorNames.includes(anchorName),
    );
    if (missingAnchors.length > 0) {
      failures.push(`missing Hungaroring anchors: ${missingAnchors.join(", ")}`);
    }
    if (!metrics.extensionsRequired.includes("EXT_meshopt_compression")) {
      failures.push("Hungaroring GLB must use local Meshopt-compatible compression");
    }
    for (const materialName of [
      "Terrain_Hungaroring_Current_Hybrid_Ground",
      "Hungaroring_Real_Asphalt",
      "Hungaroring_Current_OSM_Buildings",
      "Hungaroring_Grandstand_Seats_Red",
      "Hungaroring_2026_Race_Motorhomes",
      "Hungaroring_Pit_Wall_Concrete",
      "Hungaroring_Real_Gravel_Runoff",
      "Sector_1_Glow",
      "Sector_2_Glow",
      "Sector_3_Glow",
    ]) {
      if (!metrics.materialNames.includes(materialName)) {
        failures.push(`missing Hungaroring real-world material: ${materialName}`);
      }
    }

    validateHungaroringMetadata(metadata, failures);
    if (sourceDirectory) {
      await validateSourceFiles(sourceDirectory, metadata.sourceManifest, failures);
    }
  }

  if (modelId === "red-bull-ring") {
    const requiredAnchors = [
      ...Array.from({ length: 10 }, (_, index) => `Turn_${String(index + 1).padStart(2, "0")}`),
      "SpeedTrap",
      "StartFinish",
      "SectorBoundary_02",
      "SectorBoundary_03",
      "HighPoint",
      "LowPoint",
    ];
    const missingAnchors = requiredAnchors.filter(
      (anchorName) => !metrics.anchorNames.includes(anchorName),
    );
    if (missingAnchors.length > 0) {
      failures.push(`missing Red Bull Ring anchors: ${missingAnchors.join(", ")}`);
    }
    if (!metrics.extensionsRequired.includes("EXT_meshopt_compression")) {
      failures.push("Red Bull Ring GLB must use local Meshopt-compatible compression");
    }
    for (const materialName of [
      "Terrain_Styria_Orthophoto_2024",
      "RedBullRing_Real_Asphalt",
      "RedBullRing_Current_OSM_DSM_Buildings",
      "RedBullRing_Current_Grandstands",
      "RedBullRing_2026_Race_Motorhomes",
      "RedBullRing_Pit_Wall_Concrete",
      "RedBullRing_Real_Gravel_Runoff",
      "Sector_1_Glow",
      "Sector_2_Glow",
      "Sector_3_Glow",
    ]) {
      if (!metrics.materialNames.includes(materialName)) {
        failures.push(`missing Red Bull Ring real-world material: ${materialName}`);
      }
    }
    for (const meshName of [
      "FIA_Red_Bull_Ring_Centreline_12_5m_Mesh",
      "FIA_Pit_Lane_Markings_32_Boxes_Mesh",
      "RedBullRing_2026_32_Garage_Pit_Complex_Mesh",
      "RedBullRing_2026_Current_Grandstands_Mesh",
    ]) {
      if (!metrics.meshNames.includes(meshName)) {
        failures.push(`missing Red Bull Ring circuit mesh: ${meshName}`);
      }
    }

    validateRedBullRingMetadata(metadata, failures);
    if (sourceDirectory) {
      await validateSourceFiles(sourceDirectory, metadata.sourceManifest, failures);
    }
  }

  if (modelId === "montreal") {
    const requiredAnchors = [
      ...Array.from({ length: 14 }, (_, index) => `Turn_${String(index + 1).padStart(2, "0")}`),
      "SpeedTrap",
      "StartFinish",
      "SectorBoundary_02",
      "SectorBoundary_03",
      "HighPoint",
      "LowPoint",
    ];
    const missingAnchors = requiredAnchors.filter(
      (anchorName) => !metrics.anchorNames.includes(anchorName),
    );
    if (missingAnchors.length > 0) {
      failures.push(`missing Montreal anchors: ${missingAnchors.join(", ")}`);
    }
    if (!metrics.extensionsRequired.includes("EXT_meshopt_compression")) {
      failures.push("Montreal GLB must use local Meshopt-compatible compression");
    }
    for (const materialName of [
      "Terrain_CMM_Orthophoto_2019",
      "Montreal_Real_Asphalt",
      "Montreal_Current_OSM_HRDEM_Buildings",
      "Montreal_Current_Grandstands",
      "Montreal_Pit_Wall_Concrete",
      "Montreal_Asphalt_Runoff",
      "Sector_1_Glow",
      "Sector_2_Glow",
      "Sector_3_Glow",
    ]) {
      if (!metrics.materialNames.includes(materialName)) {
        failures.push(`missing Montreal real-world material: ${materialName}`);
      }
    }
    for (const meshName of [
      "FIA_Montreal_Centreline_10_5m_Mesh",
      "FIA_Pit_Lane_Markings_43_Boxes_Mesh",
      "FIA_Pit_Exit_Continuous_White_Guide_Line_Mesh",
      "Montreal_2026_43_Garage_Pit_Complex_Mesh",
      "Montreal_2026_Event_Grandstands_Mesh",
    ]) {
      if (!metrics.meshNames.includes(meshName)) {
        failures.push(`missing Montreal circuit mesh: ${meshName}`);
      }
    }

    validateMontrealMetadata(metadata, failures);
    if (sourceDirectory) {
      await validateSourceFiles(sourceDirectory, metadata.sourceManifest, failures);
    }
  }

  if (modelId === "catalunya") {
    const requiredAnchors = [
      ...Array.from({ length: 14 }, (_, index) => `Turn_${String(index + 1).padStart(2, "0")}`),
      "SpeedTrap",
      "StartFinish",
      "SectorBoundary_02",
      "SectorBoundary_03",
      "HighPoint",
      "LowPoint",
    ];
    const missingAnchors = requiredAnchors.filter((anchorName) => !metrics.anchorNames.includes(anchorName));
    if (missingAnchors.length > 0) {
      failures.push(`missing Catalunya anchors: ${missingAnchors.join(", ")}`);
    }
    if (!metrics.extensionsRequired.includes("EXT_meshopt_compression")) {
      failures.push("Catalunya GLB must use local Meshopt-compatible compression");
    }
    for (const materialName of [
      "Terrain_ICGC_Orthophoto_2025",
      "Catalunya_Real_Asphalt",
      "Catalunya_Current_OSM_ICGC_DSM_Buildings",
      "Catalunya_Grandstand_Seats_Red",
      "Catalunya_2026_Race_Motorhomes",
      "Catalunya_Pit_Wall_Concrete",
      "Catalunya_Real_Gravel_Runoff",
      "Sector_1_Glow",
      "Sector_2_Glow",
      "Sector_3_Glow",
    ]) {
      if (!metrics.materialNames.includes(materialName)) {
        failures.push(`missing Catalunya real-world material: ${materialName}`);
      }
    }
    for (const meshName of [
      "FIA_Catalunya_Centreline_12m_Mesh",
      "FIA_Pit_Lane_Markings_40_Boxes_Mesh",
      "FIA_Pit_Wall_Concrete_And_Fence_Mesh",
      "Catalunya_2026_40_Garage_Pit_Complex_Grandstand_Mesh",
      "Catalunya_Current_OSM_Official_Map_Grandstands_Mesh",
    ]) {
      if (!metrics.meshNames.includes(meshName)) {
        failures.push(`missing Catalunya circuit mesh: ${meshName}`);
      }
    }
    validateCatalunyaMetadata(metadata, failures);
    if (sourceDirectory) {
      await validateSourceFiles(sourceDirectory, metadata.sourceManifest, failures);
    }
  }

  if (modelId === "monza") {
    const requiredAnchors = [
      ...Array.from({ length: 11 }, (_, index) => `Turn_${String(index + 1).padStart(2, "0")}`),
      "SpeedTrap", "StartFinish", "SectorBoundary_02", "SectorBoundary_03", "HighPoint", "LowPoint",
    ];
    const missingAnchors = requiredAnchors.filter((name) => !metrics.anchorNames.includes(name));
    if (missingAnchors.length > 0) failures.push(`missing Monza anchors: ${missingAnchors.join(", ")}`);
    if (!metrics.extensionsRequired.includes("EXT_meshopt_compression")) {
      failures.push("Monza GLB must use local Meshopt-compatible compression");
    }
    for (const materialName of [
      "Terrain_PCN_Orthophoto_2012", "Monza_Real_Asphalt", "Monza_Current_OSM_PCN_DSM_Buildings",
      "Monza_Grandstand_Seats_Red", "Monza_2026_Race_Motorhomes", "Monza_Pit_Wall_Concrete",
      "Monza_Real_Gravel_Runoff", "Sector_1_Glow", "Sector_2_Glow", "Sector_3_Glow",
    ]) {
      if (!metrics.materialNames.includes(materialName)) failures.push(`missing Monza real-world material: ${materialName}`);
    }
    for (const meshName of [
      "FIA_Monza_Centreline_12m_Mesh", "FIA_Pit_Lane_Markings_60_Boxes_Mesh",
      "Monza_2026_60_Garage_Pit_Complex_Grandstand_Mesh", "Monza_Current_OSM_Official_Map_Grandstands_Mesh",
    ]) {
      if (!metrics.meshNames.includes(meshName)) failures.push(`missing Monza circuit mesh: ${meshName}`);
    }
    validateMonzaMetadata(metadata, failures);
    if (sourceDirectory) await validateSourceFiles(sourceDirectory, metadata.sourceManifest, failures);
  }

  if (modelId === "monaco") {
    const requiredAnchors = [
      ...Array.from({ length: 19 }, (_, index) => `Turn_${String(index + 1).padStart(2, "0")}`),
      "SpeedTrap",
      "StartFinish",
      "SectorBoundary_02",
      "SectorBoundary_03",
      "HighPoint",
      "LowPoint",
    ];
    const missingAnchors = requiredAnchors.filter(
      (anchorName) => !metrics.anchorNames.includes(anchorName),
    );
    if (missingAnchors.length > 0) {
      failures.push(`missing Monaco anchors: ${missingAnchors.join(", ")}`);
    }
    if (!metrics.extensionsRequired.includes("EXT_meshopt_compression")) {
      failures.push("Monaco GLB must use local Meshopt-compatible compression");
    }
    for (const materialName of [
      "Terrain_Monaco_Government_Orthophoto_2020",
      "Monaco_Street_Circuit_Asphalt",
      "Monaco_Current_OSM_Buildings",
      "Monaco_Grandstand_Frame",
      "Monaco_Pit_Wall_Concrete",
      "Monaco_Tunnel_Concrete",
      "Sector_1_Glow",
      "Sector_2_Glow",
      "Sector_3_Glow",
    ]) {
      if (!metrics.materialNames.includes(materialName)) {
        failures.push(`missing Monaco real-world material: ${materialName}`);
      }
    }
    for (const meshName of [
      "FIA_Monaco_Centreline_9m_Mesh",
      "FIA_Pit_Lane_And_Road_Markings_Mesh",
      "Monaco_Measured_Roofs_Mesh",
      "Monaco_IGN69_LiDAR_Terrain_Mesh",
      "Monaco_2026_11_Team_Pit_Complex_Mesh",
      "Monaco_2026_Current_Grandstands_Mesh",
      "Monaco_Current_OSM_Buildings_Mesh",
      "Monaco_Tunnel_Shell_Mesh",
      "Monaco_Start_Finish_Gantry_Mesh",
    ]) {
      if (!metrics.meshNames.includes(meshName)) {
        failures.push(`missing Monaco circuit mesh: ${meshName}`);
      }
    }

    const { auditMonacoSurfaces } = await import("./audit-monaco-surfaces.mjs");
    metrics.decodedSurfaceAudit = await auditMonacoSurfaces(glbBuffer, metadata);
    for (const layer of ["road", "paint"]) {
      const audit = metrics.decodedSurfaceAudit[layer];
      if (!audit.triangles || audit.intersections || audit.missingSupport) failures.push(`Monaco decoded ${layer} intersects its support surface`);
    }
    if (Object.keys(metrics.decodedSurfaceAudit.structuralConflicts).length) failures.push("Monaco structures intersect the driving envelope");
    if (metrics.decodedSurfaceAudit.pitOverlapAreaSquareMeters >= .1) failures.push("Monaco main/pit asphalt overlaps");
    if (metrics.decodedSurfaceAudit.facades.missingTextures) failures.push("Monaco facade primitives have missing textures or UVs");
    if (metrics.decodedSurfaceAudit.turnAnchors.some((anchor) => !anchor.onRoad)) failures.push("Monaco turn labels are displaced from the road");
    if (metrics.decodedSurfaceAudit.portalObstructions.length) failures.push("Monaco terrain obstructs a tunnel portal");
    if (!gltf.images?.some((image) => image.bufferView !== undefined && image.name === "monaco-government-orthophoto")) failures.push("Monaco orthophoto must be embedded");
    for (const material of gltf.materials ?? []) {
      if (!material.name?.endsWith("_Glow") && material.alphaMode === "BLEND") failures.push(`Monaco solid material is transparent: ${material.name}`);
    }
    validateMonacoMetadata(metadata, failures);
    const sourceLock = JSON.parse(await readFile(path.join(projectRoot, "docs/track-model-monaco-source-manifest.json"), "utf8"));
    if (JSON.stringify(sourceLock.sources) !== JSON.stringify(metadata.sourceManifest.sources)) failures.push("Monaco source snapshot differs from its reviewed manifest");
    if (sourceDirectory) {
      await validateSourceFiles(sourceDirectory, metadata.sourceManifest, failures);
    }
  }

  if (modelId === "silverstone") {
    const requiredAnchors = [
      ...Array.from({ length: 18 }, (_, index) => `Turn_${String(index + 1).padStart(2, "0")}`),
      "SpeedTrap",
      "StartFinish",
      "SectorBoundary_02",
      "SectorBoundary_03",
      "HighPoint",
      "LowPoint",
    ];
    const missingAnchors = requiredAnchors.filter(
      (anchorName) => !metrics.anchorNames.includes(anchorName),
    );
    if (missingAnchors.length > 0) {
      failures.push(`missing Silverstone anchors: ${missingAnchors.join(", ")}`);
    }
    if (!metrics.extensionsRequired.includes("EXT_meshopt_compression")) {
      failures.push("Silverstone GLB must use local Meshopt-compatible compression");
    }
    for (const materialName of [
      "Terrain_Silverstone_EA_LIDAR_Hybrid_Ground",
      "Silverstone_Real_Asphalt",
      "Silverstone_Current_OSM_Buildings",
      "Silverstone_Grandstand_Seats_Red",
      "Silverstone_2026_Race_Motorhomes",
      "Silverstone_Pit_Wall_Concrete",
      "Silverstone_Real_Gravel_Runoff",
      "Sector_1_Glow",
      "Sector_2_Glow",
      "Sector_3_Glow",
    ]) {
      if (!metrics.materialNames.includes(materialName)) {
        failures.push(`missing Silverstone real-world material: ${materialName}`);
      }
    }
    for (const meshName of [
      "FIA_Silverstone_Centreline_15m_Mesh",
      "FIA_Pit_Lane_Markings_41_Boxes_Mesh",
      "FIA_Pit_Straight_Dual_Fences_Mesh",
      "Silverstone_Wing_2026_41_Position_Pit_Complex_Mesh",
    ]) {
      if (!metrics.meshNames.includes(meshName)) {
        failures.push(`missing Silverstone circuit mesh: ${meshName}`);
      }
    }

    validateSilverstoneMetadata(metadata, failures);
    if (sourceDirectory) {
      await validateSourceFiles(sourceDirectory, metadata.sourceManifest, failures);
    }
  }

  if (modelId === "madring") {
    const { auditMadringSurfaces } = await import("./audit-madring-surfaces.mjs");
    metrics.decodedSurfaceAudit = await auditMadringSurfaces(glbBuffer);
    for (const name of ["edgeLines", "pitMarkings"]) {
      const audit = metrics.decodedSurfaceAudit[name];
      if (!(audit.triangles > 2000) || audit.degenerateTriangles || audit.missingSupport || audit.intersections || !(audit.minimumClearanceMeters > .005)) failures.push(`Madring decoded ${name} collapses or intersects asphalt`);
    }
    const runoffAudit = metrics.decodedSurfaceAudit.runoff;
    if (!(runoffAudit.samples > 10000) || runoffAudit.intersections || runoffAudit.missingSupport || !(runoffAudit.minimumClearanceMeters > .005)) failures.push("Madring decoded runoff intersects terrain");
    const requiredAnchors = [
      ...Array.from({ length: 22 }, (_, index) => `Turn_${String(index + 1).padStart(2, "0")}`),
      "Turn_05A", "Turn_20A", "SpeedTrap", "StartFinish", "SectorBoundary_02", "SectorBoundary_03", "HighPoint", "LowPoint",
    ];
    for (const anchor of requiredAnchors) {
      if (!metrics.anchorNames.includes(anchor)) failures.push(`missing Madring anchor: ${anchor}`);
    }
    if (!metrics.extensionsRequired.includes("EXT_meshopt_compression")) failures.push("Madring requires Meshopt compression");
    for (const [name, mode] of Object.entries(metrics.materialAlphaModes)) {
      if (name.startsWith("Madring_") && mode !== "OPAQUE") failures.push(`${name} must be opaque`);
    }
    if (metadata.coordinateReferenceSystem !== "EPSG:25830" || metadata.verticalExaggeration !== 1 || metadata.realWorldScale !== "1 Blender unit = 1 metre") failures.push("Madring must retain native metre coordinates without vertical exaggeration");
    if (!(metadata.geometry?.lengthErrorPercent < 0.5) || metadata.geometry.officialLengthMeters !== 5416) failures.push("Madring length differs from the official 5.416 km");
    if (metadata.geometry?.bankingPercent !== 24 || Math.abs(metadata.geometry.bankingAngleDegrees - Math.atan(0.24) * 180 / Math.PI) > 0.001) failures.push("La Monumental requires 24 percent banking, not 24 degrees");
    for (const key of ["surfaceClearance", "pitClearance"]) {
      if (!(metadata[key]?.sampleCount > 5000) || metadata[key].terrainPenetrations !== 0 || !(metadata[key].minimumClearanceMeters > 0)) failures.push(`Madring ${key} has missing or failed terrain audit`);
    }
    if (metadata.tunnels?.length !== 2 || metadata.tunnels.some((t) => t.minimumHeadroomMeters < 4.8 || !t.portalElevationsMeters.every(Number.isFinite))) failures.push("Madring requires two continuous road underpasses with measured portals");
    if (metadata.pitLane?.pitBoxes !== 14 || metadata.pitBuilding?.garages !== 14 || !metadata.pitLane?.fastLaneSeparator || metadata.pitLane?.entryGapMeters !== 0 || metadata.pitLane?.exitGapMeters !== 0 || !(metadata.pitLane?.physicalWall?.lengthMeters > 400)) failures.push("Madring pit complex is incomplete");
    if (!(metadata.buildings?.renderedCount > 100) || metadata.buildings.sourceToRenderCentroidDriftMeters !== 0 || metadata.buildings.remainingCorridorConflicts !== 0) failures.push("Madring LoD2 alignment failed");
    if (!(metadata.grandstands?.renderedSections > 50) || metadata.grandstands.remainingBlockOverlaps !== 0 || metadata.grandstands.remainingTrackConflicts !== 0) failures.push("Madring grandstand reservations failed");
    if (!(metadata.asphaltRunoffSourceRecords?.length > 20)) failures.push("Madring municipal runoff geometry is missing");
    if (!metadata.elevationProfile?.every((p) => [p.distanceMeters, p.elevationMeters, p.x, p.y].every(Number.isFinite))) failures.push("Madring elevation profile contains invalid samples");
    if (!metadata.officialControlPoints?.authority?.includes("map-derived")) failures.push("Madring must distinguish map-derived controls from surveyed FIA timing");
    const sources = metadata.sourceManifest?.sources ?? [];
    if (sources.length !== 16 || sources.filter((s) => s.file.startsWith("lidar-")).length !== 5) failures.push("Madring pinned source set is incomplete");
    for (const source of sources) {
      if (![source.url, source.license, source.date, source.retrievedAt, source.crs, source.resolution, source.role].every(Boolean) || !/^[a-f0-9]{64}$/.test(source.sha256)) failures.push(`Madring source provenance missing: ${source.file}`);
    }
    if (sourceDirectory) await validateSourceFiles(sourceDirectory, metadata.sourceManifest, failures);
  }

  if (failures.length > 0) {
    throw new Error(`3D asset budget failed:\n- ${failures.join("\n- ")}`);
  }

  return metrics;
}

function parseGlbJson(buffer) {
  if (buffer.length < 20 || buffer.toString("utf8", 0, 4) !== "glTF") {
    throw new Error("asset is not a GLB file");
  }

  if (buffer.readUInt32LE(4) !== 2) {
    throw new Error("only glTF 2.0 is supported");
  }

  if (buffer.readUInt32LE(8) !== buffer.length) {
    throw new Error("GLB header length does not match the file size");
  }

  const jsonChunkLength = buffer.readUInt32LE(12);
  const jsonChunkType = buffer.readUInt32LE(16);

  if (jsonChunkType !== 0x4e4f534a) {
    throw new Error("the first GLB chunk is not JSON");
  }

  return JSON.parse(buffer.toString("utf8", 20, 20 + jsonChunkLength).trim());
}

function inspectGltf(gltf, bytes, previewBytes) {
  let triangles = 0;
  let drawCalls = 0;

  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const mode = primitive.mode ?? 4;

      if (mode !== 4) {
        continue;
      }

      const accessorIndex = primitive.indices ?? primitive.attributes?.POSITION;
      const count = gltf.accessors?.[accessorIndex]?.count ?? 0;
      triangles += Math.floor(count / 3);
      drawCalls += 1;
    }
  }

  const anchorNames = (gltf.nodes ?? [])
    .map((node) => node.name)
    .filter((name) => typeof name === "string" && /^(Turn_\d{2}[A-Z]?|SpeedTrap|StartFinish|SectorBoundary_\d{2}|HighPoint|LowPoint)$/.test(name))
    .sort();

  return {
    anchorNames,
    animations: gltf.animations?.length ?? 0,
    bytes,
    drawCalls,
    extensionsRequired: gltf.extensionsRequired ?? [],
    materialAlphaModes: Object.fromEntries(
      (gltf.materials ?? [])
        .filter((material) => material.name)
        .map((material) => [material.name, material.alphaMode ?? "OPAQUE"]),
    ),
    materialNames: (gltf.materials ?? []).map((material) => material.name).filter(Boolean),
    materials: gltf.materials?.length ?? 0,
    meshNames: (gltf.meshes ?? []).map((mesh) => mesh.name).filter(Boolean),
    meshes: gltf.meshes?.length ?? 0,
    nodes: gltf.nodes?.length ?? 0,
    previewBytes,
    triangles,
  };
}

function validateZandvoortMetadata(metadata, failures) {
  const layoutQuality = metadata.layoutQuality;

  if (metadata.schemaVersion !== 2) {
    failures.push(`unexpected Zandvoort metadata schema: ${metadata.schemaVersion}`);
  }
  if (metadata.realWorldScale !== "1 unit = 1 metre; no vertical exaggeration") {
    failures.push("Zandvoort metadata must confirm real scale without vertical exaggeration");
  }
  if (metadata.coordinateReferenceSystem !== "EPSG:28992 + NAP") {
    failures.push(`unexpected coordinate reference system: ${metadata.coordinateReferenceSystem}`);
  }
  if (metadata.lapLength?.officialFiaMeters !== 4_259) {
    failures.push(`official FIA lap length is not 4,259 m: ${metadata.lapLength?.officialFiaMeters}`);
  }
  if (!(metadata.lapLength?.relativeErrorPercent <= 0.1)) {
    failures.push(`centreline differs from FIA length by ${metadata.lapLength?.relativeErrorPercent}%`);
  }
  if (metadata.objects?.turnAnchors !== 14) {
    failures.push(`expected 14 turn anchors, got ${metadata.objects?.turnAnchors}`);
  }
  if ((metadata.objects?.buildingLoD22 ?? 0) < 580) {
    failures.push(`expected at least 580 current LoD2.2 buildings, got ${metadata.objects?.buildingLoD22}`);
  }
  if ((metadata.objects?.buildingsTotal ?? 0) < 650) {
    failures.push(`expected at least 650 positioned buildings, got ${metadata.objects?.buildingsTotal}`);
  }
  if ((metadata.objects?.buildingBgtFallback ?? 0) < 10) {
    failures.push("BGT buildings missing from 3DBAG were not rendered");
  }
  if ((metadata.objects?.fenceSegments ?? 0) < 2_000) {
    failures.push(`expected at least 2,000 fence segments, got ${metadata.objects?.fenceSegments}`);
  }
  if ((metadata.objects?.raceMotorhomes ?? 0) < 11) {
    failures.push(`expected 11 georeferenced race motorhomes, got ${metadata.objects?.raceMotorhomes ?? "missing"}`);
  }
  if (layoutQuality?.motorhomes?.remainingTrackConflicts !== 0) {
    failures.push("race motorhomes must stay outside the circuit and pit-lane ribbons");
  }
  if (layoutQuality?.motorhomes?.renderedObjects !== layoutQuality?.motorhomes?.configuredObjects) {
    failures.push("not all georeferenced race motorhomes were rendered");
  }
  if ((metadata.objects?.trees ?? 0) < 150 || (metadata.objects?.lightMasts ?? 0) < 60) {
    failures.push("BGT trees or light masts are incomplete");
  }
  if (metadata.sectorBoundaryDistancesMeters?.length !== 2) {
    failures.push("two FIA sector boundaries are required");
  }
  if (layoutQuality?.surfaceClearance?.remainingBgtCircuitOverlaps !== 0) {
    failures.push("BGT surface polygons must not intersect the circuit or pit-lane ribbons");
  }
  if (layoutQuality?.surfaceClearance?.renderedBgtSurfaceOverlayFeatures !== 0) {
    failures.push(
      `synthetic BGT ground overlays must be disabled, got ${layoutQuality?.surfaceClearance?.renderedBgtSurfaceOverlayFeatures ?? "missing"}`,
    );
  }
  if (!(layoutQuality?.surfaceClearance?.surfaceFeaturesPreservedInOrthophoto > 0)) {
    failures.push("BGT ground classes are not accounted for in the real orthophoto surface");
  }
  if (layoutQuality?.surfaceClearance?.renderedWaterOverlayFeatures !== 0) {
    failures.push(
      `synthetic BGT water overlays must be disabled, got ${layoutQuality?.surfaceClearance?.renderedWaterOverlayFeatures ?? "missing"}`,
    );
  }
  if (!(layoutQuality?.surfaceClearance?.minimumTrackTerrainClearanceMeters >= 0.15)) {
    failures.push(
      `track-to-terrain clearance is ${layoutQuality?.surfaceClearance?.minimumTrackTerrainClearanceMeters ?? "missing"} m`,
    );
  }
  if (layoutQuality?.surfaceClearance?.terrainBreakthroughSamples !== 0) {
    failures.push(
      `terrain still breaks through the circuit at ${layoutQuality?.surfaceClearance?.terrainBreakthroughSamples ?? "missing"} samples`,
    );
  }
  if (!(layoutQuality?.surfaceClearance?.startStraightMinimumClearanceMeters >= 0.20)) {
    failures.push(
      `start-straight terrain clearance is ${layoutQuality?.surfaceClearance?.startStraightMinimumClearanceMeters ?? "missing"} m`,
    );
  }
  if (layoutQuality?.buildings?.remainingTrackConflicts !== 0) {
    failures.push("3DBAG buildings must not intersect the circuit safety corridor");
  }
  if (layoutQuality?.buildings?.remainingGrandstandConflicts !== 0) {
    failures.push("3DBAG buildings must not intersect grandstand footprints");
  }
  if (!(layoutQuality?.buildings?.excludedGrandstandConflicts >= 1)) {
    failures.push("the permanent building over the main grandstand was not filtered");
  }
  if (!(layoutQuality?.buildings?.maximumRenderedCentroidDeltaMeters <= 0.05)) {
    failures.push(
      `rendered buildings are displaced from BGT by ${layoutQuality?.buildings?.maximumRenderedCentroidDeltaMeters ?? "missing"} m`,
    );
  }
  if (!(layoutQuality?.buildings?.replacedStale3dBagWithBgt >= 1)) {
    failures.push("stale 3DBAG geometry was not replaced with the current BGT footprint");
  }
  if (
    (metadata.objects?.buildingsTotal ?? 0) + (layoutQuality?.buildings?.excludedTrackConflicts ?? 0)
      + (layoutQuality?.buildings?.excludedGrandstandConflicts ?? 0)
    < (layoutQuality?.buildings?.sourceActiveBgtFootprints ?? Number.POSITIVE_INFINITY)
  ) {
    failures.push("not all active BGT building footprints are represented in the scene");
  }
  if (layoutQuality?.grandstands?.remainingTrackConflicts !== 0) {
    failures.push("grandstands must not intersect the circuit safety corridor");
  }
  if (layoutQuality?.grandstands?.remainingBlockOverlaps !== 0) {
    failures.push("grandstand sections must not overlap each other");
  }
  if (!(layoutQuality?.grandstands?.minimumTrackClearanceMeters >= 2.5)) {
    failures.push(
      `grandstand track clearance is ${layoutQuality?.grandstands?.minimumTrackClearanceMeters ?? "missing"} m`,
    );
  }
  if (
    !(layoutQuality?.grandstands?.renderedSections > 0) ||
    !(layoutQuality?.grandstands?.candidateSections >= layoutQuality?.grandstands?.renderedSections)
  ) {
    failures.push("grandstand collision pass did not produce valid sections");
  }
  if (!(layoutQuality?.grandstands?.maximumSeatRowTwistMeters <= 0.02)) {
    failures.push(
      `grandstand rows twist by ${layoutQuality?.grandstands?.maximumSeatRowTwistMeters ?? "missing"} m`,
    );
  }
  if (!(layoutQuality?.grandstands?.maximumPlatformStepMeters <= 0.45)) {
    failures.push(
      `adjacent grandstand platforms step by ${layoutQuality?.grandstands?.maximumPlatformStepMeters ?? "missing"} m`,
    );
  }
  if (layoutQuality?.grandstands?.verifiedTurnTenZone !== "Eastside Grandstands 1, 2, 3") {
    failures.push("turn 10 must be verified against the official Eastside grandstand zone");
  }
  if (!(layoutQuality?.pitLane?.lengthMeters >= 700 && layoutQuality?.pitLane?.lengthMeters <= 800)) {
    failures.push(`pit-lane length is invalid: ${layoutQuality?.pitLane?.lengthMeters ?? "missing"} m`);
  }
  if (!(layoutQuality?.pitLane?.widthMeters >= 10 && layoutQuality?.pitLane?.widthMeters <= 13)) {
    failures.push(`pit-lane width is invalid: ${layoutQuality?.pitLane?.widthMeters ?? "missing"} m`);
  }
  if (layoutQuality?.pitLane?.pitBoxes !== 32) {
    failures.push(`expected 32 pit boxes, got ${layoutQuality?.pitLane?.pitBoxes ?? "missing"}`);
  }
  if (layoutQuality?.pitLane?.fastLaneSeparator !== true) {
    failures.push("pit lane is missing its fast-lane separator");
  }
  if (!(layoutQuality?.pitLane?.pitWall?.lengthMeters >= 450)) {
    failures.push(`pit wall is too short: ${layoutQuality?.pitLane?.pitWall?.lengthMeters ?? "missing"} m`);
  }
  if (!(layoutQuality?.pitLane?.pitWall?.wallHeightMeters >= 1)) {
    failures.push("pit lane is missing its concrete wall");
  }
  if (!(layoutQuality?.pitLane?.pitWall?.fenceHeightMeters >= 1)) {
    failures.push("pit lane is missing its safety fence");
  }
  if (!(layoutQuality?.pitLane?.pitWall?.panels >= 140)) {
    failures.push(`pit-wall fence panels are incomplete: ${layoutQuality?.pitLane?.pitWall?.panels ?? "missing"}`);
  }
  if (!(layoutQuality?.pitLane?.taperMeters >= 20)) {
    failures.push("pit-lane entry and exit tapers are missing");
  }
  if (
    !(layoutQuality?.pitLane?.entryGapMeters <= 0.25) ||
    !(layoutQuality?.pitLane?.exitGapMeters <= 0.25)
  ) {
    failures.push("pit-lane entry and exit must connect to the main circuit");
  }
  const licenses = new Set(metadata.sourceManifest?.sources?.map((source) => source.license));
  for (const requiredLicense of ["CC0 1.0", "CC BY 4.0", "ODbL 1.0"]) {
    if (!licenses.has(requiredLicense)) {
      failures.push(`source manifest is missing ${requiredLicense} data`);
    }
  }
  const officialSources = metadata.officialSources ?? [];
  if (!officialSources.some((source) => source.url?.includes("2025_F1-Wayfinding-Map"))) {
    failures.push("official Dutch GP wayfinding map is missing from model metadata");
  }
  if (!officialSources.some((source) => source.url?.includes("/en/tribunes/"))) {
    failures.push("current 2026 Dutch GP grandstand confirmation is missing from model metadata");
  }
}

function validateSpaMetadata(metadata, failures) {
  const quality = metadata.layoutQuality;

  if (metadata.schemaVersion !== 3) {
    failures.push(`unexpected Spa metadata schema: ${metadata.schemaVersion}`);
  }
  if (metadata.realWorldScale !== "1 unit = 1 metre; no vertical exaggeration") {
    failures.push("Spa metadata must confirm real scale without vertical exaggeration");
  }
  if (metadata.coordinateReferenceSystem !== "EPSG:3812 + DNG (EPSG:5710)") {
    failures.push(`unexpected Spa coordinate reference system: ${metadata.coordinateReferenceSystem}`);
  }
  if (metadata.lapLength?.officialFiaMeters !== 7_004) {
    failures.push(`official FIA Spa lap length is not 7,004 m: ${metadata.lapLength?.officialFiaMeters}`);
  }
  if (!(metadata.lapLength?.relativeErrorPercent <= 0.5)) {
    failures.push(`Spa centreline differs from FIA length by ${metadata.lapLength?.relativeErrorPercent}%`);
  }
  if (metadata.objects?.turnAnchors !== 19) {
    failures.push(`expected 19 Spa turn anchors, got ${metadata.objects?.turnAnchors}`);
  }
  if (JSON.stringify(metadata.sectorBoundaryDistancesMeters) !== JSON.stringify([2_254, 5_074])) {
    failures.push(`unexpected Spa sector boundaries: ${metadata.sectorBoundaryDistancesMeters}`);
  }
  if ((metadata.objects?.buildingsTotal ?? 0) < 100) {
    failures.push(`expected at least 100 current Spa buildings, got ${metadata.objects?.buildingsTotal}`);
  }
  if ((metadata.objects?.mappedGrandstands ?? 0) < 5) {
    failures.push(`expected at least 5 mapped Spa grandstands, got ${metadata.objects?.mappedGrandstands}`);
  }
  if ((metadata.objects?.grandstandSections ?? 0) < 10) {
    failures.push(`expected current GP grandstand sections, got ${metadata.objects?.grandstandSections}`);
  }
  if ((metadata.objects?.fenceSegments ?? 0) < 300) {
    failures.push(`expected at least 300 mapped barrier segments, got ${metadata.objects?.fenceSegments}`);
  }
  if ((metadata.objects?.trees ?? 0) < 100) {
    failures.push(`expected Ardennes tree groups, got ${metadata.objects?.trees}`);
  }
  if ((metadata.objects?.runoffSections ?? 0) < 100) {
    failures.push(`expected modelled runoff sections, got ${metadata.objects?.runoffSections}`);
  }
  if ((metadata.objects?.raceMotorhomes ?? 0) < 10) {
    failures.push(`expected paddock race motorhomes, got ${metadata.objects?.raceMotorhomes}`);
  }
  if (quality?.motorhomes?.remainingTrackConflicts !== 0) {
    failures.push("Spa race motorhomes must stay outside the circuit and pit-lane ribbons");
  }
  if (quality?.buildings?.remainingTrackConflicts !== 0) {
    failures.push("Spa buildings must not intersect the circuit safety corridor");
  }
  if (!(quality?.surfaceClearance?.minimumTrackTerrainClearanceMeters >= 0.15)) {
    failures.push(`Spa track-to-terrain clearance is ${quality?.surfaceClearance?.minimumTrackTerrainClearanceMeters ?? "missing"} m`);
  }
  if (quality?.surfaceClearance?.terrainBreakthroughSamples !== 0) {
    failures.push(`terrain breaks through Spa circuit at ${quality?.surfaceClearance?.terrainBreakthroughSamples ?? "missing"} samples`);
  }
  if (quality?.pitLane?.pitBoxes !== 42) {
    failures.push(`expected 42 Spa garage slots, got ${quality?.pitLane?.pitBoxes ?? "missing"}`);
  }
  if (!(quality?.pitLane?.lengthMeters >= 650 && quality?.pitLane?.lengthMeters <= 850)) {
    failures.push(`Spa pit-lane length is invalid: ${quality?.pitLane?.lengthMeters ?? "missing"} m`);
  }
  if (quality?.pitLane?.fastLaneSeparator !== true) {
    failures.push("Spa pit lane is missing its fast-lane separator");
  }
  if (!(quality?.pitLane?.entryMinimumWidthMeters >= 4)) {
    failures.push(`Spa pit-lane entry is incomplete: ${quality?.pitLane?.entryMinimumWidthMeters ?? "missing"} m`);
  }
  if (quality?.pitLane?.entrySurface !== "asphalt" || quality?.pitLane?.taperProfile !== "smoothstep") {
    failures.push("Spa pit-lane entry must use a continuous smooth asphalt taper");
  }
  if (quality?.runoff?.pitEntrySurface !== "asphalt" || quality?.runoff?.syntheticGravelAtPitEntry !== false) {
    failures.push("Spa turns 18-19 still contain synthetic gravel over the pit entry");
  }
  if (quality?.runoff?.syntheticRunoffAtPitEntry !== false || quality?.runoff?.pitEntryGroundContext !== "orthophoto") {
    failures.push("Spa turns 18-19 still contain synthetic runoff polygons over the orthophoto");
  }
  if (!(quality?.pitLane?.pitWall?.lengthMeters >= 400)) {
    failures.push(`Spa pit wall is too short: ${quality?.pitLane?.pitWall?.lengthMeters ?? "missing"} m`);
  }
  if (!(quality?.pitLane?.pitWall?.wallHeightMeters <= 0.8)) {
    failures.push(`Spa pit-wall divider is too tall: ${quality?.pitLane?.pitWall?.wallHeightMeters ?? "missing"} m`);
  }
  if (!(quality?.pitLane?.pitWall?.fenceHeightMeters <= 0.85)) {
    failures.push(`Spa pit-wall fence is too tall: ${quality?.pitLane?.pitWall?.fenceHeightMeters ?? "missing"} m`);
  }
  if (quality?.pitLane?.pitComplex?.garageBoxes !== 42) {
    failures.push(`Spa pit complex must contain 42 garage boxes, got ${quality?.pitLane?.pitComplex?.garageBoxes ?? "missing"}`);
  }
  if (!(quality?.pitLane?.pitComplex?.grandstandRows >= 8)) {
    failures.push("Spa pit complex is missing the grandstand above its garages");
  }
  if (quality?.buildings?.excludedReplacedCircuitStructures !== 2) {
    failures.push("obsolete Spa pit and Endurance building blocks were not replaced");
  }
  if (quality?.buildings?.downwardFacingRoofTriangles !== 0) {
    failures.push("Spa buildings contain downward-facing or missing roof surfaces");
  }
  if (!(quality?.buildings?.roofTriangles > 0)) {
    failures.push("Spa buildings are missing roof geometry");
  }
  if (quality?.mappedGrandstands?.roofedStructures !== metadata.objects?.mappedGrandstands) {
    failures.push("Spa mapped structures are missing covered roofs");
  }
  if (quality?.mappedGrandstands?.downwardFacingRoofTriangles !== 0) {
    failures.push("Spa mapped structure roofs face away from the viewer");
  }
  if (quality?.mappedGrandstands?.redRoofSurfaces !== 0) {
    failures.push("Spa mapped structures still use synthetic red roof surfaces");
  }
  if (quality?.motorhomes?.behindPitComplex !== true) {
    failures.push("Spa motorhomes are not confirmed behind the pit complex");
  }
  if (!(quality?.grandstands?.maximumSupportHeightMeters <= 12.5)) {
    failures.push(`Spa grandstand supports are too tall: ${quality?.grandstands?.maximumSupportHeightMeters ?? "missing"} m`);
  }
  if (quality?.surfaceSmoothing?.afterTurn17?.applied !== true) {
    failures.push("Spa track surface after turn 17 was not smoothed");
  }
  if (!(quality?.surfaceSmoothing?.afterTurn17?.maximumCorrectionMeters <= 4)) {
    failures.push(`Spa turn-17 smoothing correction is excessive: ${quality?.surfaceSmoothing?.afterTurn17?.maximumCorrectionMeters ?? "missing"} m`);
  }
  const licenses = new Set(metadata.sourceManifest?.sources?.map((source) => source.license));
  for (const requiredLicense of ["CC BY 4.0", "ODbL 1.0"]) {
    if (!licenses.has(requiredLicense)) {
      failures.push(`Spa source manifest is missing ${requiredLicense} data`);
    }
  }
  const officialSources = metadata.officialSources ?? [];
  if (!officialSources.some((source) => source.url?.includes("season-2026-2072"))) {
    failures.push("official FIA 2026 Spa document index is missing from model metadata");
  }
  if (!officialSources.some((source) => source.url?.includes("spagrandprix.com"))) {
    failures.push("current official Spa GP grandstand map is missing from model metadata");
  }
}

function validateHungaroringMetadata(metadata, failures) {
  const quality = metadata.layoutQuality;

  if (metadata.schemaVersion !== 4) {
    failures.push(`unexpected Hungaroring metadata schema: ${metadata.schemaVersion}`);
  }
  if (metadata.realWorldScale !== "1 unit = 1 metre; no vertical exaggeration") {
    failures.push("Hungaroring metadata must confirm real scale without vertical exaggeration");
  }
  if (metadata.coordinateReferenceSystem !== "EPSG:32634 + source DEM metres") {
    failures.push(`unexpected Hungaroring coordinate reference system: ${metadata.coordinateReferenceSystem}`);
  }
  if (metadata.lapLength?.officialFiaMeters !== 4_381) {
    failures.push(`official FIA Hungaroring lap length is not 4,381 m: ${metadata.lapLength?.officialFiaMeters}`);
  }
  if (!(metadata.lapLength?.relativeErrorPercent <= 0.5)) {
    failures.push(`Hungaroring centreline differs from FIA length by ${metadata.lapLength?.relativeErrorPercent}%`);
  }
  if (metadata.objects?.turnAnchors !== 14) {
    failures.push(`expected 14 Hungaroring turn anchors, got ${metadata.objects?.turnAnchors}`);
  }
  if (JSON.stringify(metadata.sectorBoundaryDistancesMeters) !== JSON.stringify([1_736, 3_278])) {
    failures.push(`unexpected Hungaroring sector boundaries: ${metadata.sectorBoundaryDistancesMeters}`);
  }
  if ((metadata.objects?.buildingsTotal ?? 0) < 20) {
    failures.push(`expected at least 20 current Hungaroring buildings, got ${metadata.objects?.buildingsTotal}`);
  }
  if ((metadata.objects?.grandstandSections ?? 0) < 80) {
    failures.push(`expected current Hungaroring GP grandstand sections, got ${metadata.objects?.grandstandSections}`);
  }
  if ((metadata.objects?.fenceSegments ?? 0) < 200) {
    failures.push(`expected at least 200 mapped Hungaroring barrier segments, got ${metadata.objects?.fenceSegments}`);
  }
  if ((metadata.objects?.mappedTrees ?? 0) < 40) {
    failures.push(`expected mapped Hungaroring tree context, got ${metadata.objects?.mappedTrees}`);
  }
  if ((metadata.objects?.runoffSections ?? 0) < 200) {
    failures.push(`expected modelled Hungaroring runoff sections, got ${metadata.objects?.runoffSections}`);
  }
  if ((metadata.objects?.raceMotorhomes ?? 0) < 10) {
    failures.push(`expected Hungaroring paddock race motorhomes, got ${metadata.objects?.raceMotorhomes}`);
  }
  if (quality?.motorhomes?.remainingTrackConflicts !== 0) {
    failures.push("Hungaroring race motorhomes must stay outside the circuit and pit-lane ribbons");
  }
  if (quality?.motorhomes?.behindPitComplex !== true) {
    failures.push("Hungaroring motorhomes are not confirmed behind the pit complex");
  }
  if (quality?.motorhomes?.compactCluster !== true || !(quality?.motorhomes?.clusterSpanMeters <= 75)) {
    failures.push("Hungaroring motorhomes must form a compact paddock cluster");
  }
  if (quality?.motorhomes?.rearTowardPitGrandstand !== true) {
    failures.push("Hungaroring motorhomes must face rear-first toward the pit grandstand");
  }
  if (quality?.buildings?.remainingTrackConflicts !== 0) {
    failures.push("Hungaroring buildings must not intersect the circuit safety corridor");
  }
  if (!(quality?.surfaceClearance?.minimumTrackTerrainClearanceMeters >= 0.15)) {
    failures.push(`Hungaroring track-to-terrain clearance is ${quality?.surfaceClearance?.minimumTrackTerrainClearanceMeters ?? "missing"} m`);
  }
  if (quality?.surfaceClearance?.terrainBreakthroughSamples !== 0) {
    failures.push(`terrain breaks through Hungaroring at ${quality?.surfaceClearance?.terrainBreakthroughSamples ?? "missing"} samples`);
  }
  if (quality?.surfaceSmoothing?.wholeLap?.applied !== true) {
    failures.push("Hungaroring racing surface was not smoothed around the full lap");
  }
  if (!(quality?.surfaceSmoothing?.wholeLap?.maximumCorrectionMeters <= 4)) {
    failures.push(`Hungaroring surface smoothing correction is excessive: ${quality?.surfaceSmoothing?.wholeLap?.maximumCorrectionMeters ?? "missing"} m`);
  }
  if (!(quality?.surfaceSmoothing?.wholeLap?.maximumSmoothedStepMeters < quality?.surfaceSmoothing?.wholeLap?.maximumRawStepMeters)) {
    failures.push("Hungaroring surface smoothing did not reduce DEM steps");
  }
  if (quality?.runoff?.syntheticGravelAtPitEntry !== false || quality?.runoff?.syntheticRunoffAtPitEntry !== false) {
    failures.push("Hungaroring pit entry still contains synthetic gravel or runoff polygons");
  }
  if (JSON.stringify(quality?.runoff?.excludedTurns) !== JSON.stringify([12, 13, 14])) {
    failures.push(`unexpected Hungaroring pit-entry runoff exclusion: ${quality?.runoff?.excludedTurns}`);
  }
  if (!(quality?.curbs?.innerOffsetMeters > 7.5) || !(quality?.curbs?.widthMeters >= 1.1) || !(quality?.curbs?.visibleHeightMeters >= 0.1)) {
    failures.push("Hungaroring curbs are not fully outside and visibly above the 15 m asphalt ribbon");
  }
  if (quality?.pitLane?.pitBoxes !== 36) {
    failures.push(`expected 36 Hungaroring garage slots, got ${quality?.pitLane?.pitBoxes ?? "missing"}`);
  }
  if (!(quality?.pitLane?.lengthMeters >= 1_000 && quality?.pitLane?.lengthMeters <= 1_120)) {
    failures.push(`Hungaroring pit-lane length is invalid: ${quality?.pitLane?.lengthMeters ?? "missing"} m`);
  }
  if (quality?.pitLane?.fastLaneSeparator !== true) {
    failures.push("Hungaroring pit lane is missing its fast-lane separator");
  }
  if (!(quality?.pitLane?.entryMinimumWidthMeters >= 4)) {
    failures.push(`Hungaroring pit-lane entry is incomplete: ${quality?.pitLane?.entryMinimumWidthMeters ?? "missing"} m`);
  }
  if (quality?.pitLane?.entrySurface !== "asphalt" || quality?.pitLane?.taperProfile !== "smoothstep") {
    failures.push("Hungaroring pit-lane entry must use a continuous smooth asphalt taper");
  }
  if (!(quality?.pitLane?.pitWall?.lengthMeters >= 700)) {
    failures.push(`Hungaroring pit wall is too short: ${quality?.pitLane?.pitWall?.lengthMeters ?? "missing"} m`);
  }
  if (!(quality?.pitLane?.pitWall?.wallHeightMeters <= 0.55)) {
    failures.push(`Hungaroring pit divider is too tall: ${quality?.pitLane?.pitWall?.wallHeightMeters ?? "missing"} m`);
  }
  if (!(quality?.pitLane?.pitWall?.fenceHeightMeters <= 0.65)) {
    failures.push(`Hungaroring pit divider fence is too tall: ${quality?.pitLane?.pitWall?.fenceHeightMeters ?? "missing"} m`);
  }
  if (quality?.pitLane?.pitWall?.placement !== "between main circuit and pit lane") {
    failures.push("Hungaroring pit divider is not confirmed between the circuit and pit lane");
  }
  if (quality?.pitLane?.pitComplex?.garageBoxes !== 36) {
    failures.push(`Hungaroring pit complex must contain 36 garage boxes, got ${quality?.pitLane?.pitComplex?.garageBoxes ?? "missing"}`);
  }
  if (!(quality?.pitLane?.pitComplex?.grandstandRows >= 8)) {
    failures.push("Hungaroring pit complex is missing the grandstand above its garages");
  }
  if (quality?.buildings?.downwardFacingRoofTriangles !== 0) {
    failures.push("Hungaroring buildings contain downward-facing or missing roof surfaces");
  }
  if (!(quality?.buildings?.roofTriangles > 0)) {
    failures.push("Hungaroring buildings are missing roof geometry");
  }
  if (quality?.terrainSurface?.macroColorSource !== "2022 orthophoto overview") {
    failures.push("Hungaroring terrain must retain the licensed 2022 macro-colour source");
  }
  if (quality?.terrainSurface?.detailSource !== "current OpenStreetMap ground geometry") {
    failures.push("Hungaroring terrain is missing its current OSM fine-detail source");
  }
  if (!(quality?.terrainSurface?.currentGroundPolygons >= 30)) {
    failures.push(`Hungaroring terrain has too few current ground polygons: ${quality?.terrainSurface?.currentGroundPolygons ?? "missing"}`);
  }
  if (!(quality?.terrainSurface?.currentGroundLines >= 80)) {
    failures.push(`Hungaroring terrain has too few current ground lines: ${quality?.terrainSurface?.currentGroundLines ?? "missing"}`);
  }
  if (!(quality?.terrainSurface?.textureWidth >= 3_000 && quality?.terrainSurface?.textureHeight >= 3_000)) {
    failures.push("Hungaroring terrain texture is below the 3K delivery target");
  }
  const licenses = new Set(metadata.sourceManifest?.sources?.map((source) => source.license));
  for (const requiredLicense of ["CC BY 4.0", "ODbL 1.0"]) {
    if (!licenses.has(requiredLicense)) {
      failures.push(`Hungaroring source manifest is missing ${requiredLicense} data`);
    }
  }
  const officialSources = metadata.officialSources ?? [];
  if (!officialSources.some((source) => source.url?.includes("season-2026-1130"))) {
    failures.push("official FIA 2026 Hungaroring document index is missing from model metadata");
  }
  if (!officialSources.some((source) => source.url?.includes("hungaroring.hu"))) {
    failures.push("current official Hungaroring renovation confirmation is missing from model metadata");
  }
}

function validateMonacoMetadata(metadata, failures) {
  const quality = metadata.layoutQuality;
  const require = (condition, message) => { if (!condition) failures.push(message); };
  require(metadata.schemaVersion === 6, "Monaco requires measured-terrain schema 6");
  require(metadata.coordinateReferenceSystem === "EPSG:32632" && metadata.verticalDatum === "IGN69 (EPSG:5720)", "Monaco CRS/datum must match IGN rasters");
  require(metadata.verticalExaggeration === 1 && metadata.baseElevationMeters === 0, "Monaco must use unexaggerated absolute metre elevations");
  require(metadata.lapLength?.officialFiaMeters === 3337 && metadata.lapLength.relativeErrorPercent <= .5, "Monaco lap length must match FIA within 0.5%");
  require(metadata.objects?.turnAnchors === 19, "Monaco requires 19 turn anchors");
  require(metadata.turnAnchors?.length === 19 && metadata.turnAnchors.every(anchor => anchor.offsetMeters === 0), "Monaco turn labels must sit on their apex centreline");
  require(quality?.buildings?.facades?.texturedFootprints === metadata.objects?.buildingsTotal && quality.buildings.facades.materialVariants === 4, "Monaco requires textured facades on every building");
  require(quality?.tunnel?.terrainOpenings && quality.tunnel.portals?.length === 4 && quality.tunnel.portals.every(portal => portal.position?.length === 3 && portal.clearHeightMeters >= 5), "Monaco tunnel portals require open driving envelopes");
  require(metadata.objects?.startGantries === 1, "Monaco requires a physical start-light frame");
  require(quality?.terrainSurface?.orthophoto?.projection === "inverse UTM32N to Web Mercator mesh; 32 pixel cells", "Monaco orthophoto must be reprojected, not stretched into UTM bounds");
  require(JSON.stringify(metadata.sectorBoundaryDistancesMeters) === JSON.stringify([1051,2470]), "Monaco sectors must match FIA 2026");
  require(JSON.stringify(metadata.turnAnchorDistancesMeters) === JSON.stringify([219,604,759,897,1124,1255,1345,1438,1750,2090,2132,2374,2537,2573,2698,2726,2788,2921,3015]), "Monaco turn locations changed without revalidation");
  require(metadata.objects?.buildingsTotal >= 1000 && quality?.buildings?.measuredRoofCount >= 990, "Monaco requires the measured city, not arbitrary-height boxes");
  require(quality?.buildings?.multipolygonCount >= 20, "Monaco building relations are missing");
  for (const id of ["relation/2093796", "relation/8280869", "relation/8269572"]) {
    require(quality?.buildings?.rendered?.some((item) => item.id === id), `Monaco landmark is missing: ${id}`);
  }
  require(quality?.buildings?.roofedFootprints === metadata.objects?.buildingsTotal && quality.buildings.opaqueRoofMaterial, "Monaco buildings require opaque roof caps");
  require(quality?.buildings?.remainingTrackConflicts === 0 && quality.buildings.excluded?.every((item) => item.id && item.reason), "Monaco requires an explicit building exclusion audit");
  require(JSON.stringify(quality?.grandstands?.groups) === JSON.stringify(["A","B","E","K","L","N","O","P","T","V","X"]), "Monaco 2026 stand groups are incomplete");
  require(quality?.grandstands?.sections?.length === 19 && quality.grandstands.blockOverlapPairs === 0 && quality.grandstands.minimumTrackClearanceMeters >= .8, "Monaco grandstands overlap each other or the driving corridor");
  require(quality?.surfaceClearance?.terrainBreakthroughSamples === 0 && quality.surfaceClearance.minimumTrackTerrainClearanceMeters >= .1, "Monaco ground breaks through its road");
  require(quality?.surfaceClearance?.sampleCount > 50000 && quality.surfaceClearance.tunnelUndergroundSamples > 0, "Monaco requires dense surface and tunnel checks");
  require(quality?.surfaceSmoothing?.wholeLap?.maximumCorrectionMeters <= 4 && quality.surfaceSmoothing.wholeLap.maximumGradePercent < 12, "Monaco road has excessive correction or grade");
  require(quality?.tunnel?.roofed === true && Math.abs(quality.tunnel.lengthMeters - 361.75) < .01 && quality.tunnel.portierCoverLengthMeters === 18, "Monaco must use the mapped main tunnel and separate Portier cover");
  require(quality?.pitLane?.pitComplex?.garageBoxes === 11 && quality.pitLane.pitComplex.controlUnits === 2 && quality.pitLane.pitComplex.coveredGrandstand === false, "Monaco needs FIA garages without a copied spectator stand");
  require(quality?.pitLane?.fastLaneSeparator && quality.pitLane.entryGapMeters < .05 && quality.pitLane.exitGapMeters < .05, "Monaco pit lane is disconnected or missing separation");
  require(metadata.pitElevationProfile?.length > 290 && metadata.objects?.fenceSegments > 1000, "Monaco needs a measured pit profile and physical barriers");
  require(metadata.limitations?.length >= 5 && quality?.paddock?.individualMotorhomesVerified === false && metadata.objects?.raceMotorhomes === 0, "Unverified Monaco motorhomes must not be represented as surveyed structures");
  for (const file of ["ign-mnt-1m.tif", "ign-mns-1m.tif", "ign-lidar-coverage.json", "fia-media-kit-2026.pdf", "acm-hospitality-2026.pdf", "audi-monaco-2026-garages.html", "terrain-tile-manifest.json"]) {
    require(metadata.sourceManifest?.sources?.some((source) => source.file === file && source.sha256 && source.license), `Monaco source provenance missing: ${file}`);
  }
}

function validateRedBullRingMetadata(metadata, failures) {
  const quality = metadata.layoutQuality;

  if (metadata.schemaVersion !== 5) {
    failures.push(`unexpected Red Bull Ring metadata schema: ${metadata.schemaVersion}`);
  }
  if (metadata.realWorldScale !== "1 unit = 1 metre; no vertical exaggeration") {
    failures.push("Red Bull Ring metadata must confirm real scale without vertical exaggeration");
  }
  if (metadata.coordinateReferenceSystem !== "EPSG:32633 + official Styria orthometric metres") {
    failures.push(`unexpected Red Bull Ring coordinate reference system: ${metadata.coordinateReferenceSystem}`);
  }
  if (metadata.lapLength?.officialFiaMeters !== 4_326) {
    failures.push(`official FIA Red Bull Ring lap length is not 4,326 m: ${metadata.lapLength?.officialFiaMeters}`);
  }
  if (!(metadata.lapLength?.relativeErrorPercent <= 0.5)) {
    failures.push(`Red Bull Ring centreline differs from FIA length by ${metadata.lapLength?.relativeErrorPercent}%`);
  }
  if (metadata.objects?.turnAnchors !== 10) {
    failures.push(`expected 10 Red Bull Ring turn anchors, got ${metadata.objects?.turnAnchors}`);
  }
  if (JSON.stringify(metadata.sectorBoundaryDistancesMeters) !== JSON.stringify([1_215, 2_912])) {
    failures.push(`unexpected Red Bull Ring sector boundaries: ${metadata.sectorBoundaryDistancesMeters}`);
  }
  if (
    JSON.stringify(metadata.turnAnchorDistancesMeters) !==
    JSON.stringify([453, 759, 1_392, 2_200, 2_462, 2_758, 3_021, 3_168, 3_781, 3_989])
  ) {
    failures.push(`unexpected Red Bull Ring turn apex anchors: ${metadata.turnAnchorDistancesMeters}`);
  }
  if ((metadata.objects?.buildingsTotal ?? 0) < 40) {
    failures.push(`expected at least 40 current Red Bull Ring buildings, got ${metadata.objects?.buildingsTotal}`);
  }
  if ((metadata.objects?.mappedGrandstands ?? 0) < 9) {
    failures.push(`expected all 9 mapped Red Bull Ring grandstands, got ${metadata.objects?.mappedGrandstands}`);
  }
  if ((metadata.objects?.fenceSegments ?? 0) < 150) {
    failures.push(`expected at least 150 mapped Red Bull Ring barrier segments, got ${metadata.objects?.fenceSegments}`);
  }
  if ((metadata.objects?.raceMotorhomes ?? 0) < 10) {
    failures.push(`expected Red Bull Ring paddock race motorhomes, got ${metadata.objects?.raceMotorhomes}`);
  }
  if (quality?.motorhomes?.remainingTrackConflicts !== 0) {
    failures.push("Red Bull Ring race motorhomes must stay outside the circuit and pit-lane ribbons");
  }
  if (quality?.buildings?.remainingTrackConflicts !== 0) {
    failures.push("Red Bull Ring buildings must not intersect the circuit safety corridor");
  }
  if (!(quality?.surfaceClearance?.minimumTrackTerrainClearanceMeters >= 0.15)) {
    failures.push(`Red Bull Ring track-to-terrain clearance is ${quality?.surfaceClearance?.minimumTrackTerrainClearanceMeters ?? "missing"} m`);
  }
  if (quality?.surfaceClearance?.terrainBreakthroughSamples !== 0) {
    failures.push(`terrain breaks through Red Bull Ring at ${quality?.surfaceClearance?.terrainBreakthroughSamples ?? "missing"} samples`);
  }
  if (quality?.surfaceSmoothing?.wholeLap?.applied !== true) {
    failures.push("Red Bull Ring racing surface was not smoothed around the full lap");
  }
  if (!(quality?.surfaceSmoothing?.wholeLap?.maximumCorrectionMeters <= 4)) {
    failures.push(`Red Bull Ring surface smoothing correction is excessive: ${quality?.surfaceSmoothing?.wholeLap?.maximumCorrectionMeters ?? "missing"} m`);
  }
  if (!(quality?.curbs?.widthMeters >= 1.1) || !(quality?.curbs?.visibleHeightMeters >= 0.1)) {
    failures.push("Red Bull Ring curbs are not visibly modelled outside the asphalt ribbon");
  }
  if (quality?.pitLane?.pitBoxes !== 32) {
    failures.push(`expected 32 Red Bull Ring garage slots, got ${quality?.pitLane?.pitBoxes ?? "missing"}`);
  }
  if (!(quality?.pitLane?.lengthMeters >= 950 && quality?.pitLane?.lengthMeters <= 1_050)) {
    failures.push(`Red Bull Ring pit-lane length is invalid: ${quality?.pitLane?.lengthMeters ?? "missing"} m`);
  }
  if (quality?.pitLane?.fastLaneSeparator !== true) {
    failures.push("Red Bull Ring pit lane is missing its fast-lane separator");
  }
  if (!(quality?.pitLane?.entryMinimumWidthMeters >= 4)) {
    failures.push(`Red Bull Ring pit-lane entry is incomplete: ${quality?.pitLane?.entryMinimumWidthMeters ?? "missing"} m`);
  }
  if (!(quality?.pitLane?.pitWall?.lengthMeters >= 700)) {
    failures.push(`Red Bull Ring pit wall is too short: ${quality?.pitLane?.pitWall?.lengthMeters ?? "missing"} m`);
  }
  if (quality?.pitLane?.pitComplex?.garageBoxes !== 32) {
    failures.push(`Red Bull Ring pit complex must contain 32 garage boxes, got ${quality?.pitLane?.pitComplex?.garageBoxes ?? "missing"}`);
  }
  if (
    quality?.pitLane?.pitComplex?.coveredGrandstand !== true ||
    quality?.pitLane?.pitComplex?.canopyMaterialOpaque !== true
  ) {
    failures.push("Red Bull Ring start/finish grandstand must have an opaque covered canopy");
  }
  if (quality?.grandstands?.roofedStructures !== metadata.objects?.mappedGrandstands) {
    failures.push("Red Bull Ring mapped grandstands are missing covered roofs");
  }
  if (
    quality?.grandstands?.openSeatingBowls !== metadata.objects?.mappedGrandstands ||
    quality?.grandstands?.opaqueRoofMaterial !== true
  ) {
    failures.push("Red Bull Ring grandstands must have open seating bowls and opaque covered roofs");
  }
  if (
    quality?.buildings?.roofedFootprints !== metadata.objects?.buildingsTotal ||
    quality?.buildings?.opaqueRoofMaterial !== true
  ) {
    failures.push("Red Bull Ring current buildings must have complete opaque roof caps");
  }
  if (quality?.grandstands?.currentEventConfirmation !== "all grandstands open for Formula 1 2026") {
    failures.push("current Red Bull Ring Formula 1 grandstand configuration is not confirmed");
  }
  const licenses = new Set(metadata.sourceManifest?.sources?.map((source) => source.license));
  for (const requiredLicense of ["CC BY 4.0 AT", "ODbL 1.0"]) {
    if (!licenses.has(requiredLicense)) {
      failures.push(`Red Bull Ring source manifest is missing ${requiredLicense} data`);
    }
  }
  const officialSources = metadata.officialSources ?? [];
  if (!officialSources.some((source) => source.url?.includes("season-2026-2072"))) {
    failures.push("official FIA 2026 Austrian GP document index is missing from model metadata");
  }
  if (!officialSources.some((source) => source.url?.includes("redbullring.com"))) {
    failures.push("current official Red Bull Ring event source is missing from model metadata");
  }
}

function validateMontrealMetadata(metadata, failures) {
  const quality = metadata.layoutQuality;

  if (metadata.schemaVersion !== 7) {
    failures.push(`unexpected Montreal metadata schema: ${metadata.schemaVersion}`);
  }
  if (metadata.realWorldScale !== "1 unit = 1 metre; no vertical exaggeration") {
    failures.push("Montreal metadata must confirm real scale without vertical exaggeration");
  }
  if (metadata.coordinateReferenceSystem !== "EPSG:32188 + CGVD2013") {
    failures.push(`unexpected Montreal coordinate reference system: ${metadata.coordinateReferenceSystem}`);
  }
  if (metadata.verticalDatum !== "Canadian Geodetic Vertical Datum of 2013 (CGVD2013); no vertical exaggeration") {
    failures.push(`unexpected Montreal vertical datum: ${metadata.verticalDatum}`);
  }
  if (metadata.lapLength?.officialFiaMeters !== 4_361) {
    failures.push(`official FIA Montreal lap length is not 4,361 m: ${metadata.lapLength?.officialFiaMeters}`);
  }
  if (!(metadata.lapLength?.relativeErrorPercent <= 0.1)) {
    failures.push(`Montreal centreline differs from FIA length by ${metadata.lapLength?.relativeErrorPercent}%`);
  }
  if (metadata.objects?.turnAnchors !== 14) {
    failures.push(`expected 14 Montreal turn anchors, got ${metadata.objects?.turnAnchors}`);
  }
  if (JSON.stringify(metadata.sectorBoundaryDistancesMeters) !== JSON.stringify([1_092, 2_488])) {
    failures.push(`unexpected Montreal sector boundaries: ${metadata.sectorBoundaryDistancesMeters}`);
  }
  if (
    JSON.stringify(metadata.turnAnchorDistancesMeters) !==
    JSON.stringify([226, 329, 708, 766, 995, 1_242, 1_301, 1_988, 2_070, 2_678, 2_773, 3_152, 3_869, 3_903])
  ) {
    failures.push(`unexpected Montreal turn apex anchors: ${metadata.turnAnchorDistancesMeters}`);
  }
  if ((metadata.objects?.buildingsTotal ?? 0) < 25) {
    failures.push(`expected at least 25 current Montreal buildings, got ${metadata.objects?.buildingsTotal}`);
  }
  if ((metadata.objects?.mappedGrandstands ?? 0) < 8) {
    failures.push(`expected at least 8 permanent Montreal spectator structures, got ${metadata.objects?.mappedGrandstands}`);
  }
  if ((metadata.objects?.grandstandSections ?? 0) < 35) {
    failures.push(`expected the current Montreal GP grandstand layout, got ${metadata.objects?.grandstandSections} sections`);
  }
  if ((metadata.objects?.fenceSegments ?? 0) < 100) {
    failures.push(`expected at least 100 mapped Montreal barrier segments, got ${metadata.objects?.fenceSegments}`);
  }
  if ((metadata.objects?.trees ?? 0) < 50) {
    failures.push(`expected HRDEM tree context around Montreal, got ${metadata.objects?.trees}`);
  }
  if (
    metadata.objects?.raceMotorhomes !== 0 ||
    quality?.motorhomes?.pitPlatformObjectsRemoved !== true
  ) {
    failures.push("Montreal must not contain motorhomes on the narrow pit platform");
  }
  if (quality?.buildings?.remainingTrackConflicts !== 0) {
    failures.push("Montreal buildings must not intersect the circuit safety corridor");
  }
  if (!(quality?.surfaceClearance?.minimumTrackTerrainClearanceMeters >= 0.15)) {
    failures.push(`Montreal track-to-terrain clearance is ${quality?.surfaceClearance?.minimumTrackTerrainClearanceMeters ?? "missing"} m`);
  }
  if (quality?.surfaceClearance?.terrainBreakthroughSamples !== 0) {
    failures.push(`terrain breaks through Montreal at ${quality?.surfaceClearance?.terrainBreakthroughSamples ?? "missing"} samples`);
  }
  if (quality?.surfaceSmoothing?.wholeLap?.applied !== true) {
    failures.push("Montreal racing surface was not smoothed around the full lap");
  }
  if (!(quality?.surfaceSmoothing?.wholeLap?.maximumCorrectionMeters <= 4)) {
    failures.push(`Montreal surface smoothing correction is excessive: ${quality?.surfaceSmoothing?.wholeLap?.maximumCorrectionMeters ?? "missing"} m`);
  }
  if (quality?.pitLane?.pitBoxes !== 43) {
    failures.push(`expected 43 Montreal garage slots, got ${quality?.pitLane?.pitBoxes ?? "missing"}`);
  }
  if (!(quality?.pitLane?.lengthMeters >= 780 && quality?.pitLane?.lengthMeters <= 880)) {
    failures.push(`Montreal pit-lane length is invalid: ${quality?.pitLane?.lengthMeters ?? "missing"} m`);
  }
  if (
    quality?.pitLane?.fastLaneSeparator !== true ||
    !(quality?.pitLane?.entryMinimumWidthMeters >= 0.5) ||
    quality?.pitLane?.entryJunction !== "smooth flush asphalt taper without a grey wedge"
  ) {
    failures.push("Montreal pit lane is missing its continuous entry or fast-lane separator");
  }
  if (
    !(quality?.pitLane?.exitMinimumWidthMeters >= 0.5) ||
    quality?.pitLane?.exitJunction !==
      "smooth flush asphalt merge with FIA 2026 continuous white line" ||
    quality?.pitLane?.entryWedgeBuildingRemoved !== true ||
    quality?.pitLane?.exitGuideLine?.present !== true ||
    quality?.pitLane?.exitGuideLine?.style !== "continuous white" ||
    !(quality?.pitLane?.exitGuideLine?.lengthMeters >= 55)
  ) {
    failures.push("Montreal pit entry/exit must keep the reviewed clear wedge and FIA continuous merge line");
  }
  if (
    !(quality?.pitLane?.pitWall?.wallHeightMeters >= 1) ||
    !(quality?.pitLane?.pitWall?.fenceHeightMeters >= 1.8) ||
    quality?.pitLane?.pitWall?.gatedOpenings !== true ||
    !(quality?.pitLane?.pitWall?.gatePanels >= 2)
  ) {
    failures.push("Montreal pit wall must use a real-height concrete wall, high debris fence and gated openings");
  }
  if (
    JSON.stringify(quality?.runoff?.excludedTurns) !== JSON.stringify([1, 2, 13, 14]) ||
    quality?.runoff?.syntheticRunoffAtPitExit !== false
  ) {
    failures.push("Montreal pit entry and exit must not contain synthetic grey runoff wedges");
  }
  if (quality?.pitLane?.pitComplex?.garageBoxes !== 43) {
    failures.push(`Montreal pit complex must contain 43 garage boxes, got ${quality?.pitLane?.pitComplex?.garageBoxes ?? "missing"}`);
  }
  if (
    quality?.pitLane?.pitComplex?.garageSide !== "left" ||
    quality?.pitLane?.pitComplex?.garageFrontFacesPitLane !== true ||
    !(quality?.pitLane?.pitComplex?.buildingDepthMeters >= 30)
  ) {
    failures.push("Montreal pit boxes must face the pit lane and fill the platform toward the rowing basin");
  }
  if (quality?.grandstands?.configuredGrandstands !== 10) {
    failures.push("Montreal visual review must retain ten corrected current-event grandstand zones");
  }
  if (
    JSON.stringify(quality?.grandstands?.removedAfterVisualReview) !==
      JSON.stringify(["Grandstand 1", "Grandstand 10", "Grandstand 12"]) ||
    JSON.stringify(quality?.grandstands?.relocatedAfterVisualReview) !==
      JSON.stringify(["Grandstand 31", "Grandstand 15"])
  ) {
    failures.push("Montreal grandstand review corrections are missing from metadata");
  }
  if (
    quality?.grandstands?.remainingBlockOverlaps !== 0 ||
    quality?.grandstands?.remainingTrackConflicts !== 0
  ) {
    failures.push("Montreal event grandstands contain unresolved overlaps");
  }
  if (quality?.mappedGrandstands?.openSeatingBowls !== metadata.objects?.mappedGrandstands) {
    failures.push("Montreal permanent spectator structures must use open stepped seating bowls");
  }
  if (!(quality?.buildings?.maximumCentroidDriftMeters <= 0.1)) {
    failures.push(`Montreal building centroid drift is ${quality?.buildings?.maximumCentroidDriftMeters ?? "missing"} m`);
  }
  const expectedExclusions =
    (quality?.buildings?.excludedReplacedCircuitStructures ?? 0)
    + (quality?.buildings?.excludedTrackConflicts ?? 0)
    + (quality?.buildings?.excludedGrandstandConflicts ?? 0);
  if (quality?.buildings?.excludedObjects?.length !== expectedExclusions) {
    failures.push("Montreal filtered building conflicts are missing IDs or reasons");
  }
  if (!(quality?.terrainSurface?.textureWidth >= 2_000 && quality?.terrainSurface?.textureHeight >= 4_000)) {
    failures.push("Montreal terrain texture is below the 2K × 4K delivery target");
  }
  const licenses = new Set(metadata.sourceManifest?.sources?.map((source) => source.license));
  for (const requiredLicense of ["Open Government Licence - Canada", "ODbL 1.0"]) {
    if (!licenses.has(requiredLicense)) {
      failures.push(`Montreal source manifest is missing ${requiredLicense} data`);
    }
  }
  const officialSources = metadata.officialSources ?? [];
  if (!officialSources.some((source) => source.url?.includes("Canadian%20Grand%20Prix"))) {
    failures.push("official FIA 2026 Canadian GP document index is missing from model metadata");
  }
  if (!officialSources.some((source) => source.url?.includes("gpcanada.ca"))) {
    failures.push("current official Canadian GP grandstand catalogue is missing from model metadata");
  }
  if (!officialSources.some((source) => source.url?.includes("guide-visiteurwebsite.pdf"))) {
    failures.push("official Canadian GP venue map is missing from model metadata");
  }
}

function validateCatalunyaMetadata(metadata, failures) {
  const quality = metadata.layoutQuality;
  if (metadata.schemaVersion !== 6) {
    failures.push(`unexpected Catalunya metadata schema: ${metadata.schemaVersion}`);
  }
  if (metadata.realWorldScale !== "1 unit = 1 metre; no vertical exaggeration") {
    failures.push("Catalunya metadata must confirm real scale without vertical exaggeration");
  }
  if (metadata.coordinateReferenceSystem !== "EPSG:25831 + ICGC source elevation metres") {
    failures.push(`unexpected Catalunya coordinate reference system: ${metadata.coordinateReferenceSystem}`);
  }
  if (metadata.lapLength?.officialFiaMeters !== 4_657) {
    failures.push(`official FIA Catalunya lap length is not 4,657 m: ${metadata.lapLength?.officialFiaMeters}`);
  }
  if (!(metadata.lapLength?.relativeErrorPercent <= 0.5)) {
    failures.push(`Catalunya centreline differs from FIA length by ${metadata.lapLength?.relativeErrorPercent}%`);
  }
  if (metadata.objects?.turnAnchors !== 14) {
    failures.push(`expected 14 Catalunya turn anchors, got ${metadata.objects?.turnAnchors}`);
  }
  if (JSON.stringify(metadata.sectorBoundaryDistancesMeters) !== JSON.stringify([1_273, 3_038])) {
    failures.push(`unexpected Catalunya sector boundaries: ${metadata.sectorBoundaryDistancesMeters}`);
  }
  if ((metadata.objects?.buildingsTotal ?? 0) < 80) {
    failures.push(`expected at least 80 current Catalunya buildings, got ${metadata.objects?.buildingsTotal}`);
  }
  if ((metadata.objects?.grandstandSections ?? 0) < 15) {
    failures.push(`expected current Catalunya grandstand sections, got ${metadata.objects?.grandstandSections}`);
  }
  if ((metadata.objects?.fenceSegments ?? 0) < 100) {
    failures.push(`expected at least 100 mapped Catalunya barrier segments, got ${metadata.objects?.fenceSegments}`);
  }
  if ((metadata.objects?.runoffSections ?? 0) < 150) {
    failures.push(`expected modelled Catalunya runoff sections, got ${metadata.objects?.runoffSections}`);
  }
  if ((metadata.objects?.raceMotorhomes ?? 0) < 8) {
    failures.push(`expected Catalunya paddock race motorhomes, got ${metadata.objects?.raceMotorhomes}`);
  }
  if (quality?.motorhomes?.remainingTrackConflicts !== 0) {
    failures.push("Catalunya race motorhomes must stay outside the circuit and pit-lane ribbons");
  }
  if (quality?.buildings?.remainingTrackConflicts !== 0) {
    failures.push("Catalunya buildings must not intersect the circuit safety corridor");
  }
  if (!(quality?.surfaceClearance?.minimumTrackTerrainClearanceMeters >= 0.15)) {
    failures.push(`Catalunya track-to-terrain clearance is ${quality?.surfaceClearance?.minimumTrackTerrainClearanceMeters ?? "missing"} m`);
  }
  if (quality?.surfaceClearance?.terrainBreakthroughSamples !== 0) {
    failures.push(`terrain breaks through Catalunya at ${quality?.surfaceClearance?.terrainBreakthroughSamples ?? "missing"} samples`);
  }
  if (quality?.surfaceSmoothing?.wholeLap?.applied !== true) {
    failures.push("Catalunya racing surface was not smoothed around the full lap");
  }
  if (!(quality?.surfaceSmoothing?.wholeLap?.maximumCorrectionMeters <= 4)) {
    failures.push(`Catalunya surface smoothing correction is excessive: ${quality?.surfaceSmoothing?.wholeLap?.maximumCorrectionMeters ?? "missing"} m`);
  }
  if (quality?.pitLane?.pitBoxes !== 40) {
    failures.push(`expected 40 Catalunya garage slots, got ${quality?.pitLane?.pitBoxes ?? "missing"}`);
  }
  if (!(quality?.pitLane?.lengthMeters >= 900 && quality?.pitLane?.lengthMeters <= 1_150)) {
    failures.push(`Catalunya pit-lane length is invalid: ${quality?.pitLane?.lengthMeters ?? "missing"} m`);
  }
  if (quality?.pitLane?.fastLaneSeparator !== true || !(quality?.pitLane?.entryMinimumWidthMeters >= 4)) {
    failures.push("Catalunya pit lane is missing its continuous entry or fast-lane separator");
  }
  if (
    quality?.pitLane?.pitComplex?.garageBoxes !== 40
    || quality?.pitLane?.pitComplex?.coveredGrandstand !== true
    || !(quality?.pitLane?.pitComplex?.grandstandRows >= 8)
  ) {
    failures.push("Catalunya pit complex is missing its 40 garage boxes or covered upper grandstand");
  }
  if (
    quality?.buildings?.excludedReplacedCircuitStructures !== 1
    || JSON.stringify(quality?.buildings?.replacedOsmBuildingIds) !== JSON.stringify([33_742_578])
  ) {
    failures.push("the grey OSM Boxes footprint must be replaced by the detailed Catalunya pit complex");
  }
  if (Math.abs((quality?.pitLane?.pitWall?.lengthMeters ?? 0) - 475) > 1) {
    failures.push(`Catalunya pit-wall fence must match the 475 m source system, got ${quality?.pitLane?.pitWall?.lengthMeters ?? "missing"} m`);
  }
  if (
    quality?.pitLane?.pitWall?.sourceSystemLengthMeters !== 475
    || !(quality?.pitLane?.pitWall?.wallHeightMeters >= 1)
    || !(quality?.pitLane?.pitWall?.fenceHeightMeters >= 2)
  ) {
    failures.push("Catalunya pit lane is missing its concrete wall and top-mounted debris fence");
  }
  if (
    JSON.stringify(quality?.circuitConfiguration?.currentFinalSectorWayIds)
      !== JSON.stringify([893_732_520, 831_804_325, 990_483_278])
    || quality?.circuitConfiguration?.deprecatedChicaneExcluded !== true
  ) {
    failures.push("Catalunya must use the current FIA T13-T14 bypass instead of the deprecated chicane");
  }
  if (JSON.stringify(quality?.grandstands?.excludedCurrentEventStandIds) !== JSON.stringify([725_695_175])) {
    failures.push("the requested T13-T14 grandstand exclusion is missing");
  }
  if (!(quality?.terrainSurface?.buildingSurfaceSamples >= 15)) {
    failures.push("Catalunya permanent structures are missing ICGC surface-height samples");
  }
  if (!(quality?.terrainSurface?.textureWidth >= 2_000 && quality?.terrainSurface?.textureHeight >= 1_800)) {
    failures.push("Catalunya terrain texture is below the 2K delivery target");
  }
  const licenses = new Set(metadata.sourceManifest?.sources?.map((source) => source.license));
  for (const requiredLicense of ["CC BY 4.0", "ODbL 1.0"]) {
    if (!licenses.has(requiredLicense)) failures.push(`Catalunya source manifest is missing ${requiredLicense} data`);
  }
  const officialSources = metadata.officialSources ?? [];
  if (!officialSources.some((source) => source.url?.includes("2026_barcelona_event"))) {
    failures.push("official FIA 2026 Catalunya circuit map is missing from model metadata");
  }
  if (!officialSources.some((source) => source.url?.includes("circuitcat.com"))) {
    failures.push("official Circuit de Barcelona-Catalunya event map is missing from model metadata");
  }
  if (!officialSources.some((source) => source.url?.includes("pit_lane_drawing"))) {
    failures.push("official FIA 2026 Catalunya pit-lane drawing is missing from model metadata");
  }
}

function validateMonzaMetadata(metadata, failures) {
  const quality = metadata.layoutQuality;
  if (metadata.schemaVersion !== 1) failures.push(`unexpected Monza metadata schema: ${metadata.schemaVersion}`);
  if (metadata.realWorldScale !== "1 unit = 1 metre; no vertical exaggeration") failures.push("Monza metadata must confirm real scale without vertical exaggeration");
  if (metadata.coordinateReferenceSystem !== "EPSG:32632 + Terrarium DEM metres") failures.push(`unexpected Monza coordinate reference system: ${metadata.coordinateReferenceSystem}`);
  if (metadata.lapLength?.officialFiaMeters !== 5_793) failures.push(`official Monza lap length is not 5,793 m: ${metadata.lapLength?.officialFiaMeters}`);
  if (!(metadata.lapLength?.relativeErrorPercent <= 0.5)) failures.push(`Monza centreline differs from official length by ${metadata.lapLength?.relativeErrorPercent}%`);
  if (metadata.objects?.turnAnchors !== 11) failures.push(`expected 11 Monza turn anchors, got ${metadata.objects?.turnAnchors}`);
  if (JSON.stringify(metadata.sectorBoundaryDistancesMeters) !== JSON.stringify([1_919, 3_745])) failures.push(`unexpected Monza sector boundaries: ${metadata.sectorBoundaryDistancesMeters}`);
  if ((metadata.objects?.grandstandSections ?? 0) < 19) failures.push(`expected current Monza grandstand sections, got ${metadata.objects?.grandstandSections}`);
  if ((metadata.objects?.raceMotorhomes ?? 0) < 8) failures.push(`expected Monza paddock motorhomes, got ${metadata.objects?.raceMotorhomes}`);
  if (quality?.motorhomes?.remainingTrackConflicts !== 0) failures.push("Monza motorhomes intersect a circuit ribbon");
  if (quality?.buildings?.remainingTrackConflicts !== 0) failures.push("Monza buildings intersect the circuit safety corridor");
  if (!(quality?.surfaceClearance?.minimumTrackTerrainClearanceMeters >= 0.15) || quality?.surfaceClearance?.terrainBreakthroughSamples !== 0) failures.push("Monza terrain breaks through the racing surface");
  if (quality?.surfaceSmoothing?.wholeLap?.applied !== true) failures.push("Monza full-lap surface smoothing is missing");
  if (quality?.pitLane?.pitBoxes !== 60 || quality?.pitLane?.fastLaneSeparator !== true) failures.push("Monza pit lane is missing 60 box markings or its fast-lane separator");
  if (quality?.pitLane?.pitComplex?.garageBoxes !== 60) failures.push("Monza pit complex is missing its 60 FIA positions");
  if (!(quality?.pitLane?.pitWall?.wallHeightMeters >= 1) || !(quality?.pitLane?.pitWall?.fenceHeightMeters >= 2)) failures.push("Monza pit wall or debris fence is incomplete");
  if (!(quality?.terrainSurface?.textureWidth >= 2_000 && quality?.terrainSurface?.textureHeight >= 2_000)) failures.push("Monza terrain texture is below the 2K target");
  const licenses = new Set(metadata.sourceManifest?.sources?.map((source) => source.license));
  if (!licenses.has("ODbL 1.0")) failures.push("Monza source manifest is missing ODbL data");
  const officialSources = metadata.officialSources ?? [];
  if (!officialSources.some((source) => source.url?.includes("monzanet.it/en/circuit"))) failures.push("official Monza circuit specification is missing from metadata");
  if (!officialSources.some((source) => source.url?.includes("GP_F1_2026"))) failures.push("official Monza 2026 grandstand map is missing from metadata");
}

function validateSilverstoneMetadata(metadata, failures) {
  const quality = metadata.layoutQuality;
  if (metadata.schemaVersion !== 5) {
    failures.push(`unexpected Silverstone metadata schema: ${metadata.schemaVersion}`);
  }
  if (metadata.realWorldScale !== "1 unit = 1 metre; no vertical exaggeration") {
    failures.push("Silverstone metadata must confirm real scale without vertical exaggeration");
  }
  if (metadata.coordinateReferenceSystem !== "EPSG:32630 + ODN") {
    failures.push(`unexpected Silverstone coordinate reference system: ${metadata.coordinateReferenceSystem}`);
  }
  if (metadata.verticalDatum !== "Ordnance Datum Newlyn (ODN); no vertical exaggeration") {
    failures.push(`unexpected Silverstone vertical datum: ${metadata.verticalDatum}`);
  }
  if (metadata.lapLength?.officialFiaMeters !== 5_891) {
    failures.push(`official FIA Silverstone lap length is not 5,891 m: ${metadata.lapLength?.officialFiaMeters}`);
  }
  if (!(metadata.lapLength?.relativeErrorPercent <= 0.5)) {
    failures.push(`Silverstone centreline differs from FIA length by ${metadata.lapLength?.relativeErrorPercent}%`);
  }
  if (metadata.objects?.turnAnchors !== 18) {
    failures.push(`expected 18 Silverstone turn anchors, got ${metadata.objects?.turnAnchors}`);
  }
  if (JSON.stringify(metadata.sectorBoundaryDistancesMeters) !== JSON.stringify([1_823, 4_287])) {
    failures.push(`unexpected Silverstone sector boundaries: ${metadata.sectorBoundaryDistancesMeters}`);
  }
  if ((metadata.objects?.buildingsTotal ?? 0) < 500) {
    failures.push(`expected at least 500 current Silverstone buildings, got ${metadata.objects?.buildingsTotal}`);
  }
  if ((metadata.objects?.mappedGrandstands ?? 0) < 15) {
    failures.push(`expected mapped Silverstone grandstands, got ${metadata.objects?.mappedGrandstands}`);
  }
  if ((metadata.objects?.grandstandSections ?? 0) < 60) {
    failures.push(`expected current Silverstone GP grandstand sections, got ${metadata.objects?.grandstandSections}`);
  }
  if ((metadata.objects?.fenceSegments ?? 0) < 3_000) {
    failures.push(`expected mapped Silverstone safety context, got ${metadata.objects?.fenceSegments} segments`);
  }
  if ((metadata.objects?.runoffSections ?? 0) < 250) {
    failures.push(`expected modelled Silverstone runoff, got ${metadata.objects?.runoffSections} sections`);
  }
  if ((metadata.objects?.raceMotorhomes ?? 0) < 10) {
    failures.push(`expected Silverstone paddock race motorhomes, got ${metadata.objects?.raceMotorhomes}`);
  }
  if (quality?.buildings?.remainingTrackConflicts !== 0) {
    failures.push("Silverstone buildings must not intersect the circuit safety corridor");
  }
  if (quality?.motorhomes?.remainingTrackConflicts !== 0) {
    failures.push("Silverstone race motorhomes must stay outside the circuit and pit-lane ribbons");
  }
  if (!(quality?.surfaceClearance?.minimumTrackTerrainClearanceMeters >= 0.15)) {
    failures.push(`Silverstone track-to-terrain clearance is ${quality?.surfaceClearance?.minimumTrackTerrainClearanceMeters ?? "missing"} m`);
  }
  if (quality?.surfaceClearance?.terrainBreakthroughSamples !== 0) {
    failures.push(`terrain breaks through Silverstone at ${quality?.surfaceClearance?.terrainBreakthroughSamples ?? "missing"} samples`);
  }
  if (quality?.surfaceSmoothing?.wholeLap?.applied !== true) {
    failures.push("Silverstone racing surface was not smoothed around the full lap");
  }
  if (!(quality?.surfaceSmoothing?.wholeLap?.maximumCorrectionMeters <= 4)) {
    failures.push(`Silverstone surface smoothing correction is excessive: ${quality?.surfaceSmoothing?.wholeLap?.maximumCorrectionMeters ?? "missing"} m`);
  }
  if (JSON.stringify(quality?.runoff?.excludedTurns) !== JSON.stringify([16, 17, 18])) {
    failures.push(`unexpected Silverstone pit-entry runoff exclusion: ${quality?.runoff?.excludedTurns}`);
  }
  if (quality?.runoff?.syntheticGravelAtPitEntry !== false || quality?.runoff?.syntheticRunoffAtPitEntry !== false) {
    failures.push("Silverstone pit entry still contains synthetic gravel or runoff polygons");
  }
  if (quality?.pitLane?.pitBoxes !== 41 || quality?.pitLane?.pitComplex?.garageBoxes !== 41) {
    failures.push(`Silverstone pit lane must contain 41 marked positions, got ${quality?.pitLane?.pitBoxes ?? "missing"}`);
  }
  if (!(quality?.pitLane?.lengthMeters >= 1_050 && quality?.pitLane?.lengthMeters <= 1_200)) {
    failures.push(`Silverstone pit-lane length is invalid: ${quality?.pitLane?.lengthMeters ?? "missing"} m`);
  }
  if (quality?.pitLane?.fastLaneSeparator !== true || quality?.pitLane?.taperProfile !== "smoothstep") {
    failures.push("Silverstone pit lane is missing its fast-lane separator or smooth taper");
  }
  if (!(quality?.pitLane?.pitWall?.lengthMeters >= 800)) {
    failures.push(`Silverstone pit wall is too short: ${quality?.pitLane?.pitWall?.lengthMeters ?? "missing"} m`);
  }
  if (
    quality?.pitLane?.entryApron?.surface !== "asphalt" ||
    quality?.pitLane?.entryApron?.coverageMode !== "full-road-envelope" ||
    quality?.pitLane?.entryApron?.grassBreakthroughSamples !== 0 ||
    quality?.pitLane?.entryApron?.coplanarSurfaceSamples !== 0 ||
    !(quality?.pitLane?.entryApron?.minimumEnvelopeWidthMeters >= 13) ||
    !(quality?.pitLane?.entryApron?.surfaceLiftMeters >= 0.05) ||
    quality?.pitLane?.entryApron?.startMeters !== 0 ||
    !(quality?.pitLane?.entryApron?.endMeters >= 140)
  ) {
    failures.push("Silverstone pit entry must have a continuous asphalt apron without grass breakthrough");
  }
  if (
    quality?.pitLane?.pitWall?.fenceLines !== 2 ||
    quality?.pitLane?.pitWall?.placement !== "both sides of the pit-straight separation"
  ) {
    failures.push("Silverstone pit straight must have low fences on both separation edges");
  }
  const manualStands = quality?.grandstands?.manual?.maximumSupportHeightByStandMeters ?? {};
  if (
    "The Loop" in manualStands ||
    "Vale" in manualStands ||
    "Club A" in manualStands ||
    "Club B" in manualStands ||
    "Hamilton Straight B" in manualStands
  ) {
    failures.push("Silverstone still contains grandstands blocking turn 4 or the pit-entry complex");
  }
  if (!("Woodcote B" in manualStands) || !("National Pit Straight" in manualStands)) {
    failures.push("Silverstone is missing the detailed grandstands between turns 8 and 9");
  }
  if (quality?.terrainSurface?.macroColorSource !== "Environment Agency National LIDAR Programme intensity 1 m") {
    failures.push("Silverstone terrain is missing its measured LIDAR-intensity surface source");
  }
  if (quality?.terrainSurface?.detailSource !== "current OpenStreetMap ground geometry") {
    failures.push("Silverstone terrain is missing current OSM surface detail");
  }
  if (!(quality?.terrainSurface?.currentGroundPolygons >= 400)) {
    failures.push(`Silverstone terrain has too few current ground polygons: ${quality?.terrainSurface?.currentGroundPolygons ?? "missing"}`);
  }
  if (!(quality?.terrainSurface?.currentGroundLines >= 1_000)) {
    failures.push(`Silverstone terrain has too few current ground lines: ${quality?.terrainSurface?.currentGroundLines ?? "missing"}`);
  }
  const sourceFiles = new Set(metadata.sourceManifest?.sources?.map((source) => source.file));
  for (const requiredFile of [
    "environment-agency-lidar-dtm-1m.tif",
    "environment-agency-lidar-first-return-dsm-1m.zip",
    "environment-agency-lidar-intensity-1m.zip",
    "fia-2026-british-grand-prix-maps.pdf",
    "openstreetmap-map.osm",
  ]) {
    if (!sourceFiles.has(requiredFile)) failures.push(`Silverstone source manifest is missing ${requiredFile}`);
  }
  const licenses = new Set(metadata.sourceManifest?.sources?.map((source) => source.license));
  for (const requiredLicense of ["Open Government Licence v3.0", "ODbL 1.0"]) {
    if (!licenses.has(requiredLicense)) failures.push(`Silverstone source manifest is missing ${requiredLicense} data`);
  }
  const officialSources = metadata.officialSources ?? [];
  if (!officialSources.some((source) => source.url?.includes("2026_british_grand_prix"))) {
    failures.push("official FIA 2026 Silverstone document is missing from model metadata");
  }
  if (!officialSources.some((source) => source.url?.includes("silverstone.co.uk"))) {
    failures.push("official Silverstone grandstand source is missing from model metadata");
  }
}

async function validateSourceFiles(sourceDirectory, sourceManifest, failures) {
  for (const source of sourceManifest?.sources ?? []) {
    try {
      const buffer = await readFile(path.join(sourceDirectory, source.file));
      const digest = createHash("sha256").update(buffer).digest("hex");
      if (digest !== source.sha256 || buffer.length !== source.bytes) {
        failures.push(`source checksum mismatch: ${source.file}`);
      }
    } catch (error) {
      failures.push(`source file cannot be verified: ${source.file} (${error.code ?? error.message})`);
    }
    for (const member of source.members ?? []) {
      try {
        const buffer = await readFile(path.join(sourceDirectory, member.file));
        const digest = createHash("sha256").update(buffer).digest("hex");
        if (digest !== member.sha256 || buffer.length !== member.bytes) {
          failures.push(`source checksum mismatch: ${member.file}`);
        }
      } catch (error) {
        failures.push(`source file cannot be verified: ${member.file} (${error.code ?? error.message})`);
      }
    }
  }
}

async function validateBuildingSourceAlignment(sourceDirectory, failures) {
  try {
    const [city, bgt] = await Promise.all([
      readFile(path.join(sourceDirectory, "3dbag-buildings.city.json"), "utf8").then(JSON.parse),
      readFile(path.join(sourceDirectory, "bgt/pand.geojson"), "utf8").then(JSON.parse),
    ]);
    const transform = city.metadata?.transform;
    const bgtByBag = new Map(
      bgt.features
        .filter((feature) => feature.properties?.bag_pnd && feature.properties.bag_pnd !== "0473100000000000")
        .map((feature) => [feature.properties.bag_pnd, feature]),
    );
    const deltas = [];

    for (const feature of city.features) {
      const bagId = feature.id?.replace("NL.IMBAG.Pand.", "");
      const bgtFeature = bgtByBag.get(bagId);
      if (!bgtFeature || !transform) continue;
      const vertices = feature.vertices.map((vertex) => [
        vertex[0] * transform.scale[0] + transform.translate[0],
        vertex[1] * transform.scale[1] + transform.translate[1],
      ]);
      const cityMetrics = polygonSetMetrics(cityGroundFootprints(feature, vertices));
      const bgtMetrics = polygonSetMetrics(geojsonOuterRings(bgtFeature.geometry));
      if (!cityMetrics || !bgtMetrics) continue;
      deltas.push(Math.hypot(cityMetrics.x - bgtMetrics.x, cityMetrics.y - bgtMetrics.y));
    }

    deltas.sort((first, second) => first - second);
    const median = deltas[Math.floor(deltas.length / 2)] ?? Number.POSITIVE_INFINITY;
    const p95 = deltas[Math.floor(deltas.length * 0.95)] ?? Number.POSITIVE_INFINITY;
    const withinOneMeter = deltas.filter((delta) => delta <= 1).length;
    if (deltas.length < 630 || median > 0.05 || p95 > 1 || withinOneMeter / deltas.length < 0.99) {
      failures.push(
        `3DBAG pagination is misaligned with BGT: matched=${deltas.length}, median=${median.toFixed(3)} m, p95=${p95.toFixed(3)} m`,
      );
    }
  } catch (error) {
    failures.push(`building source alignment cannot be verified: ${error.code ?? error.message}`);
  }
}

function geojsonOuterRings(geometry) {
  if (geometry?.type === "Polygon") return geometry.coordinates.slice(0, 1);
  if (geometry?.type === "MultiPolygon") return geometry.coordinates.map((polygon) => polygon[0]);
  return [];
}

function cityGroundFootprints(feature, vertices) {
  const result = [];
  for (const cityObject of Object.values(feature.CityObjects ?? {})) {
    if (cityObject.type !== "BuildingPart") continue;
    const geometry = cityObject.geometry?.find((item) => item.lod === "2.2");
    if (!geometry) continue;
    const surfaces = geometry.semantics?.surfaces ?? [];
    const values = geometry.semantics?.values?.[0] ?? [];
    for (let surfaceIndex = 0; surfaceIndex < geometry.boundaries?.[0]?.length; surfaceIndex += 1) {
      if (surfaces[values[surfaceIndex]]?.type !== "GroundSurface") continue;
      const ring = geometry.boundaries[0][surfaceIndex][0];
      if (ring?.length >= 3) result.push(ring.map((index) => vertices[index]));
    }
  }
  return result;
}

function polygonSetMetrics(polygons) {
  let totalArea = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (const sourceRing of polygons) {
    const ring = sourceRing.length > 1 && sourceRing[0][0] === sourceRing.at(-1)[0]
      && sourceRing[0][1] === sourceRing.at(-1)[1]
      ? sourceRing.slice(0, -1)
      : sourceRing;
    if (ring.length < 3) continue;
    const [originX, originY] = ring[0];
    let twiceArea = 0;
    let centroidX = 0;
    let centroidY = 0;
    for (let index = 0; index < ring.length; index += 1) {
      const first = ring[index];
      const second = ring[(index + 1) % ring.length];
      const x1 = first[0] - originX;
      const y1 = first[1] - originY;
      const x2 = second[0] - originX;
      const y2 = second[1] - originY;
      const cross = x1 * y2 - x2 * y1;
      twiceArea += cross;
      centroidX += (x1 + x2) * cross;
      centroidY += (y1 + y2) * cross;
    }
    if (Math.abs(twiceArea) < 1e-9) continue;
    const area = Math.abs(twiceArea) / 2;
    totalArea += area;
    weightedX += (originX + centroidX / (3 * twiceArea)) * area;
    weightedY += (originY + centroidY / (3 * twiceArea)) * area;
  }
  return totalArea > 0
    ? { area: totalArea, x: weightedX / totalArea, y: weightedY / totalArea }
    : null;
}

function readArguments(argv) {
  const modelId = argv.find((value) => !value.startsWith("--")) ?? "zandvoort";
  const glbFlagIndex = argv.indexOf("--glb");
  const previewFlagIndex = argv.indexOf("--preview");
  const metadataFlagIndex = argv.indexOf("--metadata");
  const sourceFlagIndex = argv.indexOf("--source");

  return {
    modelId,
    glbPath: path.resolve(
      projectRoot,
      glbFlagIndex >= 0 ? argv[glbFlagIndex + 1] : `public/f1/tracks/3d/${modelId}.glb`,
    ),
    metadataPath: path.resolve(
      projectRoot,
      metadataFlagIndex >= 0
        ? argv[metadataFlagIndex + 1]
        : `public/f1/tracks/3d/${modelId}-metadata.json`,
    ),
    previewPath: path.resolve(
      projectRoot,
      previewFlagIndex >= 0
        ? argv[previewFlagIndex + 1]
        : `public/f1/tracks/3d/${modelId}-preview.webp`,
    ),
    sourceDirectory: sourceFlagIndex >= 0
      ? path.resolve(projectRoot, argv[sourceFlagIndex + 1])
      : path.join(projectRoot, ".track-model-build", `${modelId}-source`),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const metrics = await validateTrackAsset(readArguments(process.argv.slice(2)));
  console.log(JSON.stringify(metrics, null, 2));
}
