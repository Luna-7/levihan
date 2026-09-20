#!/usr/bin/env python3
"""Prepare the 语C (roleplay) character portraits for the UI sprite atlas.

Reads the raw artwork from the user's material library, then writes two derived
PNGs per character into ``assets/ui-sprite-sources/``:

* ``角色-<slug>.png``  full-body illustration, trimmed and scaled for the card's
  right-hand column (rendered with ``object-contain``).
* ``头像-<slug>.png``  square head close-up, used for the small circular avatars
  (``rounded-full object-cover``). Cropping a tall full-body into a circle would
  land on the torso, so a dedicated head crop is required.

Both are checked into the repo; ``generate-ui-sprite.py`` then packs them into
``public/images/ui-sprite.webp``. Re-run this script only when the source art
changes:

    /usr/bin/python3 scripts/prepare-roleplay-portraits.py

``/usr/bin/python3`` is required — the managed interpreter has no Pillow.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets/ui-sprite-sources"
RAW_DIR = Path("/Users/luna/Downloads/素材库/png/UI库/语c")

# Full-body target height. The card illustration tops out around 160-250 CSS px,
# so 360 keeps it crisp on retina without bloating the atlas.
FULL_H = 360
# Head close-up edge, in px. The circular avatars render at 44 CSS px.
HEAD_SIDE = 144
# Head square edge as a fraction of figure height, measured off the artwork:
# the chibi heads end (chin) near 62% of the figure, so 66% leaves a sliver of
# neck below the chin.
HEAD_RATIO = 0.66
# Transparent breathing room added above the hair, so the face lands centred in
# the circle instead of riding high.
HEAD_TOP_PAD_RATIO = 0.02
# Alpha below this is treated as empty when measuring the silhouette.
ALPHA_FLOOR = 8

# slug -> raw file name (or an explicit crop rect for the composite sheet)
CHARACTERS = [
    ("armin", "阿尔敏"),
    ("historia", "希斯特利亚"),
    ("eren", "艾伦"),
    ("levi", "利威尔"),
    ("jean", "让"),
    ("mikasa", "三笠"),
    ("sasha", "莎夏"),
    ("connie", "柯尼"),
    ("erwin", "艾尔文"),
    ("reiner", "莱纳"),
    ("hange", "韩吉"),
]
# 阿尼 only exists inside the 8-in-1 composite sheet 语C_副本6.png, as the 7th
# figure (blonde, low ponytail). Box below is in that sheet's pixel space.
ANNIE_SHEET = "语C_副本6.png"
ANNIE_BOX = (561, 1929, 1097, 2515)


def silhouette_bbox(image: Image.Image):
    """Bounding box of everything with alpha above the floor."""
    return image.getchannel("A").point(lambda v: 255 if v > ALPHA_FLOOR else 0).getbbox()


def trim(image: Image.Image) -> Image.Image:
    box = silhouette_bbox(image)
    return image.crop(box) if box else image


def fit_height(image: Image.Image, height: int) -> Image.Image:
    scale = height / image.height
    width = max(1, round(image.width * scale))
    return image.resize((width, height), Image.LANCZOS)


def head_crop(figure: Image.Image) -> Image.Image:
    width, height = figure.size
    side = min(width, round(height * HEAD_RATIO))
    pad = round(height * HEAD_TOP_PAD_RATIO)

    # Centre horizontally on the head, measured from the upper 40% of the
    # silhouette (hair + face) rather than the whole body, which the arms and
    # gear would drag off-centre.
    band = figure.getchannel("A").crop((0, 0, width, max(1, round(height * 0.40))))
    box = band.point(lambda v: 255 if v > ALPHA_FLOOR else 0).getbbox()
    centre = (box[0] + box[2]) / 2 if box else width / 2
    left = max(0, min(width - side, round(centre - side / 2)))

    region = figure.crop((left, 0, left + side, max(1, side - pad)))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.alpha_composite(region, (0, pad))
    return canvas


def load_raw() -> dict[str, Image.Image]:
    if not RAW_DIR.is_dir():
        sys.exit(f"raw artwork folder not found: {RAW_DIR}")

    figures: dict[str, Image.Image] = {}
    for slug, display in CHARACTERS:
        path = RAW_DIR / f"{display}.png"
        if not path.is_file():
            sys.exit(f"missing raw artwork: {path}")
        figures[slug] = trim(Image.open(path).convert("RGBA"))

    sheet = Image.open(RAW_DIR / ANNIE_SHEET).convert("RGBA")
    figures["annie"] = trim(sheet.crop(ANNIE_BOX))
    return figures


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for slug, figure in load_raw().items():
        full = fit_height(figure, FULL_H)
        head = head_crop(figure).resize((HEAD_SIDE, HEAD_SIDE), Image.LANCZOS)
        full.save(OUT_DIR / f"角色-{slug}.png")
        head.save(OUT_DIR / f"头像-{slug}.png")
        print(f"{slug:<10} full={full.size}  head={head.size}")


if __name__ == "__main__":
    main()
