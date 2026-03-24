#!/usr/bin/env python3
import json
import sys
from pathlib import Path

from PIL import Image


def clamp(value, low, high):
    return max(low, min(high, value))


def main():
    if len(sys.argv) < 4:
        raise SystemExit(
            "usage: crop_reconstruction_preview.py <input-image> <output-image> <normalized-bounds-json>"
        )

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    bounds = json.loads(sys.argv[3])
    x = clamp(float(bounds.get("x", 0.0)), 0.0, 1.0)
    y = clamp(float(bounds.get("y", 0.0)), 0.0, 1.0)
    width = clamp(float(bounds.get("width", 0.0)), 0.0, 1.0)
    height = clamp(float(bounds.get("height", 0.0)), 0.0, 1.0)

    image = Image.open(input_path)
    image_width, image_height = image.size
    left = int(round(x * image_width))
    top = int(round(y * image_height))
    right = int(round((x + width) * image_width))
    bottom = int(round((y + height) * image_height))
    left = clamp(left, 0, image_width - 1)
    top = clamp(top, 0, image_height - 1)
    right = clamp(right, left + 1, image_width)
    bottom = clamp(bottom, top + 1, image_height)

    image.crop((left, top, right, bottom)).save(output_path)


if __name__ == "__main__":
    main()
