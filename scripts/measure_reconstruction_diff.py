#!/usr/bin/env python3
import json
import sys
from pathlib import Path

from PIL import Image, ImageFilter, ImageOps


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


def structure_similarity(reference, rendered):
    left = (
        ImageOps.autocontrast(reference.convert("L"))
        .filter(ImageFilter.GaussianBlur(radius=1.8))
        .resize((96, 96))
    )
    right = (
        ImageOps.autocontrast(rendered.convert("L"))
        .filter(ImageFilter.GaussianBlur(radius=1.8))
        .resize((96, 96))
    )
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


def hotspot_analysis(reference, rendered):
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

    sorted_items = sorted(items, key=lambda item: item["score"], reverse=True)
    scores = [item["score"] for item in items]
    hotspot_average = sum(scores) / len(scores) if scores else 0.0
    hotspot_peak = max(scores) if scores else 0.0
    hotspot_coverage = (
        sum(1 for score in scores if score >= 0.18) / len(scores) if scores else 0.0
    )
    return {
        "hotspots": sorted_items[:5],
        "hotspotAverage": round(clamp(hotspot_average, 0.0, 1.0), 4),
        "hotspotPeak": round(clamp(hotspot_peak, 0.0, 1.0), 4),
        "hotspotCoverage": round(clamp(hotspot_coverage, 0.0, 1.0), 4),
    }


def acceptance_gates(
    global_similarity,
    layout_similarity,
    structure_similarity_value,
    edge_similarity_value,
    color_delta_value,
    hotspot_peak,
    hotspot_coverage,
):
    return [
        {
            "id": "gate-global",
            "label": "Global similarity",
            "metric": "globalSimilarity",
            "comparator": "gte",
            "threshold": 0.9,
            "actual": round(global_similarity, 4),
            "passed": global_similarity >= 0.9,
            "hard": True,
        },
        {
            "id": "gate-layout",
            "label": "Layout similarity",
            "metric": "layoutSimilarity",
            "comparator": "gte",
            "threshold": 0.88,
            "actual": round(layout_similarity, 4),
            "passed": layout_similarity >= 0.88,
            "hard": True,
        },
        {
            "id": "gate-structure",
            "label": "Structure similarity",
            "metric": "structureSimilarity",
            "comparator": "gte",
            "threshold": 0.88,
            "actual": round(structure_similarity_value, 4),
            "passed": structure_similarity_value >= 0.88,
            "hard": True,
        },
        {
            "id": "gate-edge",
            "label": "Edge similarity",
            "metric": "edgeSimilarity",
            "comparator": "gte",
            "threshold": 0.88,
            "actual": round(edge_similarity_value, 4),
            "passed": edge_similarity_value >= 0.88,
            "hard": True,
        },
        {
            "id": "gate-color",
            "label": "Color delta",
            "metric": "colorDelta",
            "comparator": "lte",
            "threshold": 0.1,
            "actual": round(color_delta_value, 4),
            "passed": color_delta_value <= 0.1,
            "hard": True,
        },
        {
            "id": "gate-hotspot-peak",
            "label": "Hotspot peak",
            "metric": "hotspotPeak",
            "comparator": "lte",
            "threshold": 0.22,
            "actual": round(hotspot_peak, 4),
            "passed": hotspot_peak <= 0.22,
            "hard": True,
        },
        {
            "id": "gate-hotspot-coverage",
            "label": "Hotspot coverage",
            "metric": "hotspotCoverage",
            "comparator": "lte",
            "threshold": 0.22,
            "actual": round(hotspot_coverage, 4),
            "passed": hotspot_coverage <= 0.22,
            "hard": False,
        },
    ]


def composite_score(
    global_similarity,
    layout_similarity,
    structure_similarity_value,
    edge_similarity_value,
    color_delta_value,
    hotspot_average,
    hotspot_peak,
):
    color_similarity = 1.0 - color_delta_value
    hotspot_average_similarity = 1.0 - hotspot_average
    hotspot_peak_similarity = 1.0 - hotspot_peak
    score = (
        0.28 * global_similarity
        + 0.2 * layout_similarity
        + 0.18 * structure_similarity_value
        + 0.16 * edge_similarity_value
        + 0.08 * color_similarity
        + 0.06 * hotspot_average_similarity
        + 0.04 * hotspot_peak_similarity
    )
    return round(clamp(score, 0.0, 1.0), 4)


def score_grade(composite, gates):
    hard_failed = any((not gate["passed"]) and gate["hard"] for gate in gates)
    if composite >= 0.93 and not hard_failed:
        return "A"
    if composite >= 0.87:
        return "B"
    if composite >= 0.78:
        return "C"
    if composite >= 0.68:
        return "D"
    return "F"


def parse_crop_bounds(argv):
    if "--crop" not in argv:
        return None
    index = argv.index("--crop")
    if index + 1 >= len(argv):
        raise SystemExit("--crop requires a JSON payload")
    payload = json.loads(argv[index + 1])
    return {
        "x": clamp(float(payload.get("x", 0.0)), 0.0, 1.0),
        "y": clamp(float(payload.get("y", 0.0)), 0.0, 1.0),
        "width": clamp(float(payload.get("width", 0.0)), 0.0, 1.0),
        "height": clamp(float(payload.get("height", 0.0)), 0.0, 1.0),
    }


def crop_image(image, bounds):
    if not bounds:
        return image

    width, height = image.size
    left = int(round(bounds["x"] * width))
    top = int(round(bounds["y"] * height))
    right = int(round((bounds["x"] + bounds["width"]) * width))
    bottom = int(round((bounds["y"] + bounds["height"]) * height))
    left = clamp(left, 0, width - 1)
    top = clamp(top, 0, height - 1)
    right = clamp(right, left + 1, width)
    bottom = clamp(bottom, top + 1, height)
    return image.crop((left, top, right, bottom))


def main():
    if len(sys.argv) < 3:
        raise SystemExit("usage: measure_reconstruction_diff.py <reference-image> <rendered-image>")

    reference_path = Path(sys.argv[1])
    rendered_path = Path(sys.argv[2])
    crop_bounds = parse_crop_bounds(sys.argv[3:])

    reference = Image.open(reference_path).convert("RGB")
    rendered = Image.open(rendered_path).convert("RGB").resize(reference.size)
    reference = crop_image(reference, crop_bounds)
    rendered = crop_image(rendered, crop_bounds).resize(reference.size)

    global_difference = mean_abs_diff(reference, rendered) / 255.0
    global_similarity = round(clamp(1.0 - global_difference, 0.0, 1.0), 4)
    layout_similarity = round(coarse_layout_similarity(reference, rendered), 4)
    edge_similarity_value = round(edge_similarity(reference, rendered), 4)
    structure_similarity_value = round(structure_similarity(reference, rendered), 4)
    color_delta_value = round(color_delta(reference, rendered), 4)
    hotspot_metrics = hotspot_analysis(reference, rendered)
    composite = composite_score(
        global_similarity,
        layout_similarity,
        structure_similarity_value,
        edge_similarity_value,
        color_delta_value,
        hotspot_metrics["hotspotAverage"],
        hotspot_metrics["hotspotPeak"],
    )
    gates = acceptance_gates(
        global_similarity,
        layout_similarity,
        structure_similarity_value,
        edge_similarity_value,
        color_delta_value,
        hotspot_metrics["hotspotPeak"],
        hotspot_metrics["hotspotCoverage"],
    )
    payload = {
        "globalSimilarity": global_similarity,
        "colorDelta": color_delta_value,
        "edgeSimilarity": edge_similarity_value,
        "layoutSimilarity": layout_similarity,
        "structureSimilarity": structure_similarity_value,
        "hotspotAverage": hotspot_metrics["hotspotAverage"],
        "hotspotPeak": hotspot_metrics["hotspotPeak"],
        "hotspotCoverage": hotspot_metrics["hotspotCoverage"],
        "compositeScore": composite,
        "grade": score_grade(composite, gates),
        "acceptanceGates": gates,
        "hotspots": hotspot_metrics["hotspots"],
    }

    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
