"""Builds fonts/tg-symbols.otf: the built-in symbols of the Text-Generator.

Solid icons (good to print, no hairlines) from Font Awesome Free Solid,
reachable under the matching emoji code points (so a pasted 🐶 or ❤ works
too). The subset gets its own name, as the SIL OFL requires for modified
versions of a font with a Reserved Font Name.

Usage: python Text-Generator/tests/tools/build_symbols.py
       (pip install fonttools brotli pyyaml; downloads Font Awesome from jsDelivr)

The palette order is SYMBOLS in js/core/fonts.js; tests check that every
character there has an outline.
"""
import io
import os
import sys
import urllib.request

import yaml
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._c_m_a_p import CmapSubtable

FA_VERSION = '7.3.1'
CDN = f'https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@{FA_VERSION}'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'fonts', 'tg-symbols.otf')
LICENSE_OUT = os.path.join(HERE, '..', '..', 'fonts', 'tg-symbols.LICENSE.txt')

# Palette character, Font Awesome icon, further characters for the same icon.
PALETTE = [
    ('♥', 'heart', '❤💙💚💛💜🖤🤍🧡🤎💗💖💕'),
    ('⭐', 'star', '★🌟'),
    ('😊', 'face-smile', '🙂☺😀😃😄'),
    ('😍', 'face-grin-hearts', '🥰'),
    ('👍', 'thumbs-up', ''),
    ('✔', 'check', '✓✅'),
    ('☮', 'peace', ''),
    ('🐾', 'paw', ''),
    ('🐶', 'dog', '🐕🐩'),
    ('🐱', 'cat', '🐈'),
    ('🐴', 'horse', '🐎'),
    ('🐉', 'dragon', '🐲'),
    ('🕊', 'dove', ''),
    ('🐸', 'frog', ''),
    ('🐟', 'fish', '🐠🐡'),
    ('🐞', 'bug', '🐛🪲'),
    ('🦴', 'bone', ''),
    ('🌱', 'seedling', '🌿'),
    ('🍃', 'leaf', '🍂🍁'),
    ('🌲', 'tree', '🎄🌳'),
    ('🍀', 'clover', '☘'),
    ('☀', 'sun', '🌞'),
    ('🌙', 'moon', '🌛🌜'),
    ('☁', 'cloud', ''),
    ('❄', 'snowflake', '❅❆'),
    ('⚡', 'bolt', ''),
    ('🌈', 'rainbow', ''),
    ('🔥', 'fire', ''),
    ('⛰', 'mountain', '🏔'),
    ('⚽', 'futbol', ''),
    ('🏀', 'basketball', ''),
    ('🚲', 'bicycle', ''),
    ('🏆', 'trophy', ''),
    ('🏅', 'medal', '🥇'),
    ('🎵', 'music', '🎶♪♫'),
    ('🎸', 'guitar', ''),
    ('👑', 'crown', ''),
    ('🎂', 'cake-candles', '🎉'),
    ('🎁', 'gift', ''),
    ('⛄', 'snowman', '☃'),
    ('🎓', 'graduation-cap', ''),
    ('🏠', 'house', '🏡'),
    ('⚓', 'anchor', ''),
    ('✈', 'plane', '🛩'),
    ('🚗', 'car', '🚘🚙'),
    ('🚜', 'tractor', ''),
    ('⛵', 'sailboat', ''),
    ('🚀', 'rocket', ''),
    ('🔑', 'key', '🗝'),
    ('☕', 'mug-hot', ''),
    ('🍺', 'beer-mug-empty', '🍻'),
    ('🍎', 'apple-whole', '🍏'),
    ('🍕', 'pizza-slice', ''),
    ('🍦', 'ice-cream', '🍨'),
    ('🍪', 'cookie', ''),
    ('🎮', 'gamepad', '🕹'),
    ('💎', 'gem', ''),
    ('👻', 'ghost', ''),
    ('💀', 'skull', '☠'),
    ('📶', 'wifi', '🛜'),
    ('💡', 'lightbulb', ''),
    ('🔧', 'wrench', ''),
    ('⚙', 'gear', ''),
    ('✂', 'scissors', ''),
    ('♻', 'recycle', ''),
    ('🎲', 'dice', ''),
]

# Symbols sit on the capital letters: the font box (ascender to descender)
# is made 620 units tall, so with SYMBOL_BOX = 1.25 in the Text-Generator a
# typical icon (512 units) is about as tall as a capital letter and the
# tallest ones (576 units) about 1.16 times.
CENTER = 192
BOX = 620
NAME = 'TG Symbole'
PS_NAME = 'TGSymbole-Solid'


def fetch(path):
    with urllib.request.urlopen(f'{CDN}/{path}') as r:
        return r.read()


def main():
    icons = yaml.safe_load(fetch('metadata/icons.yml'))
    font = TTFont(io.BytesIO(fetch('webfonts/fa-solid-900.woff2')))
    font.flavor = None
    best = font.getBestCmap()
    mapping = {}
    for ch, icon, more in PALETTE:
        glyph = best[int(icons[icon]['unicode'], 16)]
        for c in ch + more:
            mapping.setdefault(ord(c), glyph)

    opts = subset.Options()
    opts.layout_features = []
    opts.name_IDs = [0, 1, 2, 3, 4, 5, 6]
    opts.notdef_outline = True
    opts.glyph_names = True
    sub = subset.Subsetter(opts)
    sub.populate(glyphs=set(mapping.values()))
    sub.subset(font)

    # Emoji code points (format 12 for those above U+FFFF).
    bmp = CmapSubtable.newSubtable(4)
    bmp.platformID, bmp.platEncID, bmp.language = 3, 1, 0
    bmp.cmap = {cp: g for cp, g in mapping.items() if cp <= 0xFFFF}
    full = CmapSubtable.newSubtable(12)
    full.platformID, full.platEncID, full.language = 3, 10, 0
    full.cmap = dict(mapping)
    font['cmap'].tables = [bmp, full]

    asc = CENTER + BOX // 2
    desc = CENTER - BOX // 2
    font['hhea'].ascent, font['hhea'].descent, font['hhea'].lineGap = asc, desc, 0
    os2 = font['OS/2']
    os2.sTypoAscender, os2.sTypoDescender, os2.sTypoLineGap = asc, desc, 0
    os2.usWinAscent, os2.usWinDescent = asc, -desc

    # New name (Reserved Font Name "Font Awesome"), copyright kept.
    names = font['name']
    for rec in list(names.names):
        if rec.nameID in (1, 4, 16):
            names.setName(NAME, rec.nameID, rec.platformID, rec.platEncID, rec.langID)
        elif rec.nameID == 6:
            names.setName(PS_NAME, 6, rec.platformID, rec.platEncID, rec.langID)
        elif rec.nameID == 3:
            names.setName(f'{PS_NAME} {FA_VERSION}', 3, rec.platformID, rec.platEncID, rec.langID)
        elif rec.nameID == 5:
            names.setName(f'Version {FA_VERSION}', 5, rec.platformID, rec.platEncID, rec.langID)
    names.setName(
        f'Subset of Font Awesome Free Solid {FA_VERSION} by Fonticons, Inc. (SIL OFL 1.1), '
        'renamed and with emoji code points, for the Text-Generator (github.com/FloG93/3D-Druck).',
        10, 3, 1, 0x409)
    cff = font['CFF '].cff
    cff.fontNames = [PS_NAME]
    top = cff.topDictIndex[0]
    top.FullName = NAME
    top.FamilyName = NAME

    font.save(OUT)
    with open(LICENSE_OUT, 'wb') as fh:
        fh.write(fetch('LICENSE.txt'))
    chars = ''.join(ch for ch, _, _ in PALETTE)
    print(f'{os.path.relpath(OUT)}: {len(set(mapping.values()))} Symbole, '
          f'{len(mapping)} Zeichen, {os.path.getsize(OUT)} Bytes')
    print(f"SYMBOLS = '{chars}'")


if __name__ == '__main__':
    sys.exit(main())
