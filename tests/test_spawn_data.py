from __future__ import annotations

import importlib.util
import sys
import types
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "src" / "dungeongen" / "webview" / "spawn_data.py"


def load_spawn_module():
    # The dungeongen package imports optional rendering dependencies (skia) from
    # __init__.py. Spawn-data generation only needs CELL_SIZE, so isolate it here.
    package = types.ModuleType("dungeongen")
    package.__path__ = []
    constants = types.ModuleType("dungeongen.constants")
    constants.CELL_SIZE = 60
    sys.modules.setdefault("dungeongen", package)
    sys.modules["dungeongen.constants"] = constants
    spec = importlib.util.spec_from_file_location("dungeongen_spawn_data_test", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


spawn_data = load_spawn_module()


class SpawnDataTests(unittest.TestCase):
    def setUp(self):
        floor = [
            [x, y]
            for y in range(20, 24)
            for x in range(10, 14)
            if [x, y] != [13, 23]
        ]
        self.project = {
            "parameters": {"seed": 31415},
            "structure": {
                "mapBounds": [10, 20, 14, 24],
                "floorCells": floor,
                "waterCells": [[12, 22]],
                "objects": [
                    {"id": "altar", "type": "altar", "source": "manual", "cells": [[11, 21]]},
                    {"id": "small", "type": "rock_small", "source": "manual", "cells": [[12, 21]]},
                    {"id": "large", "type": "rock_large", "source": "manual", "cells": [[10, 20]]},
                    {"id": "dais", "type": "dais", "source": "generated", "cells": [[10, 22]]},
                    {"id": "medium", "type": "rock_medium", "source": "generated", "cells": [[13, 20]]},
                ],
            },
        }

    def anchor(self, data, size, col, row):
        return data["bySize"][str(size)]["anchors"][row * data["grid"]["cols"] + col]

    def test_payload_matches_map_editor_spawn_contract(self):
        data = spawn_data.build_spawn_data(self.project)
        self.assertEqual(
            set(data),
            {"version", "seed", "biome", "blockers", "water", "road", "grid", "semantics", "cells", "bySize"},
        )
        self.assertEqual(data["version"], 2)
        self.assertEqual(data["seed"], "31415")
        self.assertEqual(data["biome"], "underdark")
        self.assertEqual(
            set(data["grid"]),
            {"type", "cols", "rows", "cellSizePx", "cellSizeFeet", "anchorCount"},
        )
        self.assertEqual(data["grid"], {
            "type": "square", "cols": 4, "rows": 4, "cellSizePx": 60, "cellSizeFeet": 5, "anchorCount": 16
        })
        self.assertEqual(
            set(data["semantics"]),
            {"anchor", "footprint", "sizesCells", "waterBlocksSpawn", "note"},
        )
        self.assertEqual(data["semantics"]["anchor"], "top-left")
        self.assertEqual(data["semantics"]["footprint"], "square-cells")
        self.assertEqual(data["semantics"]["sizesCells"], [1, 2, 3, 4])
        self.assertFalse(data["semantics"]["waterBlocksSpawn"])
        self.assertEqual(set(data["bySize"]), {"1", "2", "3", "4"})
        self.assertEqual(data["bySize"]["1"]["totalCount"], 16)
        self.assertEqual(len(data["bySize"]["4"]["anchors"]), 16)
        self.assertEqual(len(data["cells"]), 16)

    def test_floor_and_decor_rules(self):
        data = spawn_data.build_spawn_data(self.project)
        self.assertEqual(data["bySize"]["1"]["allowedCount"], 14)
        self.assertEqual(self.anchor(data, 1, 1, 1)["reasons"], ["decor:altar"])
        self.assertTrue(self.anchor(data, 1, 3, 0)["allowed"])  # rock_medium
        self.assertEqual(self.anchor(data, 1, 3, 3)["reasons"], ["not-floor"])

        # Explicit exceptions from the product rule.
        self.assertTrue(self.anchor(data, 1, 0, 0)["allowed"])  # rock_large
        self.assertTrue(self.anchor(data, 1, 2, 1)["allowed"])  # rock_small
        self.assertTrue(self.anchor(data, 1, 0, 2)["allowed"])  # dais / platform
        self.assertTrue(self.anchor(data, 1, 2, 2)["allowed"])  # water

        # A larger NPC tests its entire square footprint.
        self.assertFalse(self.anchor(data, 2, 1, 1)["allowed"])  # overlaps altar
        self.assertTrue(self.anchor(data, 2, 2, 1)["allowed"])   # only small rock + water
        self.assertEqual(self.anchor(data, 2, 2, 2)["reasons"], ["not-floor"])
        self.assertEqual(self.anchor(data, 2, 3, 2)["reasons"], ["map-edge"])

    def test_any_rock_family_type_is_non_blocking(self):
        project = {
            **self.project,
            "structure": {
                **self.project["structure"],
                "objects": [
                    *self.project["structure"]["objects"],
                    {"id": "future-rock", "type": "rock_crystal", "source": "manual", "cells": [[11, 20]]},
                ],
            },
        }
        data = spawn_data.build_spawn_data(project)
        self.assertTrue(self.anchor(data, 1, 1, 0)["allowed"])
        self.assertNotIn("rock_crystal", [item["objectType"] for item in data["blockers"]])

    def test_only_blocking_decor_is_serialized_as_blockers(self):
        data = spawn_data.build_spawn_data(self.project)
        self.assertEqual([item["objectType"] for item in data["blockers"]], ["altar"])
        self.assertEqual(data["water"]["features"][0]["cells"], [[12, 22]])
        self.assertIsNone(data["road"])

    def test_refresh_replaces_stale_spawn_data(self):
        project = dict(self.project)
        project["spawnData"] = {"version": -1}
        refreshed = spawn_data.refresh_spawn_data(project)
        self.assertIs(project["spawnData"], refreshed)
        self.assertEqual(refreshed["version"], 2)


if __name__ == "__main__":
    unittest.main()
