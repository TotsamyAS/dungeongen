"""Coffin prop implementation."""

import skia
from typing import TYPE_CHECKING
from dungeongen.graphics.shapes import Rectangle
from dungeongen.graphics.aliases import Point
from dungeongen.constants import CELL_SIZE
from dungeongen.map._props.prop import Prop, PropType #type: ignore
from dungeongen.graphics.rotation import Rotation
from dungeongen.graphics.conversions import grid_to_map
from dungeongen.map.enums import Layers

if TYPE_CHECKING:
    from dungeongen.map.map import Map

COFFIN_PROP_TYPE = PropType(
    is_decoration=True,
    is_grid_aligned=True,
    grid_size=(1, 2),
    boundary_shape=Rectangle(-CELL_SIZE * 0.35, -CELL_SIZE * 0.9, CELL_SIZE * 0.7, CELL_SIZE * 1.8),
)

class Coffin(Prop):
    """A coffin-shaped prop with nested polygons."""

    def __init__(self, position: Point, rotation: Rotation = Rotation.ROT_0) -> None:
        super().__init__(COFFIN_PROP_TYPE, position, rotation=rotation)
    
    def _draw_content(self, canvas: skia.Canvas, bounds: Rectangle, layer: Layers) -> None:
        """Draw the coffin shape."""
        if layer != Layers.PROPS:
            return

        """Draw the coffin shape."""
        # Calculate points for outer coffin shape
        x, y = bounds.x + bounds.width * 0.15, bounds.y + bounds.height * 0.05
        w, h = bounds.width * 0.7, bounds.height * 0.9
        
        # Create outer coffin path
        outer_path = skia.Path()
        outer_path.moveTo(x + w/2, y)  # Top point
        outer_path.lineTo(x + w, y + h/6)  # Upper right
        outer_path.lineTo(x + w, y + h*0.75)  # Lower right
        outer_path.lineTo(x + w/2, y + h)  # Bottom point
        outer_path.lineTo(x, y + h*0.75)  # Lower left
        outer_path.lineTo(x, y + h/6)  # Upper left
        outer_path.close()
        
        # Draw outer coffin
        outer_paint = skia.Paint(
            AntiAlias=True,
            Style=skia.Paint.kStroke_Style,
            StrokeWidth=2.0,
            Color=self._map.options.prop_outline_color
        )
        canvas.drawPath(outer_path, outer_paint)
        
        # Calculate inset for inner coffin (10% of width/height)
        inset_x = w * 0.1
        inset_y = h * 0.1
        
        # Create inner coffin path
        inner_path = skia.Path()
        inner_path.moveTo(x + w/2, y + inset_y)  # Top point
        inner_path.lineTo(x + w - inset_x, y + h/6 + inset_y)  # Upper right
        inner_path.lineTo(x + w - inset_x, y + h*0.75 - inset_y)  # Lower right
        inner_path.lineTo(x + w/2, y + h - inset_y)  # Bottom point
        inner_path.lineTo(x + inset_x, y + h*0.75 - inset_y)  # Lower left
        inner_path.lineTo(x + inset_x, y + h/6 + inset_y)  # Upper left
        inner_path.close()
        
        # Draw inner coffin
        inner_paint = skia.Paint(
            AntiAlias=True,
            Style=skia.Paint.kStroke_Style,
            StrokeWidth=1.0,
            Color=self._map.options.prop_outline_color
        )
        canvas.drawPath(inner_path, inner_paint)
