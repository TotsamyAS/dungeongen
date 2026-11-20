"""Hard generation guarantees, independent of rendering and project persistence."""

from copy import deepcopy
import json
from pathlib import Path
from .project_types import ProjectValidationError
from ..layout.generator import DungeonGenerator
from ..layout.models import Passage, Door
from ..layout.params import SymmetryType
from ..layout.numbering import number_dungeon


def generation_limit(size):
    candidates = [Path.cwd() / "config.json"]
    candidates.extend(parent / "config.json" for parent in Path(__file__).resolve().parents)
    config_path = next((path for path in candidates if path.is_file()), None)
    if config_path is None:
        raise RuntimeError("Dungeongen config.json was not found")
    config = json.loads(config_path.read_text(encoding="utf-8"))
    return int(config["generationLimits"][size])


def geometry_bounds(dungeon):
    x0, y0, x1, y1 = dungeon.bounds
    for obj in [
        *dungeon.doors.values(),
        *dungeon.stairs.values(),
        *dungeon.exits.values(),
    ]:
        x0 = min(x0, obj.x)
        y0 = min(y0, obj.y)
        x1 = max(x1, obj.x + 1)
        y1 = max(y1, obj.y + 1)
    return x0, y0, x1, y1


def mirror_dungeon(dungeon):
    """Reflect cell centers around x=-0.5; retain paired IDs for decoration."""
    _, _, right, _ = geometry_bounds(dungeon)
    offset = -right - 2
    for room in dungeon.rooms.values():
        room.x += offset
    for passage in dungeon.passages.values():
        passage.waypoints = [(x + offset, y) for x, y in passage.waypoints]
    for obj in [
        *dungeon.doors.values(),
        *dungeon.stairs.values(),
        *dungeon.exits.values(),
    ]:
        obj.x += offset
    for region in dungeon.water_regions:
        region.boundary = [(x + offset, y) for x, y in region.boundary]
        a, b, c, d = region.bounds
        region.bounds = (a + offset, b, c + offset, d)
    rooms = list(dungeon.rooms.values())
    pairs = {r.id: r.id + "-mirror" for r in rooms}
    passage_pairs = {p.id: p.id + "-mirror" for p in dungeon.passages.values()}
    for original in rooms:
        room = deepcopy(original)
        room.id = pairs[original.id]
        room.x = -original.x - original.width
        room.connections = [pairs[c] for c in room.connections if c in pairs]
        dungeon.add_room(room)
    for original in list(dungeon.passages.values()):
        passage = deepcopy(original)
        passage.id = passage_pairs[original.id]
        passage.start_room = pairs.get(original.start_room, original.start_room)
        passage.end_room = pairs.get(original.end_room, original.end_room)
        passage.waypoints = [(-x - 1, y) for x, y in original.waypoints]
        dungeon.passages[passage.id] = passage
    direction = {"east": "west", "west": "east", "north": "north", "south": "south"}
    for collection in [dungeon.doors, dungeon.stairs, dungeon.exits]:
        for original in list(collection.values()):
            obj = deepcopy(original)
            obj.id = original.id + "-mirror"
            obj.x = -original.x - 1
            obj.direction = direction.get(obj.direction, obj.direction)
            if hasattr(obj, "room_id"):
                obj.room_id = pairs.get(obj.room_id, obj.room_id)
            if hasattr(obj, "passage_id"):
                obj.passage_id = passage_pairs.get(obj.passage_id, obj.passage_id)
            if hasattr(obj, "is_main"):
                obj.is_main = False
            collection[obj.id] = obj
    for original in list(dungeon.water_regions):
        region = deepcopy(original)
        region.boundary = [(-x, y) for x, y in original.boundary]
        a, b, c, d = region.bounds
        region.bounds = (-c, b, -a, d)
        dungeon.water_regions.append(region)
    # The rightmost room has an unobstructed horizontal path to its reflection.
    anchor = max(rooms, key=lambda r: r.x + r.width)
    x, y = anchor.get_edge_point("east")
    end = -x - 1
    bridge = Passage(
        start_room=anchor.id, end_room=pairs[anchor.id], waypoints=[(x, y), (end, y)]
    )
    dungeon.add_passage(bridge)
    for xx, room_id, direction_name in [
        (x, anchor.id, "east"),
        (end, pairs[anchor.id], "west"),
    ]:
        dungeon.add_door(
            Door(
                x=xx,
                y=y,
                direction=direction_name,
                room_id=room_id,
                passage_id=bridge.id,
            )
        )
    dungeon.mirror_pairs = {**pairs, **{v: k for k, v in pairs.items()}}
    return dungeon


def generate_constrained(params, seed, size):
    limit = generation_limit(size)
    mirrored = params.symmetry == SymmetryType.BILATERAL
    local = deepcopy(params)
    minimum, maximum = params.get_room_count_range()
    local.symmetry = SymmetryType.NONE
    if mirrored:
        local.room_count = ((minimum + 1) // 2, maximum // 2)
    for attempt in range(24):
        # Retry deterministically without changing the requested density or room sizes.
        dungeon = DungeonGenerator(local).generate(
            seed=(seed + attempt * 104729) & 0x7FFFFFFF
        )
        if mirrored:
            dungeon = mirror_dungeon(dungeon)
        x0, y0, x1, y1 = geometry_bounds(dungeon)
        if (
            x1 - x0 + 4 <= limit
            and y1 - y0 + 4 <= limit
            and minimum <= len(dungeon.rooms) <= maximum
        ):
            dungeon.seed = seed
            for room_id, number in number_dungeon(dungeon).items():
                dungeon.rooms[room_id].number = number
            return dungeon
    raise ProjectValidationError("generationBoundsExceeded")
