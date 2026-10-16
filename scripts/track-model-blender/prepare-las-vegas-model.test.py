import importlib.util
import json
import math
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

import numpy as np

spec=importlib.util.spec_from_file_location('vegas',Path(__file__).with_name('prepare-las-vegas-model.py'))
model=importlib.util.module_from_spec(spec);spec.loader.exec_module(model)


class BuildingImportRegressionTests(unittest.TestCase):
    def test_building_crossing_scene_boundary_is_retained(self):
        ring=[[-2,2],[4,2],[4,8],[-2,8],[-2,2]]
        clipped=model.clip_polygon(ring,{'minX':0,'maxX':10,'minY':0,'maxY':10})
        self.assertEqual(clipped,[[0,2],[4,2],[4,8],[0,8],[0,2]])

    def test_disjoint_building_is_not_added(self):
        self.assertEqual(model.clip_polygon([[20,20],[25,20],[25,25],[20,20]],{'minX':0,'maxX':10,'minY':0,'maxY':10}),[])

    def test_split_multipolygon_ways_join_in_both_directions(self):
        relation=ET.fromstring('<relation><member type="way" ref="10" role="outer"/><member type="way" ref="11" role="outer"/></relation>')
        ways={10:ET.fromstring('<way><nd ref="1"/><nd ref="2"/><nd ref="3"/></way>'),11:ET.fromstring('<way><nd ref="1"/><nd ref="4"/><nd ref="3"/></way>')}
        positions={1:[0,0],2:[5,0],3:[5,5],4:[0,5]}
        self.assertEqual(model.relation_rings(relation,ways,positions,'outer'),[(10,[[0,0],[5,0],[5,5],[0,5],[0,0]])])

    def test_courtyard_members_stay_separate_from_outer_shell(self):
        relation=ET.fromstring('<relation><member type="way" ref="11" role="inner"/></relation>')
        ways={11:ET.fromstring('<way><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="1"/></way>')}
        positions={1:[1,1],2:[2,1],3:[1,2]}
        self.assertEqual(model.relation_rings(relation,ways,positions,'outer'),[])
        self.assertEqual(len(model.relation_rings(relation,ways,positions,'inner')),1)


class CornerGeometryRegressionTests(unittest.TestCase):
    def test_entire_delivered_axis_has_continuous_heading_and_offset_edges(self):
        config=json.loads((model.ROOT/'.track-model-build/las-vegas.json').read_text())
        for name,half_width,closed in [('centerline',7.8,True),('pitCenterline',4.2,False)]:
            with self.subTest(path=name):
                points=np.array(config['model'][name])
                distances=np.r_[0,np.cumsum(np.linalg.norm(np.diff(points,axis=0),axis=1))]
                steps=np.linspace(0,distances[-1],math.ceil(distances[-1]/.5)+1)
                positions=np.stack([np.interp(steps,distances,points[:,i])for i in (0,1)],axis=1)
                edges=np.diff(positions,axis=0)
                directions=edges/np.linalg.norm(edges,axis=1)[:,None]
                pairs=np.sum(directions*np.roll(directions,1,axis=0),axis=1) if closed else np.sum(directions[1:]*directions[:-1],axis=1)
                maximum=np.degrees(np.arccos(np.clip(pairs,-1,1))).max()
                self.assertLess(maximum,4,'Polygonal source vertices remain visible at an apex')
                tangents=np.vstack([directions[0],directions[:-1]+directions[1:],directions[-1]])
                if closed:tangents[0]=tangents[-1]=directions[-1]+directions[0]
                tangents/=np.linalg.norm(tangents,axis=1)[:,None]
                normals=np.stack([-tangents[:,1],tangents[:,0]],axis=1)
                for side in (-1,1):
                    offsets=positions+side*half_width*normals
                    self.assertGreater(np.sum(np.diff(offsets,axis=0)*directions,axis=1).min(),.025,'An inside edge folds backwards')


if __name__=='__main__':unittest.main()
