#!/usr/bin/env python3
"""Yonde — Brand Charter (English), the full five pages from the
reference format + the summary board + the pairings annex.
All values are the product's real brand data (brand.js,
tailwind.config.js, Doc 13). Contrast ratios are computed."""
from PIL import Image, ImageDraw, ImageFont
import os

FLEET_DIR = os.path.expanduser('~/workspace/jpn2easy-audit/repo/public/fleet')
OUT = os.path.expanduser('~/workspace/yonde-carte')
LAT = '/usr/share/fonts/truetype/noto/NotoSans-%s.ttf'
CJK_DIR = '/usr/share/fonts/opentype/noto'

def font(size, bold=False, cjk=False):
    if cjk:
        return ImageFont.truetype(f'{CJK_DIR}/NotoSansCJK-{"Bold" if bold else "Regular"}.ttc', size)
    return ImageFont.truetype(LAT % ('Bold' if bold else 'Regular'), size)

NUIT = (15, 18, 32); PANNEAU = (27, 31, 54); PANNEAU2 = (21, 17, 41)
CORAIL = (255, 107, 87); ENCRE = (245, 242, 234); SLATE = (148, 163, 184)
LINE = (55, 60, 94); OUTLINE = (42, 26, 51)
NAO = (88, 179, 104); SAKI = (79, 168, 224); TSUKU = (229, 184, 59)
HORI = (224, 123, 57); MICHI = (113, 54, 138); VERT = (52, 211, 153)
DIM = (110, 118, 140)

def hx(c): return '#%02X%02X%02X' % c
def rgb(c): return f'{c[0]} · {c[1]} · {c[2]}'

def tracked(dr, xy, s, f, fill, track=6, anchor='la'):
    x, y = xy
    widths = [dr.textlength(ch, font=f) for ch in s]
    total = sum(widths) + track * (len(s) - 1)
    if anchor == 'ma': x -= total / 2
    elif anchor == 'ra': x -= total
    for ch, w in zip(s, widths):
        dr.text((x, y), ch, font=f, fill=fill)
        x += w + track
    return total

def rrect(dr, box, r, fill=None, outline=None, width=1):
    dr.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)

def wrap(dr, s, f, max_w):
    words, lines, cur = s.split(), [], ''
    for w in words:
        t = f'{cur} {w}'.strip()
        if dr.textlength(t, font=f) <= max_w or not cur:
            cur = t
        else:
            lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

def paste_mascot(img, name, cx, cy, box, mono=False):
    path = f'{OUT}/koe-mono.png' if mono else f'{FLEET_DIR}/{name}.png'
    m = Image.open(path).convert('RGBA')
    m.thumbnail((box, box), Image.LANCZOS)
    img.paste(m, (int(cx - m.width / 2), int(cy - m.height / 2)), m)

def label(dr, x, y, s, color=SLATE):
    tracked(dr, (x, y), s, font(25, bold=True), color, track=7)

def lum(c):
    def f(v):
        v = v / 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (f(v) for v in c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b

def ratio(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)

def fmt(r): return f'{r:.1f}'

def page(W, H, bg, eyebrow, title, sub=None):
    img = Image.new('RGB', (W, H), bg)
    dr = ImageDraw.Draw(img)
    tracked(dr, (90, 58), eyebrow, font(23, bold=True), CORAIL, track=6)
    dr.text((90, 94), title, font=font(52, bold=True), fill=ENCRE if bg == NUIT else NUIT)
    if sub:
        dr.text((90, 162), sub, font=font(26), fill=SLATE if bg == NUIT else (88, 92, 110))
    return img, dr

def footer(dr, W, H, dark=True):
    dr.text((W / 2, H - 52), 'YONDE — Brand Charter · Summon your Japanese',
            font=font(22), fill=DIM if dark else (120, 124, 140), anchor='ma')

M = 90
W = 1600

# ================================================================ BOARD
def board():
    H = 2160
    img = Image.new('RGB', (W, H), NUIT); dr = ImageDraw.Draw(img)
    tracked(dr, (M, 64), 'BRAND CHARTER · V1 · 2026', font(24, bold=True), CORAIL, track=6)
    dr.text((M, 104), 'YONDE', font=font(104, bold=True), fill=ENCRE)
    dr.text((M + 468, 128), '呼んで · 読んで', font=font(44, bold=True, cjk=True), fill=CORAIL)
    dr.text((W - M, 128), 'Summon your Japanese.', font=font(34), fill=SLATE, anchor='ra')
    dr.text((W - M, 176), 'It learns how you learn', font=font(26), fill=DIM, anchor='ra')
    dr.line([(M, 238), (W - M, 238)], fill=LINE, width=2)
    label(dr, M, 268, 'THE LOGOS')
    tw = (W - 2 * M - 60) // 3; ty, th = 312, 300
    for i, bg in enumerate([ENCRE, CORAIL, PANNEAU]):
        x = M + i * (tw + 30)
        rrect(dr, [x, ty, x + tw, ty + th], 26, fill=bg)
        if i == 0:
            dr.text((x + tw / 2, ty + 78), 'Yonde', font=font(88, bold=True), fill=NUIT, anchor='ma')
            tracked(dr, (x + tw / 2, ty + 196), 'SUMMON YOUR JAPANESE', font(19, bold=True), NUIT, track=4, anchor='ma')
        elif i == 1:
            paste_mascot(img, 'koe', x + tw / 2, ty + th / 2, 235)
        else:
            dr.text((x + tw / 2, ty + 78), 'Yonde', font=font(88, bold=True), fill=ENCRE, anchor='ma')
            tracked(dr, (x + tw / 2, ty + 196), 'SUMMON YOUR JAPANESE', font(19, bold=True), SLATE, track=4, anchor='ma')
        cap = ['Primary — on light', 'Koe — the mascot', 'Reversed — on night'][i]
        dr.text((x + tw / 2, ty + th + 14), cap, font=font(23), fill=SLATE, anchor='ma')
    py = 706
    label(dr, M, py, 'PALETTE')
    palette = [('Night', NUIT), ('Panel', PANNEAU), ('Coral', CORAIL),
               ('Ink', ENCRE), ('Mustard', TSUKU), ('Plum', MICHI)]
    cw = (W - 2 * M) / 6
    for i, (name, c) in enumerate(palette):
        cx = M + cw * i + cw / 2
        dr.ellipse([cx - 74, py + 52, cx + 74, py + 200], fill=c, outline=LINE, width=2)
        dr.text((cx, py + 222), name, font=font(27, bold=True), fill=ENCRE, anchor='ma')
        dr.text((cx, py + 260), hx(c), font=font(23), fill=SLATE, anchor='ma')
    by = 1052
    rrect(dr, [M, by, W - M, by + 308], 26, fill=CORAIL)
    tracked(dr, (M + 44, by + 26), 'TYPOGRAPHY', font(23, bold=True), NUIT, track=7)
    dr.text((M + 44, by + 66), 'Aa', font=font(128, bold=True), fill=NUIT)
    dr.text((M + 262, by + 92), 'System', font=font(38, bold=True), fill=NUIT)
    dr.text((M + 262, by + 142), 'system-ui · Segoe UI · Roboto', font=font(25), fill=(70, 26, 22))
    dr.text((M + 262, by + 178), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', font=font(24), fill=(70, 26, 22))
    dr.text((M + 262, by + 210), 'abcdefghijklmnopqrstuvwxyz 1234567890', font=font(24), fill=(70, 26, 22))
    mid = M + 800
    dr.line([(mid, by + 40), (mid, by + 268)], fill=(214, 74, 54), width=2)
    dr.text((mid + 44, by + 66), 'あ', font=font(128, bold=True, cjk=True), fill=NUIT)
    dr.text((mid + 262, by + 92), 'Noto Sans JP', font=font(38, bold=True), fill=NUIT)
    dr.text((mid + 262, by + 142), 'Hiragino Sans · Yu Gothic', font=font(25), fill=(70, 26, 22))
    dr.text((mid + 262, by + 178), 'あいうえお かきくけこ', font=font(26, cjk=True), fill=(70, 26, 22))
    dr.text((mid + 262, by + 216), '声 直 先 作 掘 道 — the fleet', font=font(26, cjk=True), fill=(70, 26, 22))
    fy = 1436
    label(dr, M, fy, 'THE FLEET — SIX AGENTS')
    fleet = [('koe', 'Koe', '声', 'The Sensei', CORAIL), ('nao', 'Nao', '直', 'The Fixer', NAO),
             ('saki', 'Saki', '先', 'The Planner', SAKI), ('tsuku', 'Tsuku', '作', 'The Maker', TSUKU),
             ('hori', 'Hori', '掘', 'The Miner', HORI), ('michi', 'Michi', '道', 'The Coach', MICHI)]
    fw = (W - 2 * M - 5 * 18) // 6
    for i, (fid, name, kanji, role, c) in enumerate(fleet):
        x = M + i * (fw + 18)
        rrect(dr, [x, fy + 46, x + fw, fy + 254], 22, fill=PANNEAU)
        dr.rectangle([x, fy + 244, x + fw, fy + 254], fill=c)
        paste_mascot(img, fid, x + fw / 2, fy + 146, 148)
        dr.text((x + fw / 2, fy + 272), f'{name} · {kanji}', font=font(27, bold=True, cjk=True), fill=ENCRE, anchor='ma')
        dr.text((x + fw / 2, fy + 308), role, font=font(21), fill=SLATE, anchor='ma')
    sy = 1812
    label(dr, M, sy, 'IN USE')
    panels_y, ph = sy + 46, 236
    for i in range(3):
        x = M + i * (tw + 30)
        rrect(dr, [x, panels_y, x + tw, panels_y + ph], 22, fill=PANNEAU2)
    x = M
    dr.text((x + 34, panels_y + 26), '談', font=font(118, bold=True, cjk=True), fill=ENCRE)
    dr.text((x + 176, panels_y + 40), 'ダン', font=font(36, bold=True, cjk=True), fill=CORAIL)
    dr.text((x + 176, panels_y + 88), 'discussion,', font=font(24), fill=SLATE)
    dr.text((x + 176, panels_y + 118), 'talks', font=font(24), fill=SLATE)
    for k in range(5):
        rrect(dr, [x + 34 + k * 40, panels_y + 168, x + 64 + k * 40, panels_y + 198], 6,
              fill=CORAIL if k == 4 else (42, 47, 78))
    tracked(dr, (x + tw - 30, panels_y + ph - 34), 'KANJI CARD · TELEGRAM', font(16, bold=True), SLATE, track=3, anchor='ra')
    x = M + tw + 30
    dr.text((x + 30, panels_y + 28), 'Hori dug this up for you', font=font(26, bold=True), fill=ENCRE)
    dr.text((x + 30, panels_y + 76), '駅の近くに新しい薬局が', font=font(27, cjk=True), fill=(203, 208, 224))
    dr.text((x + 30, panels_y + 112), 'できました。', font=font(27, cjk=True), fill=(203, 208, 224))
    rrect(dr, [x + 30, panels_y + 162, x + 168, panels_y + 206], 22, fill=CORAIL)
    dr.text((x + 99, panels_y + 172), 'Listen', font=font(24, bold=True), fill=NUIT, anchor='ma')
    tracked(dr, (x + tw - 30, panels_y + ph - 34), 'THE READER · THE APP', font(16, bold=True), SLATE, track=3, anchor='ra')
    x = M + 2 * (tw + 30)
    paste_mascot(img, 'koe', x + 84, panels_y + 84, 118)
    dr.text((x + 158, panels_y + 40), '呼び出しの時間', font=font(33, bold=True, cjk=True), fill=ENCRE)
    dr.text((x + 158, panels_y + 88), 'Yobidashi · 07:30', font=font(24), fill=SLATE)
    rrect(dr, [x + 30, panels_y + 162, x + 190, panels_y + 206], 22, fill=VERT)
    dr.text((x + 110, panels_y + 172), 'Answer', font=font(24, bold=True), fill=NUIT, anchor='ma')
    tracked(dr, (x + tw - 30, panels_y + ph - 34), 'THE CALL · KOE', font(16, bold=True), SLATE, track=3, anchor='ra')
    dr.text((W / 2, H - 56), 'YONDE — Summon your Japanese · jpn2easy.vercel.app', font=font(23), fill=DIM, anchor='ma')
    img.save(f'{OUT}/charte-0-board.png'); print('board ok')

# ================================================================ 1 LOGOS
def logos():
    H = 1700
    img, dr = page(W, H, NUIT, 'BRAND CHARTER · PAGE 1 OF 5', 'The Logos',
                   'Four versions. Each one has its place — and a black & white fallback.')
    y = 268
    label(dr, M, y, 'THE FOUR VERSIONS')
    tw = (W - 2 * M - 30) // 2; th = 300
    specs = [
        ('WORDMARK ALONE', ENCRE, 'wordmark', 'Use it when space is tight — headers, footers, app chrome, anywhere the name alone carries.'),
        ('WORDMARK + SLOGAN', PANNEAU, 'slogan', 'Use it when there is room to say what Yonde does — covers, first screens, print, presentations.'),
        ('WORDMARK + ICON', PANNEAU, 'combo', 'The default signature — social profiles, documents, partnerships, anywhere Yonde introduces itself.'),
        ('ICON ALONE', CORAIL, 'icon', 'Use it where the name is already known — avatars, the app icon, favicons, watermarks, stickers.'),
    ]
    for i, (name, bg, kind, use) in enumerate(specs):
        x = M + (i % 2) * (tw + 30); yy = y + 48 + (i // 2) * (th + 118)
        rrect(dr, [x, yy, x + tw, yy + th], 24, fill=bg)
        dark_on = bg in (ENCRE, CORAIL)
        ink = NUIT if dark_on else ENCRE
        sub = SLATE if not dark_on else (70, 26, 22) if bg == CORAIL else (88, 92, 110)
        if kind == 'wordmark':
            dr.text((x + tw / 2, yy + 96), 'Yonde', font=font(96, bold=True), fill=ink, anchor='ma')
        elif kind == 'slogan':
            dr.text((x + tw / 2, yy + 74), 'Yonde', font=font(88, bold=True), fill=ink, anchor='ma')
            tracked(dr, (x + tw / 2, yy + 188), 'SUMMON YOUR JAPANESE', font(21, bold=True), sub, track=5, anchor='ma')
        elif kind == 'combo':
            paste_mascot(img, 'koe', x + 168, yy + th / 2, 190)
            dr.text((x + 292, yy + 96), 'Yonde', font=font(84, bold=True), fill=ink)
        else:
            paste_mascot(img, 'koe', x + tw / 2, yy + th / 2, 225)
        tracked(dr, (x, yy + th + 16), name, font(22, bold=True), ENCRE, track=4)
        for li, line in enumerate(wrap(dr, use, font(22), tw - 6)[:2]):
            dr.text((x, yy + th + 52 + li * 30), line, font=font(22), fill=SLATE)
    by = y + 48 + 2 * (th + 118) + 26
    label(dr, M, by, 'BLACK & WHITE — WHEN COLOR IS NOT AN OPTION')
    bw_y = by + 48; bw_h = 240
    rrect(dr, [M, bw_y, M + tw, bw_y + bw_h], 24, fill=ENCRE)
    dr.text((M + tw / 2, bw_y + 58), 'Yonde', font=font(80, bold=True), fill=NUIT, anchor='ma')
    paste_mascot(img, 'koe', M + tw - 118, bw_y + bw_h / 2, 120, mono=True)
    rrect(dr, [M + tw + 30, bw_y, M + tw + 30 + tw, bw_y + bw_h], 24, fill=(0, 0, 0))
    dr.text((M + tw + 30 + tw / 2, bw_y + 58), 'Yonde', font=font(80, bold=True), fill=(255, 255, 255), anchor='ma')
    paste_mascot(img, 'koe', M + tw + 30 + 118, bw_y + bw_h / 2, 120, mono=True)
    dr.text((M, bw_y + bw_h + 18), 'One-color printing, engraving, stamps, legal documents: the identity survives in pure black and white.',
            font=font(22), fill=SLATE)
    dr.text((M, bw_y + bw_h + 52), 'Never recolor the mascot, never outline the wordmark, never place the color logo on a busy photograph.',
            font=font(22), fill=SLATE)
    footer(dr, W, H)
    img.save(f'{OUT}/charte-1-logos.png'); print('logos ok')

# ================================================================ 2 PALETTE
def palette_page():
    H = 1760
    img, dr = page(W, H, NUIT, 'BRAND CHARTER · PAGE 2 OF 5', 'The Palette',
                   'Every color with its references — and the rules for putting them together.')
    y = 268
    label(dr, M, y, 'THE SIX CORE COLORS')
    cols = [
        ('Night', NUIT, 'The ground. Every surface starts here.'),
        ('Panel', PANNEAU, 'Cards and panels on the Night ground.'),
        ('Coral', CORAIL, 'The one accent — the primary action, and Koe.'),
        ('Ink', ENCRE, 'Text on dark grounds. The light of the system.'),
        ('Mustard', TSUKU, 'Tsuku, the Maker — making moments.'),
        ('Plum', MICHI, 'Michi, the Coach — the anchor.'),
    ]
    cw = (W - 2 * M - 2 * 24) // 3; chh = 330
    for i, (name, c, role) in enumerate(cols):
        x = M + (i % 3) * (cw + 24); yy = y + 48 + (i // 3) * (chh + 30)
        rrect(dr, [x, yy, x + cw, yy + 150], 20, fill=c, outline=LINE, width=2)
        dr.text((x + 4, yy + 168), name, font=font(30, bold=True), fill=ENCRE)
        dr.text((x + 4, yy + 208), f'HEX {hx(c)}', font=font(23), fill=SLATE)
        dr.text((x + 4, yy + 240), f'RGB {rgb(c)}', font=font(23), fill=SLATE)
        dr.text((x + 4, yy + 276), role, font=font(21), fill=DIM)
    fy = y + 48 + 2 * (chh + 30) + 16
    label(dr, M, fy, 'THE FLEET ACCENTS — ONE PER AGENT')
    fleet = [('Koe', CORAIL), ('Nao', NAO), ('Saki', SAKI), ('Tsuku', TSUKU), ('Hori', HORI), ('Michi', MICHI)]
    cw6 = (W - 2 * M) / 6
    for i, (name, c) in enumerate(fleet):
        cx = M + cw6 * i + cw6 / 2
        dr.ellipse([cx - 52, fy + 48, cx + 52, fy + 152], fill=c, outline=LINE, width=2)
        dr.text((cx, fy + 168), name, font=font(24, bold=True), fill=ENCRE, anchor='ma')
        dr.text((cx, fy + 202), hx(c), font=font(20), fill=SLATE, anchor='ma')
    ry = fy + 258
    label(dr, M, ry, 'THE PAIRING RULES')
    rules = [
        ('DO', VERT, f'Ink text on Night ({fmt(ratio(ENCRE, NUIT))}) and on Panel ({fmt(ratio(ENCRE, PANNEAU))}) — body text lives there.'),
        ('DO', VERT, f'Night text on Coral ({fmt(ratio(NUIT, CORAIL))}) and on Mustard ({fmt(ratio(NUIT, TSUKU))}) — buttons and badges.'),
        ('DO', VERT, 'One accent per surface. A fleet color appears with its agent, nowhere else.'),
        ('NEVER', CORAIL, f'Mustard on Coral ({fmt(ratio(TSUKU, CORAIL))}) or Ink on Mustard ({fmt(ratio(ENCRE, TSUKU))}) — unreadable at any size.'),
        ('NEVER', CORAIL, f'Coral text on Ink ({fmt(ratio(CORAIL, ENCRE))}) — Coral is a ground and an accent, not a text color on light.'),
    ]
    for i, (tag, tc, txt) in enumerate(rules):
        yy = ry + 52 + i * 56
        rrect(dr, [M, yy + 2, M + 108, yy + 40], 19, fill=tc)
        dr.text((M + 54, yy + 9), tag, font=font(21, bold=True), fill=NUIT, anchor='ma')
        dr.text((M + 132, yy + 8), txt, font=font(24), fill=ENCRE)
    footer(dr, W, H)
    img.save(f'{OUT}/charte-2-palette.png'); print('palette ok')

# ================================================================ 3 TYPOGRAPHY
def typo_page():
    H = 1480
    img, dr = page(W, H, NUIT, 'BRAND CHARTER · PAGE 3 OF 5', 'Typography',
                   'One typeface per script. The hierarchy does the talking.')
    y = 268
    label(dr, M, y, 'THE REFERENCES')
    tw = (W - 2 * M - 30) // 2
    rrect(dr, [M, y + 48, M + tw, y + 48 + 210], 22, fill=PANNEAU)
    dr.text((M + 36, y + 76), 'Aa', font=font(92, bold=True), fill=ENCRE)
    dr.text((M + 178, y + 84), 'System', font=font(36, bold=True), fill=ENCRE)
    dr.text((M + 178, y + 132), 'system-ui · Segoe UI · Roboto', font=font(24), fill=SLATE)
    dr.text((M + 178, y + 166), 'Latin script — interface and print', font=font(22), fill=DIM)
    x2 = M + tw + 30
    rrect(dr, [x2, y + 48, x2 + tw, y + 48 + 210], 22, fill=PANNEAU)
    dr.text((x2 + 36, y + 76), 'あ', font=font(92, bold=True, cjk=True), fill=ENCRE)
    dr.text((x2 + 178, y + 84), 'Noto Sans JP', font=font(36, bold=True), fill=ENCRE)
    dr.text((x2 + 178, y + 132), 'Hiragino Sans · Yu Gothic', font=font(24), fill=SLATE)
    dr.text((x2 + 178, y + 166), 'Japanese script — same hierarchy', font=font(22), fill=DIM)
    hy = y + 48 + 210 + 44
    label(dr, M, hy, 'THE HIERARCHY — HOW EACH LEVEL IS SET')
    rows = [
        ('DISPLAY', 'Summon your Japanese.', 58, True, 'Bold · line height 1.1 · one per screen'),
        ('TITLE', 'Your fleet is waiting', 36, True, 'Bold · line height 1.15 · screen and card titles'),
        ('BODY', 'Hori digs through what you hear all day and fits it to the words you know.', 26, False, 'Regular · line height 1.5 · paragraphs'),
        ('CAPTION', 'N2 · ~95% known · 3 new words', 22, False, 'Regular · Slate on dark · labels and footers'),
    ]
    yy = hy + 52
    for name, spec, size, bold, rule in rows:
        dr.text((M, yy), name, font=font(20, bold=True), fill=CORAIL)
        dr.text((M + 190, yy - 8), spec, font=font(size, bold=bold, cjk=False), fill=ENCRE)
        tw_spec = dr.textlength(spec, font=font(size, bold=bold))
        yy += size + 14
        dr.text((M + 190, yy), rule, font=font(22), fill=SLATE)
        yy += 62
        dr.line([(M, yy - 18), (W - M, yy - 18)], fill=LINE, width=1)
    ry = yy + 6
    label(dr, M, ry, 'THE SPACING RULES')
    rules = [
        'Titles breathe tight: line height 1.1 to 1.2, never more.',
        'Body text breathes open: line height 1.5, always.',
        'A new paragraph starts after a gap of three quarters of the body size — never an indent.',
        'Numbers are always tabular and never truncated; labels flex, digits do not.',
        'Japanese follows the same hierarchy and the same spacing — no separate system.',
    ]
    for i, txt in enumerate(rules):
        yyy = ry + 52 + i * 52
        dr.ellipse([M + 2, yyy + 9, M + 14, yyy + 21], fill=CORAIL)
        dr.text((M + 34, yyy), txt, font=font(25), fill=ENCRE)
    footer(dr, W, H)
    img.save(f'{OUT}/charte-3-typography.png'); print('typo ok')

# ================================================================ 4 ELEMENTS
def elements_page():
    H = 1700
    img, dr = page(W, H, NUIT, 'BRAND CHARTER · PAGE 4 OF 5', 'Graphic Elements',
                   'Illustrations, pictograms and the motif — each adapted to light and dark.')
    y = 268
    label(dr, M, y, 'THE ILLUSTRATIONS — THE FLEET, ON DARK AND ON LIGHT')
    fleet = [('koe', CORAIL), ('nao', NAO), ('saki', SAKI), ('tsuku', TSUKU), ('hori', HORI), ('michi', MICHI)]
    fw = (W - 2 * M - 5 * 18) // 6
    for i, (fid, c) in enumerate(fleet):
        x = M + i * (fw + 18)
        rrect(dr, [x, y + 48, x + fw, y + 196], 20, fill=PANNEAU)
        paste_mascot(img, fid, x + fw / 2, y + 122, 118)
        rrect(dr, [x, y + 214, x + fw, y + 362], 20, fill=ENCRE)
        paste_mascot(img, fid, x + fw / 2, y + 288, 118)
    for li, line in enumerate(wrap(dr, 'Flat solid fills, one bold plum outline (#2A1A33), no gradients, no shadows, no glow. The same art on both grounds — only the tile changes.', font(23), W - 2 * M)[:2]):
        dr.text((M, y + 386 + li * 32), line, font=font(23), fill=SLATE)
    py = y + 478
    label(dr, M, py, 'THE PICTOGRAMS — THE FLEET KANJI')
    kanji = [('声', CORAIL, 'Koe'), ('直', NAO, 'Nao'), ('先', SAKI, 'Saki'), ('作', TSUKU, 'Tsuku'), ('掘', HORI, 'Hori'), ('道', MICHI, 'Michi')]
    for i, (k, c, name) in enumerate(kanji):
        x = M + i * (fw + 18)
        rrect(dr, [x, py + 48, x + fw, py + 196], 28, outline=c, width=5)
        dr.text((x + fw / 2, py + 76), k, font=font(72, bold=True, cjk=True), fill=c, anchor='ma')
        dr.text((x + fw / 2, py + 214), name, font=font(22), fill=SLATE, anchor='ma')
    for li, line in enumerate(wrap(dr, 'Framing rules: rounded corners always, a bold even stroke, one color per pictogram — its agent\u2019s color. Never mix two agents\u2019 colors in one mark.', font(23), W - 2 * M)[:2]):
        dr.text((M, py + 256 + li * 32), line, font=font(23), fill=SLATE)
    my = py + 348
    label(dr, M, my, 'THE MOTIF — FLEET BAR & STROKE STRIP')
    bar_y = my + 56
    seg = (W - 2 * M) / 6
    for i, (_, c) in enumerate(fleet):
        dr.rectangle([M + i * seg, bar_y, M + (i + 1) * seg, bar_y + 26], fill=c)
    for k in range(8):
        x = M + k * 62
        rrect(dr, [x, bar_y + 52, x + 48, bar_y + 116], 8, fill=CORAIL if k == 7 else PANNEAU)
        dr.text((x + 24, bar_y + 70), str(k + 1), font=font(18, bold=True), fill=NUIT if k == 7 else SLATE, anchor='ma')
    dr.text((M + 540, bar_y + 62), 'A kanji, stroke by stroke — the current stroke in Coral.', font=font(23), fill=SLATE)
    rules = [
        'The motif lives at the edges: the fleet bar closes a composition at the bottom; the stroke strip sits inside its card.',
        'Never behind text, never across a photograph, never stretched to fill a page.',
        'Corners and footers only — the middle of a page belongs to the content.',
    ]
    for i, txt in enumerate(rules):
        yyy = bar_y + 146 + i * 50
        dr.ellipse([M + 2, yyy + 9, M + 14, yyy + 21], fill=CORAIL)
        dr.text((M + 34, yyy), txt, font=font(24), fill=ENCRE)
    footer(dr, W, H)
    img.save(f'{OUT}/charte-4-elements.png'); print('elements ok')

# ================================================================ 5 COMPOSITION
def composition_page():
    H = 1620
    img, dr = page(W, H, NUIT, 'BRAND CHARTER · PAGE 5 OF 5', 'Composition',
                   'One model layout. Every Yonde communication is a variation of it.')
    # The model visual (left) + the rules (right)
    vx, vy, vw, vh = M, 268, 760, 1180
    rrect(dr, [vx, vy, vx + vw, vy + vh], 28, fill=PANNEAU2)
    dr.text((vx + 48, vy + 44), 'Your Japanese is', font=font(52, bold=True), fill=ENCRE)
    dr.text((vx + 48, vy + 108), 'already around you.', font=font(52, bold=True), fill=ENCRE)
    dr.text((vx + 48, vy + 196), 'Yonde fits what you hear every day to the', font=font(26), fill=(203, 208, 224))
    dr.text((vx + 48, vy + 234), 'words you actually know — then proves it.', font=font(26), fill=(203, 208, 224))
    # app element (framed mini reader card)
    rrect(dr, [vx + 48, vy + 310, vx + vw - 48, vy + 560], 20, fill=PANNEAU)
    dr.text((vx + 76, vy + 334), 'Hori dug this up for you', font=font(25, bold=True), fill=ENCRE)
    dr.text((vx + 76, vy + 380), '駅の近くに新しい薬局ができました。', font=font(26, cjk=True), fill=(203, 208, 224))
    rrect(dr, [vx + 76, vy + 436, vx + 204, vy + 484], 24, fill=CORAIL)
    dr.text((vx + 140, vy + 447), 'Listen', font=font(24, bold=True), fill=NUIT, anchor='ma')
    dr.text((vx + 76, vy + 506), 'N2 · ~95% known · 3 new words', font=font(21), fill=SLATE)
    paste_mascot(img, 'koe', vx + vw - 150, vy + 760, 210)
    dr.text((vx + 48, vy + 690), 'One call a day.', font=font(34, bold=True), fill=ENCRE)
    dr.text((vx + 48, vy + 736), 'Koe rings at your hour and talks', font=font(24), fill=SLATE)
    dr.text((vx + 48, vy + 770), 'with you — in Japanese.', font=font(24), fill=SLATE)
    rrect(dr, [vx + 48, vy + 850, vx + 300, vy + 906], 28, fill=CORAIL)
    dr.text((vx + 174, vy + 864), 'Start today', font=font(26, bold=True), fill=NUIT, anchor='ma')
    seg = vw / 6
    bar = Image.new('RGB', (int(vw), 22), PANNEAU2)
    bd = ImageDraw.Draw(bar)
    for i, c in enumerate([CORAIL, NAO, SAKI, TSUKU, HORI, MICHI]):
        bd.rectangle([i * seg, 0, (i + 1) * seg, 22], fill=c)
    mask = Image.new('L', (int(vw), 22), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, -22, vw, 22], radius=22, fill=255)
    img.paste(bar, (int(vx), int(vy + vh - 22)), mask)
    dr.text((vx + 48, vy + vh - 76), 'YONDE — SUMMON YOUR JAPANESE', font=font(19, bold=True), fill=SLATE)
    rx = vx + vw + 56
    label(dr, rx, 268, 'HOW IT IS BUILT')
    rules = [
        ('1', 'The title comes first', 'Top-left, Display size, two lines at most. Nothing outranks it.'),
        ('2', 'One Coral action', 'Exactly one Coral element — the button. If everything shouts, nothing does.'),
        ('3', 'The body stays quiet', 'Two or three lines under the title, Body size, line height 1.5.'),
        ('4', 'Proof, framed', 'The product appears as a framed card — a real passage, a real card, never a decoration.'),
        ('5', 'The mascot serves', 'Bottom-right, clear of the text. The fleet helps; it never blocks reading.'),
        ('6', 'The bar closes', 'The fleet bar signs the bottom edge. The motif never enters the middle.'),
    ]
    yy = 322
    for n, head, body in rules:
        dr.ellipse([rx, yy, rx + 46, yy + 46], fill=CORAIL)
        dr.text((rx + 23, yy + 8), n, font=font(24, bold=True), fill=NUIT, anchor='ma')
        dr.text((rx + 66, yy + 2), head, font=font(27, bold=True), fill=ENCRE)
        for li, line in enumerate(wrap(dr, body, font(21), W - rx - 66 - M)[:2]):
            dr.text((rx + 66, yy + 40 + li * 28), line, font=font(21), fill=SLATE)
        yy += 118
    dr.text((rx, yy + 6), 'Duplicate this composition for every support —', font=font(23), fill=ENCRE)
    dr.text((rx, yy + 40), 'posts, pages, print. Same order, same calm.', font=font(23), fill=ENCRE)
    footer(dr, W, H)
    img.save(f'{OUT}/charte-5-composition.png'); print('composition ok')

# ================================================================ 6 PAIRINGS
def pairings_page():
    pairs = [('Ink', ENCRE, 'Night', NUIT), ('Ink', ENCRE, 'Panel', PANNEAU),
             ('Night', NUIT, 'Coral', CORAIL), ('Coral', CORAIL, 'Night', NUIT),
             ('Ink', ENCRE, 'Plum', MICHI), ('Night', NUIT, 'Mustard', TSUKU)]
    W2, H2 = 1600, 1760
    img2 = Image.new('RGB', (W2, H2), ENCRE)
    d2 = ImageDraw.Draw(img2)
    tracked(d2, (M, 70), 'THE GOOD PAIRINGS', font(40, bold=True), NUIT, track=5)
    d2.text((M, 140), 'The score measures the contrast between the text and the ground.', font=font(27), fill=(88, 92, 110))
    d2.text((M, 178), 'From 4.5 up, ordinary text reads well.', font=font(27), fill=(88, 92, 110))
    cw2 = (W2 - 2 * M - 40) // 2
    for i, (fn, fc, bn, bc) in enumerate(pairs):
        col, row = i % 2, i // 2
        x = M + col * (cw2 + 40); y = 268 + row * 448
        r = ratio(fc, bc)
        verdict = 'Readable' if r >= 4.5 else ('Headings only' if r >= 3 else 'Never')
        vcol = (46, 125, 79) if r >= 4.5 else (185, 127, 20)
        rrect(d2, [x + 60, y, x + 210, y + 150], 20, fill=bc, outline=(200, 198, 188), width=2)
        rrect(d2, [x + 150, y + 56, x + 300, y + 206], 20, fill=fc, outline=(200, 198, 188), width=2)
        d2.text((x + 60, y + 240), f'{fn} on {bn}', font=font(30, bold=True), fill=NUIT)
        rs = fmt(r)
        d2.text((x + 60, y + 284), f'{rs} · ', font=font(28, bold=True), fill=NUIT)
        wpre = d2.textlength(f'{rs} · ', font=font(28, bold=True))
        d2.text((x + 60 + wpre, y + 284), verdict, font=font(28, bold=True), fill=vcol)
    d2.text((W2 / 2, H2 - 60), 'YONDE — Brand Charter · the pairings', font=font(23), fill=(120, 124, 140), anchor='ma')
    img2.save(f'{OUT}/charte-6-pairings.png'); print('pairings ok')

board(); logos(); palette_page(); typo_page(); elements_page(); composition_page(); pairings_page()
