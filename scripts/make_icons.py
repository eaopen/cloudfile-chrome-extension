"""Generate the extension icon set as PNGs, with no third-party dependency.

Chrome's `notifications.create` requires a raster icon, and the toolbar/badge
reads the same files, so the set is generated from one shape description rather
than checked in as opaque binaries. Run from the extension root:

    python scripts/make_icons.py

Palette matches popup.css: ink #16211e on a lime #b6ea58 glyph.
"""

import os
import struct
import zlib

INK = (0x16, 0x21, 0x1E)
LIME = (0xB6, 0xEA, 0x58)

SIZES = (16, 32, 48, 128)
SUPERSAMPLE = 8          # per-axis subsamples, for anti-aliased edges
CORNER_RADIUS = 0.22     # fraction of the canvas


def inside_rounded_square(u, v):
    """True when (u, v) in the unit square falls inside the rounded tile."""
    r = CORNER_RADIUS
    cu = min(max(u, r), 1.0 - r)
    cv = min(max(v, r), 1.0 - r)
    return (u - cu) ** 2 + (v - cv) ** 2 <= r * r


def inside_arrow(u, v):
    """A downward arrow: shaft, then a triangular head."""
    if abs(u - 0.5) <= 0.062 and 0.17 <= v <= 0.60:
        return True
    if 0.50 <= v <= 0.73:
        half = 0.21 * (1.0 - (v - 0.50) / 0.23)
        if abs(u - 0.5) <= half:
            return True
    return False


def inside_tray(u, v):
    """The underline the arrow lands on, read as a download tray."""
    return 0.20 <= u <= 0.80 and 0.815 <= v <= 0.895


def render(size):
    """Return `size` * `size` RGBA bytes, supersampled then box-filtered."""
    pixels = bytearray(size * size * 4)
    step = 1.0 / (size * SUPERSAMPLE)
    offset = step / 2.0
    for py in range(size):
        for px in range(size):
            tile_hits = 0
            glyph_hits = 0
            for sy in range(SUPERSAMPLE):
                v = (py * SUPERSAMPLE + sy) * step + offset
                for sx in range(SUPERSAMPLE):
                    u = (px * SUPERSAMPLE + sx) * step + offset
                    if not inside_rounded_square(u, v):
                        continue
                    tile_hits += 1
                    if inside_arrow(u, v) or inside_tray(u, v):
                        glyph_hits += 1
            total = SUPERSAMPLE * SUPERSAMPLE
            alpha = tile_hits / total
            if alpha == 0:
                continue
            # Blend ink -> lime by how much of the covered area is glyph. The
            # glyph sits fully inside the tile, so this is exact enough.
            mix = glyph_hits / tile_hits
            index = (py * size + px) * 4
            pixels[index] = round(INK[0] + (LIME[0] - INK[0]) * mix)
            pixels[index + 1] = round(INK[1] + (LIME[1] - INK[1]) * mix)
            pixels[index + 2] = round(INK[2] + (LIME[2] - INK[2]) * mix)
            pixels[index + 3] = round(alpha * 255)
    return bytes(pixels)


def write_png(path, size, pixels):
    def chunk(tag, data):
        body = tag + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)

    raw = b''.join(
        b'\x00' + pixels[row * size * 4:(row + 1) * size * 4]
        for row in range(size)
    )
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as handle:
        handle.write(png)


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    target = os.path.join(root, 'icons')
    os.makedirs(target, exist_ok=True)
    for size in SIZES:
        path = os.path.join(target, 'icon%d.png' % size)
        write_png(path, size, render(size))
        print('%s (%d bytes)' % (path, os.path.getsize(path)))


if __name__ == '__main__':
    main()
