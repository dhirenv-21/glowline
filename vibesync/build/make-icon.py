"""Draws the VibeSync app icon (build/icon.png + build/icon.ico + docs/icon.png) with Pillow.

A dark rounded tile with a glowing violet -> pink -> teal "screen" outline and a bright music
pulse running through it: light around your screen, in sync with the beat. The same geometry
is used by docs/logo.svg. Run:  python build/make-icon.py
"""
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter

S = 1024
HERE = Path(__file__).resolve().parent
DOCS = HERE.parent.parent / 'docs'

VIOLET = (124, 108, 255)
PINK = (255, 79, 160)
TEAL = (0, 214, 190)

RING_BOX = (214, 290, S - 214, S - 290)     # the "screen"
RING_RADIUS = 92
RING_WIDTH = 46
# Music pulse across the screen (x, y): calm, a beat, calm.
PULSE = [(262, 512), (380, 512), (424, 452), (470, 600), (520, 382), (572, 646), (618, 470), (652, 512), (762, 512)]
PULSE_WIDTH = 38


def horizontal_gradient(size, stops):
    """Left-to-right gradient through several colors."""
    w, h = size
    row = Image.new('RGB', (w, 1))
    px = row.load()
    for x in range(w):
        t = x / (w - 1) * (len(stops) - 1)
        i = min(int(t), len(stops) - 2)
        f = t - i
        a, b = stops[i], stops[i + 1]
        px[x, 0] = tuple(round(a[k] + (b[k] - a[k]) * f) for k in range(3))
    return row.resize(size, Image.NEAREST)


def diagonal_gradient(size, c1, c2):
    lin = Image.linear_gradient('L').resize(size)
    mask = ImageChops.add(lin, lin.rotate(90), scale=2.0)
    return Image.composite(Image.new('RGB', size, c2), Image.new('RGB', size, c1), mask)


def shape_mask(draw_fn):
    m = Image.new('L', (S, S), 0)
    draw_fn(ImageDraw.Draw(m))
    return m


def glow(icon, color_img, mask, clip):
    """Layered bloom: wide soft halo, tighter glow, crisp core."""
    for blur, gain in ((60, 0.75), (22, 1.3), (8, 2.0)):
        g = mask.filter(ImageFilter.GaussianBlur(blur)).point(lambda v, k=gain: int(min(255, v * k)))
        icon = Image.composite(color_img, icon, ImageChops.multiply(g, clip))
    return Image.composite(color_img, icon, mask)


def main():
    size = (S, S)
    icon = Image.new('RGBA', size, (0, 0, 0, 0))

    tile = shape_mask(lambda d: d.rounded_rectangle((40, 40, S - 40, S - 40), radius=230, fill=255))
    icon.paste(diagonal_gradient(size, (18, 11, 42), (4, 22, 31)).convert('RGBA'), (0, 0), tile)

    ring_color = horizontal_gradient(size, [VIOLET, PINK, TEAL]).convert('RGBA')
    ring = shape_mask(lambda d: d.rounded_rectangle(RING_BOX, radius=RING_RADIUS, outline=255, width=RING_WIDTH))
    icon = glow(icon, ring_color, ring, tile)

    # Pulse: white-hot core with a pink/violet glow.
    pulse = shape_mask(lambda d: d.line(PULSE, fill=255, width=PULSE_WIDTH, joint='curve'))
    caps = shape_mask(lambda d: [d.ellipse((x - PULSE_WIDTH / 2, y - PULSE_WIDTH / 2, x + PULSE_WIDTH / 2, y + PULSE_WIDTH / 2), fill=255) for x, y in (PULSE[0], PULSE[-1])])
    pulse = ImageChops.lighter(pulse, caps)
    pulse_glow_color = horizontal_gradient(size, [VIOLET, PINK, TEAL]).convert('RGBA')
    halo = pulse.filter(ImageFilter.GaussianBlur(22)).point(lambda v: int(min(255, v * 1.8)))
    icon = Image.composite(pulse_glow_color, icon, ImageChops.multiply(halo, tile))
    icon = Image.composite(Image.new('RGBA', size, (255, 255, 255, 255)), icon, pulse)

    icon.save(HERE / 'icon.png')
    icon.save(HERE / 'icon.ico', sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
    DOCS.mkdir(exist_ok=True)
    icon.resize((256, 256), Image.LANCZOS).save(DOCS / 'icon.png')
    print('wrote', HERE / 'icon.png')


if __name__ == '__main__':
    main()
