import unittest
from dungeongen.webview.project import (
    normalize_parameters,
    _generate_dungeon,
    generate_project,
    SIZE_MAP,
    _project_canvas_dimensions,
)
from dungeongen.webview.generation_policy import geometry_bounds, generation_limit
from dungeongen.layout.models import RoomShape
from dungeongen.layout.params import ROOM_COUNTS


class GenerationSettingsTest(unittest.TestCase):
    def test_default_symmetry_is_none(self):
        self.assertEqual(normalize_parameters({})["symmetry"], "none")

    def test_generation_settings_are_hard_constraints(self):
        for size in ("tiny", "small", "medium", "large", "xlarge"):
            for symmetry in ("none", "bilateral"):
                for seed in (1, 7, 19):
                    with self.subTest(size=size, symmetry=symmetry, seed=seed):
                        parameters = normalize_parameters(
                            dict(
                                size=size,
                                symmetry=symmetry,
                                roundRooms=False,
                                seed=seed,
                            )
                        )
                        dungeon, _, _ = _generate_dungeon(parameters)
                        minimum, maximum = ROOM_COUNTS[SIZE_MAP[size]]
                        self.assertGreaterEqual(len(dungeon.rooms), minimum)
                        self.assertLessEqual(len(dungeon.rooms), maximum)
                        self.assertFalse(
                            any(
                                r.shape == RoomShape.CIRCLE
                                for r in dungeon.rooms.values()
                            )
                        )
                        x0, y0, x1, y1 = geometry_bounds(dungeon)
                        self.assertLessEqual(x1 - x0 + 4, generation_limit(size))
                        self.assertLessEqual(y1 - y0 + 4, generation_limit(size))
                        if symmetry == "bilateral":
                            rooms = {
                                (r.x, r.y, r.width, r.height, r.shape)
                                for r in dungeon.rooms.values()
                            }
                            self.assertEqual(
                                rooms,
                                {
                                    (-x - w, y, w, h, shape)
                                    for x, y, w, h, shape in rooms
                                },
                            )
                            cells = set()
                            for passage in dungeon.passages.values():
                                for (x, y), (xx, yy) in passage.segments:
                                    if x == xx:
                                        cells.update(
                                            (x, v)
                                            for v in range(min(y, yy), max(y, yy) + 1)
                                        )
                                    elif y == yy:
                                        cells.update(
                                            (v, y)
                                            for v in range(min(x, xx), max(x, xx) + 1)
                                        )
                            self.assertEqual(cells, {(-x - 1, y) for x, y in cells})

    def test_generated_project_floor_and_canvas_are_mirrored_and_bounded(self):
        for enabled in (False, True):
            project = generate_project(
                dict(size="tiny", symmetry="bilateral", roundRooms=enabled, seed=1),
                render_svg=False,
            )
            width, height = _project_canvas_dimensions(project, grid_size=1)
            self.assertLessEqual(width, generation_limit("tiny"))
            self.assertLessEqual(height, generation_limit("tiny"))
            floor = {tuple(cell) for cell in project["structure"]["floorCells"]}
            lo = min(x for x, y in floor)
            hi = max(x for x, y in floor)
            self.assertEqual(floor, {(lo + hi - x, y) for x, y in floor})
            seen = {next(iter(floor))}
            pending = list(seen)
            while pending:
                x, y = pending.pop()
                for cell in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if cell in floor and cell not in seen:
                        seen.add(cell)
                        pending.append(cell)
            self.assertEqual(seen, floor)


class InstalledGenerationConfigTest(unittest.TestCase):
    def test_installed_package_uses_runtime_config_for_generation_and_export(self):
        import json
        import tempfile
        from pathlib import Path
        from unittest.mock import patch
        from dungeongen.webview.app import app
        import dungeongen.webview.generation_policy as policy
        from dungeongen.webview.project import render_project_jpeg

        with tempfile.TemporaryDirectory() as folder:
            runtime = Path(folder) / 'app'
            runtime.mkdir()
            config = {'generationLimits': {'tiny': 30, 'small': 48, 'medium': 64, 'large': 96, 'xlarge': 128}}
            (runtime / 'config.json').write_text(json.dumps(config), encoding='utf-8')
            installed = Path(folder) / 'site-packages/dungeongen/webview/generation_policy.py'
            with patch.object(policy, '__file__', str(installed)), patch('pathlib.Path.cwd', return_value=runtime), patch('dungeongen.webview.app._has_valid_capability', return_value=True):
                self.assertEqual(policy.generation_limit('tiny'), 30)
                response = app.test_client().post('/api/dungeongen/editor/generate', json={'parameters': {'size':'tiny','symmetry':'bilateral','seed':1},'deferRender':True})
                self.assertEqual(response.status_code, 200, response.get_json())
                project = response.get_json()['project']
                self.assertEqual(project['parameters']['symmetry'], 'bilateral')
                self.assertTrue(render_project_jpeg(project).startswith(b'\xff\xd8'))
