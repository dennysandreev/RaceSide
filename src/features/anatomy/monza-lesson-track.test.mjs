import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { Box3, PerspectiveCamera, Vector3 } from "three";
import { decodeModelAsset } from "./w17-model-asset.ts";
import { monzaChapters, monzaFollowCameraPosition, sampleMonzaPose } from "./monza-lesson-track.ts";
import { lessonTimeline } from "./monza-lesson.ts";
import { MONZA_MODEL } from "../../data/monza-model.ts";

test("the driving path closes at the map start and restores finite, forward-facing poses", () => {
  const start = sampleMonzaPose(0), finish = sampleMonzaPose(1);
  assert.ok(start.position.distanceTo(finish.position) < 1e-8);
  assert.ok(start.forward.dot(finish.forward) > .999);
  assert.equal(start.position.x, MONZA_MODEL.points[0][1]);
  assert.equal(start.position.z, -MONZA_MODEL.points[0][2]);
  for (const progress of [NaN, Infinity, -1, 2, .1, .9, .1, 0]) {
    const pose = sampleMonzaPose(progress);
    assert.ok([...pose.position.toArray(), pose.yaw, pose.pitch].every(Number.isFinite));
    assert.ok(Math.abs(pose.forward.length() - 1) < 1e-8);
    const nose = new Vector3(1, 0, 0).applyAxisAngle(new Vector3(0, 1, 0), pose.yaw);
    assert.ok(nose.dot(pose.forward) > .999999);
    assert.deepEqual(pose, sampleMonzaPose(progress));
  }
});

test("the full delivered car stays inside the follow and cutaway camera frames", () => {
  const bytes = gunzipSync(readFileSync(new URL("../../../public/anatomy/model-mercedes.bin.gz", import.meta.url)));
  const model = decodeModelAsset(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const box = new Box3().setFromObject(model.root);
  const corners = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new Vector3(x, y, z));
  const axis = new Vector3(0, 1, 0);
  for (const aspect of [.65, 1, 1.78, 2.4]) for (const inside of [false, true]) {
    const camera = new PerspectiveCamera(43, aspect, .1, 12000);
    for (let i = 0; i <= 200; i++) {
      const pose = sampleMonzaPose(i / 200);
      camera.position.copy(monzaFollowCameraPosition(pose, inside, aspect));
      const target = pose.position.clone().addScaledVector(pose.forward, inside ? 0 : 2);
      target.y += .6;
      camera.lookAt(target); camera.updateMatrixWorld();
      for (const corner of corners) {
        const point = corner.clone().applyAxisAngle(new Vector3(0, 0, 1), pose.pitch).applyAxisAngle(axis, pose.yaw).add(pose.position).project(camera);
        assert.ok(Math.abs(point.x) < .95 && Math.abs(point.y) < .95 && point.z > -1 && point.z < 1,
          `Car cropped: aspect ${aspect}, inside ${inside}, progress ${i / 200}, projected ${point.toArray()}`);
      }
    }
  }
});

test("chapter navigation follows the physical order of the teaching lap", () => {
  const times = monzaChapters.map(chapter => lessonTimeline.find(section => section.id === chapter.id)?.time);
  assert.equal(times[0], 0);
  assert.ok(times.every(Number.isFinite));
  for (let i = 1; i < times.length; i++) assert.ok(times[i] > times[i - 1]);
});
