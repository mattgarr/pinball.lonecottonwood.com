#!/usr/bin/env python3
"""Render the 8-bit text images used in the guest emails (Gmail ignores web fonts, images it shows).

Usage: python3 scripts/email-art.py /path/to/PressStart2P.ttf ["Event Name" ...]
Writes web/public/email/*.png (2x resolution; the email shows them at half size).
Deploy the site afterwards so the email can load them from pinball.lonecottonwood.com/email/.
"""
import os, re, sys
from PIL import Image, ImageDraw, ImageFont

FONT = sys.argv[1]
EVENTS = sys.argv[2:] or ['The Auction Party']
OUT = os.path.join(os.path.dirname(__file__), '..', 'web', 'public', 'email')
os.makedirs(OUT, exist_ok=True)

WHITE, RED, SKY, PINK, LIME, YELLOW, BLACK, DARKY = '#fcfcfc', '#e40058', '#3cbcfc', '#f878f8', '#58d854', '#f8b800', '#000000', '#b06c00'
slug = lambda s: re.sub(r'^-+|-+$', '', re.sub(r'[^a-z0-9]+', '-', s.lower()))


def arrow(d, x, y, px, color):
    """A pixel ▶ (the font has no triangle glyph): 7 rows tall, 4 wide, in font pixels."""
    for row, w in enumerate([1, 2, 3, 4, 3, 2, 1]):
        d.rectangle([x, y + row * px, x + w * px - 1, y + (row + 1) * px - 1], fill=color)
    return 6 * px  # arrow + gap


def text_img(name, text, size, color, arrow_color=None, shadow=None, bg=None, pad=0, scale=2):
    """size = display size in CSS px; rendered at `scale`x, no anti-aliasing (crisp pixels)."""
    fs = size * scale
    px = fs // 8                         # one font pixel
    font = ImageFont.truetype(FONT, fs)
    tw = int(font.getlength(text))
    aw = 6 * px if arrow_color else 0
    sh = (px * 2 if shadow else 0)
    w, h = pad * 2 * scale + aw + tw + sh, pad * 2 * scale + fs + sh
    im = Image.new('RGBA', (w, h), bg or (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.fontmode = '1'
    x0 = y0 = pad * scale
    if arrow_color:
        arrow(d, x0, y0, px, arrow_color)
    if shadow:
        d.text((x0 + aw + sh, y0 + sh), text, font=font, fill=shadow)
    d.text((x0 + aw, y0), text, font=font, fill=color)
    im.save(os.path.join(OUT, name + '.png'), optimize=True)
    return name, w // scale, h // scale


made = []
made.append(text_img('brand', 'WOODSIDE PINBALL', 12, WHITE))
def title_img(name, text, size=24):
    """Event title; long names split onto two balanced lines so it fits the 520px email column."""
    words = text.split()
    if len(text) <= 21:
        return text_img(name, text, size, WHITE, shadow=RED)
    best = min(range(1, len(words)), key=lambda i: abs(len(' '.join(words[:i])) - len(' '.join(words[i:]))))
    lines = [' '.join(words[:best]), ' '.join(words[best:])]
    parts = [text_img(f'{name}-l{i}', ln, size, WHITE, shadow=RED) for i, ln in enumerate(lines)]
    ims = [Image.open(os.path.join(OUT, f'{n}.png')) for n, _, _ in parts]
    gap = 6 * 2
    out = Image.new('RGBA', (max(i.width for i in ims), sum(i.height for i in ims) + gap), (0, 0, 0, 0))
    y = 0
    for im in ims:
        out.paste(im, (0, y)); y += im.height + gap
    out.save(os.path.join(OUT, name + '.png'), optimize=True)
    for n, _, _ in parts:
        os.remove(os.path.join(OUT, f'{n}.png'))
    return name, out.width // 2, out.height // 2


for ev in EVENTS:
    made.append(title_img(f'title-{slug(ev)}', ev.upper()))
made.append(text_img('h-machines', 'THE MACHINES', 12, SKY, arrow_color=SKY))
made.append(text_img('h-how', 'HOW IT WORKS', 12, SKY, arrow_color=SKY))
made.append(text_img('h-prizes', 'PRIZES', 12, PINK, arrow_color=PINK))
made.append(text_img('h-games', 'YOUR GAMES', 12, SKY, arrow_color=SKY))
made.append(text_img('h-top10', 'FINAL TOP 10', 12, PINK, arrow_color=PINK))
made.append(text_img('hype', '6 MACHINES. 1 NIGHT. 0 QUARTERS.', 12, YELLOW, shadow=RED))
made.append(text_img('h-thanks', 'THANKS FOR PLAYING!', 12, YELLOW, shadow=RED))
made.append(text_img('h-dress', 'DRESS CODE', 12, LIME, arrow_color=LIME))
made.append(text_img('h-fuel', 'FUEL', 12, LIME, arrow_color=LIME))
made.append(text_img('btn-start', 'PRESS START', 16, BLACK, arrow_color=BLACK))
made.append(text_img('btn-open', 'OPEN THE APP', 16, BLACK, arrow_color=BLACK))
made.append(text_img('btn-tickets', 'GET TICKETS', 16, BLACK, arrow_color=BLACK))
for n in range(1, 5):
    made.append(text_img(f'n{n}', str(n), 12, BLACK))
made.append(text_img('cd-0', 'TONIGHT!', 16, BLACK, arrow_color=BLACK, bg=YELLOW, pad=8))
made.append(text_img('cd-1', 'TOMORROW!', 16, BLACK, arrow_color=BLACK, bg=YELLOW, pad=8))
for n in range(2, 61):
    made.append(text_img(f'cd-{n}', f'{n} DAYS TO GO', 16, BLACK, arrow_color=BLACK, bg=YELLOW, pad=8))
# Unpaid-guest invites: one obvious button, two lines: the countdown, then the action.
def ticket_btn(name, top):
    a = text_img(name + '-a', top, 16, BLACK)
    b = text_img(name + '-b', 'TAP HERE TO BUY TICKETS', 12, BLACK, arrow_color=BLACK)
    ims = [Image.open(os.path.join(OUT, n + '.png')) for n in (name + '-a', name + '-b')]
    pad, gap = 12 * 2, 8 * 2
    w = max(i.width for i in ims) + 2 * pad
    h = sum(i.height for i in ims) + gap + 2 * pad
    out = Image.new('RGBA', (w, h), YELLOW)
    y = pad
    for im in ims:
        out.paste(im, (pad, y), im); y += im.height + gap
    out.save(os.path.join(OUT, name + '.png'), optimize=True)
    for n in (name + '-a', name + '-b'):
        os.remove(os.path.join(OUT, n + '.png'))
    return name, w // 2, h // 2


made.append(ticket_btn('tk-0', 'TONIGHT!'))
made.append(ticket_btn('tk-1', 'TOMORROW!'))
for n in range(2, 61):
    made.append(ticket_btn(f'tk-{n}', f'{n} DAYS TO GO!'))
for name, w, h in made[:12]:
    print(f'{name}.png  {w}x{h}')
print(f'... {len(made)} images in {os.path.normpath(OUT)}')
