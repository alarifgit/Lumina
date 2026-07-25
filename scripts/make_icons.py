"""Slice the Lumina icon sheet into recolorable CSS-mask icons.

The sheet is a 4x4 grid of cream-gold line icons on deep navy. Each cell
becomes a white-on-alpha PNG (alpha derived from luminance) so CSS can
tint it with `background: currentColor` + mask-image — the icons inherit
button text color automatically, like Plex's icon font.
"""
from pathlib import Path
from PIL import Image

SRC = Path("assets/icon-sheet.png")
OUT = Path("internal/api/web/icons")
OUT.mkdir(parents=True, exist_ok=True)

NAVY = (16, 28, 43)
NAMES = [
    ["play", "pause", "back10", "fwd10"],
    ["fullscreen", "volume", "subtitles", "settings"],
    ["download", "user", "close", "back"],
    ["search", "info", "edit", "check"],
]
INSET = 0.16  # crop each cell to its central region (margins are ~25%)
SIZE = 256    # output pixels per icon (used at <=48px in the UI)

img = Image.open(SRC).convert("RGB")
W, H = img.size
cell = W // 4

# Erase the "AI生成" watermark (bottom-left of the sheet) with background
# navy before keying — it sits inside the search cell's corner.
px = img.load()
for y in range(H - 120, H):
    for x in range(0, 230):
        px[x, y] = NAVY

def key_cell(crop: Image.Image) -> Image.Image:
    """Alpha from luminance: light strokes -> opaque white, navy -> clear."""
    g = crop.convert("L")
    out = Image.new("RGBA", crop.size, (255, 255, 255, 0))
    gp, op = g.load(), out.load()
    for y in range(crop.size[1]):
        for x in range(crop.size[0]):
            lum = gp[x, y]
            # bg ~26, strokes ~218: map 60..190 -> 0..255, clamp.
            a = max(0, min(255, int((lum - 60) * 255 / 130)))
            op[x, y] = (255, 255, 255, a)
    return out

for r, row in enumerate(NAMES):
    for c, name in enumerate(row):
        x0, y0 = c * cell, r * cell
        ins = int(cell * INSET)
        crop = img.crop((x0 + ins, y0 + ins, x0 + cell - ins, y0 + cell - ins))
        keyed = key_cell(crop).resize((SIZE, SIZE), Image.LANCZOS)
        keyed.save(OUT / f"ic-{name}.png")
        print("ic-%s.png" % name)

# Bookmark icon: separate 1:1 generation, icon sits centered; erase the
# "AI生成" watermark corner the same way before keying.
bm = Image.open("assets/icon-bookmark-src.png").convert("RGB")
bp = bm.load()
for y in range(bm.size[1] - 130, bm.size[1]):
    for x in range(0, 240):
        bp[x, y] = NAVY
# generous center crop around the ribbon
bx, by = bm.size[0] // 2, bm.size[1] // 2
half = int(bm.size[0] * 0.30)
crop = bm.crop((bx - half, by - half, bx + half, by + half))
key_cell(crop).resize((SIZE, SIZE), Image.LANCZOS).save(OUT / "ic-bookmark.png")
print("ic-bookmark.png")

print("done ->", OUT)
