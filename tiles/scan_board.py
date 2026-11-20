"""Check a board photo from the command line (same scanner the app uses).

    python tiles/scan_board.py board.jpg --expect 20

Prints the tiles found and saves board_scan.jpg (outlined preview) next to the photo.
"""
import argparse
import base64
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from server.scanner import scan_image  # noqa: E402
from server.tileset import TERRAINS  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description="Read Snap Quest tiles from a board photo.")
    ap.add_argument("photo")
    ap.add_argument("--expect", type=int, help="how many tiles are on the table")
    args = ap.parse_args()

    with open(args.photo, "rb") as f:
        result = scan_image(f.read())
    tiles = result["tiles"]
    print(f"Tiles found: {len(tiles)}" + (f" of {args.expect}" if args.expect else ""))
    for t in tiles:
        print(f"  {t['label']:5} {TERRAINS[t['terrain']]['name']:9} hex ({t['q']:>2},{t['r']:>2})  "
              f"rotated {t['rotation']:>3} deg")
    if result["marker_px"]:
        print(f"Marker size in photo: min {result['marker_px']['min']} px, "
              f"median {result['marker_px']['median']} px (aim for 40+ px)")
    for w in result["warnings"]:
        print("! " + w)
    if args.expect and len(tiles) < args.expect:
        print(f"Missing {args.expect - len(tiles)} tile(s).")
    if result["preview"]:
        out = os.path.splitext(args.photo)[0] + "_scan.jpg"
        with open(out, "wb") as f:
            f.write(base64.b64decode(result["preview"]))
        print(f"Saved {out}")


if __name__ == "__main__":
    main()
