import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { surfaceIndex } from "./audit-madring-surfaces.mjs";

// Audit the compressed GLB delivered to the browser, including embedded textures.
export async function auditMexicoSurfaces(buffer, metadata = {}, stadiumReference = null) {
  await MeshoptDecoder.ready;
  const jsonLength = buffer.readUInt32LE(12);
  const gltf = JSON.parse(buffer.toString("utf8", 20, 20 + jsonLength));
  const binary = buffer.subarray(28 + jsonLength);
  const views = new Map();
  const sizes = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const readers = {
    5121: [1, "getUint8"],
    5123: [2, "getUint16"],
    5125: [4, "getUint32"],
    5126: [4, "getFloat32"],
  };
  function accessor(index) {
    const item = gltf.accessors[index];
    const view = gltf.bufferViews[item.bufferView];
    if (!views.has(item.bufferView)) {
      const compression = view.extensions?.EXT_meshopt_compression;
      if (compression) {
        const output = new Uint8Array(compression.count * compression.byteStride);
        MeshoptDecoder.decodeGltfBuffer(output, compression.count, compression.byteStride,
          binary.subarray(compression.byteOffset, compression.byteOffset + compression.byteLength),
          compression.mode, compression.filter);
        views.set(item.bufferView, output);
      } else {
        views.set(item.bufferView, binary.subarray(view.byteOffset ?? 0,
          (view.byteOffset ?? 0) + view.byteLength));
      }
    }
    const output = views.get(item.bufferView);
    const reader = readers[item.componentType];
    const components = sizes[item.type];
    if (!reader || !components) throw new Error(`Unsupported Mexico accessor ${item.componentType}/${item.type}`);
    const data = new DataView(output.buffer, output.byteOffset, output.byteLength);
    const stride = view.byteStride ?? components * reader[0];
    return Array.from({ length: item.count }, (_, row) => Array.from({ length: components }, (_, column) =>
      data[reader[1]]((item.byteOffset ?? 0) + row * stride + column * reader[0], true)));
  }

  const meshes = new Map();
  const triangleColors = new Map();
  const textures = { physicalPrimitives: 0, texturedPrimitives: 0, missingTextures: [], invalidUvs: [] };
  for (const mesh of gltf.meshes ?? []) {
    const triangles = [];
    const colors = [];
    for (const primitive of mesh.primitives) {
      const positions = accessor(primitive.attributes.POSITION);
      const vertexColors = primitive.attributes.COLOR_0 === undefined ? null : accessor(primitive.attributes.COLOR_0);
      const indices = primitive.indices === undefined
        ? positions.map((_, index) => index)
        : accessor(primitive.indices).flat();
      for (let index = 0; index < indices.length; index += 3) {
        triangles.push(indices.slice(index, index + 3).map((vertex) => positions[vertex]));
        colors.push(vertexColors ? indices.slice(index, index + 3).map((vertex) => vertexColors[vertex]) : null);
      }
      const overlay = /^Mexico_Sector_(?:Core|Glow|Boundaries_And_Finish)_Mesh$/.test(mesh.name);
      if (!mesh.name?.startsWith("Mexico_") || overlay) continue;
      textures.physicalPrimitives += 1;
      const material = gltf.materials?.[primitive.material];
      const texture = gltf.textures?.[material?.pbrMetallicRoughness?.baseColorTexture?.index];
      const image = gltf.images?.[texture?.source];
      if (image?.bufferView === undefined || primitive.attributes.TEXCOORD_0 === undefined) {
        textures.missingTextures.push({ mesh: mesh.name, material: material?.name ?? null });
        continue;
      }
      textures.texturedPrimitives += 1;
      const uv = accessor(primitive.attributes.TEXCOORD_0);
      const values = uv.flat();
      const spans = [0, 1].map((axis) => {
        const minimum = uv.reduce((value, coordinate) => Math.min(value, coordinate[axis]), Infinity);
        const maximum = uv.reduce((value, coordinate) => Math.max(value, coordinate[axis]), -Infinity);
        return maximum - minimum;
      });
      if (uv.length !== positions.length || !values.every(Number.isFinite) ||
          spans.some((span) => span < .00001)) {
        textures.invalidUvs.push({ mesh: mesh.name, material: material?.name ?? null });
      }
    }
    meshes.set(mesh.name, triangles);
    triangleColors.set(mesh.name, colors);
  }
  const get = (name) => meshes.get(`Mexico_${name}_Mesh`) ?? [];
  const road = [...get("Raceway"), ...get("Pit_Lane")];
  const roadFloor = surfaceIndex(road);
  const mainRoadFloor = surfaceIndex(get("Raceway"));
  const ground = surfaceIndex(get("Terrain"));
  const elevationAnchors = ["HighPoint", "LowPoint"].map((name) => {
    const node = gltf.nodes.find((candidate) => candidate.name === name);
    const elevation = node?.extras?.elevation_datum_m;
    const [x, , z] = node?.translation ?? [];
    const pavement = Number.isFinite(x) && Number.isFinite(z) ? mainRoadFloor(x, z) : null;
    const expected = metadata.elevationsMeters?.[name === "HighPoint" ? "high" : "low"];
    return { name, elevationMeters: elevation ?? null, roadSupported: pavement !== null,
      roadHeightErrorMeters: Number.isFinite(elevation) && pavement !== null ? Math.abs(pavement - .45 - elevation) : null,
      extremumErrorMeters: Number.isFinite(elevation) && Number.isFinite(expected) ? Math.abs(elevation - expected) : null };
  });
  function stadiumAudit() {
    if (!stadiumReference || !metadata.originMeters) return { referenceAvailable: false };
    const toLocal = ([x, y]) => [x - metadata.originMeters.x, metadata.originMeters.y - y];
    const inside = ([x, z], ring) => {
      let result = false;
      for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
        const a = ring[index], b = ring[previous];
        if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
      }
      return result;
    };
    const edgeDistance = ([x, z], ring) => Math.min(...ring.map((a, index) => {
      const b = ring[(index + 1) % ring.length];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const span = dx * dx + dz * dz;
      const blend = span > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / span)) : 0;
      return Math.hypot(x - a[0] - blend * dx, z - a[1] - blend * dz);
    }));
    const projectedArea = (triangles) => triangles.reduce((area, [a, b, c]) => area + Math.max(0,
      ((b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2])) / 2), 0);
    function footprint(triangles, worldRing, { margin = .3, excludeRoad = false } = {}) {
      const ring = worldRing.map(toLocal);
      const floor = surfaceIndex(triangles);
      let sampleCount = 0, missingSamples = 0;
      const failures = [];
      for (let x = Math.ceil(Math.min(...ring.map((point) => point[0])) / 2) * 2;
        x <= Math.max(...ring.map((point) => point[0])); x += 2) {
        for (let z = Math.ceil(Math.min(...ring.map((point) => point[1])) / 2) * 2;
          z <= Math.max(...ring.map((point) => point[1])); z += 2) {
          if (!inside([x, z], ring) || edgeDistance([x, z], ring) <= margin ||
              (excludeRoad && roadFloor(x, z) !== null)) continue;
          sampleCount += 1;
          if (floor(x, z) === null) {
            missingSamples += 1;
            if (failures.length < 6) failures.push([x, z]);
          }
        }
      }
      let outsideCentroids = 0;
      for (const [a, b, c] of triangles) {
        const point = [(a[0] + b[0] + c[0]) / 3, (a[2] + b[2] + c[2]) / 3];
        if (!inside(point, ring) && edgeDistance(point, ring) > margin) outsideCentroids += 1;
      }
      const referenceArea = Math.abs(ring.reduce((sum, [x, z], index) => {
        const next = ring[(index + 1) % ring.length];
        return sum + x * next[1] - next[0] * z;
      }, 0)) / 2;
      return { sampleCount, missingSamples, outsideCentroids, failures,
        referenceAreaSquareMeters: referenceArea, projectedAreaSquareMeters: projectedArea(triangles) };
    }
    const linear = (value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
    function matchingTriangles(name, sourceColor) {
      const expected = sourceColor.map(linear);
      const colors = triangleColors.get(`Mexico_${name}_Mesh`) ?? [];
      return get(name).filter((_, index) => colors[index]?.every((color) =>
        expected.every((channel, axis) => Math.abs(color[axis] - channel) < .015)));
    }
    const seating = get("Stadium_Grandstands");
    const canopy = get("Stadium_Canopy");
    const trusses = get("Stadium_Trusses");
    const seatingFloor = surfaceIndex(seating);
    const canopyFloor = surfaceIndex(canopy);
    const trussFloor = surfaceIndex(trusses);
    const banks = stadiumReference.seatingBanks.map((bank) => {
      const ring = bank.outlineMeters.map(toLocal);
      const triangles = seating.filter(([a, b, c]) => inside([(a[0] + b[0] + c[0]) / 3,
        (a[2] + b[2] + c[2]) / 3], ring));
      let frontSamples = 0, frontMissingSamples = 0;
      for (let index = 1; index < bank.frontPathMeters.length; index += 1) {
        const a = bank.frontPathMeters[index - 1], b = bank.frontPathMeters[index];
        const intervals = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
        for (let sample = 0; sample < intervals; sample += 1) {
          const blend = (sample + .5) / intervals;
          const front = a.map((value, axis) => value + (b[axis] - value) * blend);
          const rear = bank.rearPathMeters[index - 1].map((value, axis) =>
            value + (bank.rearPathMeters[index][axis] - value) * blend);
          const depth = Math.hypot(rear[0] - front[0], rear[1] - front[1]);
          const point = toLocal(front.map((value, axis) => value + (rear[axis] - value) * .5 / depth));
          frontSamples += 1;
          if (seatingFloor(...point) === null) frontMissingSamples += 1;
        }
      }
      return { osmWayId: bank.osmWayId, ...footprint(triangles, bank.outlineMeters), frontSamples, frontMissingSamples };
    });
    const roof = stadiumReference.roof;
    const distances = [0];
    for (let index = 1; index < roof.supportPathMeters.length; index += 1) distances.push(distances.at(-1) +
      Math.hypot(roof.supportPathMeters[index][0] - roof.supportPathMeters[index - 1][0],
        roof.supportPathMeters[index][1] - roof.supportPathMeters[index - 1][1]));
    let missingCantileverTips = 0, maximumTipHeightError = 0;
    const cantileverFailures = [];
    const endpointVertexFallbacks = [];
    const datum = metadata.layoutQuality?.stadiumReference?.floorElevationMeters;
    for (let frame = 0; frame < roof.trusses; frame += 1) {
      const distance = distances.at(-1) * frame / (roof.trusses - 1);
      const hi = Math.max(1, distances.findIndex((position) => position >= distance));
      const blend = (distance - distances[hi - 1]) / (distances[hi] - distances[hi - 1]);
      const position = roof.supportPathMeters[hi - 1].map((value, axis) => value +
        (roof.supportPathMeters[hi][axis] - value) * blend);
      const normal = roof.inwardVectors[hi - 1].map((value, axis) => value +
        (roof.inwardVectors[hi][axis] - value) * blend);
      const normalLength = Math.hypot(...normal);
      const point = toLocal(position.map((value, axis) => value + normal[axis] / normalLength * (roof.cantileverMeters - .05)));
      let height = trussFloor(...point);
      if (height === null || Math.abs(height - datum - roof.roofHeightMeters) >= .5) {
        const expectedHeight = datum + roof.roofHeightMeters;
        const nearest = trusses.flat().filter((vertex) => Math.abs(vertex[1] - expectedHeight) < .5)
          .map((vertex) => ({ vertex, distanceXZ: Math.hypot(vertex[0] - point[0], vertex[2] - point[1]) }))
          .sort((a, b) => a.distanceXZ - b.distanceXZ)[0];
        // An uncapped tube endpoint can miss a vertical ray after position
        // quantization. Its delivered end vertices still prove the full span.
        if (nearest?.distanceXZ <= .15) {
          endpointVertexFallbacks.push({ frame, point, nearestTipVertex: nearest });
          height = nearest.vertex[1];
        } else cantileverFailures.push({ frame, point, height, expectedHeightMeters: expectedHeight, nearestTipVertex: nearest });
      }
      if (height === null) missingCantileverTips += 1;
      else maximumTipHeightError = Math.max(maximumTipHeightError, Math.abs(height - datum - roof.roofHeightMeters));
    }
    // The source roof is continuous across the opening between the two banks.
    const westRear = stadiumReference.seatingBanks.map((bank) => bank.rearPathMeters[0]);
    let westPassageSamples = 0, westPassageMissingSamples = 0;
    for (let sample = 1; sample < 12; sample += 1) {
      const point = westRear[0].map((value, axis) => value + (westRear[1][axis] - value) * sample / 12);
      const local = toLocal(point);
      westPassageSamples += 1;
      if (canopyFloor(...local) === null) westPassageMissingSamples += 1;
    }
    const roofMask = footprint(canopy, roof.outlineMeters, { margin: 1 });
    const genericStadiumTriangles = get("Grandstands").filter(([a, b, c]) => stadiumReference.seatingBanks.some((bank) =>
      inside([(a[0] + b[0] + c[0]) / 3, (a[2] + b[2] + c[2]) / 3], bank.outlineMeters.map(toLocal)))).length;
    const seatingRings = stadiumReference.seatingBanks.map((bank) => bank.outlineMeters.map(toLocal));
    const seatingOutsideCentroids = seating.filter(([a, b, c]) => {
      const point = [(a[0] + b[0] + c[0]) / 3, (a[2] + b[2] + c[2]) / 3];
      return seatingRings.every((ring) => !inside(point, ring) && edgeDistance(point, ring) > .3);
    }).length;
    const eventSurfaces = stadiumReference.eventSurfaces.map((surface) => {
      const triangles = matchingTriangles("Verified_Event_Surfaces", surface.color);
      return { surface, triangles, floor: surfaceIndex(triangles), ring: surface.world.map(toLocal) };
    });
    const east = stadiumReference.eastHospitality;
    const eastTriangles = get("Stadium_East_Hospitality");
    const connection = east?.northConnection;
    const connectedFloor = surfaceIndex([...seating, ...eastTriangles].filter((triangle) =>
      triangle.every((p) => Math.abs(p[1] - datum - (connection?.heightMeters ?? 0)) < .08)));
    let connectionSamples = 0, connectionMissingSamples = 0, maximumConnectionHeightError = 0;
    if (connection) {
      const [a, b] = connection.bankEdgeMeters.map(toLocal);
      const [c, d] = connection.hospitalityEdgeMeters.map(toLocal);
      // Probe on both sides of each shared edge and throughout the walkway,
      // rather than trusting an uncompressed metadata assertion of zero gap.
      for (let across = 1; across < 5; across += 1) {
        const start = a.map((value, axis) => value + (b[axis] - value) * across / 5);
        const end = c.map((value, axis) => value + (d[axis] - value) * across / 5);
        const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
        const intervals = Math.ceil(length / .5);
        for (let sample = -1; sample <= intervals + 1; sample += 1) {
          const t = sample < 0 ? -.1 / length : sample > intervals ? 1 + .1 / length : (sample + .5) / (intervals + 1);
          const p = start.map((value, axis) => value + (end[axis] - value) * t);
          const height = connectedFloor(...p);
          connectionSamples += 1;
          if (height === null) connectionMissingSamples += 1;
          else maximumConnectionHeightError = Math.max(maximumConnectionHeightError, Math.abs(height - datum - connection.heightMeters));
        }
      }
    }
    const eastHospitality = { triangles: eastTriangles.length,
      ...(east ? footprint(eastTriangles, east.outlineMeters) : {}),
      deckLevels: east ? east.deckHeightsMeters.map((height) => ({ heightMeters: height,
        ...footprint(eastTriangles.filter((triangle) => triangle.every((p) =>
          p[1] >= datum + height - .03 && p[1] <= datum + height + .80)), east.outlineMeters) })) : [],
      connectionSamples, connectionMissingSamples, maximumConnectionHeightErrorMeters: maximumConnectionHeightError,
      palette: east ? Object.fromEntries(Object.entries(east.palette).map(([name, color]) =>
        [name, matchingTriangles("Stadium_East_Hospitality", color).length])) : {} };
    if (east && connection) {
      const rings = [east.outlineMeters,
        [connection.bankEdgeMeters[0], connection.hospitalityEdgeMeters[0],
          connection.hospitalityEdgeMeters[1], connection.bankEdgeMeters[1]]].map((ring) => ring.map(toLocal));
      eastHospitality.outsideCentroids = eastTriangles.filter(([a, b, c]) => {
        const point = [(a[0] + b[0] + c[0]) / 3, (a[2] + b[2] + c[2]) / 3];
        return rings.every((ring) => !inside(point, ring) && edgeDistance(point, ring) > .3);
      }).length;
    }
    const paintOverlays = [];
    const roadPaintOverlays = eventSurfaces.map(({ surface, floor, ring }) => {
      let sampleCount = 0, intersections = 0, minimum = Infinity;
      for (let x = Math.ceil(Math.min(...ring.map((p) => p[0])) / 2) * 2;
        x <= Math.max(...ring.map((p) => p[0])); x += 2) {
        for (let z = Math.ceil(Math.min(...ring.map((p) => p[1])) / 2) * 2;
          z <= Math.max(...ring.map((p) => p[1])); z += 2) {
          if (!inside([x, z], ring)) continue;
          const roadHeight = roadFloor(x, z), paintHeight = floor(x, z);
          if (roadHeight === null || paintHeight === null) continue;
          sampleCount += 1;
          const gap = roadHeight - paintHeight;
          minimum = Math.min(minimum, gap);
          if (gap <= .005) intersections += 1;
        }
      }
      return { id: surface.id, sampleCount, intersections, minimumClearanceMeters: minimum };
    });
    for (const upper of eventSurfaces) for (const lower of eventSurfaces) {
      if (!(upper.surface.offsetMeters > lower.surface.offsetMeters)) continue;
      let sampleCount = 0, lowClearanceSamples = 0, intersections = 0, minimum = Infinity;
      for (let x = Math.ceil(Math.min(...upper.ring.map((point) => point[0])) / 2) * 2;
        x <= Math.max(...upper.ring.map((point) => point[0])); x += 2) {
        for (let z = Math.ceil(Math.min(...upper.ring.map((point) => point[1])) / 2) * 2;
          z <= Math.max(...upper.ring.map((point) => point[1])); z += 2) {
          if (!inside([x, z], upper.ring) || !inside([x, z], lower.ring) || roadFloor(x, z) !== null) continue;
          const top = upper.floor(x, z), bottom = lower.floor(x, z);
          if (top === null || bottom === null) continue;
          sampleCount += 1;
          const gap = top - bottom;
          minimum = Math.min(minimum, gap);
          if (gap <= .005) lowClearanceSamples += 1;
          if (gap <= 0) intersections += 1;
        }
      }
      if (sampleCount) paintOverlays.push({ upper: upper.surface.id, lower: lower.surface.id, sampleCount,
        lowClearanceSamples, intersections, minimumClearanceMeters: minimum });
    }
    return { referenceAvailable: true, seatingTriangles: seating.length, canopyTriangles: canopy.length,
      trussTriangles: trusses.length, banks, canopy: roofMask, genericStadiumTriangles, seatingOutsideCentroids,
      westPassageSamples, westPassageMissingSamples, cantileverTipSamples: roof.trusses,
      missingCantileverTips, maximumTipHeightErrorMeters: maximumTipHeightError,
      cantileverFailures, endpointVertexFallbacks,
      paintOverlays,
      eastHospitality,
      roadPaintOverlays,
      palette: {
        concreteTriangles: matchingTriangles("Stadium_Grandstands", stadiumReference.seatingSection.concreteColor).length,
        seatTriangles: matchingTriangles("Stadium_Grandstands", stadiumReference.seatingSection.seatColor).length,
        canopyTriangles: matchingTriangles("Stadium_Canopy", roof.topColor).length,
        steelTriangles: matchingTriangles("Stadium_Trusses", roof.steelColor).length,
      },
      frontWalls: (() => {
        const triangles = get("Stadium_Front_Walls");
        const colors = triangleColors.get("Mexico_Stadium_Front_Walls_Mesh") ?? [];
        return { triangles: triangles.length,
          maximumHeightMeters: triangles.reduce((maximum, triangle) => Math.max(maximum,
            Math.max(...triangle.map((p) => p[1])) - Math.min(...triangle.map((p) => p[1]))), 0),
          darkTriangles: colors.filter((color) => !color || color.some((vertex) =>
            (vertex[0] + vertex[1] + vertex[2]) / 3 < .15)).length };
      })(),
      eventSurfaces: eventSurfaces.map(({ surface, triangles }) => ({ id: surface.id,
        heightRangeMeters: triangles.length ? Math.max(...triangles.flat().map((p) => p[1]))
          - Math.min(...triangles.flat().map((p) => p[1])) : null,
        ...footprint(triangles, surface.world,
          { margin: .3, excludeRoad: true }) })),
    };
  }
  function longitudinalRoadAudit() {
    const line = metadata.roadCenterlineMeters;
    const origin = metadata.originMeters;
    if (!Array.isArray(line) || line.length < 3 ||
        !line.every((point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)) ||
        !Number.isFinite(origin?.x) || !Number.isFinite(origin?.y)) {
      return { referenceAvailable: false };
    }
    const distances = [0];
    for (let index = 1; index < line.length; index += 1) {
      distances.push(distances.at(-1) + Math.hypot(line[index][0] - line[index - 1][0],
        line[index][1] - line[index - 1][1]));
    }
    const length = distances.at(-1);
    if (!(length > 0)) return { referenceAvailable: false };
    const count = Math.ceil(length / 10);
    const spacing = length / count;
    const heights = [];
    let hi = 1;
    for (let index = 0; index <= count; index += 1) {
      const distance = index * spacing;
      while (hi < line.length - 1 && distances[hi] < distance) hi += 1;
      const span = distances[hi] - distances[hi - 1];
      const blend = span > 0 ? (distance - distances[hi - 1]) / span : 0;
      const point = line[hi].map((value, axis) => line[hi - 1][axis] +
        (value - line[hi - 1][axis]) * blend);
      heights.push(mainRoadFloor(point[0] - origin.x, origin.y - point[1]));
    }
    const missingSamples = heights.filter((height) => height === null).length;
    if (missingSamples) return { referenceAvailable: true, sampleCount: heights.length, missingSamples };
    const grades = heights.slice(1).map((height, index) => (height - heights[index]) / spacing * 100);
    // A sixty-metre grade window separates profile waves from lossy position
    // quantization. Direct ten-metre grades are still reported and bounded.
    const smoothGrades = grades.map((_, index) =>
      (heights[(index + 3) % count] - heights[(index - 3 + count) % count]) / (6 * spacing) * 100);
    const gradeChanges = smoothGrades.map((grade, index) =>
      Math.abs(grade - smoothGrades[(index - 1 + count) % count]) / spacing);
    const significant = smoothGrades.filter((grade) => Math.abs(grade) >= .1);
    const round = (value) => Number(value.toFixed(6));
    return {
      referenceAvailable: true, sampleCount: heights.length, missingSamples,
      lapLengthMeters: round(length), sampleSpacingMeters: round(spacing), gradeWindowMeters: round(6 * spacing),
      maximumUphillPercent: round(Math.max(...grades)), maximumDownhillPercent: round(Math.min(...grades)),
      maximumAbsoluteGradePercent: round(Math.max(...grades.map(Math.abs))),
      maximumSmoothedGradeChangePerMeter: round(Math.max(...gradeChanges)),
      significantGradeReversals: significant.filter((grade, index) =>
        grade * significant[(index - 1 + significant.length) % significant.length] < 0).length,
      cumulativeVerticalVariationMeters: round(heights.slice(1).reduce((sum, height, index) =>
        sum + Math.abs(height - heights[index]), 0)),
      elevationRangeMeters: round(Math.max(...heights) - Math.min(...heights)),
      finishSeamHeightGapMeters: round(Math.abs(heights[0] - heights.at(-1))),
      worstSegments: grades.map((grade, index) => ({ distanceMeters: round((index + 1) * spacing), gradePercent: round(grade) }))
        .sort((a, b) => Math.abs(b.gradePercent) - Math.abs(a.gradePercent)).slice(0, 6),
    };
  }
  const samples = ([a, b, c]) => [[1 / 3, 1 / 3, 1 / 3], [.8, .1, .1], [.1, .8, .1], [.1, .1, .8]]
    .map((weights) => a.map((_, axis) => a[axis] * weights[0] + b[axis] * weights[1] + c[axis] * weights[2]));
  function surfaceSamples(triangle) {
    const points = samples(triangle);
    const [a, b, c] = triangle;
    const denominator = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(denominator) < .00000001) return points;
    // Large field triangles can clear terrain at their vertices while sinking
    // through a hill in the interior; probe every four metres as well.
    const step = 4;
    const minX = Math.ceil(Math.min(a[0], b[0], c[0]) / step) * step;
    const maxX = Math.floor(Math.max(a[0], b[0], c[0]) / step) * step;
    const minZ = Math.ceil(Math.min(a[2], b[2], c[2]) / step) * step;
    const maxZ = Math.floor(Math.max(a[2], b[2], c[2]) / step) * step;
    for (let x = minX; x <= maxX; x += step) for (let z = minZ; z <= maxZ; z += step) {
      const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / denominator;
      const v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / denominator;
      if (u < 0 || v < 0 || u + v > 1) continue;
      points.push([x, u * a[1] + v * b[1] + (1 - u - v) * c[1], z]);
    }
    return points;
  }
  function clearance(triangles, support, samplePoints = samples) {
    let minimum = Infinity;
    let intersections = 0;
    let missingSupport = 0;
    let sampleCount = 0;
    const failures = [];
    for (const triangle of triangles) for (const point of samplePoints(triangle)) {
      sampleCount += 1;
      const floor = support(point[0], point[2]);
      if (floor === null) {
        missingSupport += 1;
        if (failures.length < 8) failures.push({ point, missing: true });
        continue;
      }
      const gap = point[1] - floor;
      minimum = Math.min(minimum, gap);
      if (gap <= .005) {
        intersections += 1;
        if (failures.length < 8) failures.push({ point, gap });
      }
    }
    return { triangles: triangles.length, sampleCount, minimumClearanceMeters: Number.isFinite(minimum) ? Number(minimum.toFixed(5)) : null,
      intersections, missingSupport, failures };
  }
  const structuralConflicts = {};
  for (const name of ["Buildings", "Source_Roofs", "Grandstands", "Stadium_Grandstands", "Stadium_Canopy", "Stadium_Trusses", "Stadium_East_Hospitality",
    "Baseball_Stadium_Roof", "Baseball_Stadium_Roof_Supports", "Infrastructure", "Start_Gantry"]) {
    let count = 0;
    const points = [];
    for (const triangle of get(name)) for (const point of [...triangle, ...samples(triangle)]) {
      const floor = roadFloor(point[0], point[2]);
      if (floor === null || (["Start_Gantry", "Stadium_Canopy", "Stadium_Trusses"].includes(name) && point[1] - floor >= 4.5)) continue;
      count += 1;
      if (points.length < 6) points.push(point);
    }
    if (count) structuralConflicts[name] = { count, points };
  }
  let maximumGrade = 0;
  for (const [a, b, c] of road) {
    const u = b.map((value, axis) => value - a[axis]);
    const v = c.map((value, axis) => value - a[axis]);
    const nx = u[1] * v[2] - u[2] * v[1];
    const ny = u[2] * v[0] - u[0] * v[2];
    const nz = u[0] * v[1] - u[1] * v[0];
    if (Math.abs(ny) > .000001) maximumGrade = Math.max(maximumGrade, Math.hypot(nx, nz) / Math.abs(ny) * 100);
  }
  const paint = [...get("Edge_Paint"), ...Array.from(meshes.entries())
    .filter(([name]) => /^Mexico_Fast_Lane_\d+_Boxes_Mesh$/.test(name)).flatMap(([, triangles]) => triangles)];
  return { road: { ...clearance(road, ground), maximumGradePercent: maximumGrade }, longitudinalRoad: longitudinalRoadAudit(),
    stadium: stadiumAudit(),
    elevationAnchors,
    paint: clearance(paint, roadFloor), surfaces: clearance(get("Verified_Event_Surfaces"), ground, surfaceSamples),
    structuralConflicts, textures };
}
