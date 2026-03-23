#!/usr/bin/env python3
import json
import sys
from pathlib import Path

from PIL import Image


def clamp(value, low, high):
    return max(low, min(high, value))


def quad_to_pil_order(points):
    if len(points) != 4:
        raise ValueError("source quad must contain exactly 4 points")

    top_left, top_right, bottom_right, bottom_left = points
    return [
        (top_left["x"], top_left["y"]),
        (bottom_left["x"], bottom_left["y"]),
        (bottom_right["x"], bottom_right["y"]),
        (top_right["x"], top_right["y"]),
    ]


def solve_linear_system(matrix, vector):
    size = len(vector)
    augmented = [list(matrix[row]) + [vector[row]] for row in range(size)]

    for pivot in range(size):
        pivot_row = max(range(pivot, size), key=lambda row: abs(augmented[row][pivot]))
        if abs(augmented[pivot_row][pivot]) < 1e-8:
            raise ValueError("cannot solve perspective transform")
        if pivot_row != pivot:
            augmented[pivot], augmented[pivot_row] = augmented[pivot_row], augmented[pivot]

        pivot_value = augmented[pivot][pivot]
        for column in range(pivot, size + 1):
            augmented[pivot][column] /= pivot_value

        for row in range(size):
            if row == pivot:
                continue
            factor = augmented[row][pivot]
            if abs(factor) < 1e-12:
                continue
            for column in range(pivot, size + 1):
                augmented[row][column] -= factor * augmented[pivot][column]

    return [augmented[row][size] for row in range(size)]


def compute_perspective_coefficients(source_points, target_width, target_height):
    destination_points = [
        (0.0, 0.0),
        (0.0, float(target_height)),
        (float(target_width), float(target_height)),
        (float(target_width), 0.0),
    ]
    matrix = []
    vector = []

    for (u, v), (x, y) in zip(destination_points, source_points):
        matrix.append([u, v, 1.0, 0.0, 0.0, 0.0, -u * x, -v * x])
        vector.append(x)
        matrix.append([0.0, 0.0, 0.0, u, v, 1.0, -u * y, -v * y])
        vector.append(y)

    return solve_linear_system(matrix, vector)


def main():
    if len(sys.argv) < 6:
        raise SystemExit(
            "usage: remap_reference_image.py <input-image> <output-image> <target-width> <target-height> <source-quad-json>"
        )

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    target_width = max(1, int(float(sys.argv[3])))
    target_height = max(1, int(float(sys.argv[4])))
    source_quad = json.loads(sys.argv[5])

    image = Image.open(input_path).convert("RGBA")
    width, height = image.size

    normalized_points = []
    for point in source_quad:
      normalized_points.append(
          {
              "x": clamp(float(point["x"]), 0, width),
              "y": clamp(float(point["y"]), 0, height),
          }
      )

    coefficients = compute_perspective_coefficients(
        quad_to_pil_order(normalized_points),
        target_width,
        target_height,
    )
    transformed = image.transform(
        (target_width, target_height),
        Image.Transform.PERSPECTIVE,
        coefficients,
        resample=Image.Resampling.BICUBIC,
    )
    transformed.save(output_path, format="PNG")


if __name__ == "__main__":
    main()
