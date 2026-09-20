# -*- coding: utf-8 -*-
"""Auroradio cover: remove Doubao watermark (bottom-right), rebuild icon set."""
import os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
from PIL import Image, ImageFilter

SRC = r"C:\Users\dc\.claude\image-cache\291ad58d-bc1a-467d-8036-5395b5f39f00\21.png"
BUILD = os.path.join(ROOT, "build")

img = Image.open(SRC).convert("RGB")
W, H = img.size
print("source:", W, "x", H)

px = img.load()

# 1) 定位水印：右下角浅灰文字（亮度显著高于深夜空背景）
def is_light(p):
    r, g, b = p
    return r > 110 and g > 110 and b > 110

x0, y0 = int(W * 0.60), int(H * 0.90)
xs, ys = [], []
for y in range(y0, H):
    for x in range(x0, W):
        if is_light(px[x, y]):
            xs.append(x); ys.append(y)

if xs:
    bx0, bx1 = max(0, min(xs) - 24), min(W, max(xs) + 24)
    by0, by1 = max(0, min(ys) - 16), min(H, max(ys) + 16)
    print("watermark bbox:", bx0, by0, bx1, by1)

    # 2) 用同一高度、左侧等宽的干净夜空贴片覆盖（同一渐变色带），羽化边缘
    pw, ph = bx1 - bx0, by1 - by0
    sx = bx0 - pw - 40  # 左侧取样起点
    if sx < 0:
        sx = max(0, W - bx1 - pw - 40)  # fallback: 右上没有，取更左
    patch = img.crop((sx, by0, sx + pw, by1)).filter(ImageFilter.GaussianBlur(0.6))
    mask = Image.new("L", (pw, ph), 255)
    # 边缘 12px 线性羽化
    mp = mask.load()
    feather = 12
    for yy in range(ph):
        for xx in range(pw):
            d = min(xx, yy, pw - 1 - xx, ph - 1 - yy)
            if d < feather:
                mp[xx, yy] = int(255 * d / feather)
    img.paste(patch, (bx0, by0), mask)

    # 3) 验证：区域内浅色像素应清零
    px = img.load()
    residue = sum(1 for y in range(by0, by1) for x in range(bx0, bx1) if is_light(px[x, y]))
    print("residue light pixels:", residue)
else:
    print("no watermark found")

os.makedirs(os.path.dirname(COVER), exist_ok=True)

# 4) 封面（保持原尺寸）+ 图标套件
img.save(COVER)

def cover_crop(im, w, h):
    """scale-cover then center-crop to w x h"""
    s = max(w / im.width, h / im.height)
    im2 = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    left = (im2.width - w) // 2
    top = (im2.height - h) // 2
    return im2.crop((left, top, left + w, top + h))

icon512 = cover_crop(img, 512, 512)
icon512.save(os.path.join(BUILD, "icon.png"))
icon512.save(os.path.join(BUILD, "icon.ico"),
             sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])

cover_crop(img, 150, 57).save(os.path.join(BUILD, "installerHeader.bmp"))
cover_crop(img, 164, 314).save(os.path.join(BUILD, "installerSidebar.bmp"))

for f in ["icon.png", "icon.ico", "installerHeader.bmp", "installerSidebar.bmp"]:
    p = os.path.join(BUILD, f)
    with Image.open(p) as im:
        print(f, im.size, os.path.getsize(p))
print("cover:", os.path.getsize(COVER))
