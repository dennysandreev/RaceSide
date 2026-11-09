import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import { configureTrackShadows, trackShadowFrame } from './track-model-shadows.ts';

test('imported structures cast shadows while flat overlays only receive them', () => {
  const scene=new Group();
  for(const name of ['Grandstands','Tree_Crowns','Monza_Historic_Banked_Oval','Terrain','Track_Edge_Lines','FIA_Pit_Lane']) {
    const mesh=new Mesh(new BoxGeometry(),new MeshStandardMaterial());mesh.name=name;scene.add(mesh);
  }
  configureTrackShadows(scene);
  for(const mesh of scene.children) {
    assert.equal(mesh.receiveShadow,true);
    assert.equal(mesh.castShadow,['Grandstands','Tree_Crowns','Monza_Historic_Banked_Oval'].includes(mesh.name),mesh.name);
  }
});

test('shadow coverage tightens at zoom and follows a panned inspection view', () => {
  const bounds=new Box3(new Vector3(-1800,0,-1800),new Vector3(1800,200,1800));
  const camera=new OrthographicCamera(-1800,1800,1000,-1000,1,10000);
  camera.position.set(1500,2000,1500);camera.lookAt(0,100,0);camera.updateMatrixWorld();
  const full=trackShadowFrame(camera,bounds,4096);
  camera.zoom=6;camera.updateProjectionMatrix();
  const close=trackShadowFrame(camera,bounds,4096);
  assert.ok(close.radius < full.radius/3);
  camera.position.x+=500;camera.updateMatrixWorld();
  const panned=trackShadowFrame(camera,bounds,4096);
  assert.ok(panned.target.x-close.target.x>490);
  assert.ok(Number.isFinite(panned.radius));
  // The map's real pan path shifts the projection, not camera.position.
  camera.setViewOffset(1280,720,1800,0,1280,720);
  const offset=trackShadowFrame(camera,bounds,4096);
  assert.ok(offset.target.distanceTo(panned.target)>700);
  assert.ok(Math.abs(offset.radius-panned.radius)<.001);
  camera.clearViewOffset();
  const reset=trackShadowFrame(camera,bounds,4096);
  assert.ok(reset.target.distanceTo(panned.target)<.001);
});

test('near-horizontal driving camera keeps finite local coverage and full overview scales up', () => {
  const bounds=new Box3(new Vector3(-1800,0,-1800),new Vector3(1800,80,1800));
  const camera=new PerspectiveCamera(43,1.5,.1,12000);
  camera.position.set(100,20,100);camera.lookAt(100,19,90);camera.updateMatrixWorld();
  const local=trackShadowFrame(camera,bounds,2048);
  assert.ok(local.radius>=100 && local.radius<500);
  camera.position.set(1300,2350,1650);camera.lookAt(80,18,-450);camera.updateMatrixWorld();
  const overview=trackShadowFrame(camera,bounds,2048);
  assert.ok(overview.radius>2000);
});
