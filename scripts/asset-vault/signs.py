#!/usr/bin/env python3
"""Render original fictional-brand sign atlases for the 100 asset families."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2] / "vault-public" / "asset-vault"
PALETTES = [
    ("#193e46", "#efe4be", "#eaae40"), ("#783f32", "#fff0d3", "#d99b44"),
    ("#294d38", "#f4efd7", "#b1bf69"), ("#27344c", "#f4e9d0", "#d6894d"),
    ("#d5b15c", "#263b3d", "#f8ebcb"), ("#ece4cb", "#3c503f", "#a45d3c"),
    ("#843e42", "#fff0d9", "#e7ae73"), ("#315f6e", "#f5efda", "#bfc480"),
]
STAMPS = [
    "FUTURE COSTS SOLD SEPARATELY", "PROUDLY EXPANDING AGAIN",
    "NOW WITH MORE NOW", "YOUR NEXT GREAT OBLIGATION",
    "LOCALLY FINANCED. GLOBALLY OPTIMIZED.", "PROGRESS HAS ENTERED THE CHAT",
    "PARKING IS OUR LOVE LANGUAGE", "WE PUT THE PLAN IN PAYMENT PLAN",
    "GROWTH YOU CAN ALMOST AFFORD", "ANOTHER PHASE OF EXCELLENCE",
]

def font(size):
    # Pillow's bundled Aileron font keeps sign generation portable; no font files
    # or third-party logo artwork are copied into the distribution.
    return ImageFont.load_default(size=size)

def fit(draw, text, max_width, start=44, minimum=15):
    size = start
    while size > minimum and draw.textbbox((0, 0), text, font=font(size))[2] > max_width:
        size -= 1
    return font(size)

def render(family):
    checksum = sum((i+1)*ord(c) for i,c in enumerate(family["id"]))
    bg, ink, accent = PALETTES[checksum % len(PALETTES)]
    image = Image.new("RGB", (2048, 2048), bg)
    draw = ImageDraw.Draw(image)
    title, *tagline = family.get("signLines") or [family["label"], family["satire"]]
    tagline = tagline[0] if tagline else family["satire"]
    initials = "".join(w[0] for w in title.split()[:2]).upper()
    for variant in range(40):
        x, y = (variant % 4)*512, (variant//4)*200
        draw.rectangle((x+2,y+2,x+509,y+197), fill=bg, outline=accent, width=4)
        draw.rectangle((x+12,y+14,x+73,y+76), fill=accent)
        badge_font=fit(draw,initials,51,29)
        draw.text((x+19,y+29),initials,font=badge_font,fill=bg)
        draw.text((x+88,y+18),title.upper(),font=fit(draw,title.upper(),405,37),fill=ink)
        draw.text((x+88,y+61),family["category"].upper()+" / EST. NEXT QUARTER",font=font(14),fill=accent)
        draw.line((x+15,y+91,x+497,y+91),fill=accent,width=2)
        draw.text((x+16,y+103),tagline.upper(),font=fit(draw,tagline.upper(),479,26),fill=ink)
        plan="ABCD"[(variant//5)%4]+str(variant%5+1)+"-"+str(variant//20+1)
        draw.rectangle((x+12,y+151,x+124,y+186),fill=accent)
        draw.text((x+20,y+160),"PLAN "+plan,font=font(17),fill=bg)
        stamp=STAMPS[(variant+checksum)%len(STAMPS)]
        draw.text((x+138,y+160),stamp,font=fit(draw,stamp,357,16,10),fill=ink)
    return image

def main():
    families=json.loads((ROOT/"families.json").read_text(encoding="utf-8"))
    assert len(families)==100
    dest=ROOT/"signs";dest.mkdir(parents=True,exist_ok=True)
    for family in families:
        render(family).save(dest/(family["id"]+".png"),compress_level=9)
    print(f"Rendered {len(families)} sign atlases / {len(families)*40} uniquely labeled signs.")

if __name__=="__main__":
    main()
