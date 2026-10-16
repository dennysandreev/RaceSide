export type TrackModelPan = {
  x: number;
  y: number;
};

export const TRACK_MODEL_MIN_ZOOM = 0.82;
export const TRACK_MODEL_MAX_ZOOM = 8;
export const TRACK_MODEL_ZOOM_STEP = 0.25;
export const TRACK_MODEL_TOUCH_QUERY = "(max-width: 767px), (pointer: coarse)";
export const TRACK_MODEL_WEBGL_INITIAL_ZOOM = 1.75;
export const TRACK_MODEL_WEBGL_MOBILE_INITIAL_ZOOM = 1.25;

export function getTrackModelInitialZoom(hasWebGL: boolean, isWideViewport: boolean) {
  if (!hasWebGL) return 1;

  return isWideViewport
    ? TRACK_MODEL_WEBGL_INITIAL_ZOOM
    : TRACK_MODEL_WEBGL_MOBILE_INITIAL_ZOOM;
}

export function trackModelCameraPolarDeg(tiltDeg: number) {
  // Keep existing 3D views, with a continuous path to a true overhead view.
  return Math.min(72, Math.max(0.01, tiltDeg < 10 ? tiltDeg * 4.8 : 48 + (tiltDeg - 10) * 0.34));
}

export function getTrackModelOrbitPosition({
  lookAtY,
  radius,
  rotationDeg,
  tiltDeg,
}: {
  lookAtY: number;
  radius: number;
  rotationDeg: number;
  tiltDeg: number;
}) {
  const polar = trackModelCameraPolarDeg(tiltDeg) * Math.PI / 180;
  const azimuth = (38 + rotationDeg) * Math.PI / 180;
  const horizontalRadius = Math.sin(polar) * radius;

  return [
    Math.sin(azimuth) * horizontalRadius,
    lookAtY + Math.cos(polar) * radius,
    Math.cos(azimuth) * horizontalRadius,
  ] as const;
}

export type TrackModelCameraState = {
  pan: TrackModelPan;
  rotationDeg: number;
  zoom: number;
};

export function clampTrackModelPan(pan: TrackModelPan, zoom: number): TrackModelPan {
  const limit = Math.max(0.1, (zoom - 1) / 2);

  return {
    x: Math.min(limit, Math.max(-limit, pan.x)),
    y: Math.min(limit, Math.max(-limit, pan.y)),
  };
}

export function panTrackModelCamera<T extends TrackModelCameraState>(state: T, deltaX: number, deltaY: number, viewport: Pick<TrackModelViewport, "width" | "height">): T {
  return { ...state, pan: { x: state.pan.x + deltaX / Math.max(1, viewport.width), y: state.pan.y + deltaY / Math.max(1, viewport.height) } };
}

export function zoomTrackModelAtPoint(
  state: Pick<TrackModelCameraState, "pan" | "zoom">,
  nextZoom: number,
  focalPoint: TrackModelPan,
) {
  const zoomRatio = nextZoom / state.zoom;

  return {
    pan: {
      x: focalPoint.x - (focalPoint.x - state.pan.x) * zoomRatio,
      y: focalPoint.y - (focalPoint.y - state.pan.y) * zoomRatio,
    },
    zoom: nextZoom,
  };
}

export function pinchTrackModelCamera({
  currentAngle,
  currentCenter,
  currentDistance,
  maximumZoom,
  minimumZoom,
  startAngle,
  startCenter,
  startDistance,
  startState,
  tiltDeg = 0,
  viewportAspectRatio = 1,
}: {
  currentAngle: number;
  currentCenter: TrackModelPan;
  currentDistance: number;
  maximumZoom: number;
  minimumZoom: number;
  startAngle: number;
  startCenter: TrackModelPan;
  startDistance: number;
  startState: TrackModelCameraState;
  tiltDeg?: number;
  viewportAspectRatio?: number;
}): TrackModelCameraState {
  const scale = currentDistance / Math.max(startDistance, 1);
  const zoom = Math.min(maximumZoom, Math.max(minimumZoom, startState.zoom * scale));
  const effectiveScale = zoom / startState.zoom;
  const angleDelta = Math.atan2(
    Math.sin(currentAngle - startAngle),
    Math.cos(currentAngle - startAngle),
  );
  const rotationDeg = normalizeDegrees(startState.rotationDeg + (angleDelta * 180) / Math.PI);
  const focus = preserveTrackModelOrbitFocus({
    pan: { x: startState.pan.x - startCenter.x, y: startState.pan.y - startCenter.y },
    startRotationDeg: startState.rotationDeg, nextRotationDeg: rotationDeg,
    startTiltDeg: tiltDeg, nextTiltDeg: tiltDeg, viewportAspectRatio, zoom,
  });

  return {
    pan: { x: currentCenter.x + focus.x * effectiveScale, y: currentCenter.y + focus.y * effectiveScale },
    rotationDeg,
    zoom,
  };
}

export function orbitTrackModelCamera({
  deltaX,
  deltaY,
  maximumTiltDeg,
  minimumTiltDeg,
  rotationSensitivity = 0.42,
  startRotationDeg,
  startTiltDeg,
  tiltSensitivity = 0.5,
}: {
  deltaX: number;
  deltaY: number;
  maximumTiltDeg: number;
  minimumTiltDeg: number;
  rotationSensitivity?: number;
  startRotationDeg: number;
  startTiltDeg: number;
  tiltSensitivity?: number;
}) {
  return {
    rotationDeg: normalizeDegrees(startRotationDeg + deltaX * rotationSensitivity),
    tiltDeg: Math.min(
      maximumTiltDeg,
      Math.max(minimumTiltDeg, startTiltDeg + deltaY * tiltSensitivity),
    ),
  };
}

export function preserveTrackModelOrbitFocus({
  nextRotationDeg,
  nextTiltDeg,
  pan,
  startRotationDeg,
  startTiltDeg,
  viewportAspectRatio = 1,
}: {
  nextRotationDeg: number;
  nextTiltDeg: number;
  pan: TrackModelPan;
  startRotationDeg: number;
  startTiltDeg: number;
  viewportAspectRatio?: number;
  zoom: number;
}) {
  if (pan.x === 0 && pan.y === 0) {
    return pan;
  }

  // Three.js orbits the camera around the glTF scene, so the preserved ground
  // focus must be transformed by the inverse azimuth delta.
  const delta = ((startRotationDeg - nextRotationDeg) * Math.PI) / 180;
  const startVerticalScale = Math.cos((trackModelCameraPolarDeg(startTiltDeg) * Math.PI) / 180);
  const nextVerticalScale = Math.cos((trackModelCameraPolarDeg(nextTiltDeg) * Math.PI) / 180);
  const horizontalFocus = pan.x * viewportAspectRatio;
  const depthFocus = -pan.y / Math.max(startVerticalScale, 0.001);
  const rotatedHorizontal = horizontalFocus * Math.cos(delta) - depthFocus * Math.sin(delta);
  const rotatedDepth = horizontalFocus * Math.sin(delta) + depthFocus * Math.cos(delta);

  return {
    x: rotatedHorizontal / Math.max(viewportAspectRatio, 0.001),
    y: -rotatedDepth * nextVerticalScale,
  };
}

export function normalizeDegrees(value: number) {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

export type TrackModelGesture = {
  angle: number;
  center: TrackModelPan;
  distance: number;
  points: readonly TrackModelPan[];
};

export type TrackModelGestureMode = "transform" | "tilt";

export function readTrackModelGesture(
  pointers: ReadonlyMap<number, TrackModelPan>,
  bounds: { left: number; top: number; width: number; height: number },
): TrackModelGesture {
  const points = Array.from(pointers.values()).slice(0, 2);
  const [first, second] = points;
  return {
    angle: Math.atan2(second.y - first.y, second.x - first.x),
    center: {
      x: ((first.x + second.x) / 2 - bounds.left) / Math.max(bounds.width, 1) - 0.5,
      y: ((first.y + second.y) / 2 - bounds.top) / Math.max(bounds.height, 1) - 0.5,
    },
    distance: Math.hypot(second.x - first.x, second.y - first.y),
    points,
  };
}

export function resolveTrackModelGesture(
  start: TrackModelGesture,
  current: TrackModelGesture,
  width: number,
  height: number,
  movementThreshold = 8,
): TrackModelGestureMode | null {
  const scale = current.distance / Math.max(start.distance, 1);
  const angle = Math.abs(normalizeDegrees((current.angle - start.angle) * 180 / Math.PI));
  const dx = (current.center.x - start.center.x) * width;
  const dy = (current.center.y - start.center.y) * height;
  const firstDy = current.points[0].y - start.points[0].y;
  const secondDy = current.points[1].y - start.points[1].y;
  // Fingers rarely move at exactly the same speed. Recognise their shared
  // vertical movement before the resulting distance/angle jitter becomes zoom.
  if (Math.abs(dy) >= movementThreshold && Math.abs(dy) > Math.abs(dx) * 1.5 && firstDy * secondDy > 0
    && Math.abs(scale - 1) < 0.16 && angle < 15
    && Math.min(Math.abs(firstDy), Math.abs(secondDy)) >= Math.max(Math.abs(firstDy), Math.abs(secondDy)) * 0.25) return "tilt";
  return Math.abs(scale - 1) >= 0.03 || angle >= 3 || Math.hypot(dx, dy) >= movementThreshold ? "transform" : null;
}

export function moveTrackModelTouchCamera(
  startState: TrackModelCameraState & { tiltDeg: number },
  start: TrackModelGesture,
  current: TrackModelGesture,
  mode: TrackModelGestureMode,
  viewport: TrackModelViewport,
) {
  if (mode === "tilt") {
    const tiltDeg = Math.max(0, Math.min(82,
      startState.tiltDeg - (current.center.y - start.center.y) * viewport.height * 0.3));
    return { ...startState, tiltDeg, pan: preserveTrackModelOrbitFocus({
      pan: startState.pan, zoom: startState.zoom, startRotationDeg: startState.rotationDeg,
      nextRotationDeg: startState.rotationDeg, startTiltDeg: startState.tiltDeg, nextTiltDeg: tiltDeg,
      viewportAspectRatio: viewport.width / viewport.height,
    }) };
  }
  const offsetY = (viewport.top - viewport.bottom) / (2 * viewport.height);
  return { ...startState, ...pinchTrackModelCamera({
    startState, startAngle: start.angle, currentAngle: current.angle,
    startDistance: start.distance, currentDistance: current.distance,
    startCenter: { ...start.center, y: start.center.y - offsetY },
    currentCenter: { ...current.center, y: current.center.y - offsetY },
    minimumZoom: TRACK_MODEL_MIN_ZOOM, maximumZoom: TRACK_MODEL_MAX_ZOOM,
    tiltDeg: startState.tiltDeg, viewportAspectRatio: viewport.width / viewport.height,
  }) };
}

export type TrackModelFrame = { centerX: number; centerY: number; width: number; height: number };
export type TrackModelViewport = { width: number; height: number; top: number; bottom: number };
export type TrackModelCameraFrame = { bounds: TrackModelFrame; viewport: TrackModelViewport };

export function fitTrackModelFrame(frame: TrackModelFrame, viewport: TrackModelViewport) {
  const scale = Math.max(0.0001, Math.min(
    Math.max(1, viewport.width - 48) / Math.max(1, frame.width),
    Math.max(1, viewport.height - viewport.top - viewport.bottom - 32) / Math.max(1, frame.height),
  ));
  return {
    scale,
    offsetX: -frame.centerX * scale,
    offsetY: frame.centerY * scale + (viewport.top - viewport.bottom) / 2,
  };
}

export function getTrackModelFrame(
  points: readonly (readonly number[])[], frameRotationDeg: number, frameTiltDeg: number,
  rotationDeg = frameRotationDeg, tiltDeg = frameTiltDeg,
): TrackModelFrame {
  if (!points.length) return { centerX: 0, centerY: 0, width: 1, height: 1 };
  const azimuth = (38 + frameRotationDeg) * Math.PI / 180;
  const polar = trackModelCameraPolarDeg(frameTiltDeg) * Math.PI / 180;
  const elevations = points.map((p) => p[3] / 10);
  const centerElevation = (Math.min(...elevations) + Math.max(...elevations)) / 2;
  const projected = points.map(([, x, y, elevation]) => ({
    x: x * Math.cos(azimuth) + y * Math.sin(azimuth),
    y: -x * Math.cos(polar) * Math.sin(azimuth) + (elevation / 10 - centerElevation) * Math.sin(polar) + y * Math.cos(polar) * Math.cos(azimuth),
  }));
  const minX = Math.min(...projected.map((p) => p.x));
  const maxX = Math.max(...projected.map((p) => p.x));
  const minY = Math.min(...projected.map((p) => p.y));
  const maxY = Math.max(...projected.map((p) => p.y));
  return orbitTrackModelFrame(
    { centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2, width: Math.max(1, maxX - minX) * 1.12, height: Math.max(1, maxY - minY) * 1.12 },
    rotationDeg - frameRotationDeg, Math.cos(polar), Math.cos(trackModelCameraPolarDeg(tiltDeg) * Math.PI / 180),
  );
}

export function orbitTrackModelFrame(frame: TrackModelFrame, rotationDeltaDeg: number, startVerticalScale: number, nextVerticalScale: number): TrackModelFrame {
  // Reproject the same ground pivot, rather than keeping the offset of the old
  // camera angle. Retain the overview dimensions so rotation never changes zoom.
  const angle = rotationDeltaDeg * Math.PI / 180;
  const depth = frame.centerY / Math.max(startVerticalScale, 0.001);
  return {
    ...frame,
    centerX: frame.centerX * Math.cos(angle) + depth * Math.sin(angle),
    centerY: (-frame.centerX * Math.sin(angle) + depth * Math.cos(angle)) * nextVerticalScale,
  };
}

export function getTrackModelOverviewRotation(points: readonly (readonly number[])[], rotationDeg: number, tiltDeg: number, viewport: TrackModelViewport) {
  if (points.length < 2 || viewport.width >= viewport.height) return rotationDeg;
  let bestRotation = rotationDeg;
  let bestScale = 0;
  for (let delta = 0; delta < 180; delta += 15) {
    const candidate = normalizeDegrees(rotationDeg + delta);
    const scale = fitTrackModelFrame(getTrackModelFrame(points, candidate, tiltDeg), viewport).scale;
    if (scale > bestScale * 1.01) { bestRotation = candidate; bestScale = scale; }
  }
  return bestRotation;
}
