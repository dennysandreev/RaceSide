#!/usr/bin/env python3
"""Offline integration checks for the reviewed Mexico source/preparation snapshot.

Run after download-mexico-data.py --offline and prepare-mexico-model.py with the
existing build Python runtime (numpy, rasterio, OpenCV and Pillow). These checks
read the real source cache and prepared artifacts without regenerating them.
"""

import hashlib
import importlib.util
import json
import math
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

import cv2
import numpy as np
from PIL import Image
import rasterio
from rasterio.warp import transform

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SOURCE = ROOT / ".track-model-build/mexico-source"
PREPARED = ROOT / ".track-model-build/mexico-prepared"
MAIN_WAYS = [772755821, 1313598528, 772754605, 772754608, 1128592398,
             1128592396, 772755824, 823823141, 823823140]
PIT_WAYS = [638504647, 772763791]
FINISH_NODE = "5070396402"
START_NODE = "13826403209"


def module(filename):
    spec = importlib.util.spec_from_file_location(filename.replace("-", "_"), HERE / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


prepare = module("prepare-mexico-model.py")
download = module("download-mexico-data.py")


def read_json(path):
    return json.loads(path.read_text())


def distances(line):
    return np.concatenate(([0.0], np.cumsum(np.linalg.norm(np.diff(line, axis=0), axis=1))))


def nearest_distance(line, progress, point):
    """Independent vector projection, rather than the prepare module's helper."""
    segments = np.diff(line, axis=0)
    fractions = np.clip(np.sum((point - line[:-1]) * segments, axis=1)
                        / np.sum(segments * segments, axis=1), 0, 1)
    gaps = np.linalg.norm(line[:-1] + fractions[:, None] * segments - point, axis=1)
    index = int(np.argmin(gaps))
    return float(gaps[index]), float(progress[index] + fractions[index]
                                   * (progress[index + 1] - progress[index]))


class MexicoPreparation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config = read_json(ROOT / ".track-model-build/mexico.json")
        cls.model = cls.config["model"]
        cls.lock = read_json(ROOT / "docs/track-model-mexico-source-manifest.json")
        cls.registration = read_json(ROOT / "docs/track-model-mexico-skysat-registration.json")
        cls.raster = read_json(PREPARED / "raster-metadata.json")
        cls.profiles = read_json(PREPARED / "mexico-road-profiles.json")
        osm = ET.parse(SOURCE / "osm.xml").getroot()
        cls.nodes = {n.get("id"): n for n in osm.findall("node")}
        cls.ways = {int(w.get("id")): w for w in osm.findall("way")}
        node_ids = list(cls.nodes)
        east, north = transform("EPSG:4326", "EPSG:32614",
                                [float(cls.nodes[i].get("lon")) for i in node_ids],
                                [float(cls.nodes[i].get("lat")) for i in node_ids])
        cls.projected = dict(zip(node_ids, zip(east, north)))
        cls.line = np.asarray(cls.model["centerline"], dtype=np.float64)
        cls.pit = np.asarray(cls.model["pitCenterline"], dtype=np.float64)
        cls.progress = distances(cls.line)
        cls.pit_progress = distances(cls.pit)

    def source_chain(self, identifiers):
        refs = []
        for ident in identifiers:
            way = self.ways[ident]
            tags = {t.get("k"): t.get("v") for t in way.findall("tag")}
            self.assertEqual(tags.get("highway"), "raceway", ident)
            self.assertEqual(tags.get("oneway"), "yes", ident)
            segment = [n.get("ref") for n in way.findall("nd")]
            self.assertTrue(all(node in self.projected for node in segment), ident)
            if refs:
                self.assertEqual(refs[-1], segment[0], f"Disconnected OSM way {ident}")
            refs.extend(segment if not refs else segment[1:])
        return refs

    def test_real_closed_clockwise_f1_chain_and_unscaled_length(self):
        self.assertEqual(self.model["mainCircuitWayIds"], MAIN_WAYS)
        refs = self.source_chain(MAIN_WAYS)
        self.assertEqual(refs[0], refs[-1])
        finish_index = refs.index(FINISH_NODE)
        rotated = refs[finish_index:-1] + refs[:finish_index + 1]
        expected = np.asarray([self.projected[node] for node in rotated])
        np.testing.assert_allclose(self.line, expected, atol=.01, rtol=0)
        self.assertLess(math.dist(self.line[0], self.line[-1]), .001)
        self.assertTrue(np.all(np.diff(self.progress) > 0))
        centered = self.line - self.line[0]
        area = np.sum(centered[:-1, 0] * centered[1:, 1]
                      - centered[1:, 0] * centered[:-1, 1]) / 2
        self.assertLess(area, -500000, "The UTM circuit must run clockwise, without mirroring")
        self.assertEqual(self.model["lapLengthMeters"], 4304)
        self.assertLess(abs(self.progress[-1] - 4304) / 4304, .005)
        self.assertGreater(self.progress[-1], 4304, "Measured OSM distance must not be rescaled to FIA")

    def test_distinct_sourced_finish_and_race_start(self):
        controls = self.config["officialControlPoints"]
        self.assertEqual(str(controls["finishNodeId"]), FINISH_NODE)
        self.assertEqual(self.nodes[FINISH_NODE].find("tag[@k='name']").get("v"), "Finish Line")
        self.assertEqual(self.nodes[START_NODE].find("tag[@k='name']").get("v"), "Start Line")
        np.testing.assert_allclose(self.line[0], self.projected[FINISH_NODE], atol=.01, rtol=0)
        gap, start_distance = nearest_distance(self.line, self.progress,
                                               np.asarray(self.projected[START_NODE]))
        self.assertLess(gap, .01)
        self.assertAlmostEqual(self.model["raceStartDistanceMeters"], start_distance, delta=.01)
        self.assertGreater(start_distance, 100)
        self.assertLess(start_distance, self.model["turns"][0]["distanceMeters"])
        self.assertEqual(controls["finishGapMeters"], 0)

    def test_real_pit_chain_connects_to_main_at_both_ends(self):
        self.assertEqual(self.model["pitLaneWayIds"], PIT_WAYS)
        refs = self.source_chain(PIT_WAYS)
        self.assertNotEqual(refs[0], refs[-1])
        expected = np.asarray([self.projected[node] for node in refs])
        np.testing.assert_allclose(self.pit, expected, atol=.01, rtol=0)
        self.assertTrue(np.all(np.diff(self.pit_progress) > 0))
        self.assertTrue(750 < self.pit_progress[-1] < 850)
        for endpoint in (self.pit[0], self.pit[-1]):
            self.assertLess(nearest_distance(self.line, self.progress, endpoint)[0], .001)
        self.assertEqual(self.config["officialControlPoints"]["pitEndpointGapMeters"], [0, 0])

    def test_seventeen_apices_and_fia_control_offsets(self):
        turns = self.model["turns"]
        self.assertEqual([t["number"] for t in turns], list(range(1, 18)))
        turn_progress = [t["distanceMeters"] for t in turns]
        self.assertTrue(all(a < b for a, b in zip(turn_progress, turn_progress[1:])))
        self.assertTrue(0 < turn_progress[0] < turn_progress[-1] < self.progress[-1])
        original_refs = self.source_chain(MAIN_WAYS)
        original = np.asarray([self.projected[node] for node in original_refs])
        for turn in turns:
            expected = original[turn["sourceVertex"]]
            np.testing.assert_allclose(turn["sourceCoordinate"], expected, atol=.01, rtol=0)
            gap, progress = nearest_distance(self.line, self.progress, expected)
            self.assertLess(gap, .01)
            self.assertAlmostEqual(turn["distanceMeters"], progress, delta=.01)
        controls = self.config["officialControlPoints"]
        self.assertEqual(controls["referenceYear"], 2025)
        self.assertFalse(controls["currentEventVerified"])
        self.assertEqual(controls["pitBoxes"], 33)
        self.assertEqual(self.model["pitBoxes"], 33)
        self.assertAlmostEqual(controls["sectorBoundaryDistancesMeters"][0], turn_progress[3] - 136)
        self.assertAlmostEqual(controls["sectorBoundaryDistancesMeters"][1], turn_progress[11] - 242)
        self.assertAlmostEqual(controls["speedTrapDistanceMeters"], turn_progress[0] - 234)

    def test_all_twenty_seven_sources_are_pinned_and_cached_identically(self):
        sources = self.lock["sources"]
        self.assertGreaterEqual(len(sources), 27)
        self.assertEqual(len({entry["file"] for entry in sources}), len(sources))
        self.assertEqual(read_json(SOURCE / "source-manifest.json")["sources"], sources)
        self.assertEqual(self.config["sourceManifest"]["sources"], sources)
        for entry in sources:
            with self.subTest(source=entry["file"]):
                self.assertTrue(entry["license"])
                self.assertTrue(entry["attribution"])
                self.assertTrue(entry["retrievedAt"])
                download.verify(SOURCE / entry["file"], entry)
        by_file = {entry["file"]: entry for entry in sources}
        self.assertEqual(by_file["planet-skysat-2018-06-04.jpg"]["license"], "CC BY-SA 4.0")
        self.assertFalse(by_file["esri-registration-reference.jpg"]["redistributed"])
        self.assertIn("official-event-map-2026.txt", by_file)
        self.assertNotIn("official-event-map-2026.js", by_file)
        for filename in ("official-baseball-stadium-architect.html", "official-baseball-stadium-aerial-photo.jpg",
                         "official-baseball-stadium-field-photo.jpg", "official-baseball-stadium-roof-plan.jpg",
                         "official-baseball-stadium-section.jpg", "official-baseball-stadium-museum.pdf"):
            self.assertFalse(by_file[filename]["redistributed"])

    def test_current_baseball_roof_replaces_old_construction_colors(self):
        roof = self.config["baseballStadiumRoof"]
        self.assertEqual(roof["osmWayId"], 828705077)
        self.assertEqual(roof["overallHeightMeters"], 35)
        self.assertIn("SALA-2.pdf", roof["heightSource"])
        self.assertIn("approximate", roof["profileAccuracy"])
        vectors = {item["id"]: item for item in self.config["vectors"]}
        self.assertEqual(vectors[828705077]["tags"]["building"], "roof")
        self.assertEqual(vectors[828705077]["roofColor"], [.92, .92, .90])
        self.assertIn("architect", vectors[828705077]["roofColorSource"])
        stands = {item["id"]: item for item in self.config["grandstands"]}
        self.assertEqual(stands[828705058]["coveredRearFraction"], 0)
        self.assertIn("roof:height=60 is rejected", " ".join(self.config["limitations"]))

    def test_baseball_turf_uses_real_pitch_footprint_and_audited_color(self):
        surfaces = {item["id"]: item for item in self.config["surfacePolygons"]}
        field = surfaces["baseball-field-828705073"]
        vectors = {item["id"]: item for item in self.config["vectors"]}
        self.assertEqual(field["osmWayId"], 828705073)
        self.assertEqual(field["world"], vectors[828705073]["world"])
        audit = read_json(ROOT / "docs/track-model-mexico-building-colours.json")
        color = next(item for item in audit["sources"] if item["id"] == "baseballField")
        self.assertEqual(field["colorSourceSha256"], color["sha256"])
        self.assertIn(color["file"], field["colorSource"])
        np.testing.assert_allclose(field["color"], np.asarray(color["sampledSrgb"]) / 255, atol=.0001, rtol=0)
        data = (SOURCE / color["file"]).read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(), color["sha256"])
        with Image.open(SOURCE / color["file"]) as photo:
            pixels = np.asarray(photo.convert("RGB").crop(color["reviewedPixelRegion"])).reshape(-1, 3).astype(float)
        green = ((pixels[:, 1] > 1.25 * pixels[:, 0]) & (pixels[:, 1] > 1.25 * pixels[:, 2])
                 & (pixels[:, 1] > 60) & (pixels[:, 1] < 190))
        self.assertEqual(int(np.count_nonzero(green)), color["selectedPixels"])
        np.testing.assert_array_equal(np.median(pixels[green], axis=0), color["sampledSrgb"])

    def test_changed_bytes_and_missing_offline_sources_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            path = directory / "source.bin"
            path.write_bytes(b"observed")
            entry = {"file": path.name, "bytes": 8,
                     "sha256": hashlib.sha256(b"observed").hexdigest()}
            download.verify(path, entry)
            for corrupted in (b"invented", b"truncated"):
                path.write_bytes(corrupted)
                with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                    download.verify(path, entry)
            lock = directory / "lock.json"
            lock.write_text(json.dumps({"sources": [entry]}))
            with patch.object(download, "LOCK", lock):
                with self.assertRaisesRegex(FileNotFoundError, "Missing pinned"):
                    download.download(offline=True, source_directory=directory / "empty")
            (directory / "source-manifest.json").write_text(lock.read_text())
            with patch.object(prepare, "SOURCE", directory), patch.object(prepare, "PREPARED", directory / "prepared"):
                with self.assertRaisesRegex(ValueError, "Pinned Mexico source changed"):
                    prepare.prepare()

    def test_pinned_affine_is_not_mirrored_and_residual_is_below_three_metres(self):
        reg = self.registration
        matrix = np.asarray(reg["sourcePixelToReferencePixelAffine"], dtype=np.float64)
        self.assertTrue(np.all(np.isfinite(matrix)))
        self.assertGreater(np.linalg.det(matrix[:, :2]), 0)
        self.assertGreater(matrix[0, 0], .9)
        self.assertGreater(matrix[1, 1], .9)
        self.assertTrue(reg["referenceOnlyNotRedistributed"])
        points = reg["inlierControlPoints"]
        self.assertEqual(len(points), reg["inlierCount"])
        self.assertGreaterEqual(len(points), 20)
        source = np.asarray([point["sourcePixel"] + [1] for point in points])
        reference = np.asarray([point["referencePixel"] for point in points])
        residual = source @ matrix.T - reference
        rms_pixels = float(np.sqrt(np.mean(np.sum(residual ** 2, axis=1))))
        rms_metres = rms_pixels * reg["referencePixelGridSpacingMeters"]
        self.assertTrue(math.isfinite(rms_metres))
        self.assertLess(rms_metres, 3)
        self.assertAlmostEqual(reg["inlierRmsPixels"], rms_pixels, delta=.0001)
        self.assertAlmostEqual(reg["inlierRmsMeters"], rms_metres, delta=.0001)
        self.assertEqual(set(reg["pinnedInputSha256"]), {reg["sourceImage"], reg["referenceImage"]})
        for filename, expected in reg["pinnedInputSha256"].items():
            self.assertEqual(hashlib.sha256((SOURCE / filename).read_bytes()).hexdigest(), expected)

    def test_changed_registration_input_is_rejected_before_texture_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            for filename in self.registration["pinnedInputSha256"]:
                (directory / filename).write_bytes((SOURCE / filename).read_bytes())
            (directory / self.registration["referenceImage"]).write_bytes(b"changed reference")
            output = directory / "output"
            output.mkdir()
            with patch.object(prepare, "SOURCE", directory), patch.object(prepare, "PREPARED", output):
                with self.assertRaisesRegex(ValueError, "Reviewed Mexico registration input changed"):
                    prepare.registered_aerial(self.line)
            self.assertEqual(list(output.iterdir()), [])

    def test_registered_texture_has_full_pixel_and_geographic_coverage(self):
        reg, bounds = self.registration, self.model["bounds"]
        matrix = np.asarray(reg["sourcePixelToReferencePixelAffine"], dtype=np.float64).copy()
        spacing = reg["referencePixelGridSpacingMeters"]
        matrix[0, 2] += (reg["referenceBounds"]["minX"] - bounds["minX"]) / spacing
        matrix[1, 2] += (bounds["maxY"] - reg["referenceBounds"]["maxY"]) / spacing
        width = round((bounds["maxX"] - bounds["minX"]) / spacing)
        height = round((bounds["maxY"] - bounds["minY"]) / spacing)
        with Image.open(SOURCE / reg["sourceImage"]) as source:
            source_width, source_height = source.size
        mask = cv2.warpAffine(np.ones((source_height, source_width), dtype=np.uint8),
                             matrix, (width, height), flags=cv2.INTER_NEAREST)
        self.assertTrue(np.all(mask == 1), "No uncovered/black frame may enter the licensed texture")
        with rasterio.open(PREPARED / "mexico-orthophoto.tif") as texture:
            self.assertEqual(texture.crs.to_epsg(), 32614)
            self.assertEqual((texture.width, texture.height), (width, height))
            self.assertEqual(list(texture.bounds), [bounds[k] for k in ("minX", "minY", "maxX", "maxY")])
            self.assertGreater(texture.transform.a, 0)
            self.assertLess(texture.transform.e, 0)
        self.assertTrue(self.raster["terrainSurface"]["allOutputPixelsCovered"])
        for point in np.concatenate((self.line, self.pit)):
            self.assertTrue(bounds["minX"] <= point[0] <= bounds["maxX"])
            self.assertTrue(bounds["minY"] <= point[1] <= bounds["maxY"])

    def test_reviewed_transform_and_derived_artifacts_have_recorded_hashes(self):
        derived = self.config["sourceManifest"]["derivedResources"]
        self.assertEqual({item["file"] for item in derived}, {
            "docs/track-model-mexico-skysat-registration.json",
            "docs/track-model-mexico-building-colours.json",
            "docs/track-model-mexico-stadium-reference.json",
            ".track-model-build/mexico-prepared/mexico-orthophoto.jpg",
            ".track-model-build/mexico-prepared/mexico-dtm.f32le",
        })
        self.assertEqual(len(derived), 5)
        for entry in derived:
            with self.subTest(derived=entry["file"]):
                download.verify(ROOT / entry["file"], entry)
                self.assertEqual(entry["crs"], "EPSG:32614")
                if entry["file"] == "docs/track-model-mexico-stadium-reference.json":
                    pinned = next(item for item in self.lock["derivedResources"] if item["file"] == entry["file"])
                    self.assertEqual(entry, pinned)
                else:
                    self.assertEqual(entry["bbox"], self.model["bounds"])

    def test_changed_pinned_stadium_reference_is_rejected_before_generated_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            source = directory / "source"
            source.mkdir()
            reference = directory / "stadium.json"
            reference.write_bytes(b"reviewed geometry")
            entry = {"file": reference.name, "bytes": reference.stat().st_size,
                     "sha256": hashlib.sha256(reference.read_bytes()).hexdigest()}
            (source / "source-manifest.json").write_text(json.dumps({"sources": [], "derivedResources": [entry]}))
            reference.write_bytes(b"unreviewed geometry")
            output = directory / "prepared"
            with patch.object(prepare, "ROOT", directory), patch.object(prepare, "SOURCE", source), patch.object(prepare, "PREPARED", output):
                with self.assertRaisesRegex(ValueError, "Pinned Mexico derived reference changed"):
                    prepare.prepare()
            self.assertEqual(list(output.iterdir()), [])

    def test_native_vertical_scale_and_finite_unexaggerated_profiles(self):
        with rasterio.open(SOURCE / "gedtm30-native.tif") as native:
            self.assertEqual(native.crs.to_epsg(), 4326)
            self.assertEqual(native.scales, (.1,))
            self.assertAlmostEqual(native.transform.a, 1 / 4000)
            raw = native.read()[0]
            valid = np.isfinite(raw)
            if native.nodata is not None:
                valid &= raw != native.nodata
            source_height = raw[valid] * native.scales[0] + native.offsets[0]
            native_min, native_max = float(source_height.min()), float(source_height.max())
            self.assertTrue(2200 < native_min < native_max < 2300)
        self.assertEqual(self.raster["verticalExaggeration"], 1)
        self.assertIn("EGM2008", self.config["verticalDatum"])
        for profile in self.profiles:
            positions, heights = np.asarray(profile["distanceMeters"]), np.asarray(profile["elevationMeters"])
            self.assertEqual(len(positions), len(heights))
            self.assertTrue(np.all(np.diff(positions) > 0))
            self.assertTrue(np.all(np.isfinite(heights)))
            self.assertGreaterEqual(float(heights.min()), native_min)
            self.assertLessEqual(float(heights.max()), native_max)
        self.assertAlmostEqual(self.profiles[0]["elevationMeters"][0], self.profiles[0]["elevationMeters"][-1])
        self.assertAlmostEqual(self.profiles[0]["distanceMeters"][-1], self.progress[-1])
        self.assertAlmostEqual(self.profiles[1]["distanceMeters"][-1], self.pit_progress[-1])
        dtm = self.raster["rasters"]["dtm"]
        values = np.fromfile(PREPARED / "mexico-dtm.f32le", dtype="<f4")
        self.assertEqual(values.size, dtm["width"] * dtm["height"])
        self.assertTrue(np.all(np.isfinite(values)))
        self.assertTrue(native_min <= float(values.min()) <= float(values.max()) <= native_max)

    def test_parallel_pit_height_shares_main_profile_and_limitation_is_disclosed(self):
        main, pit_profile = self.profiles
        checked = 0
        for progress, elevation in zip(pit_profile["distanceMeters"], pit_profile["elevationMeters"]):
            point = np.asarray([np.interp(progress, self.pit_progress, self.pit[:, axis]) for axis in (0, 1)])
            gap, main_progress = nearest_distance(self.line, self.progress, point)
            if gap <= 30:
                expected = float(np.interp(main_progress, main["distanceMeters"], main["elevationMeters"]))
                self.assertAlmostEqual(elevation, expected, delta=1e-7)
                checked += 1
        self.assertGreater(checked, 400)
        limitation = " ".join(self.config["limitations"])
        self.assertIn("within 30 m", limitation)
        self.assertIn("40 m", limitation)
        self.assertIn("independent crossfall", limitation)

    def test_road_filter_preserves_absolute_source_mean_and_periodic_seam(self):
        dtm = self.raster["rasters"]["dtm"]
        raw = np.fromfile(PREPARED / "mexico-source-dtm.f32le", dtype="<f4").reshape(dtm["height"], dtm["width"])
        positions = np.asarray(self.profiles[0]["distanceMeters"][:-1])
        points = np.column_stack([np.interp(positions, self.progress, self.line[:, axis]) for axis in (0, 1)])
        bounds = self.model["bounds"]
        x = (points[:, 0] - bounds["minX"]) / (bounds["maxX"] - bounds["minX"]) * (dtm["width"] - 1)
        y = (bounds["maxY"] - points[:, 1]) / (bounds["maxY"] - bounds["minY"]) * (dtm["height"] - 1)
        ix, iy = x.astype(int), y.astype(int)
        tx, ty = x - ix, y - iy
        measured = (raw[iy, ix] * (1 - tx) * (1 - ty) + raw[iy, ix + 1] * tx * (1 - ty)
                    + raw[iy + 1, ix] * (1 - tx) * ty + raw[iy + 1, ix + 1] * tx * ty)
        filtered = np.asarray(self.profiles[0]["elevationMeters"][:-1])
        self.assertAlmostEqual(float(filtered.mean()), float(measured.mean()), delta=.0001)
        self.assertEqual(self.profiles[0]["elevationMeters"][0], self.profiles[0]["elevationMeters"][-1])
        smoothing = self.raster["roadGrading"]["smoothing"]
        self.assertEqual(smoothing["method"], "normalized Gaussian")
        self.assertEqual(smoothing["sourceResolutionMeters"], 30)
        self.assertEqual(smoothing["sigmaNativeCells"], 3)
        self.assertEqual(smoothing["sigmaMeters"], 90)
        self.assertEqual(smoothing["heightScale"], 1)
        self.assertEqual(smoothing["closedBoundary"], "periodic")
        self.assertTrue(270 <= smoothing["supportRadiusMeters"] <= 271)
        # GEDTM cell noise must not become metre-scale, short road waves.
        frequencies = np.fft.rfftfreq(len(filtered), self.profiles[0]["stepMeters"])
        band = (frequencies >= 1 / 90) & (frequencies <= 1 / 20)
        source_noise = np.linalg.norm(np.fft.rfft(measured - measured.mean())[band])
        filtered_noise = np.linalg.norm(np.fft.rfft(filtered - filtered.mean())[band])
        self.assertGreater(source_noise, 1)
        self.assertLess(filtered_noise / source_noise, .01)

    def test_reconstructed_road_has_gentle_grades_without_clipping_heights(self):
        for profile in self.profiles:
            positions = np.asarray(profile["distanceMeters"])
            heights = np.asarray(profile["elevationMeters"])
            grades = np.diff(heights) / np.diff(positions)
            self.assertLess(float(np.max(np.abs(grades))), .02)
            # Judge visible road slopes over distances the source can support;
            # nearest-main projection in the pit can have harmless millimetre
            # kinks below both native confidence and delivery quantization.
            probes = np.linspace(0, positions[-1], 1001)
            grade10 = (np.interp(probes + 5, positions, heights)
                       - np.interp(probes - 5, positions, heights)) / 10
            grade60 = (np.interp(probes + 30, positions, heights)
                       - np.interp(probes - 30, positions, heights)) / 60
            self.assertLess(float(np.max(np.abs(grade10))), .02)
            self.assertLess(float(np.max(np.abs(np.diff(grade60) / np.diff(probes))) * 100), .05)
        main = self.profiles[0]
        heights = np.asarray(main["elevationMeters"])
        grades = np.diff(heights) / np.diff(main["distanceMeters"])
        self.assertLess(float(np.max(np.abs(np.diff(grades))) / main["stepMeters"] * 100), .025)
        nonlevel_grades = grades[np.abs(grades) > .000001]
        self.assertLessEqual(int(np.count_nonzero(np.diff(np.sign(np.append(nonlevel_grades, nonlevel_grades[0]))))), 20)
        self.assertLess(abs(float(grades[0] - grades[-1])), .00025)
        # Broad source terrain remains; this is not a constant-height circuit
        # or a forced fit to the historical F1 elevation-change statistic.
        self.assertTrue(.5 < float(np.ptp(heights)) < 3)
        limitation = " ".join(self.config["limitations"])
        self.assertIn("not a surveyed elevation profile", limitation)
        self.assertIn("without height scaling or grade clipping", limitation)

    def test_graded_corridor_clears_the_coarse_delivery_terrain(self):
        dtm = self.raster["rasters"]["dtm"]
        grid = np.fromfile(PREPARED / "mexico-dtm.f32le", dtype="<f4").reshape(dtm["height"], dtm["width"])
        bounds = self.model["bounds"]
        xs = np.linspace(bounds["minX"], bounds["maxX"], 201)
        ys = np.linspace(bounds["minY"], bounds["maxY"], 121)
        # Independently resample the prepared raster and use the delivery
        # terrain's actual triangle diagonal, rather than a bilinear floor.
        px = (xs - bounds["minX"]) / (bounds["maxX"] - bounds["minX"]) * (dtm["width"] - 1)
        py = (bounds["maxY"] - ys) / (bounds["maxY"] - bounds["minY"]) * (dtm["height"] - 1)
        ix, iy = np.minimum(px.astype(int), dtm["width"] - 2), np.minimum(py.astype(int), dtm["height"] - 2)
        tx, ty = px - ix, py - iy
        coarse = (grid[iy[:, None], ix] * (1 - tx) * (1 - ty[:, None])
                  + grid[iy[:, None], ix + 1] * tx * (1 - ty[:, None])
                  + grid[iy[:, None] + 1, ix] * (1 - tx) * ty[:, None]
                  + grid[iy[:, None] + 1, ix + 1] * tx * ty[:, None])
        for line, progress, profile, width, closed in (
            (self.line, self.progress, self.profiles[0], 12, True),
            (self.pit, self.pit_progress, self.profiles[1], 8, False),
        ):
            distances = np.linspace(0, progress[-1], math.ceil(progress[-1] / 2) + 1)
            points = np.column_stack([np.interp(distances, progress, line[:, axis]) for axis in (0, 1)])
            before = (distances - 3) % progress[-1] if closed else np.maximum(0, distances - 3)
            after = (distances + 3) % progress[-1] if closed else np.minimum(progress[-1], distances + 3)
            tangent = np.column_stack([np.interp(after, progress, line[:, axis])
                                       - np.interp(before, progress, line[:, axis]) for axis in (0, 1)])
            tangent /= np.linalg.norm(tangent, axis=1)[:, None]
            normal = np.column_stack((-tangent[:, 1], tangent[:, 0]))
            road = np.interp(distances, profile["distanceMeters"], profile["elevationMeters"]) + .45
            for lateral in (-width / 2, 0, width / 2):
                positions = points + normal * lateral
                fx = (positions[:, 0] - bounds["minX"]) / (bounds["maxX"] - bounds["minX"]) * 200
                fy = (positions[:, 1] - bounds["minY"]) / (bounds["maxY"] - bounds["minY"]) * 120
                x, y = fx.astype(int), fy.astype(int)
                u, v = fx - x, fy - y
                a, b, c, d = coarse[y, x], coarse[y, x + 1], coarse[y + 1, x + 1], coarse[y + 1, x]
                floor = np.where(v <= u, (1 - u) * a + (u - v) * b + v * c,
                                 (1 - v) * a + u * c + (v - u) * d)
                self.assertGreater(float(np.min(road - floor)), .3)
        self.assertEqual(self.raster["roadGrading"]["fullGradeHalfWidthMeters"], 16)
        self.assertEqual(self.raster["roadGrading"]["blendOuterHalfWidthMeters"], 32)

    def test_terrain_away_from_road_blend_keeps_native_elevations(self):
        dtm = self.raster["rasters"]["dtm"]
        shape = (dtm["height"], dtm["width"])
        raw = np.fromfile(PREPARED / "mexico-source-dtm.f32le", dtype="<f4").reshape(shape)
        graded = np.fromfile(PREPARED / "mexico-dtm.f32le", dtype="<f4").reshape(shape)
        bounds = self.model["bounds"]
        stadium = self.config["stadiumGrading"]
        origin = np.asarray(stadium["outlineMeters"][0])
        stadium_ring = (np.asarray(stadium["outlineMeters"]) - origin).astype(np.float32)
        checked = 0
        for row in range(0, dtm["height"], 11):
            for column in range(0, dtm["width"], 13):
                point = np.asarray([bounds["minX"] + column * 4, bounds["maxY"] - row * 4])
                main_gap = nearest_distance(self.line, self.progress, point)[0]
                pit_gap = nearest_distance(self.pit, self.pit_progress, point)[0]
                stadium_gap = cv2.pointPolygonTest(stadium_ring, tuple(point - origin), True)
                if min(main_gap, pit_gap) > 36 and stadium_gap < -stadium["blendOuterMeters"]:
                    self.assertEqual(graded[row, column], raw[row, column])
                    checked += 1
        self.assertGreater(checked, 200)

    def test_stadium_ground_and_road_share_a_level_platform(self):
        grading = self.config["stadiumGrading"]
        origin = np.asarray(grading["outlineMeters"][0])
        ring = (np.asarray(grading["outlineMeters"]) - origin).astype(np.float32)
        dtm = self.raster["rasters"]["dtm"]
        ground = np.fromfile(PREPARED / "mexico-dtm.f32le", dtype="<f4").reshape(dtm["height"], dtm["width"])
        expected = grading["elevationMeters"]
        ground_samples = []
        for row in range(dtm["height"]):
            for col in range(dtm["width"]):
                point = np.asarray([self.model["bounds"]["minX"] + col * 4,
                                    self.model["bounds"]["maxY"] - row * 4])
                if cv2.pointPolygonTest(ring, tuple(point - origin), True) > 2:
                    ground_samples.append(ground[row, col])
        self.assertGreater(len(ground_samples), 1000)
        np.testing.assert_allclose(ground_samples, expected, atol=.001, rtol=0)
        count = 0
        for distance, height in zip(self.profiles[0]["distanceMeters"], self.profiles[0]["elevationMeters"]):
            point = np.asarray([np.interp(distance, self.progress, self.line[:, axis]) for axis in (0, 1)])
            if cv2.pointPolygonTest(ring, tuple(point - origin), True) > 2:
                self.assertAlmostEqual(height, expected, delta=.0001)
                count += 1
        self.assertGreater(count, 100)
        self.assertAlmostEqual(grading["sourceProfileMeanMeters"], grading["resultProfileMeanMeters"], delta=.000001)


if __name__ == "__main__":
    unittest.main()
