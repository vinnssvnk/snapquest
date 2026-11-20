"""Shared Snap Quest tile definitions: terrain types, marker ids, tile geometry.

Both make_tiles.py (printing) and scan_board.py (detection) import this file,
so the printed tiles and the scanner always agree.

Geometry is in millimetres, in the tile's own frame: origin at the hex centre,
x to the right, y DOWN (same direction as image rows). Hexes are pointy-top.
"""
import math

# ArUco dictionary: 4x4 bits, 50 ids. 4x4 is the most robust at small print sizes.
ARUCO_DICT_NAME = "DICT_4X4_50"

# --- terrain types -----------------------------------------------------------
# code: letter on the tile label (R-12 = river tile with marker 12)
TERRAINS = {
    "plains":   {"code": "P", "name": "Plains",   "fill": "#c9c06a", "ink": "#8c8536"},
    "forest":   {"code": "F", "name": "Forest",   "fill": "#2f6b46", "ink": "#1d4a2f"},
    "mountain": {"code": "M", "name": "Mountain", "fill": "#a3a7ad", "ink": "#5d6168"},
    "water":    {"code": "R", "name": "River",    "fill": "#3f86b8", "ink": "#bfe0f2"},
    "swamp":    {"code": "S", "name": "Swamp",    "fill": "#6b7a3a", "ink": "#3c4520"},
    "village":  {"code": "V", "name": "Village",  "fill": "#d9b98a", "ink": "#7a4f2a"},
    "ruins":    {"code": "U", "name": "Ruins",    "fill": "#a8846a", "ink": "#5e4433"},
}

# How many tiles of each type are in the set. Total must be <= 50 (dictionary size).
COUNTS = {
    "plains": 10, "forest": 10, "water": 9, "mountain": 7,
    "swamp": 6, "village": 4, "ruins": 4,
}


def build_tiles():
    """Return a list of tiles, one per marker id: {id, terrain, label}.

    Types are interleaved (round-robin) rather than in blocks, so a printed
    sheet has a mix of terrains and losing one sheet does not lose a type.
    """
    remaining = dict(COUNTS)
    order = list(COUNTS)
    tiles = []
    while any(remaining.values()):
        for t in order:
            if remaining[t]:
                remaining[t] -= 1
                mid = len(tiles)
                tiles.append({"id": mid, "terrain": t,
                              "label": f"{TERRAINS[t]['code']}-{mid:02d}"})
    assert len(tiles) <= 50, "DICT_4X4_50 has only 50 markers"
    return tiles


TILES = build_tiles()
TILE_BY_ID = {t["id"]: t for t in TILES}

# --- geometry (mm) -----------------------------------------------------------
HEX_WIDTH = 50.0                        # flat side to flat side
HEX_RADIUS = HEX_WIDTH / math.sqrt(3)   # centre to corner (28.87)
HEX_HEIGHT = 2 * HEX_RADIUS             # corner to corner (57.74)

MARKER_SIZE = 12.0          # black square edge, incl. the black border modules
MARKER_CENTER = (0.0, -2.0)
QUIET_ZONE = 2.0            # white margin around the marker on every side
LABEL_CENTER = (0.0, 11.0)


def hex_corners(cx=0.0, cy=0.0, r=HEX_RADIUS):
    """Pointy-top hex corners, clockwise from the top corner (y down)."""
    return [(cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a)))
            for a in (-90, -30, 30, 90, 150, 210)]


def marker_corners():
    """Marker corners in the tile frame, in OpenCV's order: TL, TR, BR, BL."""
    mx, my = MARKER_CENTER
    h = MARKER_SIZE / 2
    return [(mx - h, my - h), (mx + h, my - h), (mx + h, my + h), (mx - h, my + h)]


def axial_to_board(q, r):
    """Centre of hex (q, r) on the board, in mm (pointy-top axial coordinates)."""
    return (HEX_WIDTH * (q + r / 2), 1.5 * HEX_RADIUS * r)


def board_to_axial(x, y):
    """Nearest hex (q, r) for a board point in mm."""
    r = y / (1.5 * HEX_RADIUS)
    q = x / HEX_WIDTH - r / 2
    # cube rounding
    s = -q - r
    rq, rr, rs = round(q), round(r), round(s)
    dq, dr, ds = abs(rq - q), abs(rr - r), abs(rs - s)
    if dq > dr and dq > ds:
        rq = -rr - rs
    elif dr > ds:
        rr = -rq - rs
    return int(rq), int(rr)
