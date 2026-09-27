#!/usr/bin/env python3
"""Generate the original, deterministic SLOPMERICA PBR material library.

Every texture is sampled on a closed periodic domain: the final row/column is
an exact copy of the first. Normals use OpenGL tangent-space convention (+Y,
green-up) and ORM packs AO, roughness, metalness into RGB.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


SIZE = 512
N = SIZE - 1
TAU = math.tau
ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT / "vault-public" / "asset-vault" / "textures"

MATERIALS = [
    ("brick-red", "Red Brick", [1.1, 0.6], 0.82, 0.0, 1.15, "Warm staggered clay brick with recessed mortar."),
    ("brick-cream", "Cream Brick", [1.1, 0.6], 0.78, 0.0, 1.05, "Pale fired brick with subtle face variation."),
    ("stucco-ivory", "Ivory Stucco", 1.25, 0.88, 0.0, 0.5, "Fine hand-troweled ivory stucco."),
    ("concrete", "Architectural Concrete", 1.8, 0.84, 0.0, 0.82, "Cool concrete with embedded mineral aggregate."),
    ("limestone", "Coursed Limestone", 1.4, 0.76, 0.0, 0.9, "Warm coursed limestone blocks with fine joints."),
    ("asphalt", "Road Asphalt", 3.5, 0.94, 0.0, 0.62, "Dense charcoal asphalt with stone aggregate."),
    ("roof-shingle", "Asphalt Roof Shingle", 2.2, 0.9, 0.0, 0.78, "Staggered dark architectural roof shingles."),
    ("roof-metal", "Standing Seam Roof", 3.0, 0.48, 0.92, 0.68, "Painted standing-seam metal roofing."),
    ("wood-oak", "Weathered Oak", 1.6, 0.68, 0.0, 1.0, "Weathered oak boards with flowing grain and knots."),
    ("wood-painted", "Painted Wood", 1.6, 0.63, 0.0, 0.55, "Painted timber boards with restrained worn grain."),
    ("metal-dark", "Dark Brushed Metal", 1.2, 0.36, 0.86, 0.35, "Charcoal brushed architectural metal."),
    ("metal-galvanized", "Galvanized Steel", 0.15, 0.44, 0.95, 0.15, "Silvery galvanized steel with fine zinc spangle."),
    ("metal-copper", "Oxidized Copper", 1.25, 0.46, 0.9, 0.7, "Copper sheet with controlled turquoise oxidation."),
    ("glass-blue", "Blue-gray Glass", 2.5, 0.14, 0.0, 0.12, "Desaturated blue-gray architectural glass with faint waviness."),
    ("foliage", "Broadleaf Foliage", 1.3, 0.82, 0.0, 0.88, "Layered repeating broadleaf canopy pattern."),
    ("bark", "Coarse Tree Bark", 1.1, 0.93, 0.0, 1.35, "Deep vertically ridged brown bark."),
    ("soil", "Dark Garden Soil", 1.5, 0.96, 0.0, 0.8, "Moist dark soil with small mineral fragments."),
    ("rubber", "Molded Black Rubber", 0.75, 0.72, 0.0, 0.65, "Molded charcoal rubber with shallow diagonal tread."),
]


def grid():
    axis = np.linspace(0.0, 1.0, SIZE, dtype=np.float32)
    return np.meshgrid(axis, axis)


X, Y = grid()


def periodic_noise(seed: int, octaves=(1, 2, 4, 8), persistence=0.55):
    """Smooth deterministic Fourier noise; exactly periodic at image edges."""
    rng = np.random.default_rng(seed)
    out = np.zeros((SIZE, SIZE), np.float32)
    weight = 1.0
    for octave in octaves:
        band = np.zeros_like(out)
        for _ in range(5):
            kx = int(rng.integers(0, octave + 1))
            ky = int(rng.integers(0, octave + 1))
            if kx == ky == 0:
                kx = octave
            phase = float(rng.random() * TAU)
            band += np.cos(TAU * (kx * X + ky * Y) + phase)
        out += weight * band / 5.0
        weight *= persistence
    out -= out.min()
    return out / max(float(out.max()), 1e-6)


def torus_distance(cx, cy):
    dx = np.minimum(np.abs(X - cx), 1.0 - np.abs(X - cx))
    dy = np.minimum(np.abs(Y - cy), 1.0 - np.abs(Y - cy))
    return np.sqrt(dx * dx + dy * dy)


def aggregate(seed, count, rmin, rmax):
    rng = np.random.default_rng(seed)
    field = np.zeros_like(X)
    tones = np.zeros_like(X)
    for _ in range(count):
        cx, cy = rng.random(2)
        r = rng.uniform(rmin, rmax)
        d = torus_distance(cx, cy)
        mask = np.clip(1.0 - d / r, 0, 1)
        mask = mask * mask * (3 - 2 * mask)
        field = np.maximum(field, mask)
        tones += mask * rng.uniform(-1, 1)
    return field, np.clip(tones, -1, 1)


def rgb(base, modulation=0.0):
    base = np.asarray(base, np.float32)
    if np.isscalar(modulation):
        return np.broadcast_to(base, (SIZE, SIZE, 3)).copy()
    return np.clip(base + modulation[..., None], 0, 1)


def mortar_pattern(rows=8, cols=5, width=0.055, seed=0):
    rowf = Y * rows
    row = np.floor(rowf).astype(int)
    ly = rowf - row
    xf = ((X + (row % 2) * (0.5 / cols)) * cols) % 1.0
    edge = np.minimum.reduce([ly, 1 - ly, xf, 1 - xf])
    mortar = np.clip((width - edge) / width, 0, 1)
    face = periodic_noise(seed, (4, 8, 16), .5)
    return mortar, face


def material_fields(mid: str):
    """Return linear-display RGB albedo, height, roughness, metalness."""
    n1 = periodic_noise(sum(map(ord, mid)) + 11)
    n2 = periodic_noise(sum(map(ord, mid)) + 97, (4, 8, 16, 32), .48)
    h = n1 * .05
    rough = np.full_like(X, .8)
    metal = np.zeros_like(X)

    if mid in ("brick-red", "brick-cream"):
        mortar, face = mortar_pattern(seed=103 if mid == "brick-red" else 113)
        if mid == "brick-red":
            base, joint = (0.48, .16, .095), (.53, .49, .41)
        else:
            base, joint = (.70, .59, .43), (.60, .57, .49)
        albedo = rgb(base, (face - .5) * .13)
        albedo = albedo * (1 - mortar[..., None]) + np.array(joint) * mortar[..., None]
        h = .18 + face * .08 - mortar * .17
        rough = .76 + mortar * .15 + (n2 - .5) * .08
    elif mid == "stucco-ivory":
        trowel = .2 * periodic_noise(211, (1, 2, 3), .6) + .8 * n2
        albedo = rgb((.80, .76, .67), (trowel - .5) * .045)
        h = .10 + trowel * .065
        rough = .84 + n2 * .09
    elif mid == "concrete":
        stones, tones = aggregate(307, 70, .006, .018)
        albedo = rgb((.48, .49, .47), (n1 - .5) * .10 + tones * .12)
        h = .12 + n1 * .08 + stones * .055
        rough = .78 + n2 * .13 - stones * .08
    elif mid == "limestone":
        courses = 6
        rowf = Y * courses
        row = np.floor(rowf).astype(int)
        ly = rowf - row
        offsets = ((row * 0.37) % 1.0) / 3.0
        xf = ((X + offsets) * 3) % 1
        joint = np.clip((.045 - np.minimum.reduce([ly, 1-ly, xf, 1-xf])) / .045, 0, 1)
        stone = periodic_noise(401, (1, 3, 7, 14), .52)
        albedo = rgb((.69, .63, .50), (stone - .5) * .16)
        albedo = albedo * (1-joint[...,None]) + np.array((.40,.38,.33)) * joint[...,None]
        h = .14 + stone * .08 - joint * .14
        rough = .72 + n2*.13 + joint*.08
    elif mid == "asphalt":
        grit, tones = aggregate(503, 165, .0025, .008)
        albedo = rgb((.105, .115, .115), (n2-.5)*.07 + np.maximum(tones,0)*.15)
        h = .08 + n2*.09 + grit*.04
        rough = .88 + n1*.10
    elif mid == "roof-shingle":
        rows = 7
        rowf = Y*rows
        row = np.floor(rowf).astype(int)
        ly = rowf-row
        xf = ((X + (row%2)*.1)*5) % 1
        cut = ((ly > .64) & ((xf < .055) | (xf > .945))).astype(float)
        lip = np.clip((ly-.90)/.1, 0, 1)
        albedo = rgb((.115,.13,.135), (n2-.5)*.11 - lip*.035)
        albedo *= (1-cut[...,None]*.45)
        h = .12+n2*.06-lip*.08-cut*.09
        rough = .84+n1*.12
    elif mid == "roof-metal":
        panel = (X*4)%1
        seam_dist = np.minimum(panel,1-panel)
        seam = np.exp(-(seam_dist/.035)**2)
        ribs = np.exp(-((seam_dist-.065)/.022)**2)
        albedo = rgb((.18,.23,.25), (n1-.5)*.045 + seam*.07)
        h = .10+seam*.22+ribs*.07+n2*.018
        rough = .42+n2*.11
        metal[:] = .92
    elif mid in ("wood-oak", "wood-painted"):
        boards = 5
        by = (Y*boards)%1
        seam = np.exp(-(np.minimum(by,1-by)/.028)**2)
        warp = .035*np.sin(TAU*Y*3)+.018*np.sin(TAU*Y*7)
        grain = .5+.5*np.sin(TAU*(X*11 + warp + .25*n1))
        grain = grain*.62+n2*.38
        knots = np.zeros_like(X)
        for cx,cy in ((.18,.26),(.69,.74),(.91,.42)):
            d=torus_distance(cx,cy)
            knots += np.exp(-(d/.055)**2)*(.5+.5*np.cos(d*TAU*34))
        if mid == "wood-oak":
            albedo = rgb((.39,.235,.105), (grain-.5)*.18 - knots*.10)
            rough = .59+n2*.18+seam*.12
        else:
            paint_texture=periodic_noise(623,(4,9,17,31),.45)
            wear=np.clip((n2-.86)*5.0,0,1)
            albedo = rgb((.30,.43,.455), (paint_texture-.5)*.025)
            raw=rgb((.36,.25,.15),(grain-.5)*.055)
            albedo=albedo*(1-wear[...,None])+raw*wear[...,None]
            rough=.56+n2*.12+wear*.18
            grain=paint_texture
            knots*=.12
        h=.11+(grain-.5)*(.10 if mid == "wood-oak" else .035)+knots*.07-seam*.13
    elif mid == "metal-dark":
        brush=.5+.5*np.sin(TAU*(Y*46+.10*n1))
        albedo=rgb((.26,.285,.30),(brush-.5)*.035)
        h=.10+(brush-.5)*.018+n1*.008
        rough=.31+n2*.10
        metal[:]=.86
    elif mid == "metal-galvanized":
        cells=np.zeros_like(X)
        rng=np.random.default_rng(701)
        pts=rng.random((28,2))
        nearest=np.full_like(X,9.0)
        second=np.full_like(X,9.0)
        tone=np.zeros_like(X)
        for i,(cx,cy) in enumerate(pts):
            d=torus_distance(cx,cy)
            take=d<nearest
            second=np.where(take,nearest,np.minimum(second,d))
            nearest=np.where(take,d,nearest)
            tone=np.where(take,math.sin(i*12.9898),tone)
        edge=np.exp(-((second-nearest)/.009)**2)
        albedo=rgb((.57,.59,.58),tone*.025-edge*.014+(n2-.5)*.012)
        h=.10+edge*.003+n2*.002
        rough=.37+n1*.15
        metal[:]=.95
    elif mid == "metal-copper":
        patina=np.clip((periodic_noise(809,(1,2,3,5),.62)-.53)*3.3,0,1)
        streak=np.clip((periodic_noise(811,(1,2,8),.5)-.64)*3.5,0,1)
        patina=np.maximum(patina,streak*.55)
        copper=rgb((.58,.235,.105),(n2-.5)*.07)
        oxide=rgb((.10,.40,.35),(n1-.5)*.09)
        albedo=copper*(1-patina[...,None])+oxide*patina[...,None]
        h=.10+n2*.025+patina*.025
        rough=.33+n1*.12+patina*.33
        metal=np.clip(.94-patina*.28,0,1)
    elif mid == "glass-blue":
        waves=periodic_noise(887,(1,2,4,8),.48)
        albedo=rgb((.29,.345,.375),(waves-.5)*.012)
        h=.10+(waves-.5)*.004+n2*.002
        rough=.11+n1*.055
        metal[:]=0
    elif mid == "foliage":
        albedo=rgb((.10,.31,.105),(n1-.5)*.08)
        h=np.full_like(X,.06)
        rng=np.random.default_rng(907)
        for i in range(26):
            cx,cy=rng.random(2)
            ang=rng.uniform(0,TAU)
            dx=((X-cx+.5)%1)-.5; dy=((Y-cy+.5)%1)-.5
            u=dx*np.cos(ang)+dy*np.sin(ang); v=-dx*np.sin(ang)+dy*np.cos(ang)
            leaf=np.clip(1-(u/.075)**2-(v/.025)**2,0,1)
            vein=np.exp(-(v/.0035)**2)*leaf
            color=np.array((.12+.035*(i%3),.39+.045*(i%4),.115))
            albedo=albedo*(1-leaf[...,None])+color*leaf[...,None]
            h=np.maximum(h,.10+leaf*.16-vein*.025)
        rough=.75+n2*.16
    elif mid == "bark":
        ridge=.5+.5*np.sin(TAU*(X*9+.22*n1+.04*np.sin(TAU*Y*3)))
        fissure=np.clip((.33-ridge)*5,0,1)
        cross=np.clip((.08-np.abs(np.sin(TAU*(Y*4+.11*n1))))*5,0,1)*fissure
        albedo=rgb((.25,.125,.055),(ridge-.5)*.14-fissure*.09+n2*.035)
        h=.08+ridge*.18-fissure*.10-cross*.08
        rough=.84+n2*.14
    elif mid == "soil":
        pebbles, tones=aggregate(1009,95,.003,.012)
        albedo=rgb((.145,.095,.05),(n1-.5)*.07+tones*.12)
        h=.08+n2*.10+pebbles*.05
        rough=.89+n1*.10
    elif mid == "rubber":
        tread=(np.sin(TAU*(X*7+Y*7))>.64).astype(float)
        tread2=(np.sin(TAU*(X*7-Y*7))>.78).astype(float)
        pattern=np.maximum(tread,tread2)
        albedo=rgb((.055,.064,.064),(n2-.5)*.025+pattern*.018)
        h=.09+pattern*.055+n2*.018
        rough=.65+n1*.12
    else:
        raise ValueError(mid)
    return np.clip(albedo,0,1), h.astype(np.float32), np.clip(rough,0,1), np.clip(metal,0,1)


def enforce_edges(a):
    a[-1, ...] = a[0, ...]
    a[:, -1, ...] = a[:, 0, ...]
    return a


def normal_from_height(height, scale):
    core = height[:N, :N]
    dx = (np.roll(core,-1,axis=1)-np.roll(core,1,axis=1))*0.5*scale
    dy = (np.roll(core,-1,axis=0)-np.roll(core,1,axis=0))*0.5*scale
    # Image rows increase downward while OpenGL tangent +Y points up: +dy in G.
    vec=np.stack((-dx,dy,np.ones_like(core)),axis=-1)
    vec/=np.linalg.norm(vec,axis=-1,keepdims=True)
    full=np.empty((SIZE,SIZE,3),np.float32)
    full[:N,:N]=vec; enforce_edges(full)
    return full*.5+.5


def to_png(path, array):
    array=enforce_edges(array.copy())
    data=np.clip(np.rint(array*255),0,255).astype(np.uint8)
    Image.fromarray(data,"RGB").save(path,optimize=True,compress_level=9)


def make_contact_sheet(output, thumbs):
    cell_w, cell_h, label_h = 192, 136, 24
    cols, rows = 6, 3
    sheet=Image.new("RGB",(cols*cell_w,rows*cell_h),(20,22,24))
    draw=ImageDraw.Draw(sheet); font=ImageFont.load_default()
    for i,(mid,img) in enumerate(thumbs):
        x=(i%cols)*cell_w; y=(i//cols)*cell_h
        preview=img.resize((cell_w,cell_h-label_h),Image.Resampling.LANCZOS)
        sheet.paste(preview,(x,y))
        draw.rectangle((x,y+cell_h-label_h,x+cell_w,y+cell_h),fill=(16,18,20))
        draw.text((x+8,y+cell_h-label_h+6),mid,fill=(235,238,240),font=font)
    sheet.save(output/"contact-sheet.png",optimize=True,compress_level=9)


def generate(output: Path):
    output.mkdir(parents=True,exist_ok=True)
    manifest=[]; thumbs=[]
    for mid,label,tile,base_rough,base_metal,nscale,description in MATERIALS:
        albedo,height,rough,metal=material_fields(mid)
        albedo=enforce_edges(albedo)
        # Keep authored variation while centering maps on declared scalar values.
        rough=np.clip(rough-np.mean(rough)+base_rough,0,1)
        metal=np.clip(metal-np.mean(metal)+base_metal,0,1)
        normal=normal_from_height(enforce_edges(height),nscale*12.0)
        ao=np.clip(1.0-(np.maximum(0,np.mean(height)-height)*1.4),.58,1.0)
        orm=np.stack((ao,rough,metal),axis=-1)
        to_png(output/f"{mid}-albedo.png",albedo)
        to_png(output/f"{mid}-normal.png",normal)
        to_png(output/f"{mid}-orm.png",orm)
        thumbs.append((mid,Image.fromarray(np.rint(albedo*255).astype(np.uint8),"RGB")))
        manifest.append({
            "id":mid,"label":label,
            "albedo":f"{mid}-albedo.png","normal":f"{mid}-normal.png","orm":f"{mid}-orm.png",
            "tileMeters":tile,"roughness":base_rough,"metalness":base_metal,
            "normalScale":nscale,"description":description,
        })
    (output/"materials.json").write_text(json.dumps(manifest,indent=2)+"\n",encoding="utf-8")
    make_contact_sheet(output,thumbs)
    return manifest


def validate(output: Path, manifest):
    worst_edge=0; normal_min=1.0; normal_max=0.0
    for item in manifest:
        for kind in ("albedo","normal","orm"):
            a=np.asarray(Image.open(output/item[kind]))
            worst_edge=max(worst_edge,int(np.abs(a[0].astype(int)-a[-1].astype(int)).max()))
            worst_edge=max(worst_edge,int(np.abs(a[:,0].astype(int)-a[:,-1].astype(int)).max()))
        n=np.asarray(Image.open(output/item["normal"]),dtype=np.float32)/255*2-1
        lengths=np.linalg.norm(n,axis=-1)
        normal_min=min(normal_min,float(lengths.min())); normal_max=max(normal_max,float(lengths.max()))
    total=sum(p.stat().st_size for p in output.iterdir() if p.is_file())
    print(json.dumps({"materials":len(manifest),"size":SIZE,"maxEdgeDelta8bit":worst_edge,
        "decodedNormalLengthRange":[round(normal_min,5),round(normal_max,5)],
        "normalConvention":"OpenGL tangent space, +Y stored in green",
        "determinism":"fixed Fourier/geometry seeds; byte-stable with same Pillow version",
        "outputBytes":total},indent=2))
    if worst_edge != 0 or len(manifest) != 18 or normal_min < .97 or normal_max > 1.03:
        raise SystemExit("validation failed")


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--output",type=Path,default=DEFAULT_OUTPUT)
    args=parser.parse_args()
    manifest=generate(args.output)
    validate(args.output,manifest)


if __name__ == "__main__":
    main()
