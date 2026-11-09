#!/usr/bin/env python3
"""Prepare the Monza PCN orthophoto and Terrarium elevation for Blender."""

from __future__ import annotations

import argparse
import json
import math
import random
import struct
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

GRID_WIDTH = 106
GRID_HEIGHT = 119


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args()


class TileSet:
    def __init__(self, source_directory, metadata):
        self.zoom = int(metadata["zoom"])
        self.tile_size = int(metadata["tileSize"])
        self.images = {
            (int(member["x"]), int(member["y"])): Image.open(source_directory / member["file"]).convert("RGB")
            for member in metadata["members"]
        }

    def sample(self, lon, lat):
        scale = 2**self.zoom * self.tile_size
        global_x = (lon + 180.0) / 360.0 * scale
        latitude = math.radians(lat)
        global_y = (1.0 - math.asinh(math.tan(latitude)) / math.pi) / 2.0 * scale
        tile_x, tile_y = math.floor(global_x / self.tile_size), math.floor(global_y / self.tile_size)
        image = self.images[(tile_x, tile_y)]
        local_x = min(max(int(global_x - tile_x * self.tile_size), 0), image.width - 1)
        local_y = min(max(int(global_y - tile_y * self.tile_size), 0), image.height - 1)
        return image.getpixel((local_x, local_y))


def wgs84_from_utm32n(easting, northing):
    semi_major = 6_378_137.0
    flattening = 1 / 298.257223563
    scale = 0.9996
    e2 = flattening * (2 - flattening)
    ep2 = e2 / (1 - e2)
    x, y = easting - 500_000.0, northing
    mu = y / scale / (semi_major * (1 - e2 / 4 - 3 * e2**2 / 64 - 5 * e2**3 / 256))
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    footprint = mu + (3 * e1 / 2 - 27 * e1**3 / 32) * math.sin(2 * mu) + (21 * e1**2 / 16 - 55 * e1**4 / 32) * math.sin(4 * mu) + (151 * e1**3 / 96) * math.sin(6 * mu) + (1097 * e1**4 / 512) * math.sin(8 * mu)
    sine, cosine, tangent = math.sin(footprint), math.cos(footprint), math.tan(footprint)
    c1, t1 = ep2 * cosine**2, tangent**2
    n1 = semi_major / math.sqrt(1 - e2 * sine**2)
    r1 = semi_major * (1 - e2) / (1 - e2 * sine**2) ** 1.5
    d = x / (n1 * scale)
    latitude = footprint - (n1 * tangent / r1) * (d**2 / 2 - (5 + 3 * t1 + 10 * c1 - 4 * c1**2 - 9 * ep2) * d**4 / 24 + (61 + 90 * t1 + 298 * c1 + 45 * t1**2 - 252 * ep2 - 3 * c1**2) * d**6 / 720)
    longitude = math.radians(9) + (d - (1 + 2 * t1 + c1) * d**3 / 6 + (5 - 2 * c1 + 28 * t1 - 3 * c1**2 + 8 * ep2 + 24 * t1**2) * d**5 / 120) / cosine
    return math.degrees(latitude), math.degrees(longitude)


def terrarium_elevation(rgb):
    red, green, blue = rgb
    return red * 256 + green + blue / 256 - 32_768


def write_grid(path, values):
    with path.open("wb") as handle:
        for value in values:
            handle.write(struct.pack("<f", value))


def prepare_banking_concrete(directory):
    """12 x 24 m of aged concrete, generated at its physical surface scale.

    Expansion joints, aggregate, repairs and thin cracks are material detail,
    not extra coplanar geometry. The repeat is seamless along the oval.
    """
    rng = random.Random(1955)
    width, height = 512, 1024
    cloud = Image.new("L", (32,64))
    cloud.putdata([rng.randrange(80,180) for _ in range(32*64)])
    cloud = cloud.resize((width,height),Image.Resampling.BICUBIC).filter(ImageFilter.GaussianBlur(9))
    texture = Image.new("RGB",(width,height))
    pixels=[]
    for y in range(height):
        for x in range(width):
            weather=(cloud.getpixel((x,y))-128)*.26
            grain=rng.gauss(0,4.1)
            # Darker damp toe and intermittent moss at the inner apron.
            damp=max(0,1-x/48)*(12+max(0,weather)*2)
            shade=weather+grain-damp
            pixels.append(tuple(round(max(0,min(255,c+shade))) for c in (153,151,138)))
    texture.putdata(pixels)
    draw=ImageDraw.Draw(texture)
    relief=Image.new('L',(width,height),128)
    grooves=ImageDraw.Draw(relief)
    for x in [171,341]:
        draw.line([(x,0),(x,height)],fill=(111,111,101),width=1)
        grooves.line([(x,0),(x,height)],fill=78,width=2)
    for y in range(0,height,171):
        draw.line([(0,y),(width,y)],fill=(103,105,95),width=2)
        draw.line([(0,y+2),(width,y+2)],fill=(177,175,160),width=1)
        grooves.line([(0,y),(width,y)],fill=64,width=2)
    for _ in range(24):
        x,y=rng.randrange(width),rng.randrange(height)
        path=[(x,y)]
        for _ in range(rng.randrange(3,9)):
            x+=rng.randrange(-12,13);y+=rng.randrange(5,19);path.append((x,y))
        draw.line(path,fill=(103,106,97),width=1)
        grooves.line(path,fill=85,width=1)
    # Worn historical guide line, broken by surface erosion rather than a
    # new bright strip pasted on top of the bank.
    for y in range(height):
        if rng.random()>.22:
            tone=rng.randrange(160,191)
            draw.line([(153,y),(156,y)],fill=(tone,tone-3,tone-22),width=1)
    texture.save(directory/'monza-concrete.jpg',quality=87,optimize=True)
    normal=Image.new('RGB',(width,height)); values=[]
    for y in range(height):
        for x in range(width):
            dx=(relief.getpixel(((x-1)%width,y))-relief.getpixel(((x+1)%width,y)))*.55
            dy=(relief.getpixel((x,(y-1)%height))-relief.getpixel((x,(y+1)%height)))*.55
            length=math.sqrt(dx*dx+dy*dy+128*128)
            values.append((round(128+127*dx/length),round(128+127*dy/length),round(128+127*128/length)))
    normal.putdata(values)
    normal.save(directory/'monza-concrete-normal.jpg',quality=88,optimize=True)
    # A separate wall material: no road guide line or slab grid on the piers.
    wall=Image.new('RGB',(256,256)); weather=[]
    streaks=[rng.uniform(-22,12) for _ in range(32)]
    for y in range(256):
        for x in range(256):
            stripe=streaks[x//8]*(.6+.4*math.sin(y/256*math.tau))
            patch=18*math.sin(x*.027+y*.043)*math.sin(y*.016)
            tone=round(177+stripe+patch+rng.gauss(0,3))
            weather.append((tone,tone-2,tone-10))
    wall.putdata(weather)
    wall=wall.filter(ImageFilter.GaussianBlur(.65))
    wall.save(directory/'monza-aged_structure.jpg',quality=84,optimize=True)


def main():
    args = parse_args()
    source_directory = Path(args.source).resolve()
    output_directory = Path(args.output).resolve()
    output_directory.mkdir(parents=True, exist_ok=True)
    source_manifest = json.loads((source_directory / "source-manifest.json").read_text(encoding="utf-8"))
    tile_manifest = json.loads((source_directory / "terrain-tile-manifest.json").read_text(encoding="utf-8"))
    bounds = source_manifest["bounds"]
    tiles = TileSet(source_directory, tile_manifest["elevation"])
    values = []
    for row in range(GRID_HEIGHT):
        y = bounds["maxY"] - (bounds["maxY"] - bounds["minY"]) * row / (GRID_HEIGHT - 1)
        for column in range(GRID_WIDTH):
            x = bounds["minX"] + (bounds["maxX"] - bounds["minX"]) * column / (GRID_WIDTH - 1)
            lat, lon = wgs84_from_utm32n(x, y)
            values.append(terrarium_elevation(tiles.sample(lon, lat)))
    write_grid(output_directory / "monza-dtm.f32le", values)
    write_grid(output_directory / "monza-dsm.f32le", values)

    orthophoto = Image.new("RGB", (4096, 4096))
    for quadrant, offset in [("nw", (0, 0)), ("ne", (2048, 0)), ("sw", (0, 2048)), ("se", (2048, 2048))]:
        tile = Image.open(source_directory / f"pcn-2012-{quadrant}.jpg").convert("RGB")
        if tile.size != (2048, 2048):
            raise ValueError(f"Unexpected Monza orthophoto tile size: {quadrant}: {tile.size}")
        orthophoto.paste(tile, offset)
    orthophoto = ImageEnhance.Contrast(orthophoto).enhance(1.025)
    orthophoto = ImageEnhance.Color(orthophoto).enhance(0.93)
    orthophoto = orthophoto.filter(ImageFilter.UnsharpMask(radius=0.9, percent=35, threshold=3))
    # Keep full ground detail around the venue; distant neighbourhoods use a
    # lower-frequency version of the same imagery, with a soft transition.
    mask = Image.new("L", orthophoto.size)
    def pixel(x, y):
        return ((x-bounds["minX"])/(bounds["maxX"]-bounds["minX"])*4096,
                (bounds["maxY"]-y)/(bounds["maxY"]-bounds["minY"])*4096)
    ImageDraw.Draw(mask).rectangle([pixel(521500, 5053300), pixel(523500, 5050500)], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(60))
    context = orthophoto.resize((1024, 1024), Image.Resampling.LANCZOS).resize(orthophoto.size, Image.Resampling.BILINEAR)
    orthophoto = Image.composite(orthophoto, context, mask)
    orthophoto.save(output_directory / "monza-orthophoto-2012.jpg", format="JPEG", quality=68, optimize=True, progressive=True)
    # Small repeatable physical surface maps. No external texture dependency.
    rng = random.Random(20261021)
    for name, color, grain in [("asphalt", (72, 75, 76), 7), ("gravel", (183, 177, 160), 18)]:
        texture = Image.new("RGB", (256, 256))
        pixels = []
        for _ in range(256 * 256):
            noise = rng.uniform(-grain, grain)
            pixels.append(tuple(max(0, min(255, round(c + noise))) for c in color))
        texture.putdata(pixels)
        texture.save(output_directory / f"monza-{name}.jpg", quality=88, optimize=True)
    prepare_banking_concrete(output_directory)
    raster = {"height": GRID_HEIGHT, "maximum": max(values), "mean": sum(values) / len(values), "minimum": min(values), "sourceResolutionMeters": 19.0, "verticalDatum": "Terrarium DEM metres", "width": GRID_WIDTH}
    metadata = {
        "bounds": bounds,
        "coordinateReferenceSystem": "EPSG:32632",
        "orthophoto": {"exportResolutionMetersPerPixel": max((bounds["maxX"] - bounds["minX"]) / orthophoto.width, (bounds["maxY"] - bounds["minY"]) / orthophoto.height), "height": orthophoto.height, "source": "Italian National Geoportal PCN colour orthophoto 2012", "sourceResolutionMeters": 0.5, "width": orthophoto.width},
        "rasters": {"dsm": raster, "dtm": raster},
        "schemaVersion": 1,
        "terrainSurface": {"detailSource": "PCN orthophoto; full 4096 px detail at the venue, softened 1024 px peripheral context", "textureHeight": orthophoto.height, "textureWidth": orthophoto.width},
        "verticalDatum": "Terrarium DEM metres; no vertical exaggeration",
    }
    (output_directory / "raster-metadata.json").write_text(f"{json.dumps(metadata, indent=2)}\n", encoding="utf-8")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
