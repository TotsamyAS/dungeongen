"""Bundled typefaces used by rendering paths without system Fontconfig."""

from functools import lru_cache
from pathlib import Path

import skia


@lru_cache(maxsize=1)
def get_number_typeface() -> skia.Typeface:
    """Load room-number typeface from package data."""
    font_path = Path(__file__).with_name("data") / "fonts" / "RobotoCondensed-Regular.ttf"
    if not font_path.is_file():
        raise FileNotFoundError(f"Font file not found: {font_path}")
    typeface = skia.Typeface.MakeFromFile(str(font_path))
    if typeface is None:
        raise RuntimeError(f"Failed to load font from: {font_path}")
    return typeface
