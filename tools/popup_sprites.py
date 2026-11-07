"""Monta as tiras de sprites do logo do popup a partir dos quadros da coruja.

    python tools/popup_sprites.py

Lê store/brand/anim/{loop_noite_*, loop_dia_*, frame_*}.png e grava em src/popup/img/
uma tira horizontal por animação (webp, quadros de PX px):
  noite.webp  loop parado do modo escuro (ligado)
  dia.webp    loop parado do modo claro (desligado)
  vira.webp   transição noite → dia (tocada ao contrário para dia → noite)
Rodar de novo sempre que os quadros forem regerados.
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ANIM = ROOT / "store" / "brand" / "anim"
OUT = ROOT / "src" / "popup" / "img"
PX = 192  # exibido a ~100 px (2x para telas HiDPI)


def tira(nome, padrao):
    quadros = sorted(ANIM.glob(padrao))
    if not quadros:
        raise SystemExit(f"Sem quadros para {padrao}")
    img = Image.new("RGBA", (PX * len(quadros), PX))
    for i, q in enumerate(quadros):
        img.paste(Image.open(q).convert("RGBA").resize((PX, PX), Image.LANCZOS), (i * PX, 0))
    dest = OUT / f"{nome}.webp"
    img.save(dest, "WEBP", quality=88, method=6)
    print(f"{dest.relative_to(ROOT)}: {len(quadros)} quadros, {dest.stat().st_size / 1024:.1f} KB")
    return len(quadros)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    tira("noite", "loop_noite_*.png")
    tira("dia", "loop_dia_*.png")
    tira("vira", "frame_*.png")


if __name__ == "__main__":
    main()
