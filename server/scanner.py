"""Read a photo of a Snap Quest board: which tiles are there, where, and how rotated.

scan_image(bytes) -> dict, used by the web API and by tiles/scan_board.py.
"""
import base64
import math

import cv2
import numpy as np

from .tileset import (ARUCO_DICT_NAME, TERRAINS, TILE_BY_ID, axial_to_board,
                      board_to_axial, hex_corners, marker_corners)

MARKER_TILE = np.array(marker_corners(), dtype=np.float32)   # 4x2, mm, tile frame
HEX_TILE = np.array(hex_corners(), dtype=np.float32)          # 6x2, mm, tile frame
MAX_SIDE = 4000          # larger photos are scaled down before detection
PREVIEW_SIDE = 1200      # annotated preview sent back to the phone
GOOD_MARKER_PX = 40


class ScanError(ValueError):
    pass


def _detector():
    params = cv2.aruco.DetectorParameters()
    params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
    params.adaptiveThreshWinSizeMax = 53        # helps with uneven light across the board
    return cv2.aruco.ArucoDetector(
        cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, ARUCO_DICT_NAME)), params)


_DETECTOR = _detector()


def detect(gray):
    corners, ids, rejected = _DETECTOR.detectMarkers(gray)
    found, duplicates = {}, []
    for c, i in zip(corners, ids.flatten() if ids is not None else []):
        i = int(i)
        if i not in TILE_BY_ID:
            continue
        if i in found:
            duplicates.append(i)
        found[i] = c.reshape(4, 2).astype(np.float32)
    return found, duplicates, _likely_markers(gray, rejected, found)


def _likely_markers(gray, rejected, found):
    """Keep only rejected candidates that look like an unreadable tile marker:
    a dark square inside a white frame, not overlapping a marker we did read.
    (The detector also rejects tree clusters, label pills, etc. - ignore those.)"""
    centres = [c.mean(axis=0) for c in found.values()]
    size = np.median([math.sqrt(cv2.contourArea(c)) for c in found.values()]) if found else 0
    keep = []
    for cand in rejected:
        quad = cand.reshape(4, 2).astype(np.float32)
        side = math.sqrt(max(cv2.contourArea(quad), 1))
        mid = quad.mean(axis=0)
        if any(np.linalg.norm(mid - c) < max(side, size) for c in centres):
            continue
        inner = np.zeros(gray.shape, np.uint8)
        outer = np.zeros(gray.shape, np.uint8)
        cv2.fillPoly(inner, [quad.astype(np.int32)], 255)
        cv2.fillPoly(outer, [((quad - mid) * 1.35 + mid).astype(np.int32)], 255)
        outer[inner > 0] = 0
        if outer.any() and inner.any():
            if cv2.mean(gray, outer)[0] - cv2.mean(gray, inner)[0] > 50:
                keep.append(quad)
    return keep


def _rotate(pts, deg):
    a = math.radians(deg)
    m = np.array([[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]], dtype=np.float32)
    return pts @ m.T


def place(found):
    """Fit tiles onto the hex grid.

    Start from one marker's own perspective (its homography maps image -> mm),
    snap every tile to the nearest hex and 60-degree rotation, then fit one
    homography for the whole board from all markers and snap again.
    Returns ({id: {q, r, rotation}}, board->image homography).
    """
    ids = sorted(found)
    ref = max(ids, key=lambda i: cv2.contourArea(found[i]))   # biggest = closest/sharpest
    to_board = cv2.getPerspectiveTransform(found[ref], MARKER_TILE)

    placement = {}
    for _ in range(3):
        placement = {}
        for i in ids:
            pts = cv2.perspectiveTransform(found[i][None], to_board)[0]
            right = pts[1] - pts[0]
            rot = (round(math.degrees(math.atan2(right[1], right[0])) / 60) * 60) % 360
            centre = pts.mean(axis=0) - _rotate(MARKER_TILE.mean(axis=0)[None], rot)[0]
            q, r = board_to_axial(*centre)
            placement[i] = {"q": q, "r": r, "rotation": rot}
        src, dst = [], []
        for i, p in placement.items():
            cx, cy = axial_to_board(p["q"], p["r"])
            src.append(_rotate(MARKER_TILE, p["rotation"]) + (cx, cy))
            dst.append(found[i])
        if len(placement) >= 2:
            board_to_img, _ = cv2.findHomography(np.vstack(src), np.vstack(dst), cv2.RANSAC, 8.0)
            if board_to_img is not None:
                to_board = np.linalg.inv(board_to_img)
    return placement, np.linalg.inv(to_board)


def _upright(placement, board_to_img):
    """Turn the grid (in 60-degree steps) so the app's map faces the same way as the photo."""
    p = cv2.perspectiveTransform(np.float32([[[0, 0], [100, 0]]]), board_to_img)[0]
    angle = math.degrees(math.atan2(p[1][1] - p[0][1], p[1][0] - p[0][0]))
    k = round(angle / 60) % 6
    if not k:
        return placement
    out = {}
    for i, t in placement.items():
        x, y = _rotate(np.float32([axial_to_board(t["q"], t["r"])]), k * 60)[0]
        q, r = board_to_axial(float(x), float(y))
        out[i] = {"q": q, "r": r, "rotation": (t["rotation"] + k * 60) % 360}
    return out


def _bgr(hex_color):
    h = hex_color.lstrip("#")
    return tuple(int(h[k:k + 2], 16) for k in (4, 2, 0))


def annotate(img, found, placement, board_to_img, unreadable):
    out = img.copy()
    scale = max(1.0, max(img.shape[:2]) / 1600)
    thick = max(2, int(2 * scale))
    for quad in unreadable:
        cv2.polylines(out, [quad.reshape(-1, 1, 2).astype(np.int32)], True, (40, 40, 230), thick * 2)
    cells = {}
    for i, p in placement.items():
        cells.setdefault((p["q"], p["r"]), []).append(i)
    for i, p in placement.items():
        tile = TILE_BY_ID[i]
        cx, cy = axial_to_board(p["q"], p["r"])
        outline = cv2.perspectiveTransform((_rotate(HEX_TILE, p["rotation"]) + (cx, cy))[None],
                                           board_to_img)[0].astype(np.int32).reshape(-1, 1, 2)
        clash = len(cells[(p["q"], p["r"])]) > 1
        colour = (40, 40, 230) if clash else _bgr(TERRAINS[tile["terrain"]]["fill"])
        cv2.polylines(out, [outline], True, (255, 255, 255), thick * 3)
        cv2.polylines(out, [outline], True, colour, thick)
        cv2.polylines(out, [found[i].astype(np.int32).reshape(-1, 1, 2)], True, (80, 200, 80), thick)
        org = tuple(int(v) for v in found[i].mean(axis=0) + (-45 * scale, 45 * scale))
        cv2.putText(out, tile["label"], org, cv2.FONT_HERSHEY_SIMPLEX, 0.8 * scale, (0, 0, 0), thick * 3)
        cv2.putText(out, tile["label"], org, cv2.FONT_HERSHEY_SIMPLEX, 0.8 * scale, (255, 255, 255), thick)
    return out, [ids for ids in cells.values() if len(ids) > 1]


def _jpeg_b64(img, side):
    h, w = img.shape[:2]
    k = side / max(h, w)
    if k < 1:
        img = cv2.resize(img, (int(w * k), int(h * k)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 80])
    return base64.b64encode(buf.tobytes()).decode("ascii") if ok else None


def decode(data: bytes):
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ScanError("This file is not a photo we can read (use JPG or PNG).")
    h, w = img.shape[:2]
    k = MAX_SIDE / max(h, w)
    if k < 1:
        img = cv2.resize(img, (int(w * k), int(h * k)), interpolation=cv2.INTER_AREA)
    return img


def scan_image(data: bytes, preview=True):
    """Scan photo bytes. Returns a JSON-ready dict (see keys below)."""
    img = decode(data)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    found, duplicates, unreadable = detect(gray)

    if not found:
        return {"tiles": [], "unreadable": len(unreadable), "duplicates": [], "clashes": [],
                "marker_px": None, "warnings": [
                    "No tiles found. Make sure the whole board is in frame, in focus and without glare."],
                "preview": _jpeg_b64(img, PREVIEW_SIDE) if preview else None}

    placement, board_to_img = place(found)
    vis, clashes = annotate(img, found, placement, board_to_img, unreadable)
    placement = _upright(placement, board_to_img)
    sizes = [math.sqrt(cv2.contourArea(c)) for c in found.values()]

    # (q, r) are relative to one reference tile; only neighbours and rotations matter
    tiles = []
    for i in sorted(found, key=lambda k: (placement[k]["r"], placement[k]["q"])):
        p = placement[i]
        t = TILE_BY_ID[i]
        tiles.append({"id": i, "label": t["label"], "terrain": t["terrain"],
                      "q": p["q"], "r": p["r"], "rotation": p["rotation"]})

    warnings = []
    if unreadable:
        warnings.append(f"{len(unreadable)} marker(s) could not be read (red in the photo). "
                        "Check glare, focus, or minis covering them.")
    if duplicates:
        warnings.append("The same tile appears twice: " +
                        ", ".join(TILE_BY_ID[i]["label"] for i in duplicates) + ".")
    if clashes:
        warnings.append("Some tiles landed on the same hex - take the photo more from above.")
    if min(sizes) < GOOD_MARKER_PX * 0.6:
        warnings.append("Some markers are very small in the photo - move the phone closer.")

    return {"tiles": tiles, "unreadable": len(unreadable),
            "duplicates": [TILE_BY_ID[i]["label"] for i in duplicates],
            "clashes": [[TILE_BY_ID[i]["label"] for i in c] for c in clashes],
            "marker_px": {"min": round(min(sizes)), "median": round(float(np.median(sizes)))},
            "warnings": warnings,
            "preview": _jpeg_b64(vis, PREVIEW_SIDE) if preview else None}
