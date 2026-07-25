# Build Lumina brand assets from the chosen emblem (brand-candidates/logo-emblem-serif.png).
# - crops to the emblem bounding box (drops the generator watermark strip)
# - emits transparent favicon + header mark
# - emits opaque navy squircle icons (android-chrome, apple-touch)
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "brand-candidates" / "logo-emblem-serif.png"
OUT = ROOT / "internal" / "api" / "web" / "brand"
NAVY = (11, 18, 32)  # deep midnight navy, darker than --bg for icon contrast


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

    print("wrote:", *[p.name for p in sorted(OUT.iterdir())], sep="\n  ")


if __name__ == "__main__":
    main()
