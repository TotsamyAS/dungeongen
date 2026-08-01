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
ROOM_MIN_SPAN = 4
ROOM_KINDS = frozenset(("generated", "round", "auto", "merged"))


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
        "bounds": bounds,
        "mapBounds": map_bounds,
        "floorCells": _cell_list(floor),
        "rooms": rooms,
        "roundAreas": [],
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
        "bounds": list(bounds),
        "mapBounds": list(map_bounds),
        "floorCells": _cell_list(floor),
        "rooms": rooms,
        "roundAreas": round_areas,
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


def apply_structure_operation(structure: dict[str, Any], layout: dict[str, Any], operation: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    if not isinstance(operation, dict):
        raise ProjectValidationError("invalidEdit")
    bounds = tuple(structure["bounds"])
    floor = {(cell[0], cell[1]) for cell in structure["floorCells"]}
    operation_type = operation.get("type")
    affected: set[Cell] = set()
    if operation_type == "initialize":
        return structure, layout
    if operation_type == "paint":
        mode = operation.get("mode")
        if mode not in ("wall", "corridor") or not isinstance(operation.get("cells"), list):
            raise ProjectValidationError("invalidEdit")
        affected = {_read_cell(cell, bounds) for cell in operation["cells"]}
        if not affected or len(affected) > MAX_EDIT_DIMENSION**2:
            raise ProjectValidationError("invalidEdit")
        if mode == "wall":
            floor.difference_update(affected)
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
    return structure, layout
