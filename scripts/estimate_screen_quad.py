#!/usr/bin/env python3
import json
import sys
from colorsys import rgb_to_hsv
from math import atan2, cos, pi, radians, sin
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


def clamp(value, low, high):
    return max(low, min(high, value))


def normalize_line_angle(angle_degrees):
    normalized = ((angle_degrees + 90.0) % 180.0) - 90.0
    if normalized >= 90.0:
        normalized -= 180.0
    return normalized


def estimate_content_rotation(image):
    grayscale = image.convert("L").filter(ImageFilter.GaussianBlur(1.2))
    width, height = grayscale.size
    pixels = grayscale.load()
    histogram = [0.0] * 180

    for y in range(2, height - 2):
        for x in range(2, width - 2):
            gx = float(pixels[x + 1, y]) - float(pixels[x - 1, y])
            gy = float(pixels[x, y + 1]) - float(pixels[x, y - 1])
            magnitude = abs(gx) + abs(gy)
            if magnitude < 80:
                continue
            gradient_angle = (atan2(gy, gx) * 180.0 / pi + 180.0) % 180.0
            histogram[int(gradient_angle)] += magnitude

    candidates = []
    for gradient_index, score in enumerate(histogram):
        if score <= 0:
            continue
        line_angle = normalize_line_angle(gradient_index - 90.0)
        # Ignore outer crop edges that dominate near 0/90 degrees.
        if abs(line_angle) < 8 or abs(abs(line_angle) - 90.0) < 8:
            continue
        # Prefer the "horizontal" screen axis rather than the vertical one.
        if abs(line_angle) > 60:
            continue
        candidates.append((score, line_angle))

    if not candidates:
        return 0.0

    candidates.sort(reverse=True)
    return float(candidates[0][1])


def build_nonwhite_integral(rotated):
    width, height = rotated.size
    pixels = rotated.convert("RGB").load()
    integral = [[0] * (width + 1) for _ in range(height + 1)]

    for y in range(height):
        row_sum = 0
        for x in range(width):
            r, g, b = pixels[x, y]
            filled = 1 if (r < 245 or g < 245 or b < 245) else 0
            row_sum += filled
            integral[y + 1][x + 1] = integral[y][x + 1] + row_sum

    return integral


def build_active_content_integral(rotated):
    width, height = rotated.size
    pixels = rotated.convert("RGBA").load()
    integral = [[0] * (width + 1) for _ in range(height + 1)]
    border_x = max(6, int(width * 0.02))
    border_y = max(6, int(height * 0.02))

    for y in range(height):
        row_sum = 0
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if x < border_x or y < border_y or x >= width - border_x or y >= height - border_y:
                active = 0
            elif a <= 8:
                active = 0
            else:
                _, s, v = rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
                luminance = 0.299 * r + 0.587 * g + 0.114 * b
                active = 1 if (
                    (s >= 0.2 and v >= 0.24)  # colored cards / accents
                    or (luminance >= 214 and not (luminance >= 245 and s <= 0.06))  # white text / icons
                ) else 0
            row_sum += active
            integral[y + 1][x + 1] = integral[y][x + 1] + row_sum

    return integral


def area_sum(integral, x0, y0, x1, y1):
    return integral[y1][x1] - integral[y0][x1] - integral[y1][x0] + integral[y0][x0]


def expand_box_to_aspect(x0, y0, x1, y1, target_width, target_height, image_width, image_height):
    target_ratio = float(target_width) / float(target_height)
    width = max(1.0, float(x1 - x0))
    height = max(1.0, float(y1 - y0))
    center_x = (x0 + x1) * 0.5
    center_y = (y0 + y1) * 0.5

    if (width / height) < target_ratio:
        width = height * target_ratio
    else:
        height = width / target_ratio

    x0 = center_x - (width * 0.5)
    x1 = center_x + (width * 0.5)
    y0 = center_y - (height * 0.5)
    y1 = center_y + (height * 0.5)

    if x0 < 0:
        x1 -= x0
        x0 = 0
    if x1 > image_width:
        x0 -= (x1 - image_width)
        x1 = image_width
    if y0 < 0:
        y1 -= y0
        y0 = 0
    if y1 > image_height:
        y0 -= (y1 - image_height)
        y1 = image_height

    x0 = clamp(x0, 0.0, float(image_width))
    x1 = clamp(x1, 0.0, float(image_width))
    y0 = clamp(y0, 0.0, float(image_height))
    y1 = clamp(y1, 0.0, float(image_height))

    return {
        "x0": int(round(x0)),
        "y0": int(round(y0)),
        "x1": int(round(x1)),
        "y1": int(round(y1)),
        "width": int(round(max(1.0, x1 - x0))),
        "height": int(round(max(1.0, y1 - y0))),
    }


def find_content_driven_box(rotated, target_width, target_height):
    width, height = rotated.size
    integral = build_active_content_integral(rotated)
    total_active = area_sum(integral, 0, 0, width, height)
    if total_active <= 0:
        return None

    threshold = max(12, int(min(width, height) * 0.012))
    min_x = width
    min_y = height
    max_x = 0
    max_y = 0

    for y in range(height):
        row_active = area_sum(integral, 0, y, width, y + 1)
        if row_active < threshold:
            continue
        min_y = min(min_y, y)
        max_y = max(max_y, y + 1)

    for x in range(width):
        col_active = area_sum(integral, x, 0, x + 1, height)
        if col_active < threshold:
            continue
        min_x = min(min_x, x)
        max_x = max(max_x, x + 1)

    if min_x >= max_x or min_y >= max_y:
        return None

    box_width = max_x - min_x
    box_height = max_y - min_y
    pad_left = max(14, int(box_width * 0.08))
    pad_right = max(18, int(box_width * 0.14))
    pad_top = max(14, int(box_height * 0.05))
    pad_bottom = max(20, int(box_height * 0.08))

    expanded = expand_box_to_aspect(
        min_x - pad_left,
        min_y - pad_top,
        max_x + pad_right,
        max_y + pad_bottom,
        target_width,
        target_height,
        width,
        height,
    )
    active = area_sum(integral, expanded["x0"], expanded["y0"], expanded["x1"], expanded["y1"])
    expanded_area = max(1, expanded["width"] * expanded["height"])
    expanded["density"] = active / float(expanded_area)
    expanded["score"] = (active / float(total_active)) * 0.75 + expanded["density"] * 0.25
    return expanded


def find_best_rotated_box(rotated, target_width, target_height):
    width, height = rotated.size
    ratio = float(target_width) / float(target_height)
    integral = build_nonwhite_integral(rotated)
    best = None

    min_height = max(180, int(height * 0.35))
    max_height = max(min_height, int(height * 0.92))

    for box_height in range(min_height, max_height + 1, 10):
        box_width = int(round(box_height * ratio))
        if box_width < 80 or box_width >= width:
            continue
        x_step = max(4, box_width // 24)
        y_step = max(4, box_height // 24)
        for y0 in range(0, height - box_height + 1, y_step):
            y1 = y0 + box_height
            for x0 in range(0, width - box_width + 1, x_step):
                x1 = x0 + box_width
                filled = area_sum(integral, x0, y0, x1, y1)
                density = filled / float(box_width * box_height)
                area_score = (box_width * box_height) / float(width * height)
                center_bias = 1.0 - (abs(((x0 + x1) * 0.5) - (width * 0.5)) / max(1.0, width * 0.5)) * 0.22
                score = (density * 0.8 + area_score * 0.2) * center_bias
                if best is None or score > best["score"]:
                    best = {
                        "score": score,
                        "density": density,
                        "x0": x0,
                        "y0": y0,
                        "x1": x1,
                        "y1": y1,
                        "width": box_width,
                        "height": box_height,
                    }

    if not best:
        raise ValueError("unable to estimate rotated screen box")

    return best


def map_rotated_point_to_original(point, original_size, rotated_size, angle_degrees):
    original_width, original_height = original_size
    rotated_width, rotated_height = rotated_size
    original_center_x = original_width / 2.0
    original_center_y = original_height / 2.0
    rotated_center_x = rotated_width / 2.0
    rotated_center_y = rotated_height / 2.0
    angle = radians(angle_degrees)
    cosine = cos(angle)
    sine = sin(angle)

    dx = point[0] - rotated_center_x
    dy = point[1] - rotated_center_y
    x = cosine * dx - sine * dy + original_center_x
    y = sine * dx + cosine * dy + original_center_y
    return {
        "x": round(clamp(x, 0.0, float(original_width)), 3),
        "y": round(clamp(y, 0.0, float(original_height)), 3),
    }


def write_debug_images(original, rotated, rotated_box, source_quad, debug_prefix):
    original_overlay = original.convert("RGBA")
    original_draw = ImageDraw.Draw(original_overlay)
    quad_points = [(point["x"], point["y"]) for point in source_quad]
    original_draw.line(quad_points + [quad_points[0]], fill=(255, 64, 64, 255), width=5)
    for index, point in enumerate(quad_points, start=1):
        x, y = point
        original_draw.ellipse((x - 6, y - 6, x + 6, y + 6), fill=(255, 255, 0, 255))
        original_draw.text((x + 8, y + 8), f"P{index}", fill=(255, 255, 0, 255))
    original_path = Path(f"{debug_prefix}-quad.png")
    original_overlay.save(original_path, format="PNG")

    rotated_overlay = rotated.convert("RGBA")
    rotated_draw = ImageDraw.Draw(rotated_overlay)
    rotated_draw.rectangle(
        (rotated_box["x0"], rotated_box["y0"], rotated_box["x1"], rotated_box["y1"]),
        outline=(255, 64, 64, 255),
        width=5,
    )
    rotated_path = Path(f"{debug_prefix}-rotated-box.png")
    rotated_overlay.save(rotated_path, format="PNG")

    return {
        "originalOverlayPath": str(original_path),
        "rotatedOverlayPath": str(rotated_path),
    }


def main():
    if len(sys.argv) < 4:
        raise SystemExit(
            "usage: estimate_screen_quad.py <input-image> <target-width> <target-height> [debug-prefix]"
        )

    input_path = Path(sys.argv[1])
    target_width = max(1, int(float(sys.argv[2])))
    target_height = max(1, int(float(sys.argv[3])))
    debug_prefix = sys.argv[4] if len(sys.argv) > 4 else None

    original = Image.open(input_path).convert("RGBA")
    rotation = estimate_content_rotation(original)
    rotated = original.rotate(
        rotation,
        resample=Image.Resampling.BICUBIC,
        expand=True,
        fillcolor=(255, 255, 255, 255),
    )
    content_box = find_content_driven_box(rotated, target_width, target_height)
    dense_box = find_best_rotated_box(rotated, target_width, target_height)
    rotated_box = content_box if content_box else dense_box
    rotated_points = [
        (rotated_box["x0"], rotated_box["y0"]),
        (rotated_box["x1"], rotated_box["y0"]),
        (rotated_box["x1"], rotated_box["y1"]),
        (rotated_box["x0"], rotated_box["y1"]),
    ]
    source_quad = [
        map_rotated_point_to_original(point, original.size, rotated.size, rotation)
        for point in rotated_points
    ]

    payload = {
        "rotationDegrees": round(rotation, 3),
        "rotatedBox": {
            "x": rotated_box["x0"],
            "y": rotated_box["y0"],
            "width": rotated_box["width"],
            "height": rotated_box["height"],
            "density": round(rotated_box["density"], 4),
        },
        "source": "content-driven" if content_box else "density-search",
        "sourceQuadPixels": source_quad,
    }

    if debug_prefix:
        payload["debug"] = write_debug_images(original, rotated, rotated_box, source_quad, debug_prefix)

    sys.stdout.write(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
