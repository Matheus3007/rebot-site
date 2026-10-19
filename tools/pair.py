# Side-by-side before/after sheet: python3 tools/pair.py before_dir after_dir out.png name [name ...]
import sys
from PIL import Image, ImageDraw
bd, ad, out, names = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
rows = [(Image.open(f'{bd}/{n}.png').convert('RGB'), Image.open(f'{ad}/{n}.png').convert('RGB')) for n in names]
w, h = rows[0][0].size
W = Image.new('RGB', (w * 2 + 12, (h + 12) * len(rows)), (40, 40, 40))
for i, (a, b) in enumerate(rows):
    W.paste(a, (0, i * (h + 12))); W.paste(b, (w + 12, i * (h + 12)))
    d = ImageDraw.Draw(W); d.text((10, i * (h + 12) + h - 20), 'before', fill=(255, 255, 0)); d.text((w + 22, i * (h + 12) + h - 20), 'after', fill=(255, 255, 0))
W.save(out)
