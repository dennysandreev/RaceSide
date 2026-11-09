import test from "node:test";
import assert from "node:assert/strict";
import { adjacentLessonTime, clampLessonTime, LESSON_DURATION, lessonExplanation, lessonSystems, lessonTimeline, sampleLesson, timeAtProgress } from "./monza-lesson.ts";
import { components } from "./catalog.ts";
import { MONZA_MODEL } from "../../data/monza-model.ts";

test("the teaching timeline covers one complete Monza lap without gaps or overlaps", () => {
  assert.equal(lessonTimeline[0].start, 0);
  assert.equal(lessonTimeline.at(-1).end, 1);
  let end = 0;
  for (const [index, section] of lessonTimeline.entries()) {
    assert.ok(section.end > section.start && section.duration > 0);
    assert.equal(section.time, end);
    if (index) assert.equal(section.start, lessonTimeline[index - 1].end);
    end += section.duration;
  }
  assert.equal(end, LESSON_DURATION);
  assert.equal(sampleLesson(LESSON_DURATION).progress, 1);
});

test("all existing Monza corner markers fall inside a corner teaching phase", () => {
  for (const turn of MONZA_MODEL.turns) {
    const frame = sampleLesson(timeAtProgress(turn.progress));
    assert.equal(frame.phase, "corner", `${turn.number}: ${turn.name}`);
    assert.ok(Math.abs(frame.progress - turn.progress) < 1e-10);
    assert.equal(frame.wingOpening, 0);
  }
});

test("scrubbing is bounded and round-trips from distance to time", () => {
  assert.equal(clampLessonTime(-1), 0);
  assert.equal(clampLessonTime(NaN), 0);
  assert.equal(clampLessonTime(Infinity), 0);
  assert.equal(clampLessonTime(1e6), LESSON_DURATION);
  for (let i = 0; i <= 1000; i++) {
    const progress = i / 1000;
    assert.ok(Math.abs(sampleLesson(timeAtProgress(progress)).progress - progress) < 1e-10);
  }
});

test("every pose is deterministic when scrubbing forwards, backwards or repeatedly", () => {
  const order = [0, 56, 13, LESSON_DURATION, 89, 13, 0, 56];
  const baseline = new Map(order.map(time => [time, sampleLesson(time)]));
  for (const time of order) assert.deepEqual(sampleLesson(time), baseline.get(time));
  for (const section of lessonTimeline.slice(1)) {
    const before = sampleLesson(section.time - 1e-7), after = sampleLesson(section.time);
    assert.ok(Math.abs(after.mechanismTime - before.mechanismTime) < 1e-6);
    assert.ok(Math.abs(after.progress - before.progress) < 1e-6);
    assert.ok(Math.abs(after.wingOpening - before.wingOpening) < 1e-6);
  }
});

test("wings return before braking and energy recovery is an explicit teaching state", () => {
  let holdStraight = false;
  for (const section of lessonTimeline) {
    const frame = sampleLesson(section.time + section.duration / 2);
    assert.ok(frame.wingOpening >= 0 && frame.wingOpening <= 1);
    if (frame.phase === "braking") { assert.equal(frame.wingOpening, 0); assert.equal(frame.energy, "recover"); }
    if (frame.wingOpening > 0) assert.equal(frame.phase, "straight");
    if (frame.phase === "straight" && frame.energy === "hold") holdStraight = true;
  }
  assert.ok(holdStraight, "straight does not implicitly mean battery deployment");
});

test("system explanations and both energy directions refer to selectable real assemblies", () => {
  const ids = new Set(components.map(component => component.id));
  for (const system of lessonSystems) {
    for (const id of system.components) assert.ok(ids.has(id), id);
    for (const section of lessonTimeline) {
      const explanation = lessonExplanation(system.id, sampleLesson(section.time));
      assert.ok(explanation.title && explanation.text);
      for (const id of explanation.path) assert.ok(ids.has(id), id);
    }
  }
  assert.deepEqual(lessonExplanation("energy", sampleLesson(0)).path, ["battery", "inverter", "mguk"]);
  assert.deepEqual(lessonExplanation("energy", sampleLesson(12)).path, ["mguk", "inverter", "battery"]);
  assert.deepEqual(lessonExplanation("energy", sampleLesson(19)).path, []);
});

test("moment navigation restarts the current section then steps back, never wrapping", () => {
  assert.equal(adjacentLessonTime(0, -1), 0);
  assert.equal(adjacentLessonTime(0, 1), 12);
  assert.equal(adjacentLessonTime(15, -1), 12);
  assert.equal(adjacentLessonTime(12, -1), 0);
  assert.equal(adjacentLessonTime(LESSON_DURATION, 1), lessonTimeline.at(-1).time);
});
