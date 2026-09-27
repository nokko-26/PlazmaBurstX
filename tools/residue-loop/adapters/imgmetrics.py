#!/usr/bin/env python3
"""Deterministic image measurements for the loop's probes.
    imgmetrics.py <image> <reference|-> <x0,y0,x1,y1 crop of the reference, fractions>
Prints JSON: the image's measurements, the reference's, and distances between them. Measured on a 320-px-wide copy:
  luma (mean, spread, percentiles), saturation, warmth (R-B), a 5-colour palette, edge density, the share of
  near-black pixels, the brightness profile top-to-bottom (8 bands), and the distribution of detail (edge density per
  3x3 cell). Distances: palette (mean nearest-colour distance, 0-441), profile and detail-grid (mean abs), histogram
  intersection of luma (0-1, 1 = identical)."""
import json
import warnings
warnings.filterwarnings("ignore", category=DeprecationWarning)
import sys

from PIL import Image, ImageFilter


def measure(im):
    im = im.convert('RGB')
    w = 320
    im = im.resize((w, max(1, round(im.height * w / im.width))))
    px = list(im.getdata())
    n = len(px)
    luma = [0.299 * r + 0.587 * g + 0.114 * b for r, g, b in px]
    s = sorted(luma)
    mean = sum(luma) / n
    spread = (sum((v - mean) ** 2 for v in luma) / n) ** 0.5
    sat = sum((max(p) - min(p)) / (max(p) or 1) for p in px) / n
    warmth = sum(r - b for r, g, b in px) / n
    dark = sum(1 for v in luma if v < 24) / n
    q = im.quantize(colors=5, method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette()[:15]
    counts = sorted(q.getcolors(), reverse=True)
    palette = [{'rgb': pal[i * 3:i * 3 + 3], 'share': round(c / n, 3)} for c, i in counts]
    edges = im.convert('L').filter(ImageFilter.FIND_EDGES)
    ed = list(edges.getdata())
    edge = sum(1 for v in ed if v > 40) / n
    h = im.height
    bands = []
    for b in range(8):
        rows = luma[(h * b // 8) * w:(h * (b + 1) // 8) * w] or [0]
        bands.append(round(sum(rows) / len(rows), 1))
    grid = []
    for gy in range(3):
        for gx in range(3):
            vals = [ed[y * w + x] > 40 for y in range(h * gy // 3, h * (gy + 1) // 3) for x in range(w * gx // 3, w * (gx + 1) // 3)]
            grid.append(round(sum(vals) / max(1, len(vals)), 3))
    hist = [0] * 16
    for v in luma:
        hist[min(15, int(v / 16))] += 1
    return {'size': [im.width, im.height], 'luma': {'mean': round(mean, 1), 'spread': round(spread, 1), 'p5': round(s[n // 20], 1), 'p50': round(s[n // 2], 1), 'p95': round(s[n * 19 // 20], 1)},
            'saturation': round(sat, 3), 'warmth': round(warmth, 1), 'dark': round(dark, 3), 'edges': round(edge, 3), 'palette': palette,
            'profile': bands, 'detailGrid': grid, 'hist': [round(c / n, 4) for c in hist]}


def distance(a, b):
    def nearest(c, pal):
        return min(sum((c[i] - p['rgb'][i]) ** 2 for i in range(3)) ** 0.5 for p in pal)
    pd = sum(p['share'] * nearest(p['rgb'], b['palette']) for p in a['palette'])
    prof = sum(abs(x - y) for x, y in zip(a['profile'], b['profile'])) / 8
    grid = sum(abs(x - y) for x, y in zip(a['detailGrid'], b['detailGrid'])) / 9
    inter = sum(min(x, y) for x, y in zip(a['hist'], b['hist']))
    return {'palette': round(pd, 1), 'profile': round(prof, 1), 'detailGrid': round(grid, 3), 'lumaHistOverlap': round(inter, 3),
            'lumaMean': round(a['luma']['mean'] - b['luma']['mean'], 1), 'saturation': round(a['saturation'] - b['saturation'], 3),
            'warmth': round(a['warmth'] - b['warmth'], 1), 'edges': round(a['edges'] - b['edges'], 3), 'dark': round(a['dark'] - b['dark'], 3)}


def main():
    img = Image.open(sys.argv[1])
    out = {'image': measure(img)}
    if len(sys.argv) > 2 and sys.argv[2] != '-':
        ref = Image.open(sys.argv[2])
        x0, y0, x1, y1 = [float(v) for v in (sys.argv[3] if len(sys.argv) > 3 else '0,0,1,1').split(',')]
        ref = ref.crop((round(x0 * ref.width), round(y0 * ref.height), round(x1 * ref.width), round(y1 * ref.height)))
        out['reference'] = measure(ref)
        out['distance'] = distance(out['image'], out['reference'])
    print(json.dumps(out))


if __name__ == '__main__':
    main()
