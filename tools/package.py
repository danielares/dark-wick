"""Gera dist/dark-wick-<versão>.zip pronto para a Chrome Web Store.

Inclui só o que a extensão usa (manifest, src/, ícones PNG) e confere se todo
arquivo citado no manifest está no pacote — arquivo faltando é motivo de
reprovação ("Yellow Magnesium").

    python tools/package.py
"""
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INCLUDE = ["manifest.json", "src/**/*.js", "src/**/*.html", "src/**/*.css", "icons/*.png"]


def manifest_refs(m):
    refs = set(m.get("icons", {}).values())
    action = m.get("action", {})
    refs |= set(action.get("default_icon", {}).values())
    refs.add(action.get("default_popup"))
    refs.add(m.get("background", {}).get("service_worker"))
    for cs in m.get("content_scripts", []):
        refs |= set(cs.get("js", []) + cs.get("css", []))
    return {r for r in refs if r}


def code_refs():
    """Arquivos citados no código (ícones de estado, content script registrado)."""
    refs = {"src/content.js", "src/shared.js"}
    refs |= {f"icons/{n}{s}.png" for n in ("icon", "off") for s in (16, 32, 48)}
    return refs


def main():
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    files = sorted({p.relative_to(ROOT).as_posix() for pat in INCLUDE for p in ROOT.glob(pat)})

    missing = (manifest_refs(manifest) | code_refs()) - set(files)
    if missing:
        sys.exit(f"Arquivos referenciados mas ausentes: {sorted(missing)}")

    out = ROOT / "dist" / f"dark-wick-{manifest['version']}.zip"
    out.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in files:
            z.write(ROOT / f, f)  # caminhos com "/" (Compress-Archive do Windows usa "\")

    print(f"{out.relative_to(ROOT)}  ({out.stat().st_size / 1024:.1f} KB)")
    for f in files:
        print(f"  {f}")


if __name__ == "__main__":
    main()
