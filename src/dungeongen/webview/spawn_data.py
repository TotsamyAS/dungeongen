"""NPC spawn metadata for Dungeongen projects.

The serialized payload intentionally mirrors the map-editor EncounterSpawnData shape.
Dungeongen uses a square grid only; an anchor is spawnable when the whole NPC footprint
is dungeon floor and does not overlap blocking decoration.
"""

from __future__ import annotations

from typing import Any

from dungeongen.constants import CELL_SIZE

SPAWN_DATA_VERSION = 2
SPAWN_SIZES = (1, 2, 3, 4)
NON_BLOCKING_DECOR_TYPES = frozenset(("dais",))


def _is_non_blocking_decor(object_type: str) -> bool:
    return object_type in NON_BLOCKING_DECOR_TYPES or object_type.startswith("rock_")


def _cell_set(values: Any) -> set[tuple[int, int]]:
    if not isinstance(values, list):
        return set()
    cells: set[tuple[int, int]] = set()
    for value in values:
        if (
            isinstance(value, list)
            and len(value) == 2
            and isinstance(value[0], int)
            and not isinstance(value[0], bool)
            and isinstance(value[1], int)
            and not isinstance(value[1], bool)
        ):
            cells.add((value[0], value[1]))
    return cells


def _blocking_decor(structure: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[tuple[int, int], set[str]]]:
    blockers: list[dict[str, Any]] = []
    reasons_by_cell: dict[tuple[int, int], set[str]] = {}
    for index, item in enumerate(structure.get("objects", []), start=1):
        if not isinstance(item, dict):
            continue
        object_type = item.get("type")
        if not isinstance(object_type, str) or _is_non_blocking_decor(object_type):
            continue
        cells = _cell_set(item.get("cells"))
        if not cells:
            continue
        reason = f"decor:{object_type}"
        for cell in cells:
            reasons_by_cell.setdefault(cell, set()).add(reason)
        blockers.append(
            {
                "id": index,
                "source": item.get("source") if item.get("source") in ("generated", "manual") else "decor",
                "reason": reason,
                "shape": "cells",
                "objectId": str(item.get("id", "")),
                "objectType": object_type,
                "cells": [[x, y] for x, y in sorted(cells, key=lambda cell: (cell[1], cell[0]))],
            }
        )
    return blockers, reasons_by_cell


def _water_feature(structure: dict[str, Any]) -> list[dict[str, Any]]:
    cells = sorted(_cell_set(structure.get("waterCells")), key=lambda cell: (cell[1], cell[0]))
    if not cells:
        return []
    return [
        {
            "id": "dungeongen-water",
            "kind": "cells",
            "source": "structure",
            "width": 0,
            "points": [],
            "cells": [[x, y] for x, y in cells],
        }
    ]


def build_spawn_data(project: dict[str, Any]) -> dict[str, Any] | None:
    """Build map-editor-compatible spawn data from the current editable dungeon state."""
    structure = project.get("structure")
    if not isinstance(structure, dict):
        return None
    map_bounds = structure.get("mapBounds")
    if (
        not isinstance(map_bounds, list)
        or len(map_bounds) != 4
        or any(not isinstance(value, int) or isinstance(value, bool) for value in map_bounds)
    ):
        return None

    min_x, min_y, max_x, max_y = map_bounds
    cols = max_x - min_x
    rows = max_y - min_y
    if cols <= 0 or rows <= 0:
        return None

    floor = {
        cell
        for cell in _cell_set(structure.get("floorCells"))
        if min_x <= cell[0] < max_x and min_y <= cell[1] < max_y
    }
    blockers, decor_reasons = _blocking_decor(structure)

    def analyze(col: int, row: int, size: int) -> tuple[bool, list[str]]:
        if col < 0 or row < 0 or col + size > cols or row + size > rows:
            return False, ["map-edge"]
        reasons: set[str] = set()
        for local_y in range(row, row + size):
            for local_x in range(col, col + size):
                cell = (min_x + local_x, min_y + local_y)
                if cell not in floor:
                    reasons.add("not-floor")
                reasons.update(decor_reasons.get(cell, ()))
        ordered = sorted(reasons)
        return not ordered, ordered

    by_size: dict[str, dict[str, Any]] = {}
    total_count = cols * rows
    for size in SPAWN_SIZES:
        anchors: list[dict[str, Any]] = []
        allowed_count = 0
        for row in range(rows):
            for col in range(cols):
                allowed, reasons = analyze(col, row, size)
                if allowed:
                    allowed_count += 1
                anchors.append({"col": col, "row": row, "allowed": allowed, "reasons": reasons})
        by_size[str(size)] = {
            "sizeCells": size,
            "allowedCount": allowed_count,
            "totalCount": total_count,
            "anchors": anchors,
        }

    cells: list[dict[str, Any]] = []
    for row in range(rows):
        for col in range(cols):
            index = row * cols + col
            max_size = 0
            for size in SPAWN_SIZES:
                if by_size[str(size)]["anchors"][index]["allowed"]:
                    max_size = size
            base = by_size["1"]["anchors"][index]
            cells.append(
                {
                    "col": col,
                    "row": row,
                    "spawnable": bool(base["allowed"]),
                    "reasons": list(base["reasons"]),
                    "maxNpcSizeCells": max_size,
                }
            )

    parameters = project.get("parameters") if isinstance(project.get("parameters"), dict) else {}
    layout = project.get("layout") if isinstance(project.get("layout"), dict) else {}
    seed = parameters.get("seed", layout.get("seed", ""))

    return {
        "version": SPAWN_DATA_VERSION,
        "seed": "" if seed is None else str(seed),
        "biome": "underdark",
        "blockers": blockers,
        "water": {
            "features": _water_feature(structure),
            "terrainPolygons": [],
        },
        "road": None,
        "grid": {
            "type": "square",
            "cols": cols,
            "rows": rows,
            "cellSizePx": CELL_SIZE,
            "cellSizeFeet": 5,
            "anchorCount": total_count,
        },
        "semantics": {
            "anchor": "top-left",
            "footprint": "square-cells",
            "sizesCells": list(SPAWN_SIZES),
            "waterBlocksSpawn": False,
            "note": (
                "For size 2x2 and larger, each anchor cell is the top-left cell "
                "of the square NPC footprint."
            ),
        },
        "cells": cells,
        "bySize": by_size,
    }


def refresh_spawn_data(project: dict[str, Any]) -> dict[str, Any] | None:
    """Replace project spawnData with a freshly derived payload and return it."""
    spawn_data = build_spawn_data(project)
    project["spawnData"] = spawn_data
    return spawn_data
