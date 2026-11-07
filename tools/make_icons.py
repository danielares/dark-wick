"""Gera os ícones da extensão a partir da arte própria de ícone (cabeça da coruja + crescente).

    python tools/make_icons.py [store/brand/toolbar/04.png]

A arte vem da folha do Gemini sobre fundo cinza liso (#808080); o fundo vira transparência.
icons/icon{16,32,48,128}.png e store/assets/store-icon-128.png.
O de 128 px segue a recomendação da Chrome Web Store: arte de 96 px centrada com 16 px de margem.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
FONTE = ROOT / "store" / "brand" / "toolbar" / "04.png"


def recorta(path):
    a = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    bg = np.median(np.r_[a[:4].reshape(-1, 3), a[-4:].reshape(-1, 3)], axis=0)
    dist = np.abs(a - bg).sum(-1)
    alpha = np.clip((dist - 10) / 40, 0, 1)
    # tira a mistura com o cinza nas bordas semitransparentes
    k = alpha[..., None]
    rgb = np.where(k > 0, (a - bg * (1 - k)) / np.maximum(k, 1e-3), 0)
    img = Image.fromarray(np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8), "RGBA")
    box = img.getchannel("A").point(lambda v: 255 if v > 40 else 0).getbbox()
    img = img.crop(box)
    lado = max(img.size)
    sq = Image.new("RGBA", (lado, lado))
    sq.paste(img, ((lado - img.width) // 2, (lado - img.height) // 2))
    return sq


def reduz(img, px):
    out = img.resize((px, px), Image.LANCZOS)
    if px <= 32:  # recupera a nitidez perdida na redução grande
        out = out.filter(ImageFilter.UnsharpMask(radius=0.6, percent=70, threshold=2))
    return out


def com_margem(img, px=128, arte=96):
    out = Image.new("RGBA", (px, px))
    a = reduz(img, arte)
    out.paste(a, ((px - arte) // 2, (px - arte) // 2), a)
    return out


def main():
    arte = recorta(Path(sys.argv[1]) if len(sys.argv) > 1 else FONTE)
    icons = ROOT / "icons"
    arte.save(ROOT / "store" / "brand" / "toolbar" / "icone.png")
    for px in (16, 32, 48):
        reduz(arte, px).save(icons / f"icon{px}.png", optimize=True)
    com_margem(arte).save(icons / "icon128.png", optimize=True)
    com_margem(arte).save(ROOT / "store" / "assets" / "store-icon-128.png", optimize=True)
    print("ícones gerados em icons/ e store/assets/store-icon-128.png")


if __name__ == "__main__":
    main()
