#!/usr/bin/env python3

import json
import math
import sys

from PIL import Image


def fail(message: str) -> None:
    raise SystemExit(message)


def main() -> None:
    if len(sys.argv) != 4:
        fail("Usage: crop_png.py <input.png> <output.png> <crop-json>")

    input_path = sys.argv[1]
    output_path = sys.argv[2]
    try:
        crop = json.loads(sys.argv[3])
    except json.JSONDecodeError as error:
        fail(f"Invalid crop JSON: {error}")

    x = float(crop.get("x", 0))
    y = float(crop.get("y", 0))
    width = float(crop.get("width", 0))
    height = float(crop.get("height", 0))
    target_width = int(round(float(crop.get("targetWidth", width))))
    target_height = int(round(float(crop.get("targetHeight", height))))

    if not all(math.isfinite(value) for value in [x, y, width, height]):
        fail("Crop bounds must be finite numbers.")
    if width <= 0 or height <= 0:
        fail("Crop width and height must be positive.")
    if target_width <= 0 or target_height <= 0:
        fail("Target width and height must be positive.")

    with Image.open(input_path) as image:
        left = max(0, math.floor(x))
        top = max(0, math.floor(y))
        right = min(image.width, math.ceil(x + width))
        bottom = min(image.height, math.ceil(y + height))
        if right <= left or bottom <= top:
            fail("Crop bounds fall outside the source image.")

        cropped = image.crop((left, top, right, bottom))
        if cropped.size != (target_width, target_height):
            resampling = Image.Resampling.LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS
            cropped = cropped.resize((target_width, target_height), resampling)
        cropped.save(output_path, format="PNG")


if __name__ == "__main__":
    main()
