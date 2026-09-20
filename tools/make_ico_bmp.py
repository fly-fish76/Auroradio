# -*- coding: utf-8 -*-
"""Bulletproof ICO: uncompressed BGRA BMP frames, written manually."""
import struct, os
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SRC = r"C:\Users\dc\.claude\image-cache\291ad58d-bc1a-467d-8036-5395b5f39f00\22.png"
BUILD = os.path.join(ROOT, "build")

im = Image.open(SRC).convert("RGBA")
s = min(im.size)
im = im.crop(((im.width - s) // 2, (im.height - s) // 2, 0, 0)) if False else im.crop(((im.width - s) // 2, (im.height - s) // 2, (im.width + s) // 2, (im.height + s) // 2))

# 圆角透明
from PIL import ImageDraw
mask = Image.new("L", (s, s), 0)
d = ImageDraw.Draw(mask)
d.rounded_rectangle([0, 0, s - 1, s - 1], radius=round(s * 0.185), fill=255)
im.putalpha(mask)

SIZES = [256, 128, 64, 48, 32, 24, 16]

def bmp_frame(img):
    """Uncompressed 40-byte BITMAPINFOHEADER + BGRA pixels + AND mask."""
    w, h = img.size
    px = img.load()
    # BGRA rows bottom-up, 4-byte aligned
    row = w * 4
    data = bytearray()
    for y in range(h - 1, -1, -1):
        for x in range(w):
            r, g, b, a = px[x, y]
            data += bytes((b, g, r, a))
    # AND mask (1bpp, rows bottom-up, 4-byte aligned) — 0 = opaque (use alpha)
    androw = ((w + 31) // 32) * 4
    data += b"\x00" * (androw * h)
    header = struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0, row * h + androw * h, 0, 0, 0, 0)
    return header + bytes(data)

frames = []
for sz in SIZES:
    f = im.resize((sz, sz), Image.LANCZOS)
    frames.append(bmp_frame(f))

# ICONDIR + entries
out = struct.pack("<HHH", 0, 1, len(SIZES))
offset = 6 + 16 * len(SIZES)
for sz, fr in zip(SIZES, frames):
    b = 0 if sz >= 256 else sz
    out += struct.pack("<BBBBHHII", b, b, 0, 0, 1, 32, len(fr), offset)
    offset += len(fr)
for fr in frames:
    out += fr

for name in ["auroradio-app2.ico"]:
    with open(os.path.join(BUILD, name), "wb") as f:
        f.write(out)
    print(name, os.path.getsize(os.path.join(BUILD, name)), "bytes, BMP frames only")

# PNG 正本同步更新
im.resize((512, 512), Image.LANCZOS).save(os.path.join(BUILD, "icon.png"))
with open(os.path.join(BUILD, "icon.ico"), "wb") as f:
    f.write(out)
print("icon.png / icon.ico updated")
