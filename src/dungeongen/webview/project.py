"""Validated, versioned Dungeongen project generation and rendering."""

from __future__ import annotations

import hashlib
import json
import random
import re
from datetime import datetime, timezone
from typing import Any

import skia

from dungeongen import __version__
from dungeongen.layout import (
    Dungeon,
    DungeonArchetype,
    DungeonGenerator,
    DungeonSize,
    DungeonValidator,
    GenerationParams,
    SymmetryType,
)
from dungeongen.options import Options

from .adapter import convert_dungeon

PROJECT_FORMAT_VERSION = 1
MAX_PROJECT_BYTES = 8 * 1024 * 1024
MAX_SEED = 2**31 - 1

DEFAULT_PARAMETERS: dict[str, Any] = {
    "size": "medium",
    "symmetry": "bilateral",
    "cross": "med",
    "pack": "normal",
    "roomSize": "mixed",
    "roundRooms": False,
    "halls": True,
    "water": "dry",
    "showNumbers": True,
    "seed": None,
}

DEFAULT_APPEARANCE: dict[str, str] = {
    "background": "#ffffff",
    "shading": "#d0d2d5",
    "floor": "#ffffff",
    "shadow": "#d0d0d0",
    "walls": "#000000",
    "hatching": "#000000",
    "grid": "#202020",
    "water": "#505050",
    "numbers": "#000000",
}

TEMPLATE_APPEARANCE: dict[str, str] = {
    "background": "#f10101",
    "shading": "#f20202",
    "floor": "#f30303",
    "shadow": "#f40404",
    "walls": "#f50505",
    "hatching": "#f60606",
    "grid": "#f70707",
    "water": "#f80808",
    "numbers": "#f90909",
}

HEX_COLOR_PATTERN = re.compile(r"^#[0-9a-fA-F]{6}$")

ENUM_OPTIONS = {
    "size": frozenset(("tiny", "small", "medium", "large", "xlarge")),
    "symmetry": frozenset(("none", "bilateral")),
    "cross": frozenset(("none", "low", "med", "high")),
    "pack": frozenset(("sparse", "normal", "tight")),
    "roomSize": frozenset(("cozy", "mixed", "grand")),
    "water": frozenset(("dry", "puddles", "pools", "lakes", "flooded")),
}

SIZE_MAP = {
    "tiny": DungeonSize.TINY,
    "small": DungeonSize.SMALL,
    "medium": DungeonSize.MEDIUM,
    "large": DungeonSize.LARGE,
    "xlarge": DungeonSize.XLARGE,
}

SYMMETRY_MAP = {
    "none": SymmetryType.NONE,
    "bilateral": SymmetryType.BILATERAL,
}

WATER_DEPTH_MAP = {
    "dry": 0.0,
    "puddles": 0.75,
    "pools": 0.60,
    "lakes": 0.45,
    "flooded": 0.30,
}


class ProjectValidationError(ValueError):
    """Raised when untrusted project or generation input is invalid."""


def _stable_seed(value: Any) -> int:
    if value is None or value == "":
        return random.SystemRandom().randint(0, MAX_SEED)
    if isinstance(value, bool):
        raise ProjectValidationError("invalidSeed")
    if isinstance(value, int):
        if 0 <= value <= MAX_SEED:
            return value
        raise ProjectValidationError("invalidSeed")
    if isinstance(value, str):
        normalized = value.strip()
        if not normalized or len(normalized) > 128:
            raise ProjectValidationError("invalidSeed")
        try:
            numeric = int(normalized, 10)
        except ValueError:
            digest = hashlib.sha256(normalized.encode("utf-8")).digest()
            return int.from_bytes(digest[:4], "big") & MAX_SEED
        if 0 <= numeric <= MAX_SEED:
            return numeric
    raise ProjectValidationError("invalidSeed")


def normalize_parameters(value: Any, *, choose_seed: bool = True) -> dict[str, Any]:
    if value is None:
        value = {}
    if not isinstance(value, dict):
        raise ProjectValidationError("invalidProject")

    normalized = dict(DEFAULT_PARAMETERS)
    for key, allowed in ENUM_OPTIONS.items():
        candidate = value.get(key, normalized[key])
        if not isinstance(candidate, str) or candidate not in allowed:
            raise ProjectValidationError("invalidProject")
        normalized[key] = candidate

    for key in ("roundRooms", "halls", "showNumbers"):
        candidate = value.get(key, normalized[key])
        if not isinstance(candidate, bool):
            raise ProjectValidationError("invalidProject")
        normalized[key] = candidate

    seed = value.get("seed", normalized["seed"])
    normalized["seed"] = _stable_seed(seed) if choose_seed else seed
    return normalized


def normalize_appearance(value: Any) -> dict[str, str]:
    if value is None:
        value = {}
    if not isinstance(value, dict):
        raise ProjectValidationError("invalidProject")
    normalized = dict(DEFAULT_APPEARANCE)
    for key, default in DEFAULT_APPEARANCE.items():
        candidate = value.get(key, default)
        if not isinstance(candidate, str) or not HEX_COLOR_PATTERN.fullmatch(candidate):
            raise ProjectValidationError("invalidProject")
        normalized[key] = candidate.lower()
    return normalized


def default_project() -> dict[str, Any]:
    return {
        "formatVersion": PROJECT_FORMAT_VERSION,
        "generatorVersion": __version__,
        "parameters": normalize_parameters({}, choose_seed=False),
        "appearance": normalize_appearance({}),
        "renderSvg": None,
        "layout": None,
        "stats": None,
        "generatedAt": None,
    }


def parse_project_bytes(value: bytes) -> dict[str, Any]:
    if not value or len(value) > MAX_PROJECT_BYTES:
        raise ProjectValidationError("invalidProject")
    try:
        project = json.loads(value.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ProjectValidationError("invalidProject") from error
    return normalize_project(project)


def normalize_project(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("formatVersion") != PROJECT_FORMAT_VERSION:
        raise ProjectValidationError("invalidProject")
    project = default_project()
    project["parameters"] = normalize_parameters(value.get("parameters"), choose_seed=False)
    project["appearance"] = normalize_appearance(value.get("appearance"))

    render_svg = value.get("renderSvg")
    if render_svg is not None:
        if (
            not isinstance(render_svg, str)
            or len(render_svg.encode("utf-8")) > MAX_PROJECT_BYTES
            or "<svg" not in render_svg[:512].lower()
        ):
            raise ProjectValidationError("invalidProject")
        project["renderSvg"] = render_svg

    layout = value.get("layout")
    stats = value.get("stats")
    if layout is not None and not isinstance(layout, dict):
        raise ProjectValidationError("invalidProject")
    if stats is not None and not isinstance(stats, dict):
        raise ProjectValidationError("invalidProject")
    project["layout"] = layout
    project["stats"] = stats
    project["generatedAt"] = value.get("generatedAt") if isinstance(value.get("generatedAt"), str) else None
    project["generatorVersion"] = (
        value.get("generatorVersion")
        if isinstance(value.get("generatorVersion"), str)
        else __version__
    )
    return project


def project_bytes(project: dict[str, Any]) -> bytes:
    normalized = normalize_project(project)
    encoded = json.dumps(normalized, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > MAX_PROJECT_BYTES:
        raise ProjectValidationError("projectTooLarge")
    return encoded


def _generation_params(parameters: dict[str, Any]) -> tuple[GenerationParams, float]:
    params = GenerationParams()
    params.size = SIZE_MAP[parameters["size"]]
    params.archetype = DungeonArchetype.CLASSIC
    params.symmetry = SYMMETRY_MAP[parameters["symmetry"]]

    params.density = {"sparse": 0.2, "normal": 0.5, "tight": 0.8}[parameters["pack"]]
    params.room_size_bias = {"cozy": -1.0, "mixed": 0.0, "grand": 0.8}[parameters["roomSize"]]
    params.round_room_chance = 0.3 if parameters["roundRooms"] else 0.05
    params.hall_chance = 0.15 if parameters["halls"] else 0.0

    cross = parameters["cross"]
    params.loop_factor, params.extra_room_connections, params.extra_passage_junctions = {
        "none": (0.0, 0.0, 0.0),
        "low": (0.15, 0.1, 0.05),
        "med": (0.3, 0.2, 0.15),
        "high": (0.5, 0.4, 0.3),
    }[cross]
    params.passage_width = 1
    params.symmetry_break = 0.2

    water_depth = WATER_DEPTH_MAP[parameters["water"]]
    params.water_enabled = water_depth > 0
    params.water_threshold = water_depth
    return params, water_depth


def _enum_name(value: Any) -> str:
    return value.name.lower() if hasattr(value, "name") else str(value)


def _layout_payload(dungeon: Dungeon) -> dict[str, Any]:
    return {
        "bounds": list(dungeon.bounds),
        "rooms": [
            {
                "id": room.id,
                "x": room.x,
                "y": room.y,
                "width": room.width,
                "height": room.height,
                "shape": _enum_name(room.shape),
                "number": room.number,
                "tags": list(room.tags),
            }
            for room in dungeon.rooms.values()
        ],
        "passages": [
            {
                "id": passage.id,
                "startRoomId": passage.start_room,
                "endRoomId": passage.end_room,
                "waypoints": [list(point) for point in passage.waypoints],
                "width": passage.width,
                "style": _enum_name(passage.style),
            }
            for passage in dungeon.passages.values()
        ],
        "doors": [
            {
                "id": door.id,
                "x": door.x,
                "y": door.y,
                "direction": door.direction,
                "type": _enum_name(door.door_type),
                "roomId": door.room_id,
                "passageId": door.passage_id,
            }
            for door in dungeon.doors.values()
        ],
        "stairs": [
            {
                "id": stair.id,
                "x": stair.x,
                "y": stair.y,
                "direction": stair.direction,
                "type": _enum_name(stair.stair_dir),
                "passageId": stair.passage_id,
            }
            for stair in dungeon.stairs.values()
        ],
        "exits": [
            {
                "id": exit_point.id,
                "x": exit_point.x,
                "y": exit_point.y,
                "direction": exit_point.direction,
                "type": _enum_name(exit_point.exit_type),
                "roomId": exit_point.room_id,
                "main": exit_point.is_main,
            }
            for exit_point in dungeon.exits.values()
        ],
    }


def _argb(color: str, alpha: int = 255) -> int:
    return (alpha << 24) | int(color[1:], 16)


def _render_options(appearance: dict[str, str]) -> Options:
    options = Options()
    options.crosshatch_background_color = _argb(appearance["background"])
    options.crosshatch_shading_color = _argb(appearance["shading"])
    options.crosshatch_color = _argb(appearance["hatching"])
    options.room_shadow_color = _argb(appearance["shadow"])
    options.room_color = _argb(appearance["floor"])
    options.prop_light_color = _argb(appearance["shadow"])
    options.prop_fill_color = _argb(appearance["floor"])
    options.prop_outline_color = _argb(appearance["walls"])
    options.grid_color = _argb(appearance["grid"])
    options.border_color = _argb(appearance["walls"])
    options.number_color = _argb(appearance["numbers"], 180)
    options.water_fill_color = _argb(appearance["water"], 100)
    options.water_stroke_color = _argb(appearance["water"])
    options.water_ripple_color = _argb(appearance["water"], 200)
    return options


def _render_map(
    dungeon: Dungeon,
    parameters: dict[str, Any],
    appearance: dict[str, str],
):
    return convert_dungeon(
        dungeon,
        water_depth=WATER_DEPTH_MAP[parameters["water"]],
        water_scale=0.018,
        water_res=0.2,
        water_stroke=3.5,
        water_ripple=8.0,
        show_numbers=parameters["showNumbers"],
        options=_render_options(appearance),
    )


def _canvas_dimensions(dungeon: Dungeon, grid_size: int, padding: int) -> tuple[int, int]:
    bounds = dungeon.bounds
    width_cells = bounds[2] - bounds[0]
    height_cells = bounds[3] - bounds[1]
    if width_cells <= 0 or height_cells <= 0 or width_cells > 60 or height_cells > 60:
        raise ProjectValidationError("renderBounds")
    return width_cells * grid_size + padding * 2, height_cells * grid_size + padding * 2


def _render_svg(dungeon: Dungeon, parameters: dict[str, Any], grid_size: int = 64, padding: int = 128) -> str:
    canvas_width, canvas_height = _canvas_dimensions(dungeon, grid_size, padding)
    dungeon_map = _render_map(dungeon, parameters, TEMPLATE_APPEARANCE)
    stream = skia.DynamicMemoryWStream()
    canvas = skia.SVGCanvas.Make(skia.Rect.MakeWH(canvas_width, canvas_height), stream)
    transform = skia.Matrix()
    transform.setScale(grid_size / 64, grid_size / 64)
    transform.postTranslate(padding, padding)
    dungeon_map.render(canvas, transform)
    del canvas
    return stream.detachAsData().bytes().decode("utf-8")


def _generate_dungeon(parameters: dict[str, Any]) -> tuple[Dungeon, list[Any], str]:
    params, _ = _generation_params(parameters)
    generator = DungeonGenerator(params)
    dungeon = generator.generate(seed=parameters["seed"])
    violations: list[Any] = []
    validation = ""
    if parameters["pack"] != "tight":
        validator = DungeonValidator(dungeon)
        violations = validator.validate()
        validation = validator.summary()
    return dungeon, violations, validation


def generate_project(value: Any) -> dict[str, Any]:
    source = value.get("parameters") if isinstance(value, dict) and "parameters" in value else value
    parameters = normalize_parameters(source, choose_seed=True)
    dungeon, violations, validation = _generate_dungeon(parameters)
    stats = {
        "rooms": len(dungeon.rooms),
        "passages": len(dungeon.passages),
        "doors": len(dungeon.doors),
        "stairs": len(dungeon.stairs),
        "exits": len(dungeon.exits),
        "violations": len(violations),
        "validation": validation,
    }
    project = {
        "formatVersion": PROJECT_FORMAT_VERSION,
        "generatorVersion": __version__,
        "parameters": parameters,
        "appearance": normalize_appearance({}),
        "renderSvg": _render_svg(dungeon, parameters),
        "layout": _layout_payload(dungeon),
        "stats": stats,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }
    project_bytes(project)
    return project


def render_project_jpeg(value: Any, quality: int = 92) -> bytes:
    project = normalize_project(value)
    parameters = normalize_parameters(project["parameters"], choose_seed=True)
    dungeon, _, _ = _generate_dungeon(parameters)
    canvas_width, canvas_height = _canvas_dimensions(dungeon, 64, 128)
    dungeon_map = _render_map(dungeon, parameters, project["appearance"])
    surface = skia.Surface(canvas_width, canvas_height)
    canvas = surface.getCanvas()
    transform = skia.Matrix()
    transform.setScale(1.0, 1.0)
    transform.postTranslate(128, 128)
    dungeon_map.render(canvas, transform)
    data = surface.makeImageSnapshot().encodeToData(skia.kJPEG, quality)
    if data is None:
        raise RuntimeError("jpegEncodingFailed")
    return bytes(data)
