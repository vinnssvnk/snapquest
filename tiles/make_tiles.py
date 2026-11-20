"""Make a print-and-play A4 PDF of Snap Quest hex tiles with ArUco markers.

    python make_tiles.py                  -> snap_quest_tiles_A4.pdf
    python make_tiles.py -o my_tiles.pdf

Everything is drawn as vectors, so markers stay sharp at any printer resolution.
Print at 100% (no "fit to page"), on matte card stock.
"""
import argparse
import math
import os
import sys

import cv2
import pymupdf

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from server.tileset import (  # noqa: E402
    ARUCO_DICT_NAME, HEX_HEIGHT, HEX_RADIUS, HEX_WIDTH,
                     LABEL_CENTER, MARKER_CENTER, MARKER_SIZE, QUIET_ZONE,
                     TERRAINS, TILES, hex_corners)

MM = 72 / 25.4                      # PDF points per millimetre
PAGE_W, PAGE_H = 210.0, 297.0       # A4, mm
COLS, ROWS = 3, 6                   # 18 tiles per sheet, honeycomb layout
GRID_TOP = 16.0                     # mm, top of the first hex row
ROW_STEP = 1.5 * HEX_RADIUS
GRID_LEFT = (PAGE_W - (COLS + 0.5) * HEX_WIDTH) / 2

BORDER = "#8fd3b6"
CUT = "#1a1a1a"

FONT_CANDIDATES = [
    ("C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/arialbd.ttf"),
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
     "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ("/System/Library/Fonts/Supplemental/Arial.ttf",
     "/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
]


def rgb(hex_color):
    h = hex_color.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def pt(x, y):
    return pymupdf.Point(x * MM, y * MM)


class Sheet:
    """Thin wrapper so all drawing below is in millimetres."""

    def __init__(self, page, fonts):
        self.page = page
        self.fonts = fonts          # {"regular": (name, Font), "bold": (name, Font)}

    def poly(self, pts, fill=None, color=None, width=0.0, close=True):
        s = self.page.new_shape()
        s.draw_polyline([pt(*p) for p in pts])
        s.finish(fill=rgb(fill) if fill else None, color=rgb(color) if color else None,
                 width=width * MM, closePath=close, lineJoin=1, lineCap=1)
        s.commit()

    def circle(self, c, r, fill=None, color=None, width=0.0):
        s = self.page.new_shape()
        s.draw_circle(pt(*c), r * MM)
        s.finish(fill=rgb(fill) if fill else None, color=rgb(color) if color else None,
                 width=width * MM)
        s.commit()

    def rect(self, x0, y0, x1, y1, fill, radius=None):
        s = self.page.new_shape()
        r = pymupdf.Rect(x0 * MM, y0 * MM, x1 * MM, y1 * MM)
        if radius:
            s.draw_rect(r, radius=min(0.5, radius / min(x1 - x0, y1 - y0)))
        else:
            s.draw_rect(r)
        s.finish(fill=rgb(fill), color=None, width=0)
        s.commit()

    def text(self, x, y, txt, size, bold=False, color="#1a1a1a", align="left"):
        name, font = self.fonts["bold" if bold else "regular"]
        w = font.text_length(txt, fontsize=size) / MM
        if align == "center":
            x -= w / 2
        elif align == "right":
            x -= w
        self.page.insert_text(pt(x, y), txt, fontname=name, fontsize=size, color=rgb(color))
        return w


# --- terrain glyphs (drawn around the marker) --------------------------------
GLYPH_SPOTS = [(0, -19.5), (-14, -11), (14, -11), (-16.5, 5), (16.5, 5), (-10, 17.5), (10, 17.5)]


def glyph(sh, terrain, x, y, ink, fill):
    if terrain == "plains":
        for dx, dy in ((-2.6, 1.2), (0, -1.4), (2.6, 1.2)):
            sh.poly([(x + dx - 1, y + dy + 1), (x + dx, y + dy - 1), (x + dx + 1, y + dy + 1)],
                    color=ink, width=0.45, close=False)
    elif terrain == "forest":
        for dx, dy, r in ((-1.9, 1.0, 2.0), (1.9, 1.0, 2.0), (0, -1.9, 2.1)):
            sh.circle((x + dx, y + dy), r, fill="#3f8a5a", color=ink, width=0.35)
    elif terrain == "mountain":
        sh.poly([(x - 4.5, y + 2.6), (x - 1.5, y - 2.4), (x + 1.5, y + 2.6)], fill=ink)
        sh.poly([(x - 1, y + 2.6), (x + 1.8, y - 3.4), (x + 4.6, y + 2.6)], fill="#6e737a")
        sh.poly([(x + 0.9, y - 1.8), (x + 1.8, y - 3.4), (x + 2.7, y - 1.8)], fill="#ffffff")
    elif terrain == "water":
        for dy in (-1.3, 1.3):
            wave = [(x - 4 + i * 0.4, y + dy + 0.7 * math.sin(i * 0.4 * 1.6)) for i in range(21)]
            sh.poly(wave, color=ink, width=0.45, close=False)
    elif terrain == "swamp":
        sh.poly([(x - 3.5, y + 2.4), (x + 3.5, y + 2.4)], color=ink, width=0.5, close=False)
        for dx, h in ((-2, 3.6), (0, 4.8), (2, 3.0)):
            sh.poly([(x + dx, y + 2.4), (x + dx, y + 2.4 - h)], color=ink, width=0.45, close=False)
    elif terrain == "village":
        for dx, s in ((-1.9, 1.0), (2.0, 0.85)):
            sh.poly([(x + dx - 1.6 * s, y + 2.4), (x + dx - 1.6 * s, y), (x + dx, y - 1.7 * s),
                     (x + dx + 1.6 * s, y), (x + dx + 1.6 * s, y + 2.4)], fill=ink)
    elif terrain == "ruins":
        for dx, dy, w, h in ((-3, -0.5, 1.6, 3.2), (-0.5, 0.6, 1.6, 2.1), (2, -1.6, 1.6, 4.3)):
            sh.rect(x + dx, y + dy, x + dx + w, y + dy + h, fill=ink, radius=0.4)


def marker(sh, marker_img, cx, cy):
    """Quiet zone + ArUco marker. Black square first, then all white modules as
    one filled path, so there are no hairline seams between modules."""
    h = MARKER_SIZE / 2
    q = h + QUIET_ZONE
    sh.rect(cx - q, cy - q, cx + q, cy + q, fill="#ffffff", radius=1.2)
    sh.rect(cx - h, cy - h, cx + h, cy + h, fill="#000000")
    n = marker_img.shape[0]
    m = MARKER_SIZE / n
    s = sh.page.new_shape()
    for row in range(n):
        for col in range(n):
            if marker_img[row, col] > 127:
                x0, y0 = cx - h + col * m, cy - h + row * m
                s.draw_rect(pymupdf.Rect(x0 * MM, y0 * MM, (x0 + m) * MM, (y0 + m) * MM))
    s.finish(fill=(1, 1, 1), color=None, width=0)
    s.commit()


def draw_tile(sh, tile, cx, cy, marker_img):
    t = TERRAINS[tile["terrain"]]
    sh.poly(hex_corners(cx, cy), fill=t["fill"])
    sh.poly(hex_corners(cx, cy, HEX_RADIUS - 1.3), color=BORDER, width=0.9)
    for gx, gy in GLYPH_SPOTS:
        glyph(sh, tile["terrain"], cx + gx, cy + gy, t["ink"], t["fill"])
    marker(sh, marker_img, cx + MARKER_CENTER[0], cy + MARKER_CENTER[1])
    lx, ly = cx + LABEL_CENTER[0], cy + LABEL_CENTER[1]
    sh.rect(lx - 6.5, ly - 2.6, lx + 6.5, ly + 2.6, fill="#ffffff", radius=2.6)
    sh.text(lx, ly + 1.1, tile["label"], 8.5, bold=True, align="center")
    # cut line on top of everything
    sh.poly(hex_corners(cx, cy), color=CUT, width=0.25)


def slot_center(i):
    row, col = divmod(i, COLS)
    x = GRID_LEFT + HEX_WIDTH / 2 + col * HEX_WIDTH + (HEX_WIDTH / 2 if row % 2 else 0)
    y = GRID_TOP + HEX_RADIUS + row * ROW_STEP
    return x, y


def header(sh, page_no, pages):
    sh.text(GRID_LEFT, 8, "SNAP QUEST", 10, bold=True)
    sh.text(GRID_LEFT + 25, 8, f"тайли · аркуш {page_no}/{pages}", 9, color="#555555")
    sh.text(GRID_LEFT, 12.5, "Друкуйте у масштабі 100% (без «підігнати під сторінку»), "
            "на матовому картоні 200–300 г/м². Ріжте по чорному контуру.", 7, color="#555555")
    # 50 mm scale bar to check the print scale with a ruler
    x1 = PAGE_W - GRID_LEFT
    x0 = x1 - 50
    sh.poly([(x0, 7), (x1, 7)], color="#000000", width=0.3, close=False)
    for x in (x0, x0 + 10, x0 + 20, x0 + 30, x0 + 40, x1):
        sh.poly([(x, 5.8 if x in (x0, x1) else 6.3), (x, 7)], color="#000000", width=0.3, close=False)
    sh.text(x1, 10, "50 мм — перевірте лінійкою", 6.5, color="#555555", align="right")


def legend(sh, x, y):
    sh.text(x, y, "Типи тайлів", 9, bold=True)
    y += 5.5
    for key, t in TERRAINS.items():
        count = sum(1 for tile in TILES if tile["terrain"] == key)
        sh.poly(hex_corners(x + 2.2, y - 1.2, 2.6), fill=t["fill"], color=CUT, width=0.15)
        sh.text(x + 6.5, y, f"{t['code']}  {t['name']}  ×{count}", 8)
        y += 5.2
    y += 1.5
    for line in ("Маркер: ArUco 4x4, 12 мм.",
                 "Номер маркера = номер тайла.",
                 "Не загинайте білий квадрат.",
                 "Під час фото — без мініатюр",
                 "на маркерах."):
        sh.text(x, y, line, 7, color="#555555")
        y += 4.2


def load_fonts(doc_page):
    for regular, bold in FONT_CANDIDATES:
        if os.path.exists(regular) and os.path.exists(bold):
            doc_page.insert_font(fontname="sqR", fontfile=regular)
            doc_page.insert_font(fontname="sqB", fontfile=bold)
            return {"regular": ("sqR", pymupdf.Font(fontfile=regular)),
                    "bold": ("sqB", pymupdf.Font(fontfile=bold))}
    raise SystemExit("No TTF font with Cyrillic found; add one to FONT_CANDIDATES.")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument("-o", "--out", default=os.path.join(here, "snap_quest_tiles_A4.pdf"))
    args = ap.parse_args()

    aruco = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, ARUCO_DICT_NAME))
    per_page = COLS * ROWS
    pages = math.ceil(len(TILES) / per_page)
    doc = pymupdf.open()
    for p in range(pages):
        page = doc.new_page(width=PAGE_W * MM, height=PAGE_H * MM)
        sh = Sheet(page, load_fonts(page))
        header(sh, p + 1, pages)
        chunk = TILES[p * per_page:(p + 1) * per_page]
        for i, tile in enumerate(chunk):
            img = aruco.generateImageMarker(tile["id"], 6)   # 4x4 bits + 1-module border
            draw_tile(sh, tile, *slot_center(i), img)
        if p == pages - 1 and len(chunk) <= 14:
            # free corner under row 3, right of the last tiles
            legend(sh, GRID_LEFT + 2 * HEX_WIDTH + 6, GRID_TOP + 3 * ROW_STEP + HEX_HEIGHT + 6)
    doc.set_metadata({"title": "Snap Quest tiles (A4)", "creator": "make_tiles.py"})
    doc.save(args.out, garbage=3, deflate=True)
    print(f"{len(TILES)} tiles on {pages} A4 pages -> {args.out}")


if __name__ == "__main__":
    main()
