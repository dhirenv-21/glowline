"""Draws Glowline's app icon (build/icon.png + build/icon.ico) with Pillow.

A dark rounded tile with a glowing violet-to-teal "screen" ring, the same idea as the
in-app mark. Run:  python build/make-icon.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageChops

S = 1024
HERE = Path(__file__).resolve().parent


def gradient(size, c1, c2):
    """Diagonal two-colour gradient."""
    w, h = size
    base = Image.new('RGB', size, c1)
    top = Image.new('RGB', size, c2)
    lin = Image.linear_gradient('L').resize(size)            # top → bottom
    mask = ImageChops.add(lin, lin.rotate(90), scale=2.0)      # average with left → right = smooth diagonal
    return Image.composite(top, base, mask)


def rounded_mask(size, box, radius, width=None):
    m = Image.new('L', size, 0)
    d = ImageDraw.Draw(m)
    if width:
        d.rounded_rectangle(box, radius=radius, outline=255, width=width)
    else:
        d.rounded_rectangle(box, radius=radius, fill=255)
    return m


def main():
    size = (S, S)
    icon = Image.new('RGBA', size, (0, 0, 0, 0))

    # Tile: near-black with a faint inner gradient.
    tile_mask = rounded_mask(size, (40, 40, S - 40, S - 40), 220)
    tile = gradient(size, (14, 12, 28), (4, 18, 24)).convert('RGBA')
    icon.paste(tile, (0, 0), tile_mask)

    # Glowing ring.
    ring_box = (250, 320, S - 250, S - 320)
    color = gradient(size, (124, 108, 255), (0, 214, 190)).convert('RGBA')
    ring = rounded_mask(size, ring_box, 70, width=46)
    for blur, strength in ((90, 1.0), (40, 0.9), (14, 0.8)):
        glow = ring.filter(ImageFilter.GaussianBlur(blur)).point(lambda v, s=strength: int(min(255, v * 2.2 * s)))
        glow = ImageChops.multiply(glow, tile_mask)
        icon = Image.composite(color, icon, glow)
    # Bright core of the ring, slightly whitened.
    core = Image.blend(color, Image.new('RGBA', size, (255, 255, 255, 255)), 0.35)
    icon = Image.composite(core, icon, rounded_mask(size, ring_box, 70, width=26))

    out_png = HERE / 'icon.png'
    icon.save(out_png)
    icon.save(HERE / 'icon.ico', sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
    icon.resize((256, 256), Image.LANCZOS).save(HERE.parent.parent / 'docs' / 'icon.png')
    print('wrote', out_png)


if __name__ == '__main__':
    (HERE.parent.parent / 'docs').mkdir(exist_ok=True)
    main()
