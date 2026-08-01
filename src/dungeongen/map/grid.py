"""Grid drawing styles and utilities."""

import math
import skia
from dungeongen.options import Options
from dungeongen.map.enums import GridStyle
from dungeongen.map.region import Region
from dungeongen.constants import CELL_SIZE

def draw_region_grid(canvas: skia.Canvas, region: Region, options: 'Options') -> None:
    """Draw grid dots for a region.
    
    Args:
        canvas: The canvas to draw on
        region: The region to draw grid for
        options: Drawing configuration options
    """
    bounds = region.shape.bounds
    
    # Calculate grid-aligned bounds, ensuring we start before the shape bounds
    min_x = math.floor(bounds.x / CELL_SIZE)
    min_y = math.floor(bounds.y / CELL_SIZE)
    max_x = math.ceil((bounds.x + bounds.width) / CELL_SIZE) 
    max_y = math.ceil((bounds.y + bounds.height) / CELL_SIZE)
    
    # Map.render already clips the canvas to region.shape. Build one batched
    # path instead of repeating Python containment checks and draw calls.
    dot_paint = skia.Paint(
        AntiAlias=True,
        Style=skia.Paint.kStroke_Style,
        StrokeCap=skia.Paint.kRound_Cap,
        StrokeWidth=options.grid_dot_size,
        Color=options.grid_color,
    )
    dot_path = skia.Path()
    dot_spacing = CELL_SIZE / options.grid_dots_per_cell
    variation_cycle = (-1.0, -0.35, 0.25, 0.8, 0.1, -0.65)

    for y in range(min_y - 1, max_y + 1):
        py = y * CELL_SIZE
        x = bounds.x - dot_spacing * 0.5
        index = 0
        while x <= bounds.x + bounds.width + 2 * dot_spacing:
            x += dot_spacing
            variation = variation_cycle[(index + y) % len(variation_cycle)]
            dot_length = options.grid_dot_length * (1 + variation * options.grid_dot_variation)
            dot_path.moveTo(x, py)
            dot_path.lineTo(x + dot_length, py)
            index += 1

    for x in range(min_x - 1, max_x + 1):
        px = x * CELL_SIZE
        y = bounds.y - dot_spacing * 0.5
        index = 0
        while y <= bounds.y + bounds.height + 2 * dot_spacing:
            y += dot_spacing
            variation = variation_cycle[(index + x) % len(variation_cycle)]
            dot_length = options.grid_dot_length * (1 + variation * options.grid_dot_variation)
            dot_path.moveTo(px, y)
            dot_path.lineTo(px, y + dot_length)
            index += 1

    canvas.drawPath(dot_path, dot_paint)
