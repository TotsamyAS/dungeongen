"""Focused structural editing rules for persisted dungeon projects."""

import pytest

from dungeongen.webview.editing import apply_structure_operation, initialize_structure, normalize_structure
from dungeongen.webview.project_types import ProjectValidationError


def layout_fixture() -> dict:
    return {
        "bounds": [0, 0, 10, 10],
        "rooms": [
            {"id": "room-1", "x": 1, "y": 1, "width": 3, "height": 3, "shape": "rect", "number": 1, "tags": []}
        ],
        "passages": [],
        "doors": [{"id": "door-1", "x": 2, "y": 2}],
        "stairs": [],
        "exits": [],
    }


def test_wall_removes_floor_element_and_room_decoration() -> None:
    layout = layout_fixture()
    structure = initialize_structure(layout)

    structure, layout = apply_structure_operation(
        structure, layout, {"type": "paint", "mode": "wall", "cells": [[2, 2]]}
    )

    assert [2, 2] not in structure["floorCells"]
    assert layout["doors"] == []
    assert structure["clearedDecorationRoomIds"] == ["room-1"]


def editable_objects_fixture() -> tuple[dict, dict]:
    layout = layout_fixture()
    structure = initialize_structure(layout)
    structure["objectsInitialized"] = True
    return structure, layout


def test_object_state_is_initialized_in_structure_schema() -> None:
    structure = initialize_structure(layout_fixture())

    assert structure["objectsInitialized"] is False
    assert structure["objects"] == []
    assert structure["waterCells"] == []


def test_places_rotated_coffin_on_floor_and_rejects_outside_floor() -> None:
    structure, layout = editable_objects_fixture()

    structure, layout = apply_structure_operation(
        structure,
        layout,
        {"type": "placeObject", "objectType": "coffin", "cell": [1, 1], "rotation": 1},
    )

    coffin = structure["objects"][0]
    assert coffin["type"] == "coffin"
    assert coffin["rotation"] == 1
    assert coffin["cells"] == [[1, 1], [2, 1]]

    with pytest.raises(ProjectValidationError, match="invalidPlacement"):
        apply_structure_operation(
            structure,
            layout,
            {"type": "placeObject", "objectType": "altar", "cell": [0, 0], "rotation": 0},
        )


def test_corridor_door_can_be_placed_and_room_door_is_rejected() -> None:
    structure, layout = editable_objects_fixture()
    structure["floorCells"].extend([[2, -1], [2, 0]])

    structure, layout = apply_structure_operation(
        structure,
        layout,
        {"type": "placeObject", "objectType": "door_open", "cell": [2, 0], "rotation": 0},
    )
    door = next(item for item in layout["doors"] if item.get("manual"))
    assert door["direction"] == "north"
    with pytest.raises(ProjectValidationError, match="invalidPlacement"):
        apply_structure_operation(
            structure,
            layout,
            {"type": "placeObject", "objectType": "door_open", "cell": [1, 1], "rotation": 0},
        )

    structure, layout = apply_structure_operation(
        structure,
        layout,
        {"type": "eraseObject", "targetKind": "door", "id": door["id"]},
    )
    assert all(item.get("id") != door["id"] for item in layout["doors"])


def test_eraser_removes_generated_decoration_by_stable_id() -> None:
    structure, layout = editable_objects_fixture()
    structure, layout = apply_structure_operation(
        structure,
        layout,
        {"type": "placeObject", "objectType": "fountain", "cell": [1, 1], "rotation": 0},
    )
    structure["objects"][0]["source"] = "generated"
    object_id = structure["objects"][0]["id"]

    structure, _ = apply_structure_operation(
        structure,
        layout,
        {"type": "eraseObject", "targetKind": "prop", "id": object_id},
    )

    assert structure["objects"] == []


def test_water_brush_unions_floor_cells_and_eraser_removes_one_cell() -> None:
    structure, layout = editable_objects_fixture()

    structure, layout = apply_structure_operation(
        structure,
        layout,
        {"type": "paintWater", "cells": [[1, 1], [2, 1]]},
    )
    structure, layout = apply_structure_operation(
        structure,
        layout,
        {"type": "paintWater", "cells": [[2, 1], [3, 1]]},
    )
    assert structure["waterCells"] == [[1, 1], [2, 1], [3, 1]]

    structure, _ = apply_structure_operation(
        structure,
        layout,
        {"type": "eraseObject", "targetKind": "water", "cell": [2, 1]},
    )
    assert structure["waterCells"] == [[1, 1], [3, 1]]


def test_wall_erases_overlapping_props_and_water() -> None:
    structure, layout = editable_objects_fixture()
    structure, layout = apply_structure_operation(
        structure,
        layout,
        {"type": "placeObject", "objectType": "altar", "cell": [1, 1], "rotation": 0},
    )
    structure, layout = apply_structure_operation(
        structure,
        layout,
        {"type": "paintWater", "cells": [[1, 1]]},
    )

    structure, _ = apply_structure_operation(
        structure,
        layout,
        {"type": "paint", "mode": "wall", "cells": [[1, 1]]},
    )

    assert structure["objects"] == []
    assert structure["waterCells"] == []


def test_structure_revision_tracks_stale_render_snapshot() -> None:
    layout = layout_fixture()
    structure = initialize_structure(layout)

    assert structure["revision"] == 0
    assert structure["renderedRevision"] == 0
    assert structure["renderedFloorCells"] == structure["floorCells"]

    rendered_floor = structure["renderedFloorCells"]
    structure, _ = apply_structure_operation(
        structure, layout, {"type": "paint", "mode": "corridor", "cells": [[0, 0]]}
    )

    assert structure["revision"] == 1
    assert structure["renderedRevision"] == 0
    assert structure["renderedFloorCells"] == rendered_floor
    assert [0, 0] in structure["floorCells"]
    assert [0, 0] not in structure["renderedFloorCells"]


def test_structure_rejects_render_revision_ahead_of_model() -> None:
    layout = layout_fixture()
    structure = initialize_structure(layout)
    structure["renderedRevision"] = 1

    with pytest.raises(ProjectValidationError, match="invalidProject"):
        normalize_structure(structure, layout)


def test_only_complete_four_by_four_floor_becomes_auto_room() -> None:
    layout = layout_fixture()
    structure = initialize_structure(layout)
    incomplete = [[x, 6] for x in range(5, 9)] + [[5, y] for y in range(7, 10)]
    structure, layout = apply_structure_operation(
        structure, layout, {"type": "paint", "mode": "corridor", "cells": incomplete}
    )
    assert not any(room["kind"] == "auto" for room in structure["rooms"])

    complete = [[x, y] for y in range(6, 10) for x in range(5, 9)]
    structure, _ = apply_structure_operation(
        structure, layout, {"type": "paint", "mode": "corridor", "cells": complete}
    )
    auto_room = next(room for room in structure["rooms"] if room["kind"] == "auto")
    assert len(auto_room["cells"]) == 16


def test_corridor_override_toggles_and_survives_reclassification() -> None:
    layout = layout_fixture()
    structure = initialize_structure(layout)
    cells = [[x, y] for y in range(6, 10) for x in range(5, 9)]
    structure, layout = apply_structure_operation(
        structure, layout, {"type": "paint", "mode": "corridor", "cells": cells}
    )
    structure, layout = apply_structure_operation(structure, layout, {"type": "toggleRoom", "cell": [5, 6]})
    assert next(room for room in structure["rooms"] if room["kind"] == "auto")["suppressed"] is True

    structure, layout = apply_structure_operation(
        structure, layout, {"type": "paint", "mode": "corridor", "cells": [[9, 9]]}
    )
    assert next(room for room in structure["rooms"] if room["kind"] == "auto")["suppressed"] is True


def test_overlapping_round_room_merges_and_keeps_lower_number() -> None:
    layout = layout_fixture()
    structure = initialize_structure(layout)
    structure, _ = apply_structure_operation(
        structure, layout, {"type": "roundRoom", "center": [3, 2], "radius": 1}
    )
    merged = next(room for room in structure["rooms"] if room["kind"] == "merged")
    assert merged["number"] == 1


def test_round_room_absorbs_overlapping_auto_room() -> None:
    layout = layout_fixture()
    structure = initialize_structure(layout)
    cells = [[x, y] for y in range(6, 10) for x in range(5, 9)]
    structure, layout = apply_structure_operation(
        structure, layout, {"type": "paint", "mode": "corridor", "cells": cells}
    )
    auto_number = next(room for room in structure["rooms"] if room["kind"] == "auto")["number"]
    structure, _ = apply_structure_operation(
        structure, layout, {"type": "roundRoom", "center": [8, 8], "radius": 1}
    )
    merged = next(room for room in structure["rooms"] if room["kind"] == "merged" and [8, 8] in room["cells"])
    assert merged["number"] == auto_number


def test_edit_cannot_expand_fixed_bounds() -> None:
    layout = layout_fixture()
    structure = initialize_structure(layout)
    with pytest.raises(ProjectValidationError, match="invalidEdit"):
        apply_structure_operation(
            structure, layout, {"type": "paint", "mode": "corridor", "cells": [[12, 12]]}
        )


def test_editor_prefixed_edit_route_reaches_service() -> None:
    from dungeongen.webview.app import app

    response = app.test_client().post("/dungeon-editor/api/edit")
    assert response.status_code == 401
    assert response.get_json() == {"success": False, "error": "unauthorized"}


def test_editor_prefixed_render_route_reaches_service() -> None:
    from dungeongen.webview.app import app

    response = app.test_client().post("/dungeon-editor/api/render")
    assert response.status_code == 401
    assert response.get_json() == {"success": False, "error": "unauthorized"}


def test_editor_prefixed_checkpoint_route_reaches_service() -> None:
    from dungeongen.webview.app import app

    response = app.test_client().post("/dungeon-editor/api/checkpoint")
    assert response.status_code == 401
    assert response.get_json() == {"success": False, "error": "unauthorized"}


def test_checkpoint_validates_working_copy_without_svg_render() -> None:
    from dungeongen.webview.project import checkpoint_project, default_project

    layout = layout_fixture()
    project = default_project()
    project.update({
        "clientRevision": 7,
        "layout": layout,
        "structure": initialize_structure(layout),
        "renderSvg": "<svg></svg>",
        "stats": {},
    })

    checkpoint = checkpoint_project({"project": project})

    assert checkpoint["renderSvg"] is None
    assert checkpoint["clientRevision"] == 7
    assert checkpoint["structure"]["floorCells"] == project["structure"]["floorCells"]
    assert "renderedFloorCells" not in checkpoint["structure"]


def test_project_rejects_invalid_client_revision() -> None:
    from dungeongen.webview.project import default_project, normalize_project

    project = default_project()
    project["clientRevision"] = -1
    with pytest.raises(ProjectValidationError, match="invalidProject"):
        normalize_project(project)


def test_encoder_worker_is_served_by_editor() -> None:
    from dungeongen.webview.app import app

    response = app.test_client().get("/dungeon-editor/encoder-worker.js")
    assert response.status_code == 200
    assert response.mimetype == "application/javascript"
    assert b"self.onmessage" in response.data


def test_deferred_edit_skips_svg_render_and_keeps_snapshot() -> None:
    from dungeongen.webview.project import default_project, edit_project

    layout = layout_fixture()
    structure = initialize_structure(layout)
    project = default_project()
    project.update({
        "layout": layout,
        "structure": structure,
        "renderSvg": "<svg></svg>",
        "stats": {},
    })
    stages: list[str] = []

    edited = edit_project(
        {
            "project": project,
            "operation": {"type": "paint", "mode": "corridor", "cells": [[0, 0]]},
            "deferRender": True,
        },
        timing=lambda stage, _elapsed_ms: stages.append(stage),
        validate_size=False,
    )

    assert stages == ["project_normalization", "structure_operation", "stats_update"]
    assert edited["renderSvg"] == "<svg></svg>"
    assert edited["structure"]["revision"] == 1
    assert edited["structure"]["renderedRevision"] == 0
    assert [0, 0] not in edited["structure"]["renderedFloorCells"]


def test_canonical_render_advances_render_snapshot() -> None:
    from dungeongen.webview.project import default_project, edit_project, render_edited_project

    layout = layout_fixture()
    project = default_project()
    project.update({
        "layout": layout,
        "structure": initialize_structure(layout),
        "renderSvg": "<svg></svg>",
        "stats": {},
    })
    edited = edit_project(
        {
            "project": project,
            "operation": {"type": "paint", "mode": "corridor", "cells": [[0, 0]]},
            "deferRender": True,
        },
        validate_size=False,
    )

    rendered = render_edited_project(edited, validate_size=False)

    assert rendered["renderSvg"].startswith("<svg")
    assert rendered["structure"]["renderedRevision"] == rendered["structure"]["revision"] == 1
    assert rendered["structure"]["renderedFloorCells"] == rendered["structure"]["floorCells"]


def test_structural_room_numbers_use_bundled_typeface() -> None:
    import skia

    from dungeongen.webview.project import TEMPLATE_APPEARANCE, _draw_structure_numbers

    surface = skia.Surface(128, 128)
    project = {
        "parameters": {"showNumbers": True},
        "structure": {
            "mapBounds": [0, 0, 1, 1],
            "rooms": [
                {
                    "suppressed": False,
                    "number": 1,
                    "cells": [[0, 0]],
                    "x": 0,
                    "y": 0,
                    "width": 1,
                    "height": 1,
                }
            ],
        },
    }
    _draw_structure_numbers(surface.getCanvas(), project, skia.Matrix.I(), TEMPLATE_APPEARANCE)


def test_edit_timing_reports_full_pipeline() -> None:
    from dungeongen.webview.project import default_project, edit_project

    layout = layout_fixture()
    project = default_project()
    project.update({
        "layout": layout,
        "structure": initialize_structure(layout),
        "stats": {},
    })
    stages: list[str] = []

    edit_project(
        {
            "project": project,
            "operation": {"type": "paint", "mode": "corridor", "cells": [[0, 0]]},
        },
        timing=lambda stage, _elapsed_ms: stages.append(stage),
    )

    assert stages == [
        "project_normalization",
        "structure_operation",
        "stats_update",
        "canvas_dimensions",
        "layout_rebuild",
        "map_conversion",
        "structure_shapes",
        "svg_canvas_setup",
        "render_background",
        "render_regions",
        "render_crosshatch",
        "render_region_base",
        "render_region_shadows",
        "render_region_grid",
        "render_region_water",
        "render_region_props",
        "render_region_layers",
        "render_borders",
        "render_overlays",
        "render_text",
        "map_render",
        "room_numbers",
        "svg_serialization",
        "render_svg_total",
        "project_validation",
        "project_serialization",
    ]


def test_adjacent_edit_cells_compact_to_exact_rectangles() -> None:
    from dungeongen.webview.project import _cells_to_rectangles

    room = {(x, y) for y in range(3, 7) for x in range(2, 6)}
    assert _cells_to_rectangles(room) == [(2, 3, 4, 4)]

    irregular = room | {(6, 6), (8, 9)}
    rectangles = _cells_to_rectangles(irregular)
    restored = {
        (x, y)
        for left, top, width, height in rectangles
        for y in range(top, top + height)
        for x in range(left, left + width)
    }
    assert restored == irregular
    assert len(rectangles) < len(irregular)


def test_deterministic_hatch_tile_is_reused_within_worker() -> None:
    from dungeongen.map.map import Map
    from dungeongen.options import Options

    assert Map(Options()).hatch_tile is Map(Options()).hatch_tile
