"""One-off: clean generated avatars for Lumina.

For each internal/api/web/avatars/aN.png:
  1. Erase the bottom-left "AI generated" watermark by flood-filling that
     corner region with the surrounding background colour before the
     transparency pass.
  2. Flood-fill from the image edges: near-uniform background (white OR
     black, detected from the corner pixel) becomes transparent. Filling
     from the edges only means dark detail INSIDE the glass shape survives.
  3. Trim to the opaque bounding box, pad to square, resize to 256px.
"""
from pathlib import Path

from PIL import Image

AV_DIR = Path(__file__).parent
TOL = 28          # background colour tolerance
SIZE = 256        # final avatar size
WM_BOX = (0.0, 0.88, 0.22, 1.0)  # watermark region, relative (x0,y0,x1,y1)


def edge_colours(img):
    px = img.load()
    w, h = img.size
    pts = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, 0)]
    return [px[x, y][:3] for x, y in pts]


def close(a, b, tol):
    return all(abs(x - y) <= tol for x, y in zip(a, b))


def erase_watermark(img):
    w, h = img.size
    x0, y0 = int(WM_BOX[0] * w), int(WM_BOX[1] * h)
    x1, y1 = int(WM_BOX[2] * w), int(WM_BOX[3] * h)
    bg = img.getpixel((w - 2, h - 2))[:3]  # bottom-right corner = clean bg
    for y in range(y0, y1):
        for x in range(x0, x1):
            img.putpixel((x, y), (*bg, 255))
    return bg


def bg_to_alpha(img, bg):
    """Flood from edges: pixels within TOL of bg become transparent."""
    w, h = img.size
    px = img.load()
    seen = [[False] * w for _ in range(h)]
    stack = [(x, y) for x in range(w) for y in (0, h - 1)]
    stack += [(x, y) for y in range(h) for x in (0, w - 1)]
    while stack:
        x, y = stack.pop()
        if seen[y][x]:
            continue
        seen[y][x] = True
        r, g, b, a = px[x, y]
        if not close((r, g, b), bg, TOL):
            continue
        px[x, y] = (r, g, b, 0)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx]:
                stack.append((nx, ny))


for path in sorted(AV_DIR.glob("a*.png")):
    img = Image.open(path).convert("RGBA")
    bg = erase_watermark(img)
    bg_to_alpha(img, bg)
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)
    side = max(img.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
    square = square.resize((SIZE, SIZE), Image.LANCZOS)
    square.save(path)
    print(f"{path.name}: bg={bg} -> {square.size}")
