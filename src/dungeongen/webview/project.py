"""Validated, versioned Dungeongen project generation and rendering."""

from __future__ import annotations

import hashlib
import json
import math
import random
import re
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any

import skia

from dungeongen import __version__
from dungeongen.layout import (
    Door as LayoutDoor,
    DoorType,
    Dungeon,
    DungeonArchetype,
    DungeonGenerator,
    DungeonSize,
    DungeonValidator,
    Exit as LayoutExit,
    ExitType,
    GenerationParams,
    Passage as LayoutPassage,
    PassageStyle,
    Room as LayoutRoom,
    RoomShape,
    Stair as LayoutStair,
    StairDirection,
    SymmetryType,
)
from dungeongen.constants import CELL_SIZE
from dungeongen.graphics.shapes import Circle, Rectangle
from dungeongen.fonts import get_number_typeface
from dungeongen.options import Options

from .adapter import convert_dungeon
from .editing import (
    MAX_STRUCTURE_REVISION,
    apply_structure_operation,
    initialize_structure,
    normalize_structure,
    structure_floor_from_layout,
)
from .project_types import ProjectValidationError

PROJECT_FORMAT_VERSION = 1
MAX_PROJECT_BYTES = 8 * 1024 * 1024
MAX_SEED = 2**31 - 1
EditTimingCallback = Callable[[str, float], None]

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


@contextmanager
def _timed_edit_stage(
    timing: EditTimingCallback | None,
    stage: str,
) -> Iterator[None]:
    if timing is None:
        yield
        return
    started_at = time.perf_counter()
    try:
        yield
    finally:
        timing(stage, (time.perf_counter() - started_at) * 1000)


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
        "clientRevision": 0,
        "generatorVersion": __version__,
        "parameters": normalize_parameters({}, choose_seed=False),
        "appearance": normalize_appearance({}),
        "renderSvg": None,
        "layout": None,
        "structure": None,
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
    client_revision = value.get("clientRevision", 0)
    if (
        isinstance(client_revision, bool)
        or not isinstance(client_revision, int)
        or client_revision < 0
        or client_revision > MAX_STRUCTURE_REVISION
    ):
        raise ProjectValidationError("invalidProject")
    project["clientRevision"] = client_revision
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
    project["structure"] = normalize_structure(value.get("structure"), layout)
    project["stats"] = stats
    project["generatedAt"] = value.get("generatedAt") if isinstance(value.get("generatedAt"), str) else None
    project["generatorVersion"] = (
        value.get("generatorVersion")
        if isinstance(value.get("generatorVersion"), str)
        else __version__
    )
    return project


def project_bytes(
    project: dict[str, Any],
    timing: EditTimingCallback | None = None,
    *,
    normalize: bool = True,
) -> bytes:
    with _timed_edit_stage(timing, "project_validation"):
        normalized = normalize_project(project) if normalize else project
    with _timed_edit_stage(timing, "project_serialization"):
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
        "seed": dungeon.seed,
        "waterSeed": dungeon.water_seed,
        "propsSeed": dungeon.props_seed,
        "spineStartRoomId": dungeon.spine_start_room,
        "spineDirection": dungeon.spine_direction,
        "mirrorPairs": dict(dungeon.mirror_pairs),
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
    *,
    show_numbers: bool | None = None,
    skip_decoration_room_ids: set[str] | None = None,
    use_persisted_objects: bool = False,
):
    return convert_dungeon(
        dungeon,
        water_depth=0 if use_persisted_objects else WATER_DEPTH_MAP[parameters["water"]],
        water_scale=0.018,
        water_res=0.2,
        water_stroke=3.5,
        water_ripple=8.0,
        show_numbers=parameters["showNumbers"] if show_numbers is None else show_numbers,
        options=_render_options(appearance),
        skip_decoration_room_ids=skip_decoration_room_ids,
        decorate_rooms=not use_persisted_objects,
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


def _layout_dungeon(layout: dict[str, Any], parameters: dict[str, Any]) -> Dungeon:
    dungeon = Dungeon(
        seed=int(layout.get("seed", parameters.get("seed") or 0)),
        water_seed=int(layout.get("waterSeed", layout.get("seed", parameters.get("seed") or 0))),
        props_seed=int(layout.get("propsSeed", layout.get("seed", parameters.get("seed") or 0))),
        spine_start_room=layout.get("spineStartRoomId") if isinstance(layout.get("spineStartRoomId"), str) else None,
        spine_direction=layout.get("spineDirection") if layout.get("spineDirection") in ("north", "south", "east", "west") else "south",
        mirror_pairs={
            str(key): str(value)
            for key, value in (layout.get("mirrorPairs") if isinstance(layout.get("mirrorPairs"), dict) else {}).items()
        },
    )
    room_shapes = {name.lower(): member for name, member in RoomShape.__members__.items()}
    passage_styles = {name.lower(): member for name, member in PassageStyle.__members__.items()}
    door_types = {name.lower(): member for name, member in DoorType.__members__.items()}
    stair_types = {name.lower(): member for name, member in StairDirection.__members__.items()}
    exit_types = {name.lower(): member for name, member in ExitType.__members__.items()}
    for value in layout.get("rooms", []):
        room = LayoutRoom(
            x=int(value["x"]), y=int(value["y"]), width=int(value["width"]), height=int(value["height"]),
            shape=room_shapes.get(str(value.get("shape", "rect")), RoomShape.RECT),
            id=str(value["id"]), tags=[str(tag) for tag in value.get("tags", [])], number=int(value.get("number", 0)),
        )
        dungeon.rooms[room.id] = room
    for value in layout.get("passages", []):
        passage = LayoutPassage(
            start_room=str(value.get("startRoomId", "")), end_room=str(value.get("endRoomId", "")),
            waypoints=[(int(point[0]), int(point[1])) for point in value.get("waypoints", [])],
            width=int(value.get("width", 1)),
            style=passage_styles.get(str(value.get("style", "l_bend")), PassageStyle.L_BEND),
            id=str(value["id"]),
        )
        dungeon.passages[passage.id] = passage
    for value in layout.get("doors", []):
        if value.get("manual") is True:
            continue
        door = LayoutDoor(
            x=int(value["x"]), y=int(value["y"]), direction=str(value.get("direction", "north")),
            door_type=door_types.get(str(value.get("type", "closed")), DoorType.CLOSED),
            room_id=str(value.get("roomId", "")), passage_id=str(value.get("passageId", "")), id=str(value["id"]),
        )
        dungeon.doors[door.id] = door
    for value in layout.get("stairs", []):
        if value.get("manual") is True:
            continue
        stair = LayoutStair(
            x=int(value["x"]), y=int(value["y"]), direction=str(value.get("direction", "north")),
            stair_dir=stair_types.get(str(value.get("type", "down")), StairDirection.DOWN),
            passage_id=str(value.get("passageId", "")), id=str(value["id"]),
        )
        dungeon.stairs[stair.id] = stair
    for value in layout.get("exits", []):
        if value.get("manual") is True:
            continue
        exit_point = LayoutExit(
            x=int(value["x"]), y=int(value["y"]), direction=str(value.get("direction", "north")),
            exit_type=exit_types.get(str(value.get("type", "entrance")), ExitType.ENTRANCE),
            room_id=str(value.get("roomId", "")), is_main=value.get("main") is True, id=str(value["id"]),
        )
        dungeon.exits[exit_point.id] = exit_point
    return dungeon


def _structure_cells(structure: dict[str, Any]) -> set[tuple[int, int]]:
    return {(int(cell[0]), int(cell[1])) for cell in structure["floorCells"]}


def _round_area_cells(area: dict[str, Any], bounds: tuple[int, int, int, int]) -> set[tuple[int, int]]:
    x, y, diameter = int(area["x"]), int(area["y"]), int(area["diameter"])
    center_x, center_y, radius = x + diameter / 2, y + diameter / 2, diameter / 2
    return {
        (cell_x, cell_y)
        for cell_y in range(max(y, bounds[1]), min(y + diameter, bounds[3]))
        for cell_x in range(max(x, bounds[0]), min(x + diameter, bounds[2]))
        if (cell_x + 0.5 - center_x) ** 2 + (cell_y + 0.5 - center_y) ** 2 <= radius**2
    }


def _cells_to_rectangles(cells: set[tuple[int, int]]) -> list[tuple[int, int, int, int]]:
    """Cover cells exactly with horizontal runs merged across identical rows."""
    rows: dict[int, list[int]] = {}
    for x, y in cells:
        rows.setdefault(y, []).append(x)

    rectangles: list[tuple[int, int, int, int]] = []
    active: dict[tuple[int, int], tuple[int, int]] = {}
    previous_y: int | None = None
    for y in sorted(rows):
        if previous_y is not None and y != previous_y + 1:
            rectangles.extend(
                (start_x, start_y, end_x - start_x + 1, height)
                for (start_x, end_x), (start_y, height) in active.items()
            )
            active = {}

        spans: list[tuple[int, int]] = []
        sorted_x = sorted(set(rows[y]))
        if sorted_x:
            start_x = end_x = sorted_x[0]
            for x in sorted_x[1:]:
                if x == end_x + 1:
                    end_x = x
                else:
                    spans.append((start_x, end_x))
                    start_x = end_x = x
            spans.append((start_x, end_x))

        current = set(spans)
        for span, (start_y, height) in active.items():
            if span not in current:
                rectangles.append((span[0], start_y, span[1] - span[0] + 1, height))
        active = {
            span: (active[span][0], active[span][1] + 1) if span in active else (y, 1)
            for span in spans
        }
        previous_y = y

    rectangles.extend(
        (start_x, start_y, end_x - start_x + 1, height)
        for (start_x, end_x), (start_y, height) in active.items()
    )
    return rectangles


def _cell_rectangles(
    cells: set[tuple[int, int]],
    map_bounds: tuple[int, int, int, int],
    inflate: float = 0,
) -> list[Rectangle]:
    return [
        Rectangle(
            (x - map_bounds[0]) * CELL_SIZE,
            (y - map_bounds[1]) * CELL_SIZE,
            width * CELL_SIZE,
            height * CELL_SIZE,
            inflate,
        )
        for x, y, width, height in _cells_to_rectangles(cells)
    ]


def _apply_structure_shapes(dungeon_map: Any, project: dict[str, Any]) -> None:
    structure = project["structure"]
    layout = project["layout"]
    floor = _structure_cells(structure)
    base_floor = structure_floor_from_layout(layout)
    map_bounds = tuple(structure["mapBounds"])
    edit_bounds = tuple(structure["bounds"])
    round_cells: set[tuple[int, int]] = set()
    round_excluded_cells: set[tuple[int, int]] = set()
    includes = []
    excludes = []
    for area in structure["roundAreas"]:
        area_cells = _round_area_cells(area, edit_bounds)
        if not (area_cells & floor):
            continue
        round_cells.update(area_cells)
        includes.append(Circle(
            (int(area["x"]) - map_bounds[0] + int(area["diameter"]) / 2) * CELL_SIZE,
            (int(area["y"]) - map_bounds[1] + int(area["diameter"]) / 2) * CELL_SIZE,
            int(area["diameter"]) * CELL_SIZE / 2,
        ))
        round_excluded_cells.update(area_cells - floor)
    includes.extend(_cell_rectangles((floor - base_floor) - round_cells, map_bounds))
    excludes.extend(_cell_rectangles(round_excluded_cells, map_bounds, CELL_SIZE * 0.025))
    excludes.extend(_cell_rectangles(base_floor - floor, map_bounds, CELL_SIZE * 0.025))
    dungeon_map.set_region_shape_edits(includes, excludes)


def _draw_structure_numbers(canvas: Any, project: dict[str, Any], transform: Any, appearance: dict[str, str]) -> None:
    if not project["parameters"]["showNumbers"]:
        return
    structure = project["structure"]
    map_bounds = tuple(structure["mapBounds"])
    paint = skia.Paint(Color=_argb(appearance["numbers"], 180), AntiAlias=True)
    font = skia.Font(get_number_typeface(), CELL_SIZE / 2)
    canvas.save()
    canvas.concat(transform)
    for room in structure["rooms"]:
        if room["suppressed"] or room["number"] <= 0 or not room["cells"]:
            continue
        cells = [(int(cell[0]), int(cell[1])) for cell in room["cells"]]
        center_x = room["x"] + room["width"] / 2
        center_y = room["y"] + room["height"] / 2
        anchor = min(cells, key=lambda cell: (cell[0] + 0.5 - center_x) ** 2 + (cell[1] + 0.5 - center_y) ** 2)
        text = str(room["number"])
        x = (anchor[0] - map_bounds[0] + 0.5) * CELL_SIZE
        y = (anchor[1] - map_bounds[1] + 0.5) * CELL_SIZE
        canvas.drawString(text, x - font.measureText(text) / 2, y + font.getSize() / 3, font, paint)
    canvas.restore()


def _point_in_contour(point: tuple[float, float], contour: list[tuple[float, float]]) -> bool:
    x, y = point
    inside = False
    previous = contour[-1] if contour else (0.0, 0.0)
    for current in contour:
        if (current[1] > y) != (previous[1] > y):
            crossing_x = (previous[0] - current[0]) * (y - current[1]) / (previous[1] - current[1]) + current[0]
            if x < crossing_x:
                inside = not inside
        previous = current
    return inside


def _prop_descriptor(prop: Any, map_bounds: tuple[int, int, int, int], index: int) -> dict[str, Any] | None:
    from dungeongen.map.props import Altar, Coffin, Column, ColumnType, Dias, Fountain, Rock, StairsProp

    if isinstance(prop, StairsProp):
        return None
    object_type: str
    size: float | None = None
    if isinstance(prop, Coffin):
        object_type = "coffin"
    elif isinstance(prop, Dias):
        object_type = "dais"
    elif isinstance(prop, Altar):
        object_type = "altar"
    elif isinstance(prop, Fountain):
        object_type = "fountain"
    elif isinstance(prop, Column):
        object_type = "column_square" if prop._column_type == ColumnType.SQUARE else "column_round"
    elif isinstance(prop, Rock):
        size = float(prop._radius / CELL_SIZE)
        object_type = "rock_small" if size <= 0.1 else "rock_medium" if size <= 1 / 6 else "rock_large"
    else:
        return None

    centered = object_type in (
        "fountain", "column_round", "column_square", "rock_small", "rock_medium", "rock_large"
    )
    anchor = prop.bounds.center if centered else (prop.grid_bounds.p1 if prop.grid_bounds else prop.bounds.p1)
    x = anchor[0] / CELL_SIZE + map_bounds[0]
    y = anchor[1] / CELL_SIZE + map_bounds[1]
    if prop.grid_bounds:
        left = math.floor(prop.grid_bounds.left / CELL_SIZE + map_bounds[0] + 1e-6)
        top = math.floor(prop.grid_bounds.top / CELL_SIZE + map_bounds[1] + 1e-6)
        width = max(1, round(prop.grid_bounds.width / CELL_SIZE))
        height = max(1, round(prop.grid_bounds.height / CELL_SIZE))
        cells = [[cell_x, cell_y] for cell_y in range(top, top + height) for cell_x in range(left, left + width)]
    else:
        cells = [[math.floor(x), math.floor(y)]]
    rotation = int(round(prop.rotation.degrees / 90)) % 4
    signature = f"{object_type}:{x:.4f}:{y:.4f}:{rotation}:{index}"
    descriptor: dict[str, Any] = {
        "id": f"generated-{hashlib.sha256(signature.encode('utf-8')).hexdigest()[:12]}",
        "type": object_type,
        "x": round(x, 4),
        "y": round(y, 4),
        "rotation": rotation,
        "source": "generated",
        "cells": cells,
    }
    if size is not None:
        descriptor["size"] = round(size, 4)
        descriptor["shape"] = [
            [round(float(point[0]) / CELL_SIZE, 6), round(float(point[1]) / CELL_SIZE, 6)]
            for point in prop._control_points
        ]
    return descriptor


def materialize_project_objects(project: dict[str, Any]) -> None:
    """Freeze generated props and water into editable project descriptors."""
    structure = project["structure"]
    if structure.get("objectsInitialized"):
        return
    dungeon = _layout_dungeon(project["layout"], project["parameters"])
    dungeon_map = _render_map(dungeon, project["parameters"], TEMPLATE_APPEARANCE, show_numbers=False)
    map_bounds = tuple(structure["mapBounds"])
    descriptors: list[dict[str, Any]] = []
    for element in dungeon_map.elements:
        for prop in element.props:
            descriptor = _prop_descriptor(prop, map_bounds, len(descriptors))
            if descriptor is not None:
                descriptors.append(descriptor)

    water_cells: list[list[int]] = []
    water_layer = dungeon_map.water_layer
    if water_layer and water_layer.shapes:
        floor = _structure_cells(structure)
        for cell in floor:
            point = (
                (cell[0] - map_bounds[0] + 0.5) * CELL_SIZE - dungeon_map.bounds.x,
                (cell[1] - map_bounds[1] + 0.5) * CELL_SIZE - dungeon_map.bounds.y,
            )
            for shape in water_layer.shapes:
                if _point_in_contour(point, shape.outer) and not any(
                    _point_in_contour(point, island) for island in shape.islands
                ):
                    water_cells.append([cell[0], cell[1]])
                    break
    structure["objects"] = descriptors
    structure["waterCells"] = water_cells
    structure["objectsInitialized"] = True



def _make_persisted_prop(item: dict[str, Any], map_bounds: tuple[int, int, int, int]) -> Any:
    from dungeongen.graphics.rotation import Rotation
    from dungeongen.map.props import Altar, Coffin, Column, ColumnType, Dias, Fountain, Rock

    x = (float(item["x"]) - map_bounds[0]) * CELL_SIZE
    y = (float(item["y"]) - map_bounds[1]) * CELL_SIZE
    rotation = Rotation.from_degrees(int(item.get("rotation", 0)) * 90)
    object_type = item["type"]
    if object_type == "coffin":
        return Coffin((x, y), rotation)
    if object_type == "dais":
        return Dias((x, y), rotation)
    if object_type == "altar":
        return Altar((x, y), rotation)
    if object_type == "fountain":
        return Fountain((x, y), rotation)
    if object_type in ("column_round", "column_square"):
        column_type = ColumnType.SQUARE if object_type == "column_square" else ColumnType.ROUND
        return Column((x, y), column_type, rotation)
    radius = float(item.get("size", {
        "rock_small": 0.08,
        "rock_medium": 0.135,
        "rock_large": 0.21,
    }[object_type])) * CELL_SIZE
    raw_shape = item.get("shape")
    if isinstance(raw_shape, list) and len(raw_shape) == 8:
        rock = Rock((x, y), radius)
        rock._control_points = [
            (float(point[0]) * CELL_SIZE, float(point[1]) * CELL_SIZE)
            for point in raw_shape
        ]
        return rock
    random_state = random.getstate()
    random.seed(int(hashlib.sha256(item["id"].encode("utf-8")).hexdigest()[:8], 16))
    try:
        return Rock((x, y), radius)
    finally:
        random.setstate(random_state)


def _apply_persisted_objects(dungeon_map: Any, project: dict[str, Any]) -> None:
    structure = project["structure"]
    map_bounds = tuple(structure["mapBounds"])
    elements = [element for element in dungeon_map.elements if element.__class__.__name__ != "Exit"]
    for item in structure.get("objects", []):
        prop = _make_persisted_prop(item, map_bounds)
        center = prop.grid_bounds.center if prop.grid_bounds else prop.bounds.center
        container = next((element for element in elements if element.contains_point(*center)), None)
        if container is None and elements:
            container = elements[0]
        if container is not None:
            container.add_prop(prop)

    from dungeongen.graphics.rotation import Rotation
    from dungeongen.map.door import Door, DoorOrientation, DoorType as MapDoorType
    from dungeongen.map.enums import RoomDirection
    from dungeongen.map.exit import Exit as MapExit
    from dungeongen.map.props import StairsProp

    direction_rotations = {
        "north": Rotation.ROT_0,
        "east": Rotation.ROT_90,
        "south": Rotation.ROT_180,
        "west": Rotation.ROT_270,
    }
    room_directions = {
        "north": RoomDirection.NORTH,
        "east": RoomDirection.EAST,
        "south": RoomDirection.SOUTH,
        "west": RoomDirection.WEST,
    }

    def container_at(x: int, y: int) -> Any:
        center_x = (x - map_bounds[0] + 0.5) * CELL_SIZE
        center_y = (y - map_bounds[1] + 0.5) * CELL_SIZE
        return next((element for element in elements if element.contains_point(center_x, center_y)), elements[0] if elements else None)

    for item in project["layout"].get("stairs", []):
        if item.get("manual") is not True:
            continue
        grid_x, grid_y = int(item["x"]) - map_bounds[0], int(item["y"]) - map_bounds[1]
        prop = StairsProp.at_grid(grid_x, grid_y, direction_rotations.get(item.get("direction"), Rotation.ROT_0))
        container = container_at(int(item["x"]), int(item["y"]))
        if container is not None:
            container.add_prop(prop)
    for item in project["layout"].get("doors", []):
        if item.get("manual") is not True:
            continue
        direction = item.get("direction", "north")
        orientation = DoorOrientation.HORIZONTAL if direction in ("east", "west") else DoorOrientation.VERTICAL
        door_type = MapDoorType.OPEN if item.get("type") in ("open", "secret") else MapDoorType.CLOSED
        door = Door.from_grid(int(item["x"]) - map_bounds[0], int(item["y"]) - map_bounds[1], orientation, door_type)
        door._connects_corridor_walls = True
        dungeon_map.add_element(door)
        container = container_at(int(item["x"]), int(item["y"]))
        if container is not None:
            container.connect_to(door)
    for item in project["layout"].get("exits", []):
        if item.get("manual") is not True:
            continue
        exit_element = MapExit.from_grid(
            int(item["x"]) - map_bounds[0],
            int(item["y"]) - map_bounds[1],
            room_directions.get(item.get("direction"), RoomDirection.NORTH),
        )
        dungeon_map.add_element(exit_element)
        container = container_at(int(item["x"]), int(item["y"]))
        if container is not None:
            container.connect_to(exit_element)
    dungeon_map.set_manual_water_cells([
        (int(cell[0]) - map_bounds[0], int(cell[1]) - map_bounds[1])
        for cell in structure.get("waterCells", [])
    ])


def _edited_map(
    project: dict[str, Any],
    appearance: dict[str, str],
    timing: EditTimingCallback | None = None,
):
    if not project["structure"].get("objectsInitialized"):
        materialize_project_objects(project)
    with _timed_edit_stage(timing, "layout_rebuild"):
        dungeon = _layout_dungeon(project["layout"], project["parameters"])
    cleared = set(project["structure"].get("clearedDecorationRoomIds", []))
    with _timed_edit_stage(timing, "map_conversion"):
        dungeon_map = _render_map(
            dungeon, project["parameters"], appearance,
            show_numbers=False, skip_decoration_room_ids=cleared,
            use_persisted_objects=True,
        )
    with _timed_edit_stage(timing, "structure_shapes"):
        _apply_structure_shapes(dungeon_map, project)
        _apply_persisted_objects(dungeon_map, project)
    return dungeon_map


def _project_canvas_dimensions(project: dict[str, Any], grid_size: int = 64, padding: int = 128) -> tuple[int, int]:
    bounds = project["structure"]["mapBounds"]
    width_cells = bounds[2] - bounds[0]
    height_cells = bounds[3] - bounds[1]
    if width_cells <= 0 or height_cells <= 0 or width_cells > 60 or height_cells > 60:
        raise ProjectValidationError("renderBounds")
    return width_cells * grid_size + padding * 2, height_cells * grid_size + padding * 2


def render_project_svg(
    project: dict[str, Any],
    grid_size: int = 64,
    padding: int = 128,
    timing: EditTimingCallback | None = None,
) -> str:
    with _timed_edit_stage(timing, "canvas_dimensions"):
        canvas_width, canvas_height = _project_canvas_dimensions(project, grid_size, padding)
    dungeon_map = _edited_map(project, TEMPLATE_APPEARANCE, timing)
    with _timed_edit_stage(timing, "svg_canvas_setup"):
        stream = skia.DynamicMemoryWStream()
        canvas = skia.SVGCanvas.Make(skia.Rect.MakeWH(canvas_width, canvas_height), stream)
        transform = skia.Matrix()
        transform.setScale(grid_size / CELL_SIZE, grid_size / CELL_SIZE)
        transform.postTranslate(padding, padding)
    with _timed_edit_stage(timing, "map_render"):
        dungeon_map.render(canvas, transform, timing=timing, fast_crosshatch=True)
    with _timed_edit_stage(timing, "room_numbers"):
        _draw_structure_numbers(canvas, project, transform, TEMPLATE_APPEARANCE)
    with _timed_edit_stage(timing, "svg_serialization"):
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


def generate_project(value: Any, *, render_svg: bool = True) -> dict[str, Any]:
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
    layout = _layout_payload(dungeon)
    project = {
        "formatVersion": PROJECT_FORMAT_VERSION,
        "generatorVersion": __version__,
        "parameters": parameters,
        "appearance": normalize_appearance({}),
        "renderSvg": None,
        "layout": layout,
        "structure": initialize_structure(layout),
        "stats": stats,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }
    materialize_project_objects(project)
    if render_svg:
        project["renderSvg"] = render_project_svg(project)
        project["structure"]["renderedFloorCells"] = project["structure"]["floorCells"]
        project["structure"]["renderedRevision"] = project["structure"]["revision"]
    project_bytes(project)
    return project


def edit_project(
    value: Any,
    timing: EditTimingCallback | None = None,
    *,
    validate_size: bool = True,
) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ProjectValidationError("invalidEdit")
    with _timed_edit_stage(timing, "project_normalization"):
        project = normalize_project(value.get("project"))
        if project["layout"] is None or project["structure"] is None:
            raise ProjectValidationError("emptyProject")
    with _timed_edit_stage(timing, "structure_operation"):
        operation = value.get("operation")
        if isinstance(operation, dict) and operation.get("type") == "initializeObjects":
            if not project["structure"].get("objectsInitialized"):
                if project["structure"]["revision"] >= MAX_STRUCTURE_REVISION:
                    raise ProjectValidationError("invalidEdit")
                materialize_project_objects(project)
                project["structure"]["revision"] += 1
            structure, layout = project["structure"], project["layout"]
        else:
            structure, layout = apply_structure_operation(
                project["structure"], project["layout"], operation
            )
    project["structure"] = structure
    project["layout"] = layout
    with _timed_edit_stage(timing, "stats_update"):
        project["stats"] = {
            **(project["stats"] or {}),
            "rooms": sum(1 for room in structure["rooms"] if not room["suppressed"]),
            "doors": len(layout.get("doors", [])),
            "exits": len(layout.get("exits", [])),
        }
    defer_render = value.get("deferRender", False)
    if not isinstance(defer_render, bool):
        raise ProjectValidationError("invalidEdit")
    if not defer_render:
        with _timed_edit_stage(timing, "render_svg_total"):
            project["renderSvg"] = render_project_svg(project, timing=timing)
        project["structure"]["renderedRevision"] = project["structure"]["revision"]
        project["structure"]["renderedFloorCells"] = project["structure"]["floorCells"]
    if validate_size:
        project_bytes(project, timing=timing)
    return project


def checkpoint_project(value: Any, *, validate_size: bool = True) -> dict[str, Any]:
    """Validate a browser working copy without invoking the Skia renderer."""
    if not isinstance(value, dict):
        raise ProjectValidationError("invalidProject")
    project = normalize_project(value.get("project"))
    if project["layout"] is None or project["structure"] is None:
        raise ProjectValidationError("emptyProject")
    project["renderSvg"] = None
    structure = project["structure"]
    layout = project["layout"]
    project["stats"] = {
        **(project["stats"] or {}),
        "rooms": sum(1 for room in structure["rooms"] if not room["suppressed"]),
        "doors": len(layout.get("doors", [])),
        "stairs": len(layout.get("stairs", [])),
        "exits": len(layout.get("exits", [])),
    }
    # The client-first workspace uses floorCells directly. The rendered copy is
    # only an SVG overlay baseline and would duplicate the largest project list
    # in every checkpoint response and durable save.
    structure.pop("renderedFloorCells", None)
    if validate_size:
        project_bytes(project)
    return project


def render_edited_project(
    value: Any,
    timing: EditTimingCallback | None = None,
    *,
    validate_size: bool = True,
) -> dict[str, Any]:
    source = value.get("project") if isinstance(value, dict) and "project" in value else value
    with _timed_edit_stage(timing, "project_normalization"):
        project = normalize_project(source)
        if project["layout"] is None or project["structure"] is None:
            raise ProjectValidationError("emptyProject")
    with _timed_edit_stage(timing, "render_svg_total"):
        project["renderSvg"] = render_project_svg(project, timing=timing)
    project["structure"]["renderedRevision"] = project["structure"]["revision"]
    project["structure"]["renderedFloorCells"] = project["structure"]["floorCells"]
    if validate_size:
        project_bytes(project, timing=timing)
    return project


def render_project_jpeg(value: Any, quality: int = 92) -> bytes:
    project = normalize_project(value)
    if project["layout"] is None or project["structure"] is None:
        raise ProjectValidationError("emptyProject")
    canvas_width, canvas_height = _project_canvas_dimensions(project)
    dungeon_map = _edited_map(project, project["appearance"])
    surface = skia.Surface(canvas_width, canvas_height)
    canvas = surface.getCanvas()
    transform = skia.Matrix()
    transform.setScale(1.0, 1.0)
    transform.postTranslate(128, 128)
    dungeon_map.render(canvas, transform)
    _draw_structure_numbers(canvas, project, transform, project["appearance"])
    data = surface.makeImageSnapshot().encodeToData(skia.kJPEG, quality)
    if data is None:
        raise RuntimeError("jpegEncodingFailed")
    return bytes(data)
