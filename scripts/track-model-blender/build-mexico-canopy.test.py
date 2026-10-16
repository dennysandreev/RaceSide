"""Regression checks for concave grandstand canopies, without requiring Blender."""

import ast
from pathlib import Path
import unittest


SOURCE = Path(__file__).with_name("build-mexico-digital-twin.py")
tree = ast.parse(SOURCE.read_text())
helpers = [node for node in tree.body if isinstance(node, ast.FunctionDef)
           and node.name in ("polygon_scanline_spans", "clip_to_triangle")]
namespace = {}
exec(compile(ast.Module(body=helpers, type_ignores=[]), str(SOURCE), "exec"), namespace)
scan = namespace["polygon_scanline_spans"]
clip = namespace["clip_to_triangle"]


def area(polygon):
    return abs(sum(a[0] * b[1] - b[0] * a[1]
                   for a, b in zip(polygon, polygon[1:] + polygon[:1]))) / 2


class CanopyFootprintTests(unittest.TestCase):
    def setUp(self):
        self.footprint = [(0, 0), (10, 0), (10, 2), (2, 2), (2, 10), (0, 10)]
        self.triangles = [[(0, 0), (10, 0), (10, 2)], [(0, 0), (10, 2), (2, 2)],
                          [(0, 0), (2, 2), (2, 10)], [(0, 0), (2, 10), (0, 10)]]

    def test_sections_follow_the_two_different_depths_of_a_concave_stand(self):
        self.assertEqual(scan(self.footprint, 1), [(0, 10)])
        self.assertEqual(scan(self.footprint, 5), [(0, 2)])
        self.assertEqual(scan(self.footprint, 11), [])

    def test_clipping_preserves_source_area_without_filling_empty_bbox_corner(self):
        panels = [clip([(0, 0), (10, 0), (10, 10), (0, 10)], triangle)
                  for triangle in self.triangles]
        self.assertAlmostEqual(sum(area(panel) for panel in panels), area(self.footprint))
        for panel in panels:
            for x, y in panel:
                self.assertTrue(x <= 2 + 1e-7 or y <= 2 + 1e-7)

    def test_reversed_triangle_winding_does_not_change_clipping(self):
        panel = [(0, 0), (10, 0), (10, 10), (0, 10)]
        for triangle in self.triangles:
            self.assertAlmostEqual(area(clip(panel, triangle)), area(clip(panel, list(reversed(triangle)))))

    def test_roof_panel_outside_the_footprint_has_no_geometry(self):
        outside = [(5, 5), (10, 5), (10, 10), (5, 10)]
        self.assertTrue(all(not clip(outside, triangle) for triangle in self.triangles))


if __name__ == "__main__":
    unittest.main()
