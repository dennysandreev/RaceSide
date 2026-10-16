#!/usr/bin/env python3
"""Audit Marina Bay source geometry before any Blender or publication step.

Only measured/tagged source attributes are retained. Missing building heights,
roof geometry, facades and terrain are not replaced with invented defaults.
"""

import argparse
from collections import Counter, defaultdict
import hashlib
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / ".track-model-build/singapore-source"
PREPARED = ROOT / ".track-model-build/singapore-prepared"
BOUNDS = [103.848, 1.282, 103.869, 1.299]
OFFICIAL_LENGTH = 4927.0


def utm48(lon, lat):
    """WGS84 -> EPSG:32648; standard transverse Mercator series, metres."""
    major, flattening, scale = 6378137.0, 1 / 298.257223563, .9996
    e = flattening * (2 - flattening)
    ep = e / (1 - e)
    phi, delta = math.radians(lat), math.radians(lon - 105)
    sine, cosine, tangent = math.sin(phi), math.cos(phi), math.tan(phi)
    n = major / math.sqrt(1 - e * sine * sine)
    t, c, a = tangent * tangent, ep * cosine * cosine, cosine * delta
    m = major * ((1-e/4-3*e**2/64-5*e**3/256)*phi
                 -(3*e/8+3*e**2/32+45*e**3/1024)*math.sin(2*phi)
                 +(15*e**2/256+45*e**3/1024)*math.sin(4*phi)
                 -35*e**3/3072*math.sin(6*phi))
    return [500000+scale*n*(a+(1-t+c)*a**3/6+(5-18*t+t*t+72*c-58*ep)*a**5/120),
            scale*(m+n*tangent*(a*a/2+(5-t+9*c+4*c*c)*a**4/24
                               +(61-58*t+t*t+600*c-330*ep)*a**6/720))]


def number(value):
    try:
        result = float(str(value).removesuffix("m").strip())
        return result if math.isfinite(result) else None
    except (ValueError, TypeError):
        return None


def tags(element):
    return {item.get("k"): item.get("v") for item in element.findall("tag")}


def join_ring(segments):
    """Join the undirected circuit graph; preserve the first segment's direction."""
    if not segments:
        raise ValueError("Circuit has no segments")
    endpoints = defaultdict(list)
    for ident, points in segments:
        if len(points) < 2:
            raise ValueError(f"Empty circuit way {ident}")
        endpoints[points[0]].append(ident)
        endpoints[points[-1]].append(ident)
    invalid = {node: len(edges) for node, edges in endpoints.items() if len(edges) != 2}
    if invalid:
        raise ValueError(f"Circuit is branched or disconnected: {invalid}")
    remaining = dict(segments)
    first_id, first = segments[0]
    del remaining[first_id]
    ordered, order = list(first), [{"wayId": int(first_id), "reversed": False}]
    while remaining:
        candidates = [ident for ident in endpoints[ordered[-1]] if ident in remaining]
        if len(candidates) != 1:
            raise ValueError("Circuit consists of multiple disconnected rings")
        ident = candidates[0]
        line = remaining.pop(ident)
        reverse = line[-1] == ordered[-1]
        if reverse:
            line = list(reversed(line))
        if line[0] != ordered[-1]:
            raise ValueError(f"Disconnected circuit way {ident}")
        ordered.extend(line[1:])
        order.append({"wayId": int(ident), "reversed": reverse})
    if ordered[-1] != ordered[0]:
        raise ValueError("Circuit is not closed")
    return ordered, order


def length(line):
    return sum(math.dist(a, b) for a, b in zip(line, line[1:]))


def nearest(line, point):
    best = (math.inf, 0, 0.0, None)
    for index, (a, b) in enumerate(zip(line, line[1:])):
        dx, dy = b[0]-a[0], b[1]-a[1]
        blend = max(0, min(1, ((point[0]-a[0])*dx+(point[1]-a[1])*dy)/max(dx*dx+dy*dy, 1e-12)))
        projected = [a[0]+blend*dx, a[1]+blend*dy]
        gap = math.dist(point, projected)
        if gap < best[0]:
            best = (gap, index, blend, projected)
    return best


def rotate_to_control_line(line, point):
    gap, index, _, projected = nearest(line, point)
    rotated = [projected, *line[index+1:-1], *line[:index+1], projected]
    clean = [rotated[0]]
    for item in rotated[1:]:
        if math.dist(item, clean[-1]) > 1e-8:
            clean.append(item)
    return clean, gap


def prepare(source=SOURCE, output=PREPARED):
    manifest = json.loads((ROOT / "docs/track-model-singapore-source-manifest.json").read_text())
    for entry in manifest["sources"]:
        data = (source / entry["file"]).read_bytes()
        if len(data) != entry["bytes"] or hashlib.sha256(data).hexdigest() != entry["sha256"]:
            raise ValueError(f"Singapore source checksum mismatch: {entry['file']}")
    osm = ET.parse(source / "osm.xml").getroot()
    nodes = {item.get("id"): utm48(float(item.get("lon")), float(item.get("lat")))
             for item in osm.findall("node")}
    ways = {item.get("id"): item for item in osm.findall("way")}
    circuit = next(item for item in osm.findall("relation") if item.get("id") == "421263")
    segments, pit_segments, control = [], [], {}
    for member in circuit.findall("member"):
        ident, role = member.get("ref"), member.get("role")
        if member.get("type") == "node":
            control[role] = {"osmNodeId": int(ident), "position": nodes[ident]}
            continue
        if member.get("type") != "way":
            raise ValueError(f"Unsupported circuit member {member.attrib}")
        line = [node.get("ref") for node in ways[ident].findall("nd")]
        if role == "pitlane":
            pit_segments.append({"wayId": int(ident), "points": [nodes[node] for node in line]})
        else:
            segments.append((ident, line))
    first_role = next(item.get("role") for item in circuit.findall("member") if item.get("ref") == segments[0][0])
    if first_role == "backward":
        segments[0] = (segments[0][0], list(reversed(segments[0][1])))
    ring, order = join_ring(segments)
    order[0]["reversed"] = first_role == "backward"
    line, control_gap = rotate_to_control_line([nodes[node] for node in ring], control["finish"]["position"])
    measured_length = length(line)
    buildings = []
    southwest, northeast = utm48(*BOUNDS[:2]), utm48(*BOUNDS[2:])
    for ident, way in ways.items():
        attributes = tags(way)
        if not any(key in attributes for key in ("building", "building:part")):
            continue
        ring = [nodes[node.get("ref")] for node in way.findall("nd")]
        if not ring:
            continue
        center = [sum(point[axis] for point in ring)/len(ring) for axis in (0, 1)]
        if not all(southwest[axis] <= center[axis] <= northeast[axis] for axis in (0, 1)):
            continue
        height = number(attributes.get("height"))
        buildings.append({
            "osmWayId": int(ident), "name": attributes.get("name"), "tags": attributes,
            "footprint": ring, "closed": ring[0] == ring[-1],
            "heightMeters": height,
            "positiveHeightKnown": height is not None and height > 0,
            "roofShapeKnown": bool(attributes.get("roof:shape")),
            "facadeSurveyAvailable": False,
        })
    relation_buildings = [{"osmRelationId": int(item.get("id")), "tags": tags(item),
                           "members": [member.attrib for member in item.findall("member")]}
                          for item in osm.findall("relation") if "building" in tags(item)]
    result = {
        "schemaVersion": 1, "modelId": "singapore", "status": "source-audit-only",
        "coordinateReferenceSystem": "EPSG:32648", "bboxWgs84": BOUNDS,
        "verticalDatum": None, "verticalExaggeration": 1,
        "centerline": line, "sourceWayOrder": order, "pitLaneSegments": pit_segments,
        "controlPoints": control, "buildings": buildings, "buildingRelations": relation_buildings,
        "sourceManifest": manifest,
    }
    audit = {
        "modelId": "singapore", "publicationReady": False,
        "coordinateReferenceSystem": "EPSG:32648", "bboxWgs84": BOUNDS,
        "centerline": {"relationId": 421263, "wayCount": len(order), "pointCount": len(line),
                       "closed": line[0] == line[-1], "geometryMeters": measured_length,
                       "officialFiaMeters": OFFICIAL_LENGTH,
                       "relativeErrorPercent": abs(measured_length-OFFICIAL_LENGTH)/OFFICIAL_LENGTH*100,
                       "controlLineProjectionGapMeters": control_gap,
                       "lengthWithinHalfPercent": abs(measured_length-OFFICIAL_LENGTH)/OFFICIAL_LENGTH <= .005},
        "pitLane": [{"wayId": item["wayId"], "lengthMeters": length(item["points"]),
                     "endpointGapsMeters": [nearest(line, item["points"][i])[0] for i in (0, -1)]}
                    for item in pit_segments],
        "buildingCoverage": {"wayFootprintsAndParts": len(buildings),
                             "buildingRelations": len(relation_buildings),
                             "withPositiveHeight": sum(item["positiveHeightKnown"] for item in buildings),
                             "withRoofShape": sum(item["roofShapeKnown"] for item in buildings),
                             "roofShapes": dict(Counter(item["tags"].get("roof:shape", "unrecorded") for item in buildings)),
                             "withSurveyedFacades": 0},
        "blockers": [
            "No acquired textured or surveyed 3D buildings: exact windows and facades cannot be certified.",
            "No acquired bare-earth DTM or verified vertical datum.",
            "FIA 2025 timing controls are provisional for 2026; current-event operational map not acquired.",
            "Promoter event map is illustrative, not a survey of temporary structures.",
            "No Blender asset or browser acceptance has been completed.",
        ],
    }
    if not audit["centerline"]["lengthWithinHalfPercent"]:
        audit["blockers"].insert(0, "OSM centreline exceeds the 0.5% lap-length tolerance; do not rescale the city to conceal this.")
    output.mkdir(parents=True, exist_ok=True)
    (output / "singapore-source-geometry.json").write_text(json.dumps(result, ensure_ascii=False) + "\n")
    (output / "singapore-source-audit.json").write_text(json.dumps(audit, indent=2) + "\n")
    print(json.dumps(audit, indent=2))
    return audit


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=SOURCE)
    parser.add_argument("--output", type=Path, default=PREPARED)
    args = parser.parse_args()
    prepare(args.source, args.output)
