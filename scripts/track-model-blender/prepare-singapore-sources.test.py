import hashlib
import importlib.util
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent


def module(filename):
    spec = importlib.util.spec_from_file_location(filename.replace("-", "_"), HERE / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


prepare = module("prepare-singapore-sources.py")
download = module("download-singapore-data.py")


class SingaporeSources(unittest.TestCase):
    def test_utm_central_meridian_and_southern_offset(self):
        self.assertEqual(prepare.utm48(105, 0), [500000, 0])
        west = prepare.utm48(103.85, 1.29)
        east = prepare.utm48(103.86, 1.29)
        self.assertGreater(east[0], west[0])
        self.assertAlmostEqual(east[0] - west[0], 1112.7, delta=.4)

    def test_ring_joins_shuffled_reversed_ways(self):
        nodes, order = prepare.join_ring([("1", ["a", "b"]), ("3", ["d", "c"]),
                                          ("2", ["c", "b"]), ("4", ["a", "d"])])
        self.assertEqual(nodes, ["a", "b", "c", "d", "a"])
        self.assertEqual([item["wayId"] for item in order], [1, 2, 3, 4])

    def test_open_branched_and_disconnected_graphs_are_rejected(self):
        for segments in [[], [("1", ["a", "b"])],
                         [("1", ["a", "b", "a"]), ("2", ["c", "d", "c"])],
                         [("1", ["a", "b"]), ("2", ["b", "a"]), ("3", ["b", "c"])]]:
            with self.assertRaises(ValueError):
                prepare.join_ring(segments)

    def test_control_line_rotation_preserves_distance_and_closure(self):
        line = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
        for control in ([5, -2], [0, 0], [10, 10]):
            rotated, gap = prepare.rotate_to_control_line(line, control)
            self.assertEqual(rotated[0], rotated[-1])
            self.assertAlmostEqual(prepare.length(rotated), 40)
            self.assertTrue(all(a != b for a, b in zip(rotated, rotated[1:])))
            self.assertGreaterEqual(gap, 0)

    def test_missing_or_invalid_height_is_never_invented(self):
        for value in [None, "unknown", "nan", "inf", "10;20"]:
            self.assertIsNone(prepare.number(value))
        self.assertEqual(prepare.number("15 m"), 15)
        self.assertEqual(prepare.number("0"), 0)

    def test_source_lock_detects_corruption(self):
        data = b"measured source"
        entry = {"file": "test", "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        download.verify(data, entry)
        with self.assertRaises(ValueError):
            download.verify(b"invented source", entry)


if __name__ == "__main__":
    unittest.main()
