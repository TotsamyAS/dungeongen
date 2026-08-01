from __future__ import annotations

import unittest
from unittest.mock import patch

from dungeongen.webview.app import app


class ExportProjectApiTest(unittest.TestCase):
    def test_compact_project_without_render_svg_is_passed_to_jpeg_renderer(self) -> None:
        compact_project = {
            "renderSvg": None,
            "layout": {"rooms": []},
            "structure": {"rooms": [], "floorCells": []},
        }
        jpeg = b"\xff\xd8test\xff\xd9"

        with (
            patch(
                "dungeongen.webview.app.parse_project_bytes",
                return_value=compact_project,
            ),
            patch(
                "dungeongen.webview.app.render_project_jpeg",
                return_value=jpeg,
            ) as render_project_jpeg,
        ):
            response = app.test_client().post(
                "/api/dungeongen/projects/export",
                data=b"{}",
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, "image/jpeg")
        self.assertEqual(response.data, jpeg)
        render_project_jpeg.assert_called_once_with(compact_project)


if __name__ == "__main__":
    unittest.main()
