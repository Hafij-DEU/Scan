"""Writes build/icon.png (512x512): a page with a folded corner and scan line on a teal tile. Stdlib only."""
import math
import struct
import sys
import zlib
from pathlib import Path

N = 512
TEAL = (15, 118, 110)
TEAL_DARK = (17, 94, 89)
WHITE = (255, 255, 255)
FOLD = (204, 251, 241)
LINE = (45, 212, 191)


def rounded_tile(x, y, r=112):
    cx = min(max(x, r), N - 1 - r)
    cy = min(max(y, r), N - 1 - r)
    return math.hypot(x - cx, y - cy) <= r


def pixel(x, y):
    if not rounded_tile(x, y):
        return (0, 0, 0, 0)
    t = y / N
    bg = tuple(round(a + (b - a) * t) for a, b in zip(TEAL, TEAL_DARK))
    # Page: 150..362 x 104..408 with a 64 px fold at the top right.
    left, right, top, bottom, fold = 150, 362, 104, 408, 64
    if left <= x <= right and top <= y <= bottom:
        fx = x - (right - fold)
        fy = y - top
        if fx > 0 and fy < fold:
            if fx > fy:
                return bg + (255,)
            return FOLD + (255,)
        if abs(y - 268) <= 7 and left - 36 <= x <= right + 36:
            return LINE + (255,)
        for row in (190, 222, 314, 346):
            if abs(y - row) <= 5 and left + 30 <= x <= right - (30 if row != 190 else 80):
                return (148, 163, 184, 255)
        return WHITE + (255,)
    if abs(y - 268) <= 7 and left - 36 <= x <= right + 36:
        return LINE + (255,)
    return bg + (255,)


def main(out):
    raw = bytearray()
    for y in range(N):
        raw.append(0)
        for x in range(N):
            raw.extend(pixel(x, y))

    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xFFFFFFFF)

    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', N, N, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b'')
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_bytes(png)


if __name__ == '__main__':
    main(sys.argv[1])
