# -*- coding: utf-8 -*-
"""Generate Auroradio placeholder icon set (dark aurora + letter A)."""
import math, os
from PIL import Image, ImageDraw, ImageFont
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

OUT = os.path.join(ROOT, "build")
ASSETS = os.path.join(ROOT, ".github", "assets")
os.makedirs(ASSETS, exist_ok=True)

FONT = r"C:\Windows\Fonts\arialbd.ttf"

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def aurora_bg(w, h):
    """Dark base with two soft aurora glows (teal top-left, gold bottom-right)."""
    img = Image.new("RGB", (w, h), (8, 12, 16))
    px = img.load()
    c_teal = (36, 160, 138)
    c_gold = (196, 158, 82)
    g1 = (w * 0.28, h * 0.22)   # teal glow center
    g2 = (w * 0.78, h * 0.85)   # gold glow center
    r1, r2 = w * 0.75, w * 0.85
    for y in range(h):
        for x in range(w):
            base = (8, 12, 16)
            d1 = math.hypot(x - g1[0], y - g1[1]) / r1
            d2 = math.hypot(x - g2[0], y - g2[1]) / r2
            t1 = max(0.0, 1.0 - d1) ** 2 * 0.55
            t2 = max(0.0, 1.0 - d2) ** 2 * 0.40
            c = base
            if t1 > 0:
                c = lerp(c, c_teal, min(1.0, t1))
            if t2 > 0:
                c = lerp(c, c_gold, min(1.0, t2))
            px[x, y] = c
    return img

def rounded_mask(w, h, radius):
    m = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=255)
    return m

def make_icon(size):
    img = aurora_bg(size, size).convert("RGBA")
    mask = rounded_mask(size, size, int(size * 0.18))
    img.putalpha(mask)
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(FONT, int(size * 0.58))
    bbox = d.textbbox((0, 0), "A", font=f)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((size - tw) / 2 - bbox[0], (size - th) / 2 - bbox[1]), "A",
           font=f, fill=(238, 242, 240, 255))
    return img

# --- app icon: png (512) + multi-size ico ---
icon512 = make_icon(512)
icon512.save(os.path.join(OUT, "icon.png"))

ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
icon512.save(os.path.join(OUT, "icon.ico"), sizes=ico_sizes)

# --- NSIS installer header (150x57) : A + wordmark ---
W, H = 150, 57
head = aurora_bg(W, H).convert("RGB")
d = ImageDraw.Draw(head)
fa = ImageFont.truetype(FONT, 34)
fw = ImageFont.truetype(FONT, 16)
bbox = d.textbbox((0, 0), "A", font=fa)
d.text((10, (H - (bbox[3] - bbox[1])) / 2 - bbox[1]), "A", font=fa, fill=(238, 242, 240))
d.text((56, H / 2 - 10), "AURORADIO", font=fw, fill=(210, 224, 220))
head.save(os.path.join(OUT, "installerHeader.bmp"))

# --- NSIS installer sidebar (164x314) : big A + name vertical ---
W, H = 164, 314
side = aurora_bg(W, H).convert("RGB")
d = ImageDraw.Draw(side)
fa = ImageFont.truetype(FONT, 96)
fw = ImageFont.truetype(FONT, 20)
bbox = d.textbbox((0, 0), "A", font=fa)
d.text(((W - (bbox[2] - bbox[0])) / 2 - bbox[0], 46), "A", font=fa, fill=(238, 242, 240))
bbox2 = d.textbbox((0, 0), "AURORADIO", font=fw)
d.text(((W - (bbox2[2] - bbox2[0])) / 2 - bbox2[0], 200), "AURORADIO", font=fw, fill=(210, 224, 220))
side.save(os.path.join(OUT, "installerSidebar.bmp"))

# --- donate QR placeholder (square, light) for README sponsorship ---
W = H = 300
ph = Image.new("RGB", (W, H), (245, 246, 248))
d = ImageDraw.Draw(ph)
d.rounded_rectangle([4, 4, W - 5, H - 5], radius=14, outline=(200, 205, 212), width=2)
fm = ImageFont.truetype(FONT, 18)
msg = "donate-wechat.png"
d.text((W / 2 - 110, H / 2 - 12), "在此放置收款码", font=fm, fill=(120, 128, 138))
ph.save(os.path.join(ASSETS, "donate-wechat.png"))

print("done")
for f in ["icon.png", "icon.ico", "installerHeader.bmp", "installerSidebar.bmp"]:
    p = os.path.join(OUT, f)
    with Image.open(p) as im:
        print(f, im.size, im.mode, os.path.getsize(p))
print("donate-wechat.png", os.path.getsize(os.path.join(ASSETS, "donate-wechat.png")))
