#!/usr/bin/env python3
"""Yonde charter — the standalone logo lockups (assets/). Full-bleed renders of
the same lockups shown on charter page 1, as usable files."""
from PIL import Image, ImageDraw, ImageFont
import os
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'assets'); os.makedirs(OUT, exist_ok=True)
FLEET = os.path.expanduser('~/workspace/jpn2easy-audit/repo/public/fleet')
NOTO = '/usr/share/fonts/truetype/noto/NotoSans-{}.ttf'
def font(size, bold=False):
    return ImageFont.truetype(NOTO.format('Bold' if bold else 'Regular'), size)
NUIT=(15,18,32); PANNEAU=(27,31,54); CORAIL=(255,107,87); ENCRE=(245,242,234); SLATE=(148,163,184)
def tracked(dr, xy, s, f, fill, track=6, anchor_mid=None):
    x, y = xy; widths = []
    for ch in s:
        w = dr.textlength(ch, font=f); widths.append(w)
        dr.text((x, y), ch, font=f, fill=fill); x += w + track
    return sum(widths) + track * (len(s) - 1)
def centered(dr, cx, y, s, f, fill):
    w = dr.textlength(s, font=f); dr.text((cx - w/2, y), s, font=f, fill=fill); return w
def mascot(img, name, cx, cy, box, mono=False):
    src = os.path.join(HERE, 'koe-mono.png') if mono else os.path.join(FLEET, f'{name}.png')
    m = Image.open(src).convert('RGBA'); bb = m.getchannel('A').getbbox(); m = m.crop(bb)
    r = box / max(m.size); m = m.resize((int(m.width*r), int(m.height*r)), Image.LANCZOS)
    img.paste(m, (int(cx - m.width/2), int(cy - m.height/2)), m)
W, H = 1394, 560
# 1 wordmark alone (light)
img = Image.new('RGB', (W, H), ENCRE); dr = ImageDraw.Draw(img)
centered(dr, W/2, H/2 - 105, 'Yonde', font(190, bold=True), NUIT)
img.save(f'{OUT}/logo-wordmark.png')
# 2 wordmark + slogan (dark)
img = Image.new('RGB', (W, H), PANNEAU); dr = ImageDraw.Draw(img)
centered(dr, W/2, 120, 'Yonde', font(170, bold=True), ENCRE)
tw = tracked(dr, (0, 0), 'SUMMON YOUR JAPANESE', font(44, bold=True), PANNEAU, track=10)
tracked(dr, (W/2 - tw/2, 350), 'SUMMON YOUR JAPANESE', font(44, bold=True), SLATE, track=10)
img.save(f'{OUT}/logo-wordmark-slogan.png')
# 3 wordmark + icon (dark)
img = Image.new('RGB', (W, H), PANNEAU); dr = ImageDraw.Draw(img)
mascot(img, 'koe', 330, H/2, 400)
dr.text((580, H/2 - 85), 'Yonde', font=font(165, bold=True), fill=ENCRE)
img.save(f'{OUT}/logo-wordmark-icon.png')
# 4 icon alone (coral)
img = Image.new('RGB', (W, H), CORAIL); dr = ImageDraw.Draw(img)
mascot(img, 'koe', W/2, H/2, 470)
img.save(f'{OUT}/logo-icon.png')
# 5 black & white on white
img = Image.new('RGB', (W, H), (255,255,255)); dr = ImageDraw.Draw(img)
dr.text((120, H/2 - 85), 'Yonde', font=font(165, bold=True), fill=(0,0,0))
mascot(img, 'koe', 1130, H/2, 340, mono=True)
img.save(f'{OUT}/logo-bw-on-white.png')
# 6 black & white on black
img = Image.new('RGB', (W, H), (0,0,0)); dr = ImageDraw.Draw(img)
mascot(img, 'koe', 260, H/2, 340, mono=True)
dr.text((500, H/2 - 85), 'Yonde', font=font(165, bold=True), fill=(255,255,255))
img.save(f'{OUT}/logo-bw-on-black.png')
print('assets ok:', sorted(os.listdir(OUT)))
