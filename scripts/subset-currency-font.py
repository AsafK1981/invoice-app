"""Regenerate the small Inter shekel face with fonttools[woff]."""
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

font_dir = Path(__file__).resolve().parent.parent / "src/app/fonts/inter"
font = TTFont(font_dir / "Inter-Variable-latin-ext.woff2")
options = subset.Options()
options.flavor = "woff2"
subsetter = subset.Subsetter(options=options)
subsetter.populate(unicodes=[0x20AA])
subsetter.subset(font)
assert set(font.getBestCmap()) == {0x20AA}
font.save(font_dir / "Inter-Variable-shekel.woff2")
