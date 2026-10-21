"""Gera os ícones do app (Android e web) a partir de assets/icone/original.jpg.

Uso: python3 scripts/gerar-icones.py
- Android 8+ (ícone adaptável): fundo laranja em degradê + prancheta branca extraída da imagem.
- Android 7 e versões antigas: o disco laranja da imagem original (ic_launcher / _round).
- Web: favicon (disco) e icon-512 de sangria total (serve como "maskable").
"""
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

RAIZ = Path(__file__).resolve().parent.parent
ORIGINAL = Image.open(RAIZ / "assets/icone/original.jpg").convert("RGB")
CX, CY, R = 556, 507, 446  # disco laranja na imagem original (px)
CLIP_CX, CLIP_CY, CLIP_ALT = 562, 502, 490  # prancheta: centro e altura (px)
RES = RAIZ / "mobile/android/app/src/main/res"
DENS = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
TOPO, BASE = (238, 118, 30), (214, 74, 0)


def disco(tamanho: int) -> Image.Image:
    """O disco da imagem original, recortado em círculo com fundo transparente."""
    grande = 1024
    rec = ORIGINAL.crop((CX - R, CY - R, CX + R, CY + R)).resize((grande, grande), Image.LANCZOS)
    mascara = Image.new("L", (grande, grande), 0)
    ImageDraw.Draw(mascara).ellipse((0, 0, grande - 1, grande - 1), fill=255)
    img = rec.convert("RGBA")
    img.putalpha(mascara)
    return img.resize((tamanho, tamanho), Image.LANCZOS)


def degrade(tamanho: int) -> Image.Image:
    """Fundo laranja em diagonal (claro no alto à esquerda), como o disco da imagem."""
    img = Image.new("RGB", (tamanho, tamanho))
    px = img.load()
    for y in range(tamanho):
        for x in range(tamanho):
            t = (x + y) / (2 * (tamanho - 1))
            px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(TOPO, BASE))
    return img


def prancheta(tamanho: int, altura: float) -> Image.Image:
    """Prancheta branca (com o sombreado da imagem) sobre fundo transparente.
    `altura` = fração do lado ocupada pela prancheta."""
    escala = altura * tamanho / CLIP_ALT
    lado = tamanho / escala
    caixa = (CLIP_CX - lado / 2, CLIP_CY - lado / 2, CLIP_CX + lado / 2, CLIP_CY + lado / 2)
    fundo = Image.new("RGB", ORIGINAL.size, (0, 0, 0))
    # Só a região do disco (fora dele não há prancheta).
    m = Image.new("L", ORIGINAL.size, 0)
    ImageDraw.Draw(m).ellipse((CX - R + 30, CY - R + 30, CX + R - 30, CY + R - 30), fill=255)
    base = Image.composite(ORIGINAL, fundo, m)
    # Branco = canal azul alto (o laranja tem azul ~0–30).
    azul = base.getchannel("B")
    alfa = azul.point(lambda v: max(0, min(255, round((v - 60) * 255 / (215 - 60)))))
    tom = azul.point(lambda v: min(255, v + 12))
    rgba = Image.merge("RGBA", (tom, tom, tom, alfa))
    return rgba.crop(tuple(round(v) for v in caixa)).resize((tamanho, tamanho), Image.LANCZOS)


def salvar(img: Image.Image, caminho: Path) -> None:
    caminho.parent.mkdir(parents=True, exist_ok=True)
    img.save(caminho, optimize=True)
    print("ok", caminho.relative_to(RAIZ), img.size)


for nome, f in DENS.items():
    d = RES / f"mipmap-{nome}"
    camada = round(108 * f)  # camadas do ícone adaptável: 108dp
    salvar(degrade(camada), d / "ic_launcher_background.png")
    salvar(prancheta(camada, 0.40), d / "ic_launcher_foreground.png")
    legado = round(48 * f)
    salvar(disco(legado), d / "ic_launcher.png")
    salvar(disco(legado), d / "ic_launcher_round.png")

web = RAIZ / "public"
cheio = degrade(512).convert("RGBA")
cheio.alpha_composite(prancheta(512, 0.5))
salvar(cheio, web / "icon-512.png")
salvar(disco(64), web / "favicon.png")
disco(256).save(web / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
print("ok public/favicon.ico")
salvar(disco(512), RAIZ / "assets/icone/disco-512.png")
