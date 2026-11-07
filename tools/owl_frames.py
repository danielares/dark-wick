"""Monta os quadros da transição noite→dia do ícone a partir da arte-base (quadro 1 do Gemini).

A coruja é recortada uma vez e fica parada em todos os quadros; o céu, a lua→sol, as estrelas
e os olhos (chamas que apagam e pálpebras que fecham) são animados por código, para os quadros
ficarem alinhados pixel a pixel.

    python tools/owl_frames.py [store/brand/transicao/01.png]

Saída em store/brand/anim/: frame_00..NN.png (1024px), preview.gif e camadas de depuração.
"""
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "store" / "brand" / "anim"
S = 1024  # resolução de trabalho
N = 10  # quadros (0 = noite, N-1 = dia)


def lum(a):
    return a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114


def fit_circle(pts):
    x, y = pts[:, 0].astype(float), pts[:, 1].astype(float)
    A = np.c_[2 * x, 2 * y, np.ones_like(x)]
    cx, cy, c = np.linalg.lstsq(A, x * x + y * y, rcond=None)[0]
    return cx, cy, np.sqrt(c + cx * cx + cy * cy)


def extrair(path):
    src = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    h, w, _ = src.shape
    L = lum(src)
    corner = src[5, 5]
    # tile: tudo que difere do fundo externo
    tile = (np.abs(src - corner).sum(-1) > 30)
    tile = ndimage.binary_fill_holes(ndimage.binary_opening(tile, iterations=3))
    ys, xs = np.nonzero(tile)
    box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    src, L, tile = src[box[1]:box[3], box[0]:box[2]], L[box[1]:box[3], box[0]:box[2]], tile[box[1]:box[3], box[0]:box[2]]
    # redimensiona para S×S
    def rs(a, interp=cv2.INTER_AREA):
        return cv2.resize(a, (S, S), interpolation=interp)
    src = rs(src)
    L = rs(L)
    tile = rs(tile.astype(np.uint8), cv2.INTER_NEAREST).astype(bool)

    # coruja: pixels escuros e pouco azuis, componente que toca a borda de baixo, buracos preenchidos
    # (a base da coruja tem quase a cor do fundo externo, por isso não usa a máscara do tile)
    # borda nítida no verde: fundo G>=56, coruja G<=40 (mesmo com o brilho da lua por cima)
    near_corner = np.abs(src - src[2, 2]).sum(-1) < 14
    lab, _ = ndimage.label(near_corner)
    outer = np.isin(lab, list({lab[2, 2], lab[2, -3], lab[-3, 2], lab[-3, -3]} - {0}))
    dark = (src[..., 1] < 45) & (src[..., 2] < 52) & ~outer
    lab, n = ndimage.label(dark)
    owl = lab == lab[S - 20, S // 2]
    owl = ndimage.binary_closing(owl, iterations=4)
    owl = ndimage.binary_fill_holes(owl)
    owl = ndimage.binary_opening(owl, iterations=2)
    tile = ndimage.binary_fill_holes(tile | owl)

    # chamas dos olhos: laranja dentro da coruja
    flame = owl & (src[..., 0] > 150) & (src[..., 2] < 140)
    lab, n = ndimage.label(flame)
    sizes = ndimage.sum(flame, lab, range(1, n + 1))
    keep = np.argsort(sizes)[-2:] + 1
    eyes = []
    for k in keep:
        yy, xx = np.nonzero(lab == k)
        eyes.append((xx.mean(), yy.mean(), max(np.ptp(xx), np.ptp(yy)) / 2))
    eyes.sort()

    # lua: claro fora da coruja; estrelas = componentes pequenos
    bright = tile & ~owl & (L > 150)
    lab, n = ndimage.label(bright)
    sizes = ndimage.sum(bright, lab, range(1, n + 1))
    big = np.argmax(sizes) + 1
    moon = lab == big
    stars = bright & ~moon & ~ndimage.binary_dilation(moon, iterations=40)
    lab, n = ndimage.label(stars)
    sizes = ndimage.sum(stars, lab, range(1, n + 1))
    stars = np.isin(lab, np.nonzero(sizes < 3000)[0] + 1)
    # círculo externo e interno da crescente
    cnt, _ = cv2.findContours(moon.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    pts = max(cnt, key=len)[:, 0, :]
    (ocx, ocy), orad = cv2.minEnclosingCircle(pts)
    d = np.hypot(pts[:, 0] - ocx, pts[:, 1] - ocy)
    near_owl = ndimage.binary_dilation(owl, iterations=6)[pts[:, 1], pts[:, 0]]
    inner = pts[(d < orad * 0.93) & ~near_owl]
    icx, icy, irad = fit_circle(inner)

    return dict(src=src, tile=tile, owl=owl, eyes=eyes, moon=moon, stars=stars,
                outer=(ocx, ocy, orad), inner=(icx, icy, irad))


def smooth(a, b, t):
    x = np.clip((t - a) / (b - a), 0, 1)
    return x * x * (3 - 2 * x)


def lerp(a, b, t):
    return np.asarray(a, np.float32) * (1 - t) + np.asarray(b, np.float32) * t


YY, XX = np.mgrid[0:S, 0:S].astype(np.float32)


def circle(cx, cy, r, soft=1.5):
    """Máscara de círculo com borda suavizada (0..1)."""
    return np.clip((r - np.hypot(XX - cx, YY - cy)) / soft + 0.5, 0, 1)


def over(base, color, alpha):
    a = alpha[..., None]
    return base * (1 - a) + np.asarray(color, np.float32) * a


def preparar(L):
    src, owl = L["src"], L["owl"]
    body = np.median(src[owl & (YY > S * 0.8)], axis=0)  # cor lisa do corpo
    olhos = []
    for cx, cy, rf in L["eyes"]:
        # disco claro em volta da chama
        near = (np.hypot(XX - cx, YY - cy) < rf * 1.6) & owl & (src[..., 1] > 40)
        ys, xs = np.nonzero(near)
        (dx, dy), rd = cv2.minEnclosingCircle(np.c_[xs, ys].astype(np.float32))
        ring = (np.hypot(XX - dx, YY - dy) < rd * 0.97) & (np.hypot(XX - dx, YY - dy) > rd * 0.85)
        olhos.append(dict(cx=dx, cy=dy, rd=rd, rf=rf * 1.12, fx=cx, fy=cy, r0=rf, ring=np.percentile(src[ring], 75, axis=0)))
    lid = lerp(body, olhos[0]["ring"], 0.3)
    # bico: contorno claro entre os olhos, abaixo da linha deles e fora dos discos
    a, b = olhos
    mx, my, rd = (a["cx"] + b["cx"]) / 2, (a["cy"] + b["cy"]) / 2, (a["rd"] + b["rd"]) / 2
    fora = np.ones((S, S), bool)
    for o in olhos:
        fora &= np.hypot(XX - o["cx"], YY - o["cy"]) > o["rd"] * 1.08
    cand = owl & fora & (lum(src) > 55) & (np.abs(XX - mx) < rd * 0.6) & (YY > my) & (YY < my + rd * 2)
    ys, xs = np.nonzero(cand)
    beak = np.zeros((S, S), np.uint8)
    if len(xs):
        cv2.fillConvexPoly(beak, cv2.convexHull(np.c_[xs, ys].astype(np.int32)), 1)
    beak = ndimage.binary_dilation(beak.astype(bool), iterations=3)
    # céu noturno sem a lua (senão ela aparece como fantasma atrás do sol)
    lua = ndimage.binary_dilation(~owl & ~L["stars"] & (lum(src) > 120), iterations=6) & ~owl
    sem_lua = cv2.inpaint(np.clip(src, 0, 255).astype(np.uint8), lua.astype(np.uint8), 12, cv2.INPAINT_TELEA)
    sem_lua = cv2.GaussianBlur(sem_lua.astype(np.float32), (0, 0), 6)
    estrelas, n = ndimage.label(L["stars"])
    rng = np.random.default_rng(7)
    L["piscas"] = [(estrelas == i + 1, rng.integers(1, 3), rng.random()) for i in range(n)]
    L.update(body=body, olhos=olhos, lid=lid, beak=beak, sem_lua=np.where(lua[..., None], sem_lua, src))


def ceu_dia():
    top, bot = np.array([178, 214, 244], np.float32), np.array([255, 238, 205], np.float32)
    k = (YY / S)[..., None]
    return top * (1 - k) + bot * k


def chamas(L, img, fase, peso):
    """Tremula as chamas dos olhos: balanço lateral maior na ponta, leve esticada e brilho pulsando."""
    src = L["src"]
    for i, o in enumerate(L["olhos"]):
        ph = i * 1.7
        base = o["fy"] + o["r0"]
        h = np.clip((base - YY) / (2 * o["r0"]), 0, 1)
        dx = o["r0"] * 0.09 * h ** 1.5 * np.sin(2 * np.pi * fase * 2 + ph + h * 2.5)
        st = 1 + 0.035 * np.sin(2 * np.pi * fase * 3 + ph)
        mx = (XX - dx * peso).astype(np.float32)
        my = (base - (base - YY) / (1 + (st - 1) * peso)).astype(np.float32)
        warp = cv2.remap(src, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        # só a chama e um pouco em volta (o anel do olho vizinho fica dentro do disco)
        disco = cv2.GaussianBlur(circle(o["fx"], o["fy"], o["r0"] * 1.12, 1.0), (0, 0), 4)[..., None]
        img = img * (1 - disco) + warp * disco
        # o brilho quente em volta respira junto
        g = 1 + 0.09 * peso * np.sin(2 * np.pi * fase * 2 + ph + 0.8)
        zona = (np.hypot(XX - o["cx"], YY - o["cy"]) < o["rd"] * 1.9) & L["owl"]
        img[zona] = L["body"] + (img[zona] - L["body"]) * g
    return img


def render(L, t, fase=0.0):
    src, owl, tile = L["src"], L["owl"], L["tile"]
    ocx, ocy, orad = L["outer"]
    icx, icy, irad = L["inner"]

    # --- céu: noite (arte original sem coruja) → aurora → dia
    noite = 1 - smooth(0.15, 0.85, t)
    # a lua original some do céu enquanto o desenho assume
    ceu_noite = lerp(src, L["sem_lua"], smooth(0.05, 0.3, t))
    # estrelas piscando, cada uma no seu ritmo
    for m, ciclos, ph in L["piscas"]:
        b = 0.62 + 0.38 * np.cos(2 * np.pi * (fase * ciclos + ph))
        ceu_noite[m] = lerp(L["sem_lua"][m], src[m], b)
    img = lerp(ceu_dia(), ceu_noite, noite)
    aurora = np.sin(np.pi * smooth(0.1, 0.9, t)) * 0.35 * (YY / S)
    img = over(img, (255, 160, 110), aurora)

    # --- astro: crescente desenhada por cima da lua original, que vai enchendo e vira sol
    u = smooth(0.08, 0.5, t)  # enche
    v = smooth(0.35, 0.8, t)  # vira sol
    r = orad * lerp(1.0, 0.74, v)
    disco = circle(ocx, ocy, r, 2.0)
    vx, vy = icx - ocx, icy - ocy
    corte = circle(ocx + vx * (1 + u * 6), ocy + vy * (1 + u * 6), irad * (1 - u), 2.0)
    astro = disco * (1 - corte)
    cor = lerp((250, 233, 206), (255, 198, 84), v)
    respira = 1 + 0.18 * v * np.sin(2 * np.pi * fase)
    halo = np.clip(cv2.GaussianBlur(astro, (0, 0), 28 * (1 + 0.15 * v * np.sin(2 * np.pi * fase))) * lerp(0.55, 0.8, v) * respira, 0, 1)
    if v > 0:
        # feixes de luz saindo do sol, parados, cada um pulsando no seu tempo
        th = np.arctan2(YY - ocy, XX - ocx)
        dist = np.hypot(XX - ocx, YY - ocy)
        feixes = np.zeros((S, S), np.float32)
        for j in range(7):
            c = j * 2 * np.pi / 7 + 0.3
            dth = np.angle(np.exp(1j * (th - c)))
            amp = 0.55 + 0.45 * np.sin(2 * np.pi * fase + j * 2.4)
            feixes += amp * np.exp(-(dth / 0.2) ** 2)
        queda = np.clip((dist - r * 0.9) / (r * 0.3), 0, 1) * np.clip(1 - (dist - r) / (S * 0.75), 0, 1)
        img = over(img, (255, 232, 170), np.clip(feixes * queda, 0, 1) * 0.42 * v)
    img = over(img, lerp((255, 222, 180), (255, 190, 90), v), halo * (1 - noite * 0.6))
    # a lua original manda nos primeiros quadros; o desenho assume aos poucos
    img = over(img, cor, astro * smooth(0.0, 0.12, t))
    # raios do sol
    if v > 0:
        raios = np.zeros((S, S), np.float32)
        ang0 = t * 0.6  # raios parados; quem anda é uma onda de brilho
        for k in range(12):
            a = ang0 + k * np.pi / 6
            onda = np.sin(2 * np.pi * (fase - k / 12))
            pulso = 0.035 * onda
            r0, r1 = r * 1.12, r * (1.12 + (0.2 + pulso) * v)
            p0 = (int(ocx + np.cos(a) * r0), int(ocy + np.sin(a) * r0))
            p1 = (int(ocx + np.cos(a) * r1), int(ocy + np.sin(a) * r1))
            cv2.line(raios, p0, p1, 0.72 + 0.28 * onda, int(r * 0.06), cv2.LINE_AA)
        img = over(img, (255, 190, 80), raios * v)
        # luz do sol banhando o céu, pulsando devagar
        luz = np.clip(1 - np.hypot(XX - ocx, YY - ocy) / (S * 0.9), 0, 1) ** 2
        img = over(img, (255, 236, 190), luz * v * (0.1 + 0.08 * np.sin(2 * np.pi * fase)))

    # --- coruja (parada)
    img[owl] = src[owl]
    e = smooth(0.3, 0.8, t)
    if e < 1:
        img = np.where(owl[..., None], chamas(L, img, fase, 1 - e), img)
    discos = np.zeros((S, S), bool)
    for o in L["olhos"]:
        discos |= np.hypot(XX - o["cx"], YY - o["cy"]) < o["rd"]
    for o in L["olhos"]:
        d = np.hypot(XX - o["cx"], YY - o["cy"])
        # o brilho quente das chamas some do rosto
        brilho = owl & (d < o["rd"] * 1.9) & ~discos & ~L["beak"]
        img[brilho] = lerp(src[brilho], L["body"], e)
        # pálpebras fecham numa fenda que afina; no fim, um arco de olho dormindo
        miolo = circle(o["cx"], o["cy"], o["rd"] * 0.84, 2.0)
        # aberto (e=0) a fenda cobre o disco todo; fecha até virar uma linha
        fenda = np.clip((o["rd"] * 1.05 * (1 - e) - np.abs(YY - o["cy"])) / 2 + 0.5, 0, 1)
        img = over(img, L["lid"], miolo * np.maximum(1 - fenda, smooth(0.5, 1.0, e)))
        if e > 0.6:
            linha = np.zeros((S, S), np.float32)
            rf = o["rf"]
            cv2.ellipse(linha, (int(o["cx"]), int(o["cy"] - rf * 0.12)), (int(rf * 0.6), int(rf * 0.38)),
                        0, 12, 168, 1.0, max(3, int(rf * 0.16)), cv2.LINE_AA)
            img = over(img, lerp(o["ring"], (255, 225, 190), 0.45), linha * smooth(0.6, 1.0, e))

    rgba = np.dstack([np.clip(img, 0, 255), tile.astype(np.float32) * 255]).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def main():
    path = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "store/brand/transicao/01.png")
    OUT.mkdir(parents=True, exist_ok=True)
    L = extrair(path)
    preparar(L)
    frames = [render(L, i / (N - 1)) for i in range(N)]
    for i, f in enumerate(frames):
        f.save(OUT / f"frame_{i:02d}.png")
    # prévia: liga ↔ desliga, em 128 px e 32 px lado a lado
    prev = []
    seq = frames + [frames[-1]] * 8 + frames[::-1] + [frames[0]] * 8
    for f in seq:
        c = Image.new("RGB", (128 + 32 + 30, 138), (32, 33, 36))
        c.paste(f.resize((128, 128), Image.LANCZOS), (5, 5), f.resize((128, 128), Image.LANCZOS))
        s = f.resize((32, 32), Image.LANCZOS)
        c.paste(s, (148, 53), s)
        prev.append(c)
    prev[0].save(OUT / "preview.gif", save_all=True, append_images=prev[1:], duration=45, loop=0)
    tira = Image.new("RGB", (N * 210, 210), (32, 33, 36))
    for i, f in enumerate(frames):
        g = f.resize((200, 200), Image.LANCZOS)
        tira.paste(g, (i * 210 + 5, 5), g)
    tira.save(OUT / "tira.png")

    # loops parados de cada estado
    K = 24
    for nome, t in (("noite", 0.0), ("dia", 1.0)):
        loop = [render(L, t, k / K) for k in range(K)]
        for k, f in enumerate(loop):
            f.save(OUT / f"loop_{nome}_{k:02d}.png")
        g = []
        for f in loop:
            c = Image.new("RGB", (256 + 32 + 30, 266), (32, 33, 36))
            big = f.resize((256, 256), Image.LANCZOS)
            c.paste(big, (5, 5), big)
            sm = f.resize((32, 32), Image.LANCZOS)
            c.paste(sm, (276, 117), sm)
            g.append(c)
        # paleta única para o loop todo (paleta por quadro faz os tons escuros cintilarem)
        mosaico = Image.new("RGB", (g[0].width, g[0].height * len(g)))
        for k, c in enumerate(g):
            mosaico.paste(c, (0, k * c.height))
        pal = mosaico.quantize(256, method=Image.Quantize.MEDIANCUT)
        g = [c.quantize(palette=pal, dither=Image.Dither.NONE) for c in g]
        g[0].save(OUT / f"loop_{nome}.gif", save_all=True, append_images=g[1:], duration=80, loop=0)

    dbg = L["src"].copy()
    dbg[L["owl"]] = dbg[L["owl"]] * 0.3 + np.array([0, 255, 0]) * 0.7
    dbg[L["moon"]] = dbg[L["moon"]] * 0.3 + np.array([255, 0, 255]) * 0.7
    dbg[L["stars"]] = [0, 255, 255]
    dbg = dbg.astype(np.uint8).copy()
    for cx, cy, r in [L["outer"], L["inner"]] + L["eyes"]:
        cv2.circle(dbg, (int(cx), int(cy)), int(r), (255, 255, 0), 3)
    Image.fromarray(dbg).save(OUT / "debug_camadas.png")
    print("outer", L["outer"], "inner", L["inner"], "eyes", L["eyes"])


if __name__ == "__main__":
    main()
