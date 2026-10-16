import assert from "node:assert/strict";
import test from "node:test";
import { readdir } from "node:fs/promises";
import { OrthographicCamera, Vector3 } from "three";
import { TRACK_MODEL_ALIASES } from "../data/track-models.ts";

import {
  clampTrackModelPan,
  getTrackModelInitialZoom,
  getTrackModelOrbitPosition,
  orbitTrackModelCamera,
  pinchTrackModelCamera,
  preserveTrackModelOrbitFocus,
  zoomTrackModelAtPoint,
  readTrackModelGesture,
  resolveTrackModelGesture,
  trackModelCameraPolarDeg,
  fitTrackModelFrame,
  getTrackModelFrame,
  getTrackModelOverviewRotation,
  moveTrackModelTouchCamera,
  panTrackModelCamera,
} from "./track-model-camera.ts";

test("full WebGL track models open tightly framed", () => {
  assert.equal(getTrackModelInitialZoom(true, true), 1.75);
  assert.equal(getTrackModelInitialZoom(true, false), 1.25);
  assert.equal(getTrackModelInitialZoom(false, true), 1);
});

const touchBounds = { left: 0, top: 0, width: 390, height: 844 };
const gestureAt = (first, second) => readTrackModelGesture(new Map([[1, first], [2, second]]), touchBounds);
const startTouch = gestureAt({ x: 100, y: 300 }, { x: 200, y: 300 });

test("map-style horizontal two-finger movement pans without rotating", () => {
  const state = { pan: { x: 0, y: 0 }, rotationDeg: 25, tiltDeg: 10, zoom: 1 };
  const result = moveTrackModelTouchCamera(state, startTouch,
    gestureAt({ x: 180, y: 300 }, { x: 280, y: 300 }), "transform", { ...touchBounds, top: 84, bottom: 84 });
  assert.equal(result.rotationDeg, state.rotationDeg);
  assert.ok(Math.abs(result.pan.x - 80 / touchBounds.width) < 1e-9);
});

test("swiping two fingers upwards tilts the map and downwards flattens it", () => {
  const state = { pan: { x: 0, y: 0 }, rotationDeg: 25, tiltDeg: 30, zoom: 1 };
  const viewport = { ...touchBounds, top: 84, bottom: 84 };
  const up = moveTrackModelTouchCamera(state, startTouch, gestureAt({ x: 100, y: 260 }, { x: 200, y: 260 }), "tilt", viewport);
  const down = moveTrackModelTouchCamera(state, startTouch, gestureAt({ x: 100, y: 340 }, { x: 200, y: 340 }), "tilt", viewport);
  assert.ok(up.tiltDeg > state.tiltDeg);
  assert.ok(down.tiltDeg < state.tiltDeg);
});

test("mobile gestures ignore finger jitter and distinguish zoom, rotation and pitch", () => {
  const mode = (a, b) => resolveTrackModelGesture(startTouch, gestureAt(a, b), 390, 844);
  assert.equal(mode({ x: 99, y: 301 }, { x: 201, y: 299 }), null);
  assert.equal(mode({ x: 90, y: 301 }, { x: 210, y: 299 }), "transform");
  assert.equal(mode({ x: 100, y: 290 }, { x: 200, y: 310 }), "transform");
  assert.equal(mode({ x: 100, y: 330 }, { x: 200, y: 330 }), "tilt");
  assert.equal(mode({ x: 130, y: 300 }, { x: 230, y: 300 }), "transform");
  // Moving only one finger changes the angle, rather than tilting the map.
  assert.equal(mode({ x: 100, y: 325 }, { x: 200, y: 300 }), "transform");
});

test("two fingers moving vertically tilt despite unequal finger speed", () => {
  const mode = (a, b) => resolveTrackModelGesture(startTouch, gestureAt(a, b), 390, 844);
  assert.equal(mode({ x: 98, y: 345 }, { x: 205, y: 325 }), "tilt");
  assert.equal(mode({ x: 102, y: 265 }, { x: 196, y: 280 }), "tilt");
});

test("one finger moves the map freely without changing rotation, zoom or tilt", () => {
  const state = { pan: { x: 0.18, y: -0.1 }, rotationDeg: 25, tiltDeg: 10, zoom: 1 };
  const result = panTrackModelCamera(state, 390, -422, touchBounds);
  assert.deepEqual(result, { ...state, pan: { x: 1.18, y: -0.6 } });
  const resumed = panTrackModelCamera(result, -195, 211, touchBounds);
  assert.deepEqual(resumed, { ...state, pan: { x: 0.6799999999999999, y: -0.35 } });
});

test("two fingers can zoom, rotate and move the map together", () => {
  const state = { pan: { x: 0, y: 0 }, rotationDeg: 25, tiltDeg: 10, zoom: 2 };
  const viewport = { ...touchBounds, top: 84, bottom: 84 };
  const stationary = gestureAt({ x: 75, y: 300 }, { x: 225, y: 300 });
  const shifted = gestureAt({ x: 130, y: 280 }, { x: 260, y: 355 });
  const first = moveTrackModelTouchCamera(state, startTouch, stationary, "transform", viewport);
  const second = moveTrackModelTouchCamera(state, startTouch, shifted, "transform", viewport);
  assert.equal(first.rotationDeg, state.rotationDeg);
  assert.equal(first.zoom, 3);
  assert.ok(second.rotationDeg > state.rotationDeg);
  assert.ok(second.zoom > state.zoom);
  assert.notDeepEqual(first.pan, second.pan);
  assert.equal(first.tiltDeg, state.tiltDeg);
  assert.equal(second.tiltDeg, state.tiltDeg);
});

test("a sliding two-finger rotation stays continuous when the fingers start twisting", () => {
  const state = { pan: { x: 0, y: 0 }, rotationDeg: 0, tiltDeg: 10, zoom: 1 };
  const rotated = angle => {
    const radians = angle * Math.PI / 180;
    const dx = Math.cos(radians) * 50, dy = Math.sin(radians) * 50;
    return gestureAt({ x: 190 - dx, y: 300 - dy }, { x: 190 + dx, y: 300 + dy });
  };
  const viewport = { ...touchBounds, top: 84, bottom: 84 };
  const before = moveTrackModelTouchCamera(state, startTouch, rotated(6), "transform", viewport);
  const after = moveTrackModelTouchCamera(state, startTouch, rotated(8), "transform", viewport);
  assert.ok(Math.abs(after.rotationDeg - before.rotationDeg - 2) < 1e-8);
});

test("combined gestures keep the same ground point between the fingers on a tilted map", () => {
  const viewport = { ...touchBounds, top: 84, bottom: 132 };
  const points = [[0, 300, 500, 0], [0.25, 900, 500, 0], [0.5, 900, 900, 0], [1, 300, 900, 0]];
  const cameraAt = state => {
    const frame = getTrackModelFrame(points, -38, 10, state.rotationDeg, state.tiltDeg);
    const fit = fitTrackModelFrame(frame, viewport);
    const camera = new OrthographicCamera(-viewport.width / 2, viewport.width / 2, viewport.height / 2, -viewport.height / 2, 1, 10_000);
    camera.position.set(...getTrackModelOrbitPosition({ lookAtY: 0, radius: 2400, rotationDeg: state.rotationDeg, tiltDeg: state.tiltDeg }));
    camera.lookAt(0, 0, 0);
    camera.zoom = fit.scale * state.zoom;
    const offsetX = fit.offsetX * state.zoom + state.pan.x * viewport.width;
    const offsetY = frame.centerY * fit.scale * state.zoom + (viewport.top - viewport.bottom) / 2 + state.pan.y * viewport.height;
    camera.setViewOffset(viewport.width, viewport.height, -offsetX, -offsetY, viewport.width, viewport.height);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    return camera;
  };
  for (const pan of [{ x: 0, y: 0 }, { x: 1.1, y: -0.8 }]) {
    const state = { pan, rotationDeg: 25, tiltDeg: 48, zoom: 2 };
    const camera = cameraAt(state);
    const groundPoint = new Vector3(startTouch.center.x * 2, -startTouch.center.y * 2, 0).unproject(camera);
    const direction = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    groundPoint.addScaledVector(direction, -groundPoint.y / direction.y);
    for (const angle of [-90, 45, 135]) {
      const radians = angle * Math.PI / 180;
      const dx = Math.cos(radians) * 90, dy = Math.sin(radians) * 90;
      const next = gestureAt({ x: 195 - dx, y: 325 - dy }, { x: 195 + dx, y: 325 + dy });
      const result = moveTrackModelTouchCamera(state, startTouch, next, "transform", viewport);
      const projected = groundPoint.clone().project(cameraAt(result));
      assert.ok(Math.abs(projected.x / 2 - next.center.x) < 1e-8, `horizontal anchor drift at ${angle}°`);
      assert.ok(Math.abs(-projected.y / 2 - next.center.y) < 1e-8, `vertical anchor drift at ${angle}°`);
      assert.equal(result.tiltDeg, state.tiltDeg);
    }
    const up = gestureAt({ x: 100, y: 240 }, { x: 200, y: 240 });
    const tilted = moveTrackModelTouchCamera(state, startTouch, up, "tilt", viewport);
    assert.equal(tilted.rotationDeg, state.rotationDeg);
    assert.equal(tilted.zoom, state.zoom);
  }
});

test("overhead camera stays above the track and transitions continuously to 3D", () => {
  const position = getTrackModelOrbitPosition({ lookAtY: 2228, radius: 2000, rotationDeg: 40, tiltDeg: 0 });
  assert.ok(position[1] > 2228);
  assert.ok(Math.hypot(position[0], position[2]) < 1);
  assert.ok(Math.abs(trackModelCameraPolarDeg(9.999) - trackModelCameraPolarDeg(10)) < 0.01);
});

test("framing reserves space for thumb controls in portrait and landscape", () => {
  const frame = { centerX: 70, centerY: -120, width: 500, height: 1400 };
  for (const viewport of [{ width: 375, height: 812, top: 64, bottom: 154 }, { width: 844, height: 390, top: 64, bottom: 154 }]) {
    const fit = fitTrackModelFrame(frame, viewport);
    const x = viewport.width / 2 + frame.centerX * fit.scale + fit.offsetX;
    const y = viewport.height / 2 - frame.centerY * fit.scale + fit.offsetY;
    assert.ok(x - frame.width * fit.scale / 2 >= 24 - 1e-9);
    assert.ok(x + frame.width * fit.scale / 2 <= viewport.width - 24 + 1e-9);
    assert.ok(y - frame.height * fit.scale / 2 >= viewport.top + 16 - 1e-9);
    assert.ok(y + frame.height * fit.scale / 2 <= viewport.height - viewport.bottom - 16 + 1e-9);
  }
});

test("an off-centre track rotates around the same screen point without changing scale", () => {
  const points = [[0, 300, 500, 0], [0.25, 900, 500, 0], [0.5, 900, 900, 0], [1, 300, 900, 0]];
  const viewport = { width: 390, height: 844, top: 84, bottom: 84 };
  const overview = getTrackModelFrame(points, -38, 10);
  const initialScale = fitTrackModelFrame(overview, viewport).scale;
  for (const rotation of [-170, -38, 0, 90, 180]) {
    for (const tilt of [0, 10, 48, 82]) {
      const frame = getTrackModelFrame(points, -38, 10, rotation, tilt);
      const fit = fitTrackModelFrame(frame, viewport);
      const camera = new OrthographicCamera(-viewport.width / 2, viewport.width / 2, viewport.height / 2, -viewport.height / 2, 1, 10_000);
      camera.position.set(...getTrackModelOrbitPosition({ lookAtY: 0, radius: 2400, rotationDeg: rotation, tiltDeg: tilt }));
      camera.lookAt(0, 0, 0);
      camera.zoom = fit.scale;
      camera.setViewOffset(viewport.width, viewport.height, -fit.offsetX, -fit.offsetY, viewport.width, viewport.height);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      const pivot = new Vector3(600, 0, -700).project(camera);
      assert.ok(Math.abs(pivot.x) < 1e-8, `rotation ${rotation}, tilt ${tilt}: horizontal drift`);
      assert.ok(Math.abs(pivot.y + (viewport.top - viewport.bottom) / viewport.height) < 1e-8, `rotation ${rotation}, tilt ${tilt}: vertical drift`);
      assert.equal(fit.scale, initialScale);
    }
  }
});

test("portrait overview uses the phone height for an elongated track", () => {
  const points = [[0, -1500, -80, 0], [0.25, 1500, -80, 0], [0.5, 1500, 80, 0], [1, -1500, 80, 0]];
  const viewport = { width: 375, height: 812, top: 64, bottom: 154 };
  const initial = fitTrackModelFrame(getTrackModelFrame(points, -38, 10), viewport).scale;
  const rotation = getTrackModelOverviewRotation(points, -38, 10, viewport);
  assert.ok(fitTrackModelFrame(getTrackModelFrame(points, rotation, 10), viewport).scale > initial * 1.5);
});

test("camera orbits above a high-altitude track with the same radius and tilt as a sea-level scene", () => {
  const radius = 2040;
  const targetElevation = 2228;
  for (const tiltDeg of [8, 10, 82]) {
    const settings = { radius, rotationDeg: 25, tiltDeg };
    const baseline = getTrackModelOrbitPosition({ ...settings, lookAtY: 0 });
    const elevated = getTrackModelOrbitPosition({ ...settings, lookAtY: targetElevation });

    assert.ok(elevated[1] > targetElevation, "The camera must remain above the Mexico terrain");
    assert.equal(elevated[0], baseline[0]);
    assert.equal(elevated[2], baseline[2]);
    assert.ok(Math.abs(elevated[1] - targetElevation - baseline[1]) < 1e-9);
    assert.ok(Math.abs(Math.hypot(elevated[0], elevated[1] - targetElevation, elevated[2]) - radius) < 1e-9,
      "Changing the elevation datum must not change the orbit radius");
  }
});

test("zoom keeps the point under the cursor stable", () => {
  const result = zoomTrackModelAtPoint(
    { pan: { x: 0.04, y: -0.02 }, zoom: 2 },
    4,
    { x: 0.25, y: -0.1 },
  );

  assert.deepEqual(result, {
    pan: { x: -0.16999999999999998, y: 0.06 },
    zoom: 4,
  });
});

test("pinch zooms, pans and rotates in one gesture", () => {
  const result = pinchTrackModelCamera({
    currentAngle: Math.PI / 2,
    currentCenter: { x: 0.1, y: -0.05 },
    currentDistance: 200,
    maximumZoom: 8,
    minimumZoom: 0.82,
    startAngle: 0,
    startCenter: { x: 0, y: 0 },
    startDistance: 100,
    startState: { pan: { x: 0, y: 0 }, rotationDeg: 15, zoom: 1 },
  });

  assert.deepEqual(result, {
    pan: { x: 0.1, y: -0.05 },
    rotationDeg: 105,
    zoom: 2,
  });
});

test("pan stays inside the visible model bounds", () => {
  assert.deepEqual(clampTrackModelPan({ x: 10, y: -10 }, 3), { x: 1, y: -1 });
  assert.deepEqual(clampTrackModelPan({ x: 0.06, y: -0.08 }, 1), { x: 0.06, y: -0.08 });
});

test("orientation sphere rotates and clamps the 3D tilt", () => {
  assert.deepEqual(
    orbitTrackModelCamera({
      deltaX: 80,
      deltaY: 200,
      maximumTiltDeg: 82,
      minimumTiltDeg: 8,
      rotationSensitivity: 1,
      startRotationDeg: 150,
      startTiltDeg: 10,
      tiltSensitivity: 0.5,
    }),
    { rotationDeg: -130, tiltDeg: 82 },
  );
});

test("orientation sphere keeps the current world focus centred while orbiting", () => {
  const result = preserveTrackModelOrbitFocus({
    nextRotationDeg: 90,
    nextTiltDeg: 10,
    pan: { x: 0.2, y: -0.1 },
    startRotationDeg: 0,
    startTiltDeg: 10,
    viewportAspectRatio: 1200 / 710,
    zoom: 2,
  });

  assert.ok(Math.abs(result.x - 0.08842) < 0.0001);
  assert.ok(Math.abs(result.y - 0.22618) < 0.0001);
});

test("every published model fits phone portrait, landscape and desktop overviews", async () => {
  const dataDirectory = new URL("../data/", import.meta.url);
  const filenames = (await readdir(dataDirectory)).filter(name => !name.startsWith(".") && name.endsWith("-model.ts"));
  let checked = 0;
  for (const filename of filenames) {
    const modelExports = await import(new URL(filename, dataDirectory));
    const model = Object.entries(modelExports).find(([name]) => name.endsWith("_TRACK_MODEL"))?.[1];
    if (!model) continue;
    checked++;
    for (const viewport of [{ width: 375, height: 812, top: 64, bottom: 154 }, { width: 844, height: 390, top: 64, bottom: 154 }, { width: 1024, height: 768, top: 64, bottom: 154 }]) {
      for (const tilt of [0, model.camera.tiltDeg]) {
        const rotation = getTrackModelOverviewRotation(model.data.points, model.camera.rotationDeg, tilt, viewport);
        const bounds = getTrackModelFrame(model.data.points, rotation, tilt);
        const fitted = fitTrackModelFrame(bounds, viewport);
        assert.ok(Number.isFinite(fitted.scale) && fitted.scale > 0, filename);
        assert.ok(bounds.width * fitted.scale <= viewport.width - 48 + 1e-7, filename);
        assert.ok(bounds.height * fitted.scale <= viewport.height - viewport.top - viewport.bottom - 32 + 1e-7, filename);
      }
    }
  }
  assert.equal(checked, Object.keys(TRACK_MODEL_ALIASES).length);
});
