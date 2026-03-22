#!/usr/bin/env python3
import json
import sys
from pathlib import Path

from PIL import Image, ImageFilter


def clamp(value, low, high):
    return max(low, min(high, value))


def mean_abs_diff(image_a, image_b):
    width, height = image_a.size
    pixels_a = image_a.load()
    pixels_b = image_b.load()
    total = 0.0

    for y in range(height):
        for x in range(width):
            left = pixels_a[x, y]
            right = pixels_b[x, y]
            if isinstance(left, int):
                total += abs(left - right)
            else:
                total += sum(abs(left[index] - right[index]) for index in range(len(left))) / len(left)

    return total / (width * height)


def coarse_layout_similarity(reference, rendered):
    left = reference.convert("L").resize((64, 64))
    right = rendered.convert("L").resize((64, 64))
    difference = mean_abs_diff(left, right) / 255.0
    return clamp(1.0 - difference, 0.0, 1.0)


def edge_similarity(reference, rendered):
    left = reference.convert("L").filter(ImageFilter.FIND_EDGES).resize((192, 192))
    right = rendered.convert("L").filter(ImageFilter.FIND_EDGES).resize((192, 192))
    difference = mean_abs_diff(left, right) / 255.0
    return clamp(1.0 - difference, 0.0, 1.0)


def color_delta(reference, rendered):
    left = reference.convert("RGB").resize((64, 64))
    right = rendered.convert("RGB").resize((64, 64))
    return clamp(mean_abs_diff(left, right) / 255.0, 0.0, 1.0)


def hotspots(reference, rendered):
    left = reference.convert("RGB").resize((120, 120))
    right = rendered.convert("RGB").resize((120, 120))
    grid_size = 6
    cell_width = left.size[0] // grid_size
    cell_height = left.size[1] // grid_size
    items = []

    for row in range(grid_size):
        for column in range(grid_size):
            x0 = column * cell_width
            y0 = row * cell_height
            x1 = left.size[0] if column == grid_size - 1 else (column + 1) * cell_width
            y1 = left.size[1] if row == grid_size - 1 else (row + 1) * cell_height
            diff = mean_abs_diff(left.crop((x0, y0, x1, y1)), right.crop((x0, y0, x1, y1))) / 255.0
            items.append(
                {
                    "id": f"hotspot-{len(items) + 1}",
                    "score": round(clamp(diff, 0.0, 1.0), 4),
                    "bounds": {
                        "x": round(x0 / left.size[0], 4),
                        "y": round(y0 / left.size[1], 4),
                        "width": round((x1 - x0) / left.size[0], 4),
                        "height": round((y1 - y0) / left.size[1], 4),
                    },
                }
            )

    items.sort(key=lambda item: item["score"], reverse=True)
    return items[:5]


def main():
    if len(sys.argv) < 3:
        raise SystemExit("usage: measure_reconstruction_diff.py <reference-image> <rendered-image>")

    reference_path = Path(sys.argv[1])
    rendered_path = Path(sys.argv[2])

    reference = Image.open(reference_path).convert("RGB")
    rendered = Image.open(rendered_path).convert("RGB").resize(reference.size)

    global_difference = mean_abs_diff(reference, rendered) / 255.0
    payload = {
        "globalSimilarity": round(clamp(1.0 - global_difference, 0.0, 1.0), 4),
        "colorDelta": round(color_delta(reference, rendered), 4),
        "edgeSimilarity": round(edge_similarity(reference, rendered), 4),
        "layoutSimilarity": round(coarse_layout_similarity(reference, rendered), 4),
        "hotspots": hotspots(reference, rendered),
    }

    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
