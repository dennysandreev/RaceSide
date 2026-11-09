#!/usr/bin/env python3
"""Build the current, real-scale Autodromo Nazionale Monza web scene."""

from __future__ import annotations

import importlib.util
import json
import math
from pathlib import Path

import bpy


SCRIPT_DIRECTORY = Path(__file__).resolve().parent
HUNGARORING_PATH = SCRIPT_DIRECTORY / "build-hungaroring-digital-twin.py"
SPEC = importlib.util.spec_from_file_location("track_hungaroring_digital_twin", HUNGARORING_PATH)
hung = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(hung)
spa = hung.spa
base = hung.base
VENUE_SPEC = importlib.util.spec_from_file_location("monza_venue", SCRIPT_DIRECTORY / "monza-venue.py")
venue_module = importlib.util.module_from_spec(VENUE_SPEC)
VENUE_SPEC.loader.exec_module(venue_module)

SECTOR_COLORS = ((0.86, 0.02, 0.01, 1), (0.98, 0.48, 0.03, 1), (0.02, 0.60, 0.78, 1))


def utm32n_from_wgs84(lat, lon):
    semi_major = 6_378_137.0
    flattening = 1 / 298.257223563
    scale = 0.9996
    eccentricity_squared = flattening * (2 - flattening)
    secondary_eccentricity_squared = eccentricity_squared / (1 - eccentricity_squared)
    latitude = math.radians(lat)
    longitude_delta = math.radians(lon - 9)
    sine = math.sin(latitude)
    cosine = math.cos(latitude)
    tangent = math.tan(latitude)
    radius = semi_major / math.sqrt(1 - eccentricity_squared * sine**2)
    t = tangent**2
    c = secondary_eccentricity_squared * cosine**2
    a = cosine * longitude_delta
    meridional_arc = semi_major * (
        (1 - eccentricity_squared / 4 - 3 * eccentricity_squared**2 / 64 - 5 * eccentricity_squared**3 / 256) * latitude
        - (3 * eccentricity_squared / 8 + 3 * eccentricity_squared**2 / 32 + 45 * eccentricity_squared**3 / 1024) * math.sin(2 * latitude)
        + (15 * eccentricity_squared**2 / 256 + 45 * eccentricity_squared**3 / 1024) * math.sin(4 * latitude)
        - 35 * eccentricity_squared**3 / 3072 * math.sin(6 * latitude)
    )
    return (
        500_000 + scale * radius * (
            a + (1 - t + c) * a**3 / 6
            + (5 - 18 * t + t**2 + 72 * c - 58 * secondary_eccentricity_squared) * a**5 / 120
        ),
        scale * (
            meridional_arc + radius * tangent * (
                a**2 / 2 + (5 - t + 9 * c + 4 * c**2) * a**4 / 24
                + (61 - 58 * t + t**2 + 600 * c - 330 * secondary_eccentricity_squared) * a**6 / 720
            )
        ),
    )


base.rd_from_wgs84 = utm32n_from_wgs84
spa.lambert_2008_from_wgs84 = utm32n_from_wgs84
hung.utm34n_from_wgs84 = utm32n_from_wgs84
spa.REPLACED_OSM_BUILDING_IDS = venue_module.LANDMARK_IDS
spa.REPLACED_OSM_GRANDSTAND_IDS = set()
base.TERRAIN_COLUMNS = 140
base.TERRAIN_ROWS = 120
base.TRACK_SURFACE_Z_OFFSET = 0.70
base.PIT_LANE_WIDTH_METERS = 12.0
base.PIT_LANE_TAPER_METERS = 34.0
base.GRANDSTAND_MAX_PLATFORM_STEP_METERS = 1.5
base.TURN_CURB_HALF_SPAN = (48, 44, 70, 46, 44, 54, 56, 58, 46, 50, 76)
base.bank_angle = lambda _distance, _total: (0.0, 0.0)
hung.GRAVEL_TURNS = {1, 2, 4, 5, 6, 7, 8, 9, 10, 11}
hung.RUNOFF_SIDES = {1: -1, 2: 1, 3: 1, 4: -1, 5: 1, 6: -1, 7: 1, 8: -1, 9: 1, 10: -1, 11: 1}
hung.PIT_ENTRY_RUNOFF_TURNS = {11}


def load_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def smooth_closed_line(points):
    core = points[:-1] if math.hypot(points[0][0] - points[-1][0], points[0][1] - points[-1][1]) < 0.05 else points
    smoothed = []
    for index, point in enumerate(core):
        previous = core[(index - 1) % len(core)]
        following = core[(index + 1) % len(core)]
        smoothed.append(((previous[0] + point[0] * 2 + following[0]) / 4, (previous[1] + point[1] * 2 + following[1]) / 4))
    return [*smoothed, smoothed[0]]


def keep_near_circuit(osm_data, reference_lines, maximum_distance):
    reference_points = [point for line in reference_lines for point in line]
    retained = []
    for feature in osm_data["elements"]:
        geometry = feature.get("geometry") or ([feature] if "lat" in feature and "lon" in feature else [])
        if any(
            min(math.dist(utm32n_from_wgs84(point["lat"], point["lon"]), reference) for reference in reference_points)
            <= maximum_distance
            for point in geometry[::max(1, len(geometry) // 8)]
        ):
            retained.append(feature)
    return {**osm_data, "elements": retained}


def create_road_edge_paint(samples, center, material, collection, pit):
    # Use exactly the road's tessellation. Independent 4 m paint sampling
    # previously cut across the 3 m asphalt triangles at tight chicanes.
    builder = base.MeshBuilder()
    for a, b in zip(samples, samples[1:]):
        for side in [-1, 1]:
            def edge_at(t):
                x=a[1]*(1-t)+b[1]*t
                y=a[2]*(1-t)+b[2]*t
                normal=a[5]*(1-t)+b[5]*t
                return (x+normal.x*side*(a[7]/2-.27),y+normal.y*side*(a[7]/2-.27))
            interval=venue_module.visible_interval(0,1,lambda t:base.distance_to_polyline(edge_at(t),pit)-2.6)
            if interval is None:
                continue
            vertices = []
            first,last=interval
            for blend,inset in [(first,.36),(last,.36),(last,.18),(first,.18)]:
                _, x, y, height, _, normal, _, width = a
                x=x*(1-blend)+b[1]*blend
                y=y*(1-blend)+b[2]*blend
                height=height*(1-blend)+b[3]*blend
                normal=normal*(1-blend)+b[5]*blend
                lateral = side*(width/2-inset)
                vertices.append((x+normal.x*lateral-center["x"],
                                 y+normal.y*lateral-center["y"],height+.05))
            builder.add_quad(vertices)
    return builder.create_object("Track_Edge_Lines",[material],collection)


def assemble_way_geometry(osm_data, way_ids):
    ways = {element.get("id"): element for element in osm_data["elements"] if element.get("type") == "way"}
    geometry = []
    for way_id in way_ids:
        candidate = list(ways[way_id]["geometry"])
        if geometry:
            previous = utm32n_from_wgs84(geometry[-1]["lat"], geometry[-1]["lon"])
            first = utm32n_from_wgs84(candidate[0]["lat"], candidate[0]["lon"])
            last = utm32n_from_wgs84(candidate[-1]["lat"], candidate[-1]["lon"])
            if math.dist(previous, last) < math.dist(previous, first):
                candidate.reverse()
            if math.dist(previous, utm32n_from_wgs84(candidate[0]["lat"], candidate[0]["lon"])) < 0.5:
                candidate = candidate[1:]
        geometry.extend(candidate)
    return geometry


def assemble_current_circuit(osm_data, main_way_ids, final_sector_way_ids):
    main = base.assemble_main_circuit(osm_data, main_way_ids)
    main_core = main[:-1] if math.dist(main[0], main[-1]) < 0.05 else main
    bypass = [utm32n_from_wgs84(point["lat"], point["lon"]) for point in assemble_way_geometry(osm_data, final_sector_way_ids)]

    def nearest_index(points, target):
        return min(range(len(points)), key=lambda index: math.dist(points[index], target))

    start_index = nearest_index(main_core, bypass[0])
    end_index = nearest_index(main_core, bypass[-1])
    if end_index >= start_index:
        bypass.reverse()
        start_index = nearest_index(main_core, bypass[0])
        end_index = nearest_index(main_core, bypass[-1])
    if end_index >= start_index:
        raise ValueError("Monza current final-sector bypass does not cross the main OSM way boundary")
    if math.dist(main_core[start_index], bypass[0]) > 0.5 or math.dist(main_core[end_index], bypass[-1]) > 0.5:
        raise ValueError("Monza current final-sector bypass is disconnected from the main circuit")
    return [*main_core[end_index:start_index + 1], *bypass[1:]]


def assemble_pit_way(osm_data, way_ids):
    geometry = assemble_way_geometry(osm_data, way_ids)
    synthetic_id = -2_026_070_1
    return {
        **osm_data,
        "elements": [*osm_data["elements"], {
            "geometry": geometry,
            "id": synthetic_id,
            "tags": {"highway": "raceway", "service": "pit_lane", "source": "assembled current OSM pit entry, lane and exit"},
            "type": "way",
        }],
    }, synthetic_id


def configure_scene(center, base_elevation):
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "METERS"
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1_280
    scene.render.resolution_y = 960
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "WEBP"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("Monza_World")
    scene.world.color = (0.025, 0.035, 0.045)
    scene["coordinate_reference_system"] = "EPSG:32632"
    scene["origin_utm32n_x"] = center["x"]
    scene["origin_utm32n_y"] = center["y"]
    scene["origin_terrarium_z"] = base_elevation
    scene["real_world_scale"] = "1 Blender unit = 1 metre"


def render_preview(preview_path, collection, bounds, center, review_directory):
    scene = bpy.context.scene
    camera_data = bpy.data.cameras.new("MonzaPreviewCamera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 3_450
    camera_data.clip_end = 10_000
    camera = bpy.data.objects.new("MonzaPreviewCamera", camera_data)
    camera.location = (1_500, -2_050, 2_500)
    base.look_at(camera, (100, 310, 22))
    collection.objects.link(camera)
    scene.camera = camera
    scene.render.filepath = str(preview_path)
    bpy.ops.render.render(write_still=True)
    review_directory.mkdir(parents=True, exist_ok=True)
    for name, lat, lon, scale, offset in [
        ("pit-complex", 45.6178, 9.2815, 620, (360, -420, 340)),
        ("prima-variante", 45.6244, 9.2820, 700, (400, -450, 430)),
        ("historic-banking", 45.6241, 9.2860, 700, (450, -350, 330)),
        ("pit-entry", 45.6152, 9.2808, 180, (100, -110, 95)),
        ("pit-garages", 45.6171, 9.2812, 210, (-100, -125, 100)),
        ("pit-exit", 45.6198, 9.2814, 230, (100, 120, 90)),
        ("serraglio-underpass", 45.624796, 9.28922, 150, (80, 100, 45)),
        ("flat-north-approach", 45.6230, 9.2820, 360, (-160, -180, 130)),
        ("banking-concrete", 45.62565, 9.2848, 100, (50, -60, 35)),
        ("banking-south", 45.6104, 9.2863, 110, (-30, 65, 28)),
        ("banking-frames", 45.62565, 9.2848, 70, (20, 60, 14)),
    ]:
        x, y = utm32n_from_wgs84(lat, lon)
        target = (x - center["x"], y - center["y"], 22)
        camera.location = tuple(target[i] + offset[i] for i in range(3))
        camera_data.ortho_scale = scale
        base.look_at(camera, target)
        scene.render.filepath = str(review_directory / f"{name}.webp")
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(camera, do_unlink=True)
    bpy.data.cameras.remove(camera_data)


def main():
    args = base.parse_args()
    input_path = Path(args.input).resolve()
    prepared_directory = Path(args.prepared).resolve()
    glb_path = Path(args.glb).resolve()
    preview_path = Path(args.preview).resolve()
    metadata_path = Path(args.metadata).resolve()
    config = load_json(input_path)
    source_directory = Path(config["sourceDirectory"])
    bounds = config["model"]["bounds"]
    center = config["model"]["center"]
    raster_metadata = load_json(prepared_directory / "raster-metadata.json")
    dtm = base.HeightRaster(prepared_directory / "monza-dtm.f32le", raster_metadata["rasters"]["dtm"], bounds)
    dsm = base.HeightRaster(prepared_directory / "monza-dsm.f32le", raster_metadata["rasters"]["dsm"], bounds)
    base_elevation = float(raster_metadata["rasters"]["dtm"]["minimum"])

    bpy.ops.wm.read_factory_settings(use_empty=True)
    collections = base.create_collections()
    configure_scene(center, base_elevation)
    materials = {
        "terrain": base.create_aerial_material(prepared_directory / "monza-orthophoto-2012.jpg"),
        "asphalt": base.create_material("Monza_Real_Asphalt", (0.072, 0.078, 0.083, 1), 0.95),
        "white": base.create_material("Monza_Track_White", (0.94, 0.93, 0.90, 1), 0.82),
        "curb_red": base.create_material("Monza_Curb_Red", (0.71, 0.018, 0.012, 1), 0.84),
        "building": base.create_material("Monza_Current_OSM_PCN_DSM_Buildings", (1, 1, 1, 1), 0.84, use_vertex_color=True),
        "motorhome": base.create_material("Monza_2026_Race_Motorhomes", (1, 1, 1, 1), 0.64, metallic=0.10, use_vertex_color=True),
        "pit_wall": base.create_material("Monza_Pit_Wall_Concrete", (1, 1, 1, 1), 0.92, use_vertex_color=True),
        "fence": base.create_material("Monza_Safety_Fence", (0.40, 0.43, 0.44, 0.64), 0.72, metallic=0.34),
        "tree_trunk": base.create_material("Monza_Tree_Trunks", (0.18, 0.105, 0.055, 1), 1.0),
        "tree_crown": base.create_material("Monza_Tree_Canopies", (1, 1, 1, 1), 1.0, use_vertex_color=True),
        "stand_frame": base.create_material("Monza_Grandstand_Frame", (0.19, 0.21, 0.22, 1), 0.58, metallic=0.55),
        "seat_dark": base.create_material("Monza_Grandstand_Seats_Dark", (0.05, 0.06, 0.07, 1), 0.88),
        "seat_red": base.create_material("Monza_Grandstand_Seats_Red", (0.67, 0.02, 0.018, 1), 0.88),
        "structure": base.create_material("Monza_Circuit_Structures", (0.36, 0.38, 0.38, 1), 0.78, metallic=0.12),
        "gantry_light": base.create_material("Monza_Gantry_Lights", (0.88, 0.05, 0.02, 1), 0.34),
        "gravel": base.create_material("Monza_Real_Gravel_Runoff", (0.54, 0.43, 0.29, 1), 1.0),
        "runoff": base.create_material("Monza_Asphalt_Runoff", (0.16, 0.17, 0.18, 1), 0.98),
        "black": base.create_material("Monza_Control_Line_Black", (0.015, 0.015, 0.015, 1), 0.86),
        "concrete": base.create_material("Monza_Weathered_Banking_Concrete", (1,1,1,1), .98),
        "aged_structure": base.create_material("Monza_Weathered_Bridge_Concrete", (1,1,1,1), .98),
    }
    materials["terrain"].name = "Terrain_PCN_Orthophoto_2012"
    sector_materials = [base.create_material(f"Sector_{index + 1}", color, 0.68) for index, color in enumerate(SECTOR_COLORS)]
    sector_glow_materials = [base.create_material(f"Sector_{index + 1}_Glow", (color[0], color[1], color[2], 0.34), 0.48, emission_strength=1.4) for index, color in enumerate(SECTOR_COLORS)]

    terrain = base.add_terrain(bounds, center, dtm, base_elevation, materials["terrain"], collections["Terrain"])
    terrain.name = "PCN_Monza_DTM_Terrain_RealScale"
    terrain.data.name = "PCN_Monza_DTM_Terrain_RealScale_Mesh"
    terrain["source"] = "Terrarium terrain and PCN 2012 orthophoto; no vertical exaggeration"
    osm_data = load_json(source_directory / "openstreetmap-raceway.json")
    source_centerline = smooth_closed_line(base.assemble_main_circuit(osm_data, config["model"]["mainCircuitWayIds"]))
    centerline = spa.rotate_closed_polyline(source_centerline, config["model"]["sourceStartFinishOffsetMeters"])
    cumulative, total_length = base.line_distance(centerline)
    surface_raster = hung.WholeLapSurfaceRaster(dtm, centerline, cumulative, config["model"]["trackWidthMeters"])
    track, cumulative, total_length, track_samples = base.create_ribbon(
        "FIA_Monza_Centreline_12m", centerline, surface_raster, center, base_elevation,
        config["model"]["trackWidthMeters"], materials["asphalt"], collections["Circuit"],
        z_offset=base.TRACK_SURFACE_Z_OFFSET, banked=False,
    )
    track["source"] = "Current OSM GP centreline, smoothed once and checked against the official 5.793 km Monza specification"
    curb_obj, curb_quality = hung.create_curbs(config, centerline, cumulative, surface_raster, center, base_elevation, [materials["curb_red"], materials["white"]], collections["Circuit"])
    curb_obj.name = "Monza_Real_Red_White_Curbs"
    curb_obj.data.name = "Monza_Real_Red_White_Curbs_Mesh"
    runoff_obj, runoff_sections, runoff_quality = hung.create_runoff(config, centerline, cumulative, surface_raster, center, base_elevation, [materials["gravel"], materials["runoff"]], collections["Circuit"])
    runoff_obj.name = "Monza_FIA_Runoff_And_Gravel"
    runoff_obj.data.name = "Monza_FIA_Runoff_And_Gravel_Mesh"
    runoff_obj["source"] = "Latest FIA operational map cross-checked against the PCN orthophoto"

    pit_way = next(e for e in osm_data["elements"] if e["id"] == config["model"]["pitLaneWayId"])
    pit_centerline = [utm32n_from_wgs84(p["lat"], p["lon"]) for p in pit_way["geometry"]]
    all_buildings = load_json(source_directory / "openstreetmap-buildings.json")
    venue = venue_module.Venue(base, utm32n_from_wgs84, dtm, center, base_elevation,
                               centerline, pit_centerline, all_buildings)
    venue.surface = surface_raster
    create_road_edge_paint(track_samples, center, materials["white"], collections["Circuit"], venue.pit)
    pit_quality = venue.pit_lane(surface_raster, materials, collections["Circuit"], collections["Infrastructure"])
    pit_quality["sourceWayIds"] = [config["model"]["pitLaneWayId"]]
    pit_complex_obj, pit_complex_quality = venue.architecture(materials["building"], collections["Grandstands"])
    pit_quality["pitComplex"] = pit_complex_quality

    exclusion_corridors = [
        (base.sample_line_points(centerline, cumulative, 4.0), config["model"]["trackWidthMeters"] / 2 + 1.5),
        (base.sample_line_points(pit_centerline, base.line_distance(pit_centerline)[0], 4.0, closed=False), base.PIT_LANE_WIDTH_METERS / 2 + 1.5),
    ]
    surface_quality = base.measure_ribbon_terrain_clearance(track_samples, dtm, base_elevation)
    osm_buildings = keep_near_circuit(
        load_json(source_directory / "openstreetmap-buildings.json"),
        [centerline, pit_centerline],
        450.0,
    )
    osm_buildings_without_stands = {
        **osm_buildings,
        "elements": [feature for feature in osm_buildings["elements"] if feature.get("tags", {}).get("leisure") != "bleachers"],
    }
    grandstand_obj, grandstand_sections, grandstand_quality = venue.grandstands(
        [materials["building"], materials["seat_red"]], collections["Grandstands"])
    reserved_stands = venue.exclusions
    building_obj, _, building_quality = spa.create_osm_buildings(
        osm_buildings_without_stands, dtm, dsm, bounds, center, base_elevation,
        materials["building"], collections["Buildings"], exclusion_corridors, reserved_stands,
    )
    building_obj.name = "Monza_Current_OSM_PCN_DSM_Buildings"
    building_obj.data.name = "Monza_Current_OSM_PCN_DSM_Buildings_Mesh"
    building_obj["source"] = "Current OSM footprints with terrain-aligned heights"
    building_quality["replacedOsmBuildingIds"] = sorted(spa.REPLACED_OSM_BUILDING_IDS)
    barrier_obj, fence_segments = venue.barriers(load_json(source_directory / "openstreetmap-barriers.json"),
                                               materials["building"], collections["Infrastructure"])
    oval_obj, historic_lines, oval_quality = venue.historic_oval(osm_data, materials, collections["Infrastructure"])
    (input_path.parent / "monza-review").mkdir(parents=True, exist_ok=True)
    (input_path.parent / "monza-review" / "oval-profile.json").write_text(json.dumps(oval_quality.pop("profile")))
    motorhome_obj, motorhome_count, motorhome_quality = venue.paddock(materials["motorhome"], collections["Infrastructure"])
    tree_obj, tree_count, forest_quality = venue.forest(prepared_directory, materials["tree_crown"],
                                                      collections["Infrastructure"], historic_lines)
    grandstand_quality["sourceMap"] = "Autodromo Nazionale Monza official 2026 Formula 1 event map"
    grandstand_quality["excludedCurrentEventStandIds"] = [
        exclusion["osmWayId"] for exclusion in config.get("grandstandExclusions", [])
    ]

    finish_distance, sector_distances, _, _ = base.create_track_annotations(
        config, osm_data, centerline, cumulative, total_length, surface_raster, center, base_elevation,
        [*sector_materials, materials["white"], materials["black"], *sector_glow_materials], collections["Annotations"],
    )
    base.create_start_gantry(finish_distance, centerline, cumulative, surface_raster, center, base_elevation, [materials["structure"], materials["gantry_light"]], collections["Infrastructure"])
    low, high = base.create_extrema_anchors(centerline, cumulative, total_length, surface_raster, center, base_elevation, collections["Annotations"])
    for name in ("LowPoint", "HighPoint"):
        anchor = bpy.data.objects.get(name)
        if anchor:
            anchor["elevation_terrarium_m"] = anchor["elevation_datum_m"]
    bounds_anchor = bpy.data.objects.new("SceneBounds", None)
    bounds_anchor["width_m"] = bounds["maxX"] - bounds["minX"]
    bounds_anchor["depth_m"] = bounds["maxY"] - bounds["minY"]
    bounds_anchor["minimum_elevation_terrarium_m"] = raster_metadata["rasters"]["dtm"]["minimum"]
    bounds_anchor["maximum_elevation_terrarium_m"] = raster_metadata["rasters"]["dtm"]["maximum"]
    collections["Annotations"].objects.link(bounds_anchor)

    base.add_lighting(collections["Terrain"])
    # Review the underside in daylight too; one-sided studio light concealed
    # the previous solid walls. This fill is for the offline preview only.
    fill_data=bpy.data.lights.new("Monza_Daylight_Fill","SUN")
    fill_data.energy=.65
    fill_data.use_shadow=False
    fill=bpy.data.objects.new("Monza_Daylight_Fill",fill_data)
    fill.rotation_euler=(math.radians(-32),math.radians(24),math.radians(145))
    collections["Terrain"].objects.link(fill)
    venue_module.texture_surfaces(prepared_directory, materials)
    repaired_meshes = sum(1 for mesh in bpy.data.meshes if mesh.validate(clean_customdata=False))
    glb_path.parent.mkdir(parents=True, exist_ok=True)
    preview_path.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    render_preview(preview_path, collections["Terrain"], bounds, center, input_path.parent / "monza-review")
    venue_module.export_precise_glb(base, glb_path)
    profile = []
    for index in range(180):
        distance = total_length * index / 179
        x, y = base.sample_polyline(centerline, cumulative, min(distance, total_length - 1e-6))
        profile.append({"distanceMeters": round(distance, 2), "elevationMeters": round(surface_raster.sample(x, y), 3)})
    metadata = {
        "boundsMeters": {"depth": bounds["maxY"] - bounds["minY"], "width": bounds["maxX"] - bounds["minX"]},
        "coordinateReferenceSystem": "EPSG:32632 + Terrarium DEM metres",
        "elevationProfile": profile,
        "drivingLine": [[round(s[1],5),round(s[2],5),round(s[3]+base_elevation,5)] for s in track_samples],
        "elevationsMeters": {"high": round(high[0], 3), "low": round(low[0], 3)},
        "finishDistanceMeters": round(finish_distance, 2),
        "generatedWith": f"Blender {bpy.app.version_string}",
        "lapLength": {
            "geometryMeters": round(total_length, 3),
            "officialFiaMeters": config["model"]["lapLengthMeters"],
            "relativeErrorPercent": round(abs(total_length - config["model"]["lapLengthMeters"]) / config["model"]["lapLengthMeters"] * 100, 4),
        },
        "layoutQuality": {
            "buildings": building_quality,
            "circuitConfiguration": {"direction": "clockwise", "officialLayout": "5.793 km / 11 turns"},
            "curbs": curb_quality,
            "grandstands": grandstand_quality,
            "historicOval": oval_quality,
            "forest": forest_quality,
            "motorhomes": motorhome_quality,
            "pitLane": pit_quality,
            "runoff": runoff_quality,
            "surfaceClearance": surface_quality,
            "surfaceSmoothing": {"wholeLap": surface_raster.quality},
            "terrainSurface": raster_metadata["terrainSurface"],
        },
        "objects": {
            "buildingsTotal": building_quality["renderedCurrentFootprints"],
            "fenceSegments": fence_segments,
            "grandstandSections": grandstand_sections,
            "reconstructedTrees": tree_count,
            "repairedMeshes": repaired_meshes,
            "pitGarageBoxes": pit_complex_quality["garageBoxes"],
            "raceMotorhomes": motorhome_count,
            "runoffSections": runoff_sections,
            "turnAnchors": 11,
        },
        "officialSources": config["officialSources"],
        "limitations": [
            "Building footprints are mapped; heights, facade divisions, roof structures and tower dimensions are photographic reconstructions, not measured CAD.",
            "The ground orthophoto dates from 2012. Individual forest trees and heights are inferred from wooded pixels, not a tree survey.",
            "Historic oval cross-section uses archived 1954 dimensions. Bridge grades, transition placement and open-frame dimensions remain reconstructed. Client driving paths are sampled from the delivered GP road.",
            "Temporary event structures and motorhome liveries do not claim an exact 2026 paddock layout.",
        ],
        "surfaceExport": {"meshoptPositionBits": 18},
        "realWorldScale": "1 unit = 1 metre; no vertical exaggeration",
        "schemaVersion": 1,
        "sectorBoundaryDistancesMeters": [round(value, 2) for value in sector_distances],
        "sourceManifest": config["sourceManifest"],
        "verticalDatum": "Terrarium DEM metres; no vertical exaggeration",
    }
    metadata_path.write_text(f"{json.dumps(metadata, indent=2)}\n", encoding="utf-8")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
