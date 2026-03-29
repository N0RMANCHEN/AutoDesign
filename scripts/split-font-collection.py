#!/usr/bin/env python3

import json
import re
import sys
from pathlib import Path


def fail(message: str) -> None:
    raise SystemExit(message)


if len(sys.argv) != 3:
    fail("usage: split-font-collection.py <source-ttc-or-otc> <output-dir>")

try:
    from fontTools.ttLib import TTCollection
except Exception as error:  # pragma: no cover - surfaced through stderr/stdout to the caller.
    fail(f"fontTools import failed: {error}")


def sanitize_filename(value: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip())
    normalized = normalized.strip("-")
    return normalized or "font"


def name_value(font, name_id: int, fallback: str) -> str:
    value = font["name"].getDebugName(name_id)
    if isinstance(value, str) and value.strip():
        return value.strip()
    return fallback


source_path = Path(sys.argv[1]).expanduser().resolve()
output_dir = Path(sys.argv[2]).expanduser().resolve()
output_dir.mkdir(parents=True, exist_ok=True)

collection = TTCollection(str(source_path))
faces = []

for index, font in enumerate(collection.fonts):
    family = name_value(font, 1, f"Font Family {index + 1}")
    style = name_value(font, 2, "Regular")
    postscript_name = name_value(font, 6, f"{family.replace(' ', '')}-{style.replace(' ', '')}")
    extension = ".otf" if font.sfntVersion == "OTTO" else ".ttf"
    file_path = output_dir / f"{sanitize_filename(postscript_name)}{extension}"
    font.save(str(file_path))
    faces.append(
        {
            "family": family,
            "style": style,
            "postscriptName": postscript_name,
            "filePath": str(file_path),
        }
    )

print(json.dumps({"faces": faces}))
