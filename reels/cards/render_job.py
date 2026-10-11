import argparse
import json
from pathlib import Path
from PIL import Image
from render import Renderer, save

parser = argparse.ArgumentParser()
parser.add_argument('deck', type=Path)
parser.add_argument('--out', type=Path, required=True)
parser.add_argument('--font', type=Path, required=True)
parser.add_argument('--bold-font', type=Path, required=True)
args = parser.parse_args()
images = Renderer(args.font, args.bold_font).deck(json.loads(args.deck.read_text()), args.deck.parent)
save(images, args.out)
for kind in ('mobile', 'jpeg'):
    target = args.out / kind
    target.mkdir(parents=True, exist_ok=True)
    for old in target.glob('[0-9][0-9].*'):
        old.unlink()
for i, image in enumerate(images, 1):
    image.resize((390, 488), Image.Resampling.LANCZOS).save(args.out / 'mobile' / f'{i:02d}.png')
    image.convert('RGB').save(args.out / 'jpeg' / f'{i:02d}.jpg', quality=95, subsampling=0)
print(json.dumps({'count': len(images), 'size': [1080,1350]}))
