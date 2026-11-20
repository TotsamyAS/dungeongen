"""Atmosphere transforms for exported dungeon maps."""
import json
import math
from pathlib import Path
import numpy as np

def apply_atmosphere(image, value):
    import skia
    if not isinstance(value, dict): return image
    looks = json.loads((Path(__file__).parent / 'editor/atmosphere-presets.json').read_text())
    preset = value.get('preset', 'none')
    if not isinstance(preset, str) or preset not in looks or preset == 'none': return image
    strength = value.get('strength', 50)
    if isinstance(strength, bool) or not isinstance(strength, (int,float)) or not math.isfinite(strength): strength = 50
    a = max(0,min(100,strength))/100
    tint = looks[preset]
    r,g,b,c,s,lift = tint
    matrix = np.array([[t*c*((s if row==col else 0)+(1-s)*w) for col,w in enumerate([.2126,.7152,.0722])] for row,t in enumerate([r,g,b])])
    pixels = image.toarray(colorType=skia.kRGBA_8888_ColorType)
    h,w = pixels.shape[:2]
    x = (np.arange(w)+.5)/w
    for y in range(0,h,64):
        rgb = pixels[y:y+64,:,:3].astype(np.float32)
        weight = a
        if value.get('placement') != 'uniform':
            yy = (np.arange(y,min(h,y+64))+.5)/h
            radius = np.minimum(1,np.hypot((x[None,:]-.5)*2,(yy[:,None]-.5)*2))
            weight = a*(.15+.85*radius*radius*(3-2*radius))[:,:,None]
        changed = rgb @ matrix.T + ((1-c)/2+lift)*255
        pixels[y:y+64,:,:3] = np.clip(rgb+weight*(changed-rgb),0,255).round().astype(np.uint8)
    return skia.Image.fromarray(pixels,colorType=skia.kRGBA_8888_ColorType)
