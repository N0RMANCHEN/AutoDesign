#!/usr/bin/env python3
import json
import sys
from pathlib import Path

from PIL import Image


def clamp(value, low, high):
    return max(low, min(high, value))


def rgb_to_hex(rgb):
    return "#{:02X}{:02X}{:02X}".format(*rgb)


def normalize_bounds(bounds, width, height):
    x0, y0, x1, y1 = bounds
    return {
        "x": round((x0 / width), 4),
        "y": round((y0 / height), 4),
        "width": round(((x1 - x0) / width), 4),
        "height": round(((y1 - y0) / height), 4),
    }


def extract_dominant_colors(image):
    sampled = image.convert("RGB").resize((96, 96))
    quantized = sampled.quantize(colors=6, method=Image.MEDIANCUT)
    palette = quantized.getpalette() or []
    counts = quantized.getcolors() or []
    colors = []
    for count, index in sorted(counts, reverse=True):
      base = index * 3
      if base + 2 >= len(palette):
        continue
      colors.append(rgb_to_hex((palette[base], palette[base + 1], palette[base + 2])))
    deduped = []
    for color in colors:
      if color not in deduped:
        deduped.append(color)
    return deduped[:6]


def detect_surface_regions(image):
    small = image.convert("RGB").resize((160, 160))
    width, height = small.size
    pixels = small.load()
    luminance = []
    mean_l = 0
    for y in range(height):
        row = []
        for x in range(width):
            r, g, b = pixels[x, y]
            l = int(0.299 * r + 0.587 * g + 0.114 * b)
            row.append(l)
            mean_l += l
        luminance.append(row)
    mean_l = mean_l / (width * height)
    threshold = min(240, max(120, int(mean_l + 20)))

    visited = set()
    regions = []

    for y in range(height):
        for x in range(width):
            if (x, y) in visited:
                continue
            if luminance[y][x] < threshold:
                continue

            stack = [(x, y)]
            visited.add((x, y))
            points = []
            while stack:
                cx, cy = stack.pop()
                points.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if nx < 0 or ny < 0 or nx >= width or ny >= height:
                        continue
                    if (nx, ny) in visited:
                        continue
                    if luminance[ny][nx] < threshold:
                        continue
                    visited.add((nx, ny))
                    stack.append((nx, ny))

            if len(points) < 260:
                continue

            xs = [point[0] for point in points]
            ys = [point[1] for point in points]
            x0, x1 = min(xs), max(xs) + 1
            y0, y1 = min(ys), max(ys) + 1
            box_width = x1 - x0
            box_height = y1 - y0
            if box_width < 18 or box_height < 12:
                continue
            area_ratio = (box_width * box_height) / float(width * height)
            width_ratio = box_width / float(width)
            height_ratio = box_height / float(height)
            # Skip whole-canvas or near whole-canvas blobs. Those are usually
            # the page backdrop and produce the "weird background slab" bug.
            if area_ratio >= 0.55:
                continue
            if width_ratio >= 0.92 and height_ratio >= 0.92:
                continue

            crop = small.crop((x0, y0, x1, y1)).convert("RGB")
            avg = crop.resize((1, 1)).getpixel((0, 0))
            regions.append(
                {
                    "id": f"surface-{len(regions) + 1}",
                    "kind": "surface",
                    "confidence": round(clamp(len(points) / 2200.0, 0.35, 0.96), 2),
                    "bounds": normalize_bounds((x0, y0, x1, y1), width, height),
                    "fillHex": rgb_to_hex(avg),
                }
            )

    regions.sort(
        key=lambda region: (
            -(region["bounds"]["width"] * region["bounds"]["height"]),
            -region["confidence"],
        )
    )
    return regions[:6]


def detect_text_candidates(image, regions):
    small = image.convert("L").resize((160, 160))
    width, height = small.size
    candidates = []

    for region in regions[:6]:
        bounds = region["bounds"]
        area_ratio = bounds["width"] * bounds["height"]
        if area_ratio >= 0.35 or bounds["height"] >= 0.55:
            continue
        x0 = int(bounds["x"] * width)
        y0 = int(bounds["y"] * height)
        x1 = int((bounds["x"] + bounds["width"]) * width)
        y1 = int((bounds["y"] + bounds["height"]) * height)
        if x1 <= x0 or y1 <= y0:
            continue

        crop = small.crop((x0, y0, x1, y1))
        crop_w, crop_h = crop.size
        dark_rows = []
        for row in range(crop_h):
            dark_count = 0
            for col in range(crop_w):
                if crop.getpixel((col, row)) < 110:
                    dark_count += 1
            if crop_w > 0 and dark_count / crop_w > 0.08:
                dark_rows.append(row)

        if not dark_rows:
            continue

        bands = []
        start = dark_rows[0]
        previous = dark_rows[0]
        for row in dark_rows[1:]:
            if row == previous + 1:
                previous = row
                continue
            bands.append((start, previous + 1))
            start = row
            previous = row
        bands.append((start, previous + 1))

        for band_start, band_end in bands[:3]:
            band_height = band_end - band_start
            if band_height < 2:
                continue
            role = "label"
            if band_height >= 12:
                role = "metric"
            elif band_height >= 7:
                role = "headline"
            candidates.append(
                {
                    "id": f"text-{len(candidates) + 1}",
                    "confidence": round(clamp(0.38 + band_height / 22.0, 0.4, 0.82), 2),
                    "bounds": normalize_bounds((x0, y0 + band_start, x1, y0 + band_end), width, height),
                    "estimatedRole": role,
                }
            )

    return candidates[:10]


def build_ocr_blocks(text_candidates):
    blocks = []
    for index, candidate in enumerate(text_candidates[:8]):
        blocks.append(
            {
                "id": f"ocr-{index + 1}",
                "text": None,
                "confidence": round(clamp(candidate["confidence"], 0.3, 0.75), 2),
                "bounds": candidate["bounds"],
                "lineCount": 2 if candidate["estimatedRole"] == "body" else 1,
                "language": None,
                "source": "heuristic",
            }
        )
    return blocks


def build_text_style_hints(text_candidates, theme):
    hints = []
    color = "#F5F7FF" if theme == "dark" else "#111111"
    for candidate in text_candidates[:8]:
        role = candidate["estimatedRole"]
        hints.append(
            {
                "textCandidateId": candidate["id"],
                "role": role,
                "fontCategory": "display" if role in ("metric", "headline") else "text",
                "fontWeightGuess": 700 if role == "metric" else 600 if role == "headline" else 500,
                "fontSizeEstimate": 32 if role == "metric" else 24 if role == "headline" else 16,
                "colorHex": color,
                "alignmentGuess": "left",
                "lineHeightEstimate": 22 if role == "body" else 18 if role == "label" else None,
                "letterSpacingEstimate": 0,
                "confidence": round(clamp(candidate["confidence"], 0.4, 0.82), 2),
            }
        )
    return hints


def build_asset_candidates(image, regions):
    width, height = image.size
    candidates = []
    for region in regions[:4]:
        bounds = region["bounds"]
        if bounds["width"] * bounds["height"] < 0.12:
            continue
        candidates.append(
            {
                "id": f"asset-{len(candidates) + 1}",
                "kind": "background-slice",
                "bounds": bounds,
                "confidence": round(clamp(region["confidence"] - 0.08, 0.35, 0.8), 2),
                "extractMode": "ignore",
                "needsOutpainting": bounds["width"] >= 0.6 and bounds["height"] >= 0.45 and (width > height),
            }
        )
    return candidates


def style_hints(image, dominant_colors, regions):
    rgb = image.convert("RGB").resize((1, 1)).getpixel((0, 0))
    luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255
    theme = "dark" if luminance < 0.45 else "light"
    primary = dominant_colors[0] if dominant_colors else None
    accent = dominant_colors[1] if len(dominant_colors) > 1 else primary
    corner = 28 if regions else 20
    return {
        "theme": theme,
        "cornerRadiusHint": corner,
        "shadowHint": "soft" if theme == "dark" else "none",
        "primaryColorHex": primary,
        "accentColorHex": accent,
    }


def main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: analyze_reference_preview.py <image-path>")

    image_path = Path(sys.argv[1])
    image = Image.open(image_path).convert("RGB")
    width, height = image.size
    dominant_colors = extract_dominant_colors(image)
    regions = detect_surface_regions(image)
    texts = detect_text_candidates(image, regions)
    hints = style_hints(image, dominant_colors, regions)
    ocr_blocks = build_ocr_blocks(texts)
    text_style_hints = build_text_style_hints(texts, hints["theme"])
    asset_candidates = build_asset_candidates(image, regions)

    uncertainties = []
    if not regions:
        uncertainties.append("未稳定识别出大区块，当前结果仅基于整图风格。")
    if not texts:
        uncertainties.append("未识别出稳定文本区域，当前不包含 OCR 内容。")
    uncertainties.append("当前分析不做真实 OCR，文本内容与精确字体仍需后续阶段补全。")

    payload = {
        "width": width,
        "height": height,
        "dominantColors": dominant_colors,
        "layoutRegions": regions,
        "textCandidates": texts,
        "ocrBlocks": ocr_blocks,
        "textStyleHints": text_style_hints,
        "assetCandidates": asset_candidates,
        "styleHints": hints,
        "uncertainties": uncertainties,
    }

    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
