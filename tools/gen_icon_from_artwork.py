# -*- coding: utf-8 -*-
"""Build Auroradio app icon from AI-generated script-A artwork.

Pipeline: load artwork -> inpaint bottom-right watermark (border bilinear
blend, background there is uniform dark) -> rounded-corner alpha mask
(18% radius, 4x supersampled) -> 512 png + multi-size ico.
"""
import os
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "build")
SRC = r"C:\Users\dc\AppData\Local\Temp\claude\D--PycharmProjects-Auroradio\0b045f09-cc39-4532-959d-e4a003e047a0\images\26.jpg"

# watermark bbox (measured on the 2000x2000 source) + margin
WM = (1880, 1975, 1640, 1985)  # y0, y1, x0, x1


def inpaint_bilinear(arr, y0, y1, x0, x1):
    """Fill rect by blending the surrounding border pixels per row/column."""
    h, w = y1 - y0, x1 - x0
    top = arr[y0 - 1, x0:x1].astype(np.float64)        # (w, c)
    bottom = arr[y1, x0:x1].astype(np.float64)
    left = arr[y0:y1, x0 - 1].astype(np.float64)       # (h, c)
    right = arr[y0:y1, x1].astype(np.float64)
    vy = np.linspace(0.0, 1.0, h)[:, None, None]
    vx = np.linspace(0.0, 1.0, h)[None, :, None] * 0  # placeholder
    vx = np.linspace(0.0, 1.0, w)[None, :, None]
    vert = left[:, None, :] * (1 - vx) + right[:, None, :] * vx
    horiz = top[None, :, :] * (1 - vy) + bottom[None, :, :] * vy
    wy = np.linspace(0.0, 1.0, h)[:, None, None]
    wx = np.linspace(0.0, 1.0, w)[None, :, None]
    # bilinear: weight vertical blend near left/right edges, horizontal near top/bottom
    # simple separable blend: average of both, cross-faded by distance to edges
    fy = np.minimum(np.linspace(0, 1, h), np.linspace(1, 0, h))[:, None, None] * 2
    fx = np.minimum(np.linspace(0, 1, w), np.linspace(1, 0, w))[None, :, None] * 2
    fy = np.clip(fy, 0, 1)
    fx = np.clip(fx, 0, 1)
    denom = fy + fx + 1e-6
    out = (vert * fx + horiz * fy) / denom
    arr[y0:y1, x0:x1] = np.clip(out, 0, 255).astype(arr.dtype)


def rounded_mask(size, radius, ss=4):
    m = Image.new("L", (size * ss, size * ss), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size * ss - 1, size * ss - 1],
                        radius=radius * ss, fill=255)
    return m.resize((size, size), Image.LANCZOS)


def main():
    art = Image.open(SRC).convert("RGB")
    arr = np.asarray(art).copy()
    inpaint_bilinear(arr, *WM)
    art = Image.fromarray(arr)

    icon512 = art.resize((512, 512), Image.LANCZOS).convert("RGBA")
    icon512.putalpha(rounded_mask(512, int(512 * 0.18)))
    icon512.save(os.path.join(OUT, "icon.png"))

    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48),
                 (64, 64), (128, 128), (256, 256)]
    icon512.save(os.path.join(OUT, "icon.ico"), sizes=ico_sizes)
    # dev-shortcut icons (desktop Auroradio.lnk pins IconLocation to these)
    icon512.save(os.path.join(OUT, "auroradio-app.ico"), sizes=ico_sizes)
    icon512.save(os.path.join(OUT, "auroradio-app2.ico"), sizes=ico_sizes)

    for f in ["icon.png", "icon.ico", "auroradio-app.ico", "auroradio-app2.ico"]:
        p = os.path.join(OUT, f)
        with Image.open(p) as im:
            print(f, im.size, im.mode, os.path.getsize(p))


if __name__ == "__main__":
    main()
