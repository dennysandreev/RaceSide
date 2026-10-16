import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mapLocation, projectLocation} from './state.mjs';
const track=JSON.parse(readFileSync(new URL('./tracks/sepang-2026.json',import.meta.url),'utf8'));
const path=JSON.parse(readFileSync(new URL('../../src/data/sepang-live-path.json',import.meta.url),'utf8'));
test('Sepang registration fits independent FP1 lap 5 samples and follows the correct direction',()=>{
  // Public OpenF1 session 11727, HAM lap 5, independent of calibration lap 9.
  const samples=[[-5094,-944],[-1947,3042],[4775,-2231],[-4038,-3477],[4761,-1275]];
  let previous=0;
  for(const [x,y] of samples){
    const location=mapLocation(track,{x,y,date:'2026-10-02T04:50:00Z'});
    const nearest=projectLocation(track.centerline,location.x,location.y);
    assert.ok(nearest.distance/(track.transform.scale*track.liveModelAlignment.scale)<15);
    assert.ok(location.progress>previous);
    assert.equal(location.pitLaneProgress,null);
    previous=location.progress;
  }
  assert.ok(track.liveModelAlignment.rmsMeters<10);
});
test('Sepang live pit path is continuous and map coordinates match the 3D path',()=>{
  assert.ok(path.pitLanePoints.length>100);
  assert.equal(path.pitLanePoints[0][0],0);
  assert.equal(path.pitLanePoints.at(-1)[0],1);
  assert.equal(track.pitLane.points.length,path.pitLanePoints.length);
  for(let i=1;i<path.pitLanePoints.length;i++){
    const a=path.pitLanePoints[i-1],b=path.pitLanePoints[i];
    assert.ok(b[0]>a[0]);
    assert.ok(Math.hypot(b[1]-a[1],b[2]-a[2])<9);
    assert.equal(track.pitLane.points[i].progress,b[0]);
  }
});
