"""Generates icons/icon{16,48,128}.png. Run: python3 tools/generate-icons.py (needs Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw

S = 1024  # draw large, then downscale for clean anti-aliasing
OUT = Path(__file__).resolve().parent.parent / "icons"


def gradient(size, top, bottom):
    img = Image.new("RGBA", (size, size))
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / (size - 1)
        d.line([(0, y), (size, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(top, bottom)) + (255,))
    return img


def draw_icon():
    bg = gradient(S, (99, 102, 241), (124, 58, 237))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=255)
    icon = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    icon.paste(bg, (0, 0), mask)
    d = ImageDraw.Draw(icon)

    # The "trail": three step nodes joined by a zig-zag path.
    nodes = [(S * 0.26, S * 0.74), (S * 0.50, S * 0.50), (S * 0.30, S * 0.30), (S * 0.62, S * 0.22)]
    d.line(nodes[:3], fill="white", width=int(S * 0.075), joint="curve")
    d.line([nodes[2], nodes[3]], fill=(255, 255, 255, 200), width=int(S * 0.075))
    for i, (x, y) in enumerate(nodes[:3]):
        r = S * (0.085 if i == 0 else 0.07)
        d.ellipse([x - r, y - r, x + r, y + r], fill="white")

    # Record dot with a white ring, bottom right.
    cx, cy, r = S * 0.72, S * 0.70, S * 0.15
    d.ellipse([cx - r - S * 0.035, cy - r - S * 0.035, cx + r + S * 0.035, cy + r + S * 0.035], fill="white")
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(239, 68, 68))
    return icon


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    big = draw_icon()
    for size in (16, 48, 128):
        big.resize((size, size), Image.LANCZOS).save(OUT / f"icon{size}.png")
    big.resize((256, 256), Image.LANCZOS).save(OUT / "icon-256.png")
    print("icons written to", OUT)
