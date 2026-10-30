"""Gera as imagens da Chrome Web Store em store/assets/.

Renderiza as cenas de store/src/ com o Chrome (ou Brave) headless, usando o
popup e o content script reais. Requer Python 3 + Pillow.

    python store/build.py
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "store" / "src"
OUT = ROOT / "store" / "assets"

SCENES = [
    ("screenshot-1.html", "screenshot-1.png", (1280, 800)),
    ("screenshot-2.html", "screenshot-2.png", (1280, 800)),
    ("screenshot-3.html", "screenshot-3.png", (1280, 800)),
    ("promo.html", "promo-small-440x280.png", (440, 280)),
    ("promo.html", "promo-marquee-1400x560.png", (1400, 560)),
]

BROWSERS = [
    os.environ.get("CHROME", ""),
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "google-chrome",
    "chromium",
]

FAVICON = (
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E"
    "%3Crect width='32' height='32' rx='7' fill='%232563eb'/%3E%3Ctext x='16' y='22' "
    "font-family='Georgia' font-size='18' font-weight='700' fill='white' text-anchor='middle'%3EJ%3C/text%3E%3C/svg%3E"
)


def find_browser():
    for b in BROWSERS:
        if b and (Path(b).exists() or shutil.which(b)):
            return b
    sys.exit("Chrome/Brave não encontrado. Defina a variável CHROME com o caminho do executável.")


def build_popup_demo():
    """Copia o <body> do popup real para uma página com a API chrome simulada."""
    html = (ROOT / "src" / "popup" / "popup.html").read_text(encoding="utf-8")
    body = re.search(r"<body>(.*)</body>", html, re.S).group(1)
    body = body.replace('src="popup.js"', 'src="../../src/popup/popup.js"')
    page = f"""<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<link rel="stylesheet" href="../../src/popup/popup.css">
<style>* {{ transition: none !important; }}</style>
<script>
  const state = new URLSearchParams(location.search).get('state') || 'on';
  window.chrome = {{
    tabs: {{ query: async () => [{{ id: 1, url: 'https://www.jornaldamanha.com.br/' }}], sendMessage: async () => ({{ state }}) }},
    storage: {{ sync: {{ get: async () => ({{}}), set: async () => {{}}, remove: async () => {{}} }} }},
    runtime: {{ getURL: () => "{FAVICON}", getManifest: () => ({{ version: '1.0.0' }}) }},
    commands: {{ getAll: async () => [{{ name: 'toggle-site', shortcut: 'Alt+Shift+D' }}] }},
  }};
</script>
</head><body>{body}</body></html>"""
    (SRC / "_popup-demo.html").write_text(page, encoding="utf-8")


def render(browser, scene, out, size, profile):
    w, h = size
    subprocess.run(
        [
            browser, "--headless=new", "--disable-gpu", "--hide-scrollbars",
            "--allow-file-access-from-files", "--force-device-scale-factor=1",
            f"--user-data-dir={profile}", f"--window-size={w},{h}",
            "--virtual-time-budget=4000", f"--screenshot={out}",
            (SRC / scene).as_uri(),
        ],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60,
    )
    # A loja recusa imagens com transparência: achata em RGB.
    img = Image.open(out).convert("RGB")
    assert img.size == size, f"{out.name}: {img.size} != {size}"
    img.save(out)


def store_icon():
    """Ícone da loja: 128x128 com arte de 96x96 e 16px de margem transparente."""
    art = Image.open(ROOT / "icons" / "icon128.png").convert("RGBA").resize((96, 96), Image.LANCZOS)
    icon = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    icon.paste(art, (16, 16), art)
    icon.save(OUT / "store-icon-128.png")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    browser = find_browser()
    build_popup_demo()
    with tempfile.TemporaryDirectory() as profile:
        for scene, name, size in SCENES:
            render(browser, scene, OUT / name, size, profile)
            print(f"ok  {name}")
    store_icon()
    print("ok  store-icon-128.png")


if __name__ == "__main__":
    main()
