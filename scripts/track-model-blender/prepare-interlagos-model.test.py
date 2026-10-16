"""Geographic regression for T10, independent of the rendered screenshot."""
import importlib.util
import json
import math
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("interlagos", Path(__file__).with_name("prepare-interlagos-model.py"))
model = importlib.util.module_from_spec(spec)
spec.loader.exec_module(model)


class Turn10Alignment(unittest.TestCase):
    def test_road_follows_the_midpoint_of_visible_orthophoto_edges(self):
        line, *_ = model.read_geometry()
        cumulative = model.helpers.cumulative(line)
        corridor = json.loads((model.ROOT / "docs/track-model-interlagos-t10-corridor.json").read_text())
        for station in corridor["stations"]:
            if station["method"] != "GeoSampa RGB cross-section edge trace":
                continue
            midpoint = [(a+b)/2 for a, b in zip(station["innerEdgeWorld"], station["outerEdgeWorld"])]
            gap, _ = model.helpers.nearest(line, cumulative, midpoint)
            self.assertLess(gap, .8, f"T10 station {station['sourceNodeIndex']} is {gap:.2f} m off the visible asphalt centre")

    def test_closed_lap_retains_fia_length_tolerance(self):
        line, *_ = model.read_geometry()
        self.assertLess(math.dist(line[0], line[-1]), .001)
        self.assertLess(abs(model.helpers.cumulative(line)[-1]-4309)/4309, .005)


if __name__ == "__main__":
    unittest.main()
