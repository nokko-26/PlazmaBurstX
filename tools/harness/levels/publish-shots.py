#!/usr/bin/env python3
"""Copy a level's screenshots from levels/results/ into docs/cs-coastal-tower/shots/<level>/ as JPEGs, and make a
contact sheet of them (docs/cs-coastal-tower/shots/<level>/sheet.jpg).

    python3 levels/publish-shots.py 01 overview-start eye-start lane-arch-b tier-quay ...

Each name is a results file without its '<level>-' prefix and '.png'. The sheet keeps the order given."""
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
RESULTS = os.path.join(HERE, 'results')
DOCS = os.path.normpath(os.path.join(HERE, '..', '..', '..', 'docs', 'cs-coastal-tower', 'shots'))


def main():
    level, names = sys.argv[1], sys.argv[2:]
    out = os.path.join(DOCS, level)
    os.makedirs(out, exist_ok=True)
    thumbs = []
    for name in names:
        src = os.path.join(RESULTS, '%s-%s.png' % (level, name))
        im = Image.open(src).convert('RGB')
        im.thumbnail((1600, 900))
        im.save(os.path.join(out, name + '.jpg'), quality=84, optimize=True)
        th = im.copy()
        th.thumbnail((480, 270))
        thumbs.append((name, th))
        print('%s -> %s' % (src, os.path.join(out, name + '.jpg')))
    cols = 3
    rows = (len(thumbs) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * 480, rows * 270), (12, 14, 18))
    draw = ImageDraw.Draw(sheet)
    for i, (name, th) in enumerate(thumbs):
        x, y = (i % cols) * 480, (i // cols) * 270
        sheet.paste(th, (x, y))
        draw.rectangle([x, y, x + 8 + 7 * len(name), y + 16], fill=(0, 0, 0))
        draw.text((x + 4, y + 2), name, fill=(255, 230, 120))
    sheet.save(os.path.join(out, 'sheet.jpg'), quality=82, optimize=True)
    print('sheet ->', os.path.join(out, 'sheet.jpg'))


if __name__ == '__main__':
    main()
