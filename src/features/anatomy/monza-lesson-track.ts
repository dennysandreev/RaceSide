import { CatmullRomCurve3, Vector3 } from "three";
import { MONZA_MODEL, MONZA_REPLAY_PATH } from "../../data/monza-model.ts";

// Blender exports metres with north along -Z. The map stores elevation in
// decimetres above sea level; the GLB uses the local terrain datum.
export const monzaLessonCurve = new CatmullRomCurve3(
  MONZA_MODEL.points.slice(0, -1).map(p => new Vector3(p[1], p[3] / 10 - MONZA_REPLAY_PATH.baseElevationMeters, -p[2])),
  true, "centripetal",
);

export function sampleMonzaPose(progress: number) {
  const t = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const position = monzaLessonCurve.getPoint(t);
  const forward = monzaLessonCurve.getTangent(t);
  const pitch = Math.atan2(forward.y, Math.hypot(forward.x, forward.z));
  forward.y = 0;
  forward.normalize();
  return { position, forward, yaw: Math.atan2(-forward.z, forward.x), pitch };
}

// OSM north-banking / Serraglio crossing in the GLB's local metre frame.
// Ease the chase camera down before the portal; its usual 5.2 m height is
// above the bridge's minimum clearance, even though the car fits underneath.
export function monzaFollowCameraHeight(position: Vector3, inside = false) {
  const distance = Math.hypot(position.x-130.8365,position.z+811.8532);
  const t = Math.min(1,Math.max(0,(distance-18)/45));
  const blend = t*t*(3-2*t);
  return 3.4+((inside?4.5:5.2)-3.4)*blend;
}

export function monzaFollowCameraPosition(pose: ReturnType<typeof sampleMonzaPose>, inside: boolean, aspect: number) {
  const scale = Math.max(1, Math.min(1.8, 1 / Math.max(.5, aspect)));
  const open = (monzaFollowCameraHeight(pose.position)-3.4)/1.8;
  const requestedLateral = (inside?7.8:4.8)*scale;
  // Keep the wider portrait/cutaway view within the portal's side walls too.
  const lateral = Math.min(requestedLateral,6.5+(requestedLateral-6.5)*open);
  // Move behind the car when the portal prevents a wider side view, retaining
  // framing distance without crossing its walls or raising the camera.
  const behind = Math.hypot((inside?3.4:8)*scale, Math.sqrt(Math.max(0,requestedLateral**2-lateral**2)));
  const position = pose.position.clone().addScaledVector(pose.forward,-behind);
  position.x -= pose.forward.z*lateral;
  position.z += pose.forward.x*lateral;
  position.y += monzaFollowCameraHeight(position,inside)+(scale-1)*(inside?4.5:5.2)*open;
  return position;
}

export const monzaChapters = [
  { name: "Старт", id: "start" },
  { name: "Первая шикана", id: "rettifilo-brake" },
  { name: "Курва Гранде", id: "grande" },
  { name: "Роджа", id: "roggia-brake" },
  { name: "Лесмо", id: "lesmo-one-brake" },
  { name: "Серральо", id: "serraglio" },
  { name: "Аскари", id: "ascari-brake" },
  { name: "Альборето", id: "alboreto-brake" },
] as const;
