"""Gera folhas de identidade visual com o Gemini (uma chamada = várias ideias) e recorta.

    GEMINI_API_KEY=... python tools/brand.py gerar <nome> "<prompt>" [--grade 3x3] [--ref img.png ...]
    python tools/brand.py recortar <nome> [--grade 3x3]

A folha fica em store/brand/<nome>/folha.png e os recortes em store/brand/<nome>/NN.png.
O recorte divide a imagem pela grade pedida e depois apara a margem de fundo de cada célula.
"""
import base64
import json
import os
import sys
import urllib.request
from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "store" / "brand"
MODEL = "gemini-3-pro-image"


def gerar(nome, prompt, cols, rows, refs=()):
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        sys.exit("Defina GEMINI_API_KEY")
    body = {
        "contents": [{"parts": [
            *({"inlineData": {"mimeType": "image/png", "data": base64.b64encode((ROOT / r).read_bytes()).decode()}} for r in refs),
            {"text": prompt},
        ]}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {"aspectRatio": "1:1" if cols == rows else "16:9", "imageSize": "4K"},
        },
    }
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        data = json.load(r)
    parts = data["candidates"][0]["content"]["parts"]
    img = next((p["inlineData"]["data"] for p in parts if "inlineData" in p), None)
    if not img:
        sys.exit(f"Sem imagem na resposta: {json.dumps(data)[:500]}")
    d = OUT / nome
    d.mkdir(parents=True, exist_ok=True)
    (d / "folha.png").write_bytes(base64.b64decode(img))
    (d / "prompt.txt").write_text(prompt, encoding="utf-8")
    recortar(nome, cols, rows)


def aparar(cell, margem=0.06):
    """Apara o fundo uniforme (cor do canto) e devolve um quadrado centrado com margem."""
    bg = Image.new(cell.mode, cell.size, cell.getpixel((2, 2)))
    diff = ImageChops.difference(cell, bg).convert("L").point(lambda v: 255 if v > 8 else 0)
    box = diff.getbbox()
    if not box:
        return cell
    obj = cell.crop(box)
    lado = int(max(obj.size) * (1 + 2 * margem))
    sq = Image.new(cell.mode, (lado, lado), cell.getpixel((2, 2)))
    sq.paste(obj, ((lado - obj.width) // 2, (lado - obj.height) // 2))
    return sq


def recortar(nome, cols, rows):
    d = OUT / nome
    folha = Image.open(d / "folha.png").convert("RGB")
    w, h = folha.size
    cw, ch = w / cols, h / rows
    n = 0
    for r in range(rows):
        for c in range(cols):
            n += 1
            # encolhe 2% de cada lado para não pegar linha de divisão entre células
            dx, dy = cw * 0.02, ch * 0.02
            cell = folha.crop((int(c * cw + dx), int(r * ch + dy), int((c + 1) * cw - dx), int((r + 1) * ch - dy)))
            aparar(cell).save(d / f"{n:02d}.png")
    print(f"{d.relative_to(ROOT)}: folha {w}x{h}, {n} recortes")


def main():
    a = sys.argv[1:]
    grade = "3x3"
    if "--grade" in a:
        i = a.index("--grade")
        grade = a[i + 1]
        del a[i : i + 2]
    refs = []
    while "--ref" in a:
        i = a.index("--ref")
        refs.append(a[i + 1])
        del a[i : i + 2]
    cols, rows = map(int, grade.split("x"))
    if a[0] == "gerar":
        gerar(a[1], a[2], cols, rows, refs)
    elif a[0] == "recortar":
        recortar(a[1], cols, rows)


if __name__ == "__main__":
    main()
