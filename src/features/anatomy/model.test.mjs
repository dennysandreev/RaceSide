import test from "node:test";
import assert from "node:assert/strict";
import { ersPowerLimit, componentState } from "./model.ts";
import { components, phases } from "./catalog.ts";

test("ERS-K follows normal, overtake and restricted-sector boundary curves", () => {
  for (const [speed, expected] of [[200,350],[290,350],[300,300],[310,250],[339,105],[340,100],[344,20],[345,0],[360,0]]) {
    assert.equal(ersPowerLimit(speed,false,false),expected,`normal at ${speed}`);
  }
  for (const [speed, expected] of [[300,350],[337,350],[338,340],[350,100],[355,0]]) {
    assert.equal(ersPowerLimit(speed,true,false),expected,`overtake at ${speed}`);
  }
  assert.equal(ersPowerLimit(250,false,true),250);
  assert.equal(ersPowerLimit(300,true,true),250);
  assert.equal(ersPowerLimit(345,true,true),0);
  for (let speed=0;speed<=400;speed++) for(const overtake of [true,false]) for(const sector of [true,false]) {
    const power=ersPowerLimit(speed,overtake,sector);
    assert.ok(Number.isFinite(power)&&power>=0&&power<=350);
  }
});

test("the educational braking state reverses motor and battery energy flow", () => {
  assert.equal(componentState("mguk","braking"),"Генерирует ток");
  assert.equal(componentState("battery","braking"),"Принимает энергию");
  assert.equal(componentState("battery","acceleration"),"Отдаёт энергию");
  assert.equal(componentState("front-wing","straight"),"Меньше сопротивление");
});

test("every component relationship and every phase references an existing component", () => {
  const ids=new Set(components.map(c=>c.id));
  assert.equal(ids.size,components.length);
  for(const c of components) for(const id of c.related) assert.ok(ids.has(id),`${c.id} → ${id}`);
  for(const p of phases) for(const id of [...p.active,...p.flow]) assert.ok(ids.has(id),`${p.id} → ${id}`);
});
