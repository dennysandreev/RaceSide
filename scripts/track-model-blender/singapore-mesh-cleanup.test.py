import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

spec=importlib.util.spec_from_file_location('cleanup',Path(__file__).with_name('singapore-mesh-cleanup.py'))
cleanup=importlib.util.module_from_spec(spec);spec.loader.exec_module(cleanup)

def mesh(triangles):
    return SimpleNamespace(vertices=[p for t in triangles for p in t],faces=[(i*3,i*3+1,i*3+2) for i in range(len(triangles))],face_colors=[None]*len(triangles),material_indices=[0]*len(triangles))

class CoplanarCleanupTests(unittest.TestCase):
    def test_duplicate_opposite_winding_is_removed(self):
        t=[(0,0,0),(4,0,0),(0,4,0)];m=mesh([t,t[::-1]])
        result=cleanup.clean(m)
        self.assertAlmostEqual(result['removedCoplanarAreaSquareMeters'],8)
        self.assertEqual(len(m.faces),1)
    def test_partial_overlap_is_clipped_and_uvs_interpolated(self):
        m=mesh([[(0,0,0),(4,0,0),(0,4,0)],[(2,0,0),(6,0,0),(2,4,0)]])
        uvs=[[(p[0]/4,p[1]/4) for p in m.vertices[i:i+3]] for i in (0,3)]
        result=cleanup.clean(m,uvs)
        self.assertAlmostEqual(result['removedCoplanarAreaSquareMeters'],2)
        for face,uv in zip(m.faces,uvs):
            for index,(u,v) in zip(face,uv):
                self.assertAlmostEqual(m.vertices[index][0]/4,u);self.assertAlmostEqual(m.vertices[index][1]/4,v)
        self.assertAlmostEqual(cleanup.clean(m,uvs)['removedCoplanarAreaSquareMeters'],0)
    def test_different_storeys_are_not_removed(self):
        m=mesh([[(0,0,0),(4,0,0),(0,4,0)],[(0,0,3),(4,0,3),(0,4,3)]])
        self.assertEqual(cleanup.clean(m)['affectedTriangles'],0)
    def test_shared_edge_is_not_overlap(self):
        m=mesh([[(0,0,0),(4,0,0),(0,4,0)],[(4,0,0),(4,4,0),(0,4,0)]])
        self.assertEqual(cleanup.clean(m)['affectedTriangles'],0)
    def test_vertical_facades_keep_area(self):
        t=[(2,0,0),(2,4,0),(2,0,4)];m=mesh([t,t])
        self.assertEqual(cleanup.clean(m)['removedCoplanarAreaSquareMeters'],8)

if __name__=='__main__':unittest.main()
