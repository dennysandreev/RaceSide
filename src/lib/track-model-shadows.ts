import { Box3, Camera, Mesh, Object3D, OrthographicCamera, Raycaster, Vector2, Vector3 } from "three";

// glTF does not store Three.js shadow flags. Restore them on each viewer clone.
export function configureTrackShadows(scene: Object3D) {
  scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.receiveShadow = true;
    // Thin surface layers must not shadow their own asphalt or each other.
    object.castShadow = !/Terrain|Centreline|Pit_Lane|Runoff|Curbs|Control_Lines|Edge_Lines|Markings|Working_Boxes/i.test(object.name);
  });
}

export function trackShadowFrame(camera: Camera, bounds: Box3, resolution: number) {
  const centre = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  // Map panning uses setViewOffset, without moving the camera. Unproject the
  // centre of the visible viewport so shadows follow that offset at high zoom.
  camera.updateMatrixWorld();
  const raycaster = new Raycaster();
  raycaster.setFromCamera(new Vector2(0,0),camera);
  const { origin, direction } = raycaster.ray;
  const distance = (centre.y - origin.y) / Math.min(-.05, direction.y);
  const target = origin.clone().addScaledVector(direction, Math.max(0, distance));
  target.x = Math.min(bounds.max.x, Math.max(bounds.min.x, target.x));
  target.z = Math.min(bounds.max.z, Math.max(bounds.min.z, target.z));
  target.y = centre.y;
  // The close driving camera needs a much tighter map than the whole venue.
  // An orthographic view scales with zoom, retaining detail when inspecting pits.
  const visibleRadius = camera instanceof OrthographicCamera
    ? Math.hypot((camera.right-camera.left)/camera.zoom,
      (camera.top-camera.bottom)/camera.zoom/Math.max(.25,-direction.y))*.55
    : Math.max(100, camera.position.distanceTo(target)*1.2);
  const radius = Math.max(100, Math.min(Math.hypot(size.x,size.z)*.6+40,visibleRadius));
  // Snap the light's target in its own horizontal plane, avoiding crawling edges.
  const right = new Vector3(.774,0,-.633);
  const up = new Vector3(.477,.657,.584);
  const texel = radius*2/resolution;
  for (const axis of [right,up]) {
    const coordinate = target.dot(axis);
    target.addScaledVector(axis,Math.round(coordinate/texel)*texel-coordinate);
  }
  return { target, radius };
}
