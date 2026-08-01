"""Validated cell-edit state and operations for Dungeongen projects."""

from __future__ import annotations

import uuid
from collections import deque
from typing import Any, Iterable

from .project_types import ProjectValidationError

Cell = tuple[int, int]

STRUCTURE_VERSION = 1
EDIT_MARGIN_CELLS = 2
MAX_EDIT_DIMENSION = 64
MAX_ROOMS = 512
MAX_DUNGEON_OBJECTS = 2048
MAX_STRUCTURE_REVISION = 2**31 - 1
ROOM_MIN_SPAN = 4
ROOM_KINDS = frozenset(("generated", "round", "auto", "merged"))
PROP_OBJECT_TYPES = frozenset((
    "coffin", "dais", "altar", "fountain", "column_round", "column_square",
    "rock_small", "rock_medium", "rock_large",
))
LAYOUT_OBJECT_TYPES = {
    "door_open": ("doors", "open"),
    "door_closed": ("doors", "closed"),
    "door_locked": ("doors", "locked"),
    "door_secret": ("doors", "secret"),
    "stairs_up": ("stairs", "up"),
    "stairs_down": ("stairs", "down"),
    "entrance": ("exits", "entrance"),
    "exit": ("exits", "exit"),
}
ROTATION_DIRECTIONS = ("north", "east", "south", "west")


def _cell_list(cells: Iterable[Cell]) -> list[list[int]]:
    return [[x, y] for x, y in sorted(set(cells), key=lambda cell: (cell[1], cell[0]))]


def _read_cell(value: Any, bounds: tuple[int, int, int, int]) -> Cell:
    if (
        not isinstance(value, list)
        or len(value) != 2
        or isinstance(value[0], bool)
        or isinstance(value[1], bool)
        or not isinstance(value[0], int)
        or not isinstance(value[1], int)
    ):
        raise ProjectValidationError("invalidEdit")
    cell = (value[0], value[1])
    if not (bounds[0] <= cell[0] < bounds[2] and bounds[1] <= cell[1] < bounds[3]):
        raise ProjectValidationError("invalidEdit")
    return cell


def _room_geometry_cells(room: dict[str, Any], bounds: tuple[int, int, int, int]) -> set[Cell]:
    x = int(room.get("x", 0))
    y = int(room.get("y", 0))
    width = int(room.get("width", 0))
    height = int(room.get("height", 0))
    if width <= 0 or height <= 0:
        return set()
    cells: set[Cell] = set()
    if room.get("shape") == "circle":
        cx = x + width / 2
        cy = y + height / 2
        radius = width / 2
        for cell_y in range(y, y + height):
            for cell_x in range(x, x + width):
                if (cell_x + 0.5 - cx) ** 2 + (cell_y + 0.5 - cy) ** 2 <= radius**2:
                    cells.add((cell_x, cell_y))
    else:
        cells.update((cell_x, cell_y) for cell_y in range(y, y + height) for cell_x in range(x, x + width))
    return {
        cell
        for cell in cells
        if bounds[0] <= cell[0] < bounds[2] and bounds[1] <= cell[1] < bounds[3]
    }


def _expand_path(waypoints: Any) -> set[Cell]:
    if not isinstance(waypoints, list) or not waypoints:
        return set()
    points: list[Cell] = []
    for value in waypoints:
        if (
            not isinstance(value, list)
            or len(value) != 2
            or not isinstance(value[0], (int, float))
            or not isinstance(value[1], (int, float))
        ):
            continue
        points.append((int(value[0]), int(value[1])))
    if not points:
        return set()
    cells = {points[0]}
    for start, end in zip(points, points[1:]):
        x, y = start
        dx = 1 if end[0] > x else -1 if end[0] < x else 0
        dy = 1 if end[1] > y else -1 if end[1] < y else 0
        while (x, y) != end:
            x += dx
            y += dy
            cells.add((x, y))
    return cells


def structure_floor_from_layout(layout: dict[str, Any]) -> set[Cell]:
    raw_bounds = layout.get("bounds", [0, 0, 10, 10])
    map_bounds = tuple(int(value) for value in raw_bounds)
    edit_bounds = (
        map_bounds[0] - EDIT_MARGIN_CELLS,
        map_bounds[1] - EDIT_MARGIN_CELLS,
        map_bounds[2] + EDIT_MARGIN_CELLS,
        map_bounds[3] + EDIT_MARGIN_CELLS,
    )
    cells: set[Cell] = set()
    for room in layout.get("rooms", []):
        if isinstance(room, dict):
            cells.update(_room_geometry_cells(room, edit_bounds))
    for passage in layout.get("passages", []):
        if isinstance(passage, dict):
            cells.update(_expand_path(passage.get("waypoints")))
    for collection in ("doors", "stairs", "exits"):
        for element in layout.get(collection, []):
            if isinstance(element, dict) and isinstance(element.get("x"), int) and isinstance(element.get("y"), int):
                cells.add((element["x"], element["y"]))
    return {cell for cell in cells if edit_bounds[0] <= cell[0] < edit_bounds[2] and edit_bounds[1] <= cell[1] < edit_bounds[3]}


def initialize_structure(layout: dict[str, Any]) -> dict[str, Any]:
    raw_bounds = layout.get("bounds", [0, 0, 10, 10])
    map_bounds = [int(value) for value in raw_bounds]
    bounds = [
        map_bounds[0] - EDIT_MARGIN_CELLS,
        map_bounds[1] - EDIT_MARGIN_CELLS,
        map_bounds[2] + EDIT_MARGIN_CELLS,
        map_bounds[3] + EDIT_MARGIN_CELLS,
    ]
    floor = structure_floor_from_layout(layout)
    rooms = []
    used_numbers: set[int] = set()
    for value in layout.get("rooms", []):
        if not isinstance(value, dict):
            continue
        number = int(value.get("number", 0))
        if number > 0:
            used_numbers.add(number)
        descriptor = {
            "id": str(value.get("id", uuid.uuid4().hex[:8])),
            "kind": "generated",
            "shape": "circle" if value.get("shape") == "circle" else "rect",
            "x": int(value.get("x", 0)),
            "y": int(value.get("y", 0)),
            "width": int(value.get("width", 1)),
            "height": int(value.get("height", 1)),
            "number": number,
            "suppressed": False,
            "decorationCleared": False,
        }
        descriptor["cells"] = _cell_list(_room_geometry_cells(descriptor, tuple(bounds)) & floor)
        rooms.append(descriptor)
    return {
        "version": STRUCTURE_VERSION,
        "revision": 0,
        "renderedRevision": 0,
        "bounds": bounds,
        "mapBounds": map_bounds,
        "floorCells": _cell_list(floor),
        "renderedFloorCells": _cell_list(floor),
        "rooms": rooms,
        "roundAreas": [],
        "objectsInitialized": False,
        "objects": [],
        "waterCells": [],
        "clearedDecorationRoomIds": [],
        "nextRoomNumber": _next_free_number(used_numbers),
    }


def _next_free_number(used: set[int]) -> int:
    number = 1
    while number in used:
        number += 1
    return number


def _normalize_bounds(value: Any) -> tuple[int, int, int, int]:
    if (
        not isinstance(value, list)
        or len(value) != 4
        or any(isinstance(item, bool) or not isinstance(item, int) for item in value)
    ):
        raise ProjectValidationError("invalidProject")
    bounds = tuple(value)
    if bounds[2] <= bounds[0] or bounds[3] <= bounds[1]:
        raise ProjectValidationError("invalidProject")
    if bounds[2] - bounds[0] > MAX_EDIT_DIMENSION or bounds[3] - bounds[1] > MAX_EDIT_DIMENSION:
        raise ProjectValidationError("invalidProject")
    return bounds


def normalize_structure(value: Any, layout: Any) -> dict[str, Any] | None:
    if value is None:
        return initialize_structure(layout) if isinstance(layout, dict) else None
    if not isinstance(value, dict) or value.get("version") != STRUCTURE_VERSION:
        raise ProjectValidationError("invalidProject")
    bounds = _normalize_bounds(value.get("bounds"))
    map_bounds = _normalize_bounds(value.get("mapBounds"))
    expected_bounds = (
        map_bounds[0] - EDIT_MARGIN_CELLS,
        map_bounds[1] - EDIT_MARGIN_CELLS,
        map_bounds[2] + EDIT_MARGIN_CELLS,
        map_bounds[3] + EDIT_MARGIN_CELLS,
    )
    if bounds != expected_bounds:
        raise ProjectValidationError("invalidProject")
    if isinstance(layout, dict):
        if _normalize_bounds(layout.get("bounds")) != map_bounds:
            raise ProjectValidationError("invalidProject")
    floor = {_read_cell(cell, bounds) for cell in value.get("floorCells", [])}
    if len(floor) > MAX_EDIT_DIMENSION**2:
        raise ProjectValidationError("invalidProject")
    revision = value.get("revision", 0)
    rendered_revision = value.get("renderedRevision", revision)
    if (
        isinstance(revision, bool)
        or not isinstance(revision, int)
        or revision < 0
        or revision > MAX_STRUCTURE_REVISION
        or isinstance(rendered_revision, bool)
        or not isinstance(rendered_revision, int)
        or rendered_revision < 0
        or rendered_revision > revision
    ):
        raise ProjectValidationError("invalidProject")
    raw_rendered_floor = value.get("renderedFloorCells", value.get("floorCells", []))
    if not isinstance(raw_rendered_floor, list):
        raise ProjectValidationError("invalidProject")
    rendered_floor = {_read_cell(cell, bounds) for cell in raw_rendered_floor}
    if len(rendered_floor) > MAX_EDIT_DIMENSION**2:
        raise ProjectValidationError("invalidProject")
    objects_initialized = value.get("objectsInitialized", False)
    if not isinstance(objects_initialized, bool):
        raise ProjectValidationError("invalidProject")
    raw_objects = value.get("objects", [])
    if not isinstance(raw_objects, list) or len(raw_objects) > MAX_DUNGEON_OBJECTS:
        raise ProjectValidationError("invalidProject")
    objects: list[dict[str, Any]] = []
    object_ids: set[str] = set()
    for raw in raw_objects:
        if not isinstance(raw, dict) or raw.get("type") not in PROP_OBJECT_TYPES:
            raise ProjectValidationError("invalidProject")
        object_id = raw.get("id")
        if not isinstance(object_id, str) or not object_id or len(object_id) > 64 or object_id in object_ids:
            raise ProjectValidationError("invalidProject")
        object_ids.add(object_id)
        x, y = raw.get("x"), raw.get("y")
        rotation = raw.get("rotation", 0)
        if (
            isinstance(x, bool) or not isinstance(x, (int, float))
            or isinstance(y, bool) or not isinstance(y, (int, float))
            or not bounds[0] - 1 <= x <= bounds[2] + 1
            or not bounds[1] - 1 <= y <= bounds[3] + 1
            or isinstance(rotation, bool) or not isinstance(rotation, int) or rotation not in range(4)
        ):
            raise ProjectValidationError("invalidProject")
        raw_cells = raw.get("cells", [])
        if not isinstance(raw_cells, list):
            raise ProjectValidationError("invalidProject")
        object_cells = {_read_cell(cell, bounds) for cell in raw_cells}
        if not object_cells or len(object_cells) > 16:
            raise ProjectValidationError("invalidProject")
        size = raw.get("size")
        if size is not None and (
            isinstance(size, bool) or not isinstance(size, (int, float)) or size <= 0 or size > 2
        ):
            raise ProjectValidationError("invalidProject")
        descriptor = {
            "id": object_id,
            "type": raw["type"],
            "x": round(float(x), 4),
            "y": round(float(y), 4),
            "rotation": rotation,
            "source": "generated" if raw.get("source") == "generated" else "manual",
            "cells": _cell_list(object_cells),
        }
        if size is not None:
            descriptor["size"] = round(float(size), 4)
        objects.append(descriptor)
    raw_water_cells = value.get("waterCells", [])
    if not isinstance(raw_water_cells, list):
        raise ProjectValidationError("invalidProject")
    water_cells = {_read_cell(cell, bounds) for cell in raw_water_cells}
    if len(water_cells) > MAX_EDIT_DIMENSION**2:
        raise ProjectValidationError("invalidProject")
    rooms: list[dict[str, Any]] = []
    raw_rooms = value.get("rooms", [])
    if not isinstance(raw_rooms, list) or len(raw_rooms) > MAX_ROOMS:
        raise ProjectValidationError("invalidProject")
    for raw in raw_rooms:
        if not isinstance(raw, dict) or raw.get("kind") not in ROOM_KINDS:
            raise ProjectValidationError("invalidProject")
        room_id = raw.get("id")
        if not isinstance(room_id, str) or not room_id or len(room_id) > 64:
            raise ProjectValidationError("invalidProject")
        number = raw.get("number", 0)
        if isinstance(number, bool) or not isinstance(number, int) or number < 0 or number > MAX_ROOMS:
            raise ProjectValidationError("invalidProject")
        room = {
            "id": room_id,
            "kind": raw["kind"],
            "shape": "circle" if raw.get("shape") == "circle" else "rect",
            "x": int(raw.get("x", 0)),
            "y": int(raw.get("y", 0)),
            "width": max(1, int(raw.get("width", 1))),
            "height": max(1, int(raw.get("height", 1))),
            "number": number,
            "suppressed": raw.get("suppressed") is True,
            "decorationCleared": raw.get("decorationCleared") is True,
        }
        room["cells"] = _cell_list({_read_cell(cell, bounds) for cell in raw.get("cells", [])} & floor)
        rooms.append(room)
    round_areas: list[dict[str, Any]] = []
    raw_round_areas = value.get("roundAreas", [])
    if not isinstance(raw_round_areas, list) or len(raw_round_areas) > MAX_ROOMS:
        raise ProjectValidationError("invalidProject")
    for raw in raw_round_areas:
        if (
            not isinstance(raw, dict)
            or not isinstance(raw.get("id"), str)
            or not raw["id"]
            or len(raw["id"]) > 64
        ):
            raise ProjectValidationError("invalidProject")
        diameter = raw.get("diameter")
        if isinstance(diameter, bool) or not isinstance(diameter, int) or diameter < 3 or diameter > MAX_EDIT_DIMENSION:
            raise ProjectValidationError("invalidProject")
        round_areas.append({"id": raw["id"], "x": int(raw.get("x", 0)), "y": int(raw.get("y", 0)), "diameter": diameter})
    used = {room["number"] for room in rooms if room["number"] > 0}
    cleared_ids = value.get("clearedDecorationRoomIds", [])
    if (
        not isinstance(cleared_ids, list)
        or any(not isinstance(room_id, str) or len(room_id) > 64 for room_id in cleared_ids)
    ):
        raise ProjectValidationError("invalidProject")
    return {
        "version": STRUCTURE_VERSION,
        "revision": revision,
        "renderedRevision": rendered_revision,
        "bounds": list(bounds),
        "mapBounds": list(map_bounds),
        "floorCells": _cell_list(floor),
        "renderedFloorCells": _cell_list(rendered_floor),
        "rooms": rooms,
        "roundAreas": round_areas,
        "objectsInitialized": objects_initialized,
        "objects": objects,
        "waterCells": _cell_list(water_cells & floor),
        "clearedDecorationRoomIds": sorted(set(cleared_ids)),
        "nextRoomNumber": _next_free_number(used),
    }


def _room_cells(room: dict[str, Any]) -> set[Cell]:
    return {(cell[0], cell[1]) for cell in room.get("cells", [])}


def _components(cells: set[Cell]) -> list[set[Cell]]:
    remaining = set(cells)
    result: list[set[Cell]] = []
    while remaining:
        start = remaining.pop()
        component = {start}
        queue = deque((start,))
        while queue:
            x, y = queue.popleft()
            for neighbor in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if neighbor in remaining:
                    remaining.remove(neighbor)
                    component.add(neighbor)
                    queue.append(neighbor)
        result.append(component)
    return result


def _auto_room_cells(floor: set[Cell], excluded: set[Cell], bounds: tuple[int, int, int, int]) -> list[set[Cell]]:
    eligible = floor - excluded
    qualified: set[Cell] = set()
    for y in range(bounds[1], bounds[3] - ROOM_MIN_SPAN + 1):
        for x in range(bounds[0], bounds[2] - ROOM_MIN_SPAN + 1):
            window = {
                (cell_x, cell_y)
                for cell_y in range(y, y + ROOM_MIN_SPAN)
                for cell_x in range(x, x + ROOM_MIN_SPAN)
            }
            if window <= eligible:
                qualified.update(window)
    return _components(qualified)


def _reclassify(structure: dict[str, Any]) -> None:
    bounds = tuple(structure["bounds"])
    floor = {(cell[0], cell[1]) for cell in structure["floorCells"]}
    explicit: list[dict[str, Any]] = []
    previous_auto: list[dict[str, Any]] = []
    for room in structure["rooms"]:
        if room["kind"] in ("generated", "round"):
            cells = _room_geometry_cells(room, bounds) & floor
        else:
            cells = _room_cells(room) & floor
        if not cells:
            continue
        room["cells"] = _cell_list(cells)
        (previous_auto if room["kind"] == "auto" else explicit).append(room)

    # Explicit rooms with overlapping floor merge; touching edges remain separate.
    merged_explicit: list[dict[str, Any]] = []
    for room in explicit:
        room_cells = _room_cells(room)
        overlaps = [existing for existing in merged_explicit if _room_cells(existing) & room_cells]
        if not overlaps:
            merged_explicit.append(room)
            continue
        target = min(overlaps + [room], key=lambda item: item["number"] or MAX_ROOMS + 1)
        combined_cells = set(room_cells)
        combined_ids = []
        for existing in overlaps:
            combined_cells.update(_room_cells(existing))
            combined_ids.append(existing["id"])
            merged_explicit.remove(existing)
        combined_ids.append(room["id"])
        xs = [cell[0] for cell in combined_cells]
        ys = [cell[1] for cell in combined_cells]
        merged_explicit.append({
            "id": target["id"], "kind": "merged", "shape": "rect",
            "x": min(xs), "y": min(ys), "width": max(xs) - min(xs) + 1, "height": max(ys) - min(ys) + 1,
            "number": min((item["number"] for item in overlaps + [room] if item["number"] > 0), default=0),
            "suppressed": all(item["suppressed"] for item in overlaps + [room]),
            "decorationCleared": True, "cells": _cell_list(combined_cells),
        })

    # A manually created round room also absorbs any auto-detected room it overlaps.
    remaining_auto: list[dict[str, Any]] = []
    for auto_room in previous_auto:
        auto_cells = _room_cells(auto_room)
        overlaps = [room for room in merged_explicit if _room_cells(room) & auto_cells]
        if not overlaps:
            remaining_auto.append(auto_room)
            continue
        combined_cells = set(auto_cells)
        for room in overlaps:
            combined_cells.update(_room_cells(room))
            merged_explicit.remove(room)
        candidates_for_identity = overlaps + [auto_room]
        target = min(candidates_for_identity, key=lambda item: item["number"] or MAX_ROOMS + 1)
        xs = [cell[0] for cell in combined_cells]
        ys = [cell[1] for cell in combined_cells]
        merged_explicit.append({
            "id": target["id"], "kind": "merged", "shape": "rect",
            "x": min(xs), "y": min(ys), "width": max(xs) - min(xs) + 1, "height": max(ys) - min(ys) + 1,
            "number": min((item["number"] for item in candidates_for_identity if item["number"] > 0), default=0),
            "suppressed": all(item["suppressed"] for item in candidates_for_identity),
            "decorationCleared": True, "cells": _cell_list(combined_cells),
        })
    previous_auto = remaining_auto

    explicit_cells = set().union(*(_room_cells(room) for room in merged_explicit)) if merged_explicit else set()
    candidates = _auto_room_cells(floor, explicit_cells, bounds)
    used_previous: set[str] = set()
    used_numbers = {room["number"] for room in merged_explicit if room["number"] > 0}
    auto_rooms: list[dict[str, Any]] = []
    for cells in candidates:
        matches = [room for room in previous_auto if room["id"] not in used_previous and _room_cells(room) & cells]
        previous = max(matches, key=lambda room: len(_room_cells(room) & cells), default=None)
        if previous:
            used_previous.add(previous["id"])
            number = previous["number"]
            room_id = previous["id"]
            suppressed = previous["suppressed"]
        else:
            number = _next_free_number(used_numbers)
            room_id = uuid.uuid4().hex[:8]
            suppressed = False
        used_numbers.add(number)
        xs = [cell[0] for cell in cells]
        ys = [cell[1] for cell in cells]
        auto_rooms.append({
            "id": room_id, "kind": "auto", "shape": "rect",
            "x": min(xs), "y": min(ys), "width": max(xs) - min(xs) + 1, "height": max(ys) - min(ys) + 1,
            "number": number, "suppressed": suppressed, "decorationCleared": True, "cells": _cell_list(cells),
        })
    structure["rooms"] = merged_explicit + auto_rooms
    structure["nextRoomNumber"] = _next_free_number({room["number"] for room in structure["rooms"] if room["number"] > 0})


def _object_footprint(object_type: str, cell: Cell, rotation: int) -> set[Cell]:
    width, height = {
        "dais": (3, 2),
        "coffin": (1, 2),
    }.get(object_type, (1, 1))
    if rotation % 2:
        width, height = height, width
    return {
        (x, y)
        for y in range(cell[1], cell[1] + height)
        for x in range(cell[0], cell[0] + width)
    }


def _occupied_object_cells(structure: dict[str, Any]) -> set[Cell]:
    occupied: set[Cell] = set()
    for item in structure.get("objects", []):
        if item.get("type") not in ("rock_small", "rock_medium", "rock_large"):
            occupied.update((cell[0], cell[1]) for cell in item.get("cells", []))
    return occupied


def _place_dungeon_object(
    structure: dict[str, Any], layout: dict[str, Any], operation: dict[str, Any], bounds: tuple[int, int, int, int]
) -> set[Cell]:
    object_type = operation.get("objectType")
    if object_type not in PROP_OBJECT_TYPES and object_type not in LAYOUT_OBJECT_TYPES:
        raise ProjectValidationError("invalidEdit")
    cell = _read_cell(operation.get("cell"), bounds)
    rotation = operation.get("rotation", 0)
    if isinstance(rotation, bool) or not isinstance(rotation, int) or rotation not in range(4):
        raise ProjectValidationError("invalidEdit")
    floor = {(value[0], value[1]) for value in structure["floorCells"]}
    footprint = _object_footprint(object_type, cell, rotation)
    if not footprint <= floor:
        raise ProjectValidationError("invalidPlacement")
    if object_type in PROP_OBJECT_TYPES:
        if len(structure["objects"]) >= MAX_DUNGEON_OBJECTS:
            raise ProjectValidationError("invalidPlacement")
        if object_type not in ("rock_small", "rock_medium", "rock_large") and footprint & _occupied_object_cells(structure):
            raise ProjectValidationError("invalidPlacement")
        centered = object_type in (
            "fountain", "column_round", "column_square", "rock_small", "rock_medium", "rock_large"
        )
        descriptor = {
            "id": uuid.uuid4().hex[:12],
            "type": object_type,
            "x": cell[0] + 0.5 if centered else cell[0],
            "y": cell[1] + 0.5 if centered else cell[1],
            "rotation": rotation,
            "source": "manual",
            "cells": _cell_list(footprint),
        }
        structure["objects"].append(descriptor)
        return footprint

    collection, variant = LAYOUT_OBJECT_TYPES[object_type]
    if any(
        (item.get("x"), item.get("y")) == cell
        for name in ("doors", "stairs", "exits")
        for item in layout.get(name, [])
        if isinstance(item, dict)
    ):
        raise ProjectValidationError("invalidPlacement")
    direction = ROTATION_DIRECTIONS[rotation]
    facing = ((0, -1), (1, 0), (0, 1), (-1, 0))[rotation]
    if collection in ("doors", "exits") and (cell[0] + facing[0], cell[1] + facing[1]) in floor:
        raise ProjectValidationError("invalidPlacement")
    item = {
        "id": uuid.uuid4().hex[:12], "x": cell[0], "y": cell[1], "direction": direction,
        "type": variant, "manual": True,
    }
    if collection == "doors":
        item.update({"roomId": "", "passageId": ""})
    elif collection == "stairs":
        item["passageId"] = ""
    else:
        item.update({"roomId": "", "main": object_type == "entrance"})
    layout.setdefault(collection, []).append(item)
    return {cell}


def _erase_dungeon_object(
    structure: dict[str, Any], layout: dict[str, Any], operation: dict[str, Any], bounds: tuple[int, int, int, int]
) -> set[Cell]:
    target_kind = operation.get("targetKind")
    if target_kind == "water":
        cell = _read_cell(operation.get("cell"), bounds)
        water = {(value[0], value[1]) for value in structure["waterCells"]}
        if cell not in water:
            raise ProjectValidationError("objectNotFound")
        water.remove(cell)
        structure["waterCells"] = _cell_list(water)
        return {cell}
    target_id = operation.get("id")
    if not isinstance(target_id, str) or not target_id or len(target_id) > 64:
        raise ProjectValidationError("invalidEdit")
    if target_kind == "prop":
        matches = [item for item in structure["objects"] if item["id"] == target_id]
        if not matches:
            raise ProjectValidationError("objectNotFound")
        structure["objects"] = [item for item in structure["objects"] if item["id"] != target_id]
        return {(cell[0], cell[1]) for cell in matches[0]["cells"]}
    collection = {"door": "doors", "stairs": "stairs", "exit": "exits"}.get(target_kind)
    if not collection:
        raise ProjectValidationError("invalidEdit")
    matches = [item for item in layout.get(collection, []) if item.get("id") == target_id]
    if not matches:
        raise ProjectValidationError("objectNotFound")
    layout[collection] = [item for item in layout.get(collection, []) if item.get("id") != target_id]
    return {(int(matches[0]["x"]), int(matches[0]["y"]))}


def apply_structure_operation(structure: dict[str, Any], layout: dict[str, Any], operation: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    if not isinstance(operation, dict):
        raise ProjectValidationError("invalidEdit")
    bounds = tuple(structure["bounds"])
    floor = {(cell[0], cell[1]) for cell in structure["floorCells"]}
    operation_type = operation.get("type")
    affected: set[Cell] = set()
    if operation_type == "initialize":
        return structure, layout
    if structure["revision"] >= MAX_STRUCTURE_REVISION:
        raise ProjectValidationError("invalidEdit")
    if operation_type == "paint":
        mode = operation.get("mode")
        if mode not in ("wall", "corridor") or not isinstance(operation.get("cells"), list):
            raise ProjectValidationError("invalidEdit")
        affected = {_read_cell(cell, bounds) for cell in operation["cells"]}
        if not affected or len(affected) > MAX_EDIT_DIMENSION**2:
            raise ProjectValidationError("invalidEdit")
        if mode == "wall":
            floor.difference_update(affected)
            structure["objects"] = [
                item for item in structure.get("objects", [])
                if not ({(cell[0], cell[1]) for cell in item.get("cells", [])} & affected)
            ]
            structure["waterCells"] = _cell_list(
                {(cell[0], cell[1]) for cell in structure.get("waterCells", [])} - affected
            )
            structure["roundAreas"] = [
                area for area in structure["roundAreas"]
                if _room_geometry_cells(
                    {
                        "shape": "circle", "x": area["x"], "y": area["y"],
                        "width": area["diameter"], "height": area["diameter"],
                    },
                    bounds,
                ) & floor
            ]
            for collection in ("doors", "stairs", "exits"):
                elements = layout.get(collection, [])
                if not isinstance(elements, list) or any(not isinstance(element, dict) for element in elements):
                    raise ProjectValidationError("invalidProject")
                layout[collection] = [element for element in elements if (element.get("x"), element.get("y")) not in affected]
        else:
            floor.update(affected)
    elif operation_type == "roundRoom":
        center = _read_cell(operation.get("center"), bounds)
        radius = operation.get("radius")
        if isinstance(radius, bool) or not isinstance(radius, int) or radius < 1 or radius > MAX_EDIT_DIMENSION // 2:
            raise ProjectValidationError("invalidEdit")
        diameter = radius * 2 + 1
        descriptor = {
            "id": uuid.uuid4().hex[:8], "kind": "round", "shape": "circle",
            "x": center[0] - radius, "y": center[1] - radius,
            "width": diameter, "height": diameter,
            "number": structure["nextRoomNumber"], "suppressed": False,
            "decorationCleared": True,
        }
        affected = _room_geometry_cells(descriptor, bounds)
        if not affected:
            raise ProjectValidationError("invalidEdit")
        floor.update(affected)
        descriptor["cells"] = _cell_list(affected)
        structure["rooms"].append(descriptor)
        structure["roundAreas"].append({"id": descriptor["id"], "x": descriptor["x"], "y": descriptor["y"], "diameter": diameter})
    elif operation_type == "toggleRoom":
        cell = _read_cell(operation.get("cell"), bounds)
        candidates = [room for room in structure["rooms"] if cell in _room_cells(room)]
        if not candidates:
            raise ProjectValidationError("roomNotFound")
        room = min(candidates, key=lambda item: len(_room_cells(item)))
        room["suppressed"] = not room["suppressed"]
    elif operation_type == "placeObject":
        if not structure.get("objectsInitialized"):
            raise ProjectValidationError("objectsNotInitialized")
        _place_dungeon_object(structure, layout, operation, bounds)
    elif operation_type == "eraseObject":
        if not structure.get("objectsInitialized"):
            raise ProjectValidationError("objectsNotInitialized")
        _erase_dungeon_object(structure, layout, operation, bounds)
    elif operation_type == "paintWater":
        if not structure.get("objectsInitialized") or not isinstance(operation.get("cells"), list):
            raise ProjectValidationError("invalidEdit")
        water_cells = {_read_cell(cell, bounds) for cell in operation["cells"]}
        if not water_cells:
            raise ProjectValidationError("invalidEdit")
        floor_cells = {(cell[0], cell[1]) for cell in structure["floorCells"]}
        if not water_cells <= floor_cells:
            raise ProjectValidationError("invalidPlacement")
        water = {(cell[0], cell[1]) for cell in structure["waterCells"]}
        water.update(water_cells)
        structure["waterCells"] = _cell_list(water)
    else:
        raise ProjectValidationError("invalidEdit")

    if affected:
        cleared_ids = set(structure.get("clearedDecorationRoomIds", []))
        for raw_room in layout.get("rooms", []):
            if isinstance(raw_room, dict) and _room_geometry_cells(raw_room, bounds) & affected:
                cleared_ids.add(str(raw_room.get("id", "")))
        structure["clearedDecorationRoomIds"] = sorted(room_id for room_id in cleared_ids if room_id)
        for room in structure["rooms"]:
            if _room_cells(room) & affected:
                room["decorationCleared"] = True
    structure["floorCells"] = _cell_list(floor)
    _reclassify(structure)
    structure["revision"] += 1
    return structure, layout
