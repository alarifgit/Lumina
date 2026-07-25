# Build Lumina brand assets from the chosen emblem (brand-candidates/logo-emblem-serif.png).
# - crops to the emblem bounding box (drops the generator watermark strip)
# - emits transparent favicon + header mark
# - emits opaque navy squircle icons (android-chrome, apple-touch)
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "brand-candidates" / "logo-emblem-serif.png"
WORDMARK = ROOT / "brand-candidates" / "wordmark-gold.png"
WORDMARK_BLACK = ROOT / "brand-candidates" / "wordmark-black.png"
OUT = ROOT / "internal" / "api" / "web" / "brand"
NAVY = (11, 18, 32)  # deep midnight navy, darker than --bg for icon contrast


def black_to_alpha(im: Image.Image) -> Image.Image:
    """Additive key for glow-on-black art: alpha = max(R,G,B), colours
    UNTOUCHED. The glow was authored additively, so on a dark header the
    semi-transparent pixels composite back to the original render.
    (Un-premultiplying over-saturates gold into neon orange — don't.)"""
    im = im.convert("RGBA")
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, _ = px[x, y]
            px[x, y] = (r, g, b, max(r, g, b))
    return im


def white_to_alpha(im: Image.Image) -> Image.Image:
    """Key out a white background: alpha = 255 - min(R,G,B), then
    un-premultiply so gold keeps its saturation at the edges."""
    im = im.convert("RGBA")
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, _ = px[x, y]
            a = 255 - min(r, g, b)
            if a > 8:
                f = 255 / (255 - min(r, g, b)) if min(r, g, b) < 255 else 1
                px[x, y] = (min(255, int(r * f)), min(255, int(g * f)),
                            min(255, int(b * f)), a)
            else:
                px[x, y] = (0, 0, 0, 0)
    return im


def crop_to_content(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    # The generator watermark sits in the bottom ~12% strip; ignore it when
    # computing the bounding box.
    scan_h = int(h * 0.88)
    xs, ys = [], []
    for y in range(scan_h):
        for x in range(w):
            if px[x, y][3] > 16:
                xs.append(x)
                ys.append(y)
    if not xs:
        raise SystemExit("no visible pixels found")
    pad = int(max(xs) - min(xs)) * 0.06
    box = (
        max(0, int(min(xs) - pad)),
        max(0, int(min(ys) - pad)),
        min(w, int(max(xs) + pad)),
        min(h, int(max(ys) + pad)),
    )
    return im.crop(box)


def squircle(size: int, radius_ratio: float = 0.24) -> Image.Image:
    """Opaque navy rounded-square with a subtle gold rim, apple-touch safe."""
    base = Image.new("RGBA", (size, size), NAVY + (255,))
    rim = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(rim)
    r = int(size * radius_ratio)
    d.rounded_rectangle([2, 2, size - 3, size - 3], radius=r,
                        outline=(175, 145, 95, 200), width=max(2, size // 170))
    return Image.alpha_composite(base, rim)


def paste_centered(bg: Image.Image, fg: Image.Image, scale: float) -> Image.Image:
    s = int(bg.width * scale)
    fg_r = fg.resize((s, int(s * fg.height / fg.width)), Image.LANCZOS)
    x = (bg.width - fg_r.width) // 2
    y = (bg.height - fg_r.height) // 2
    out = bg.copy()
    out.paste(fg_r, (x, y), fg_r)
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    emblem = crop_to_content(Image.open(SRC))
    emblem.save(ROOT / "brand-candidates" / "logo-emblem-serif-cropped.png")

    # Transparent sizes: favicon + header mark master.
    for size, name in [(32, "favicon-32x32.png"), (512, "emblem-512.png")]:
        emblem.resize((size, int(size * emblem.height / emblem.width)),
                      Image.LANCZOS).save(OUT / name)

    # Opaque squircle icons.
    for size, name in [(192, "android-chrome-192x192.png"),
                       (512, "android-chrome-512x512.png"),
                       (180, "apple-touch-icon.png")]:
        icon = paste_centered(squircle(size), emblem, 0.78)
        icon.convert("RGB").save(OUT / name)

    # Wordmark: glow-on-black keys cleanly (additive alpha); the older
    # white-background render is the fallback. Crop above the watermark
    # strip, then ship a tall transparent master for the header.
    wm_src = WORDMARK_BLACK if WORDMARK_BLACK.exists() else WORDMARK
    if wm_src.exists():
        keyer = black_to_alpha if wm_src == WORDMARK_BLACK else white_to_alpha
        wm = keyer(Image.open(wm_src))
        # Watermark sits in the bottom strip — clamp the bbox scan above it.
        px = wm.load()
        xs, ys = [], []
        for y in range(int(wm.height * 0.88)):
            for x in range(wm.width):
                if px[x, y][3] > 16:
                    xs.append(x)
                    ys.append(y)
        if xs:
            wm = wm.crop((min(xs), min(ys), max(xs) + 1, max(ys) + 1))
        wm.save(ROOT / "brand-candidates" / "wordmark-transparent.png")
        target_h = 512
        wm.resize((int(target_h * wm.width / wm.height), target_h),
                  Image.LANCZOS).save(OUT / "wordmark.png")

    print("wrote:", *[p.name for p in sorted(OUT.iterdir())], sep="\n  ")


if __name__ == "__main__":
    main()
