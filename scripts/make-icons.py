"""
Génère le jeu d'icônes complet de TelecomStock Pro.

Motif : un téléphone stylisé sur fond dégradé bleu, avec un indicateur de stock.
Produit : icônes PWA, .ico Windows, et mipmaps Android.
"""
from PIL import Image, ImageDraw
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public" / "assets"
BUILD = ROOT / "build"
ANDROID = ROOT / "android" / "app" / "src" / "main" / "res"

BG_TOP = (37, 99, 235)      # --primary
BG_BOTTOM = (29, 78, 216)   # --primary-dark
ACCENT = (52, 211, 153)     # vert "stock OK"


def rounded_mask(size, radius_ratio=0.22):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [(0, 0), (size - 1, size - 1)],
        radius=int(size * radius_ratio), fill=255
    )
    return mask


def draw_icon(size, rounded=True):
    """Dessine l'icône à la taille demandée (carrée ou à coins arrondis)."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Fond : dégradé vertical simple
    for y in range(size):
        t = y / max(1, size - 1)
        d.line([(0, y), (size, y)], fill=(
            int(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t),
            int(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t),
            int(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t),
            255
        ))

    # Corps du téléphone
    pw, ph = size * 0.40, size * 0.60
    px, py = (size - pw) / 2, (size - ph) / 2 * 0.92
    d.rounded_rectangle([px, py, px + pw, py + ph],
                        radius=size * 0.075, fill=(255, 255, 255, 255))

    # Écran
    m = size * 0.045
    sx0, sy0 = px + m, py + size * 0.070
    sx1, sy1 = px + pw - m, py + ph - size * 0.070
    d.rounded_rectangle([sx0, sy0, sx1, sy1],
                        radius=size * 0.035, fill=BG_TOP + (255,))

    # Barres façon graphique de stock
    bar_w = (sx1 - sx0) * 0.16
    gap = (sx1 - sx0 - bar_w * 3) / 4
    base = sy1 - size * 0.055
    for i, h in enumerate((0.30, 0.52, 0.40)):
        bx = sx0 + gap + i * (bar_w + gap)
        bh = (sy1 - sy0) * h
        d.rounded_rectangle([bx, base - bh, bx + bar_w, base],
                            radius=bar_w * 0.3, fill=ACCENT + (255,))

    # Encoche haut-parleur
    nw = pw * 0.26
    d.rounded_rectangle([px + (pw - nw) / 2, py + size * 0.028,
                         px + (pw + nw) / 2, py + size * 0.043],
                        radius=size * 0.008, fill=(226, 232, 240, 255))

    if rounded:
        img.putalpha(rounded_mask(size))
    return img


def main():
    for path in (PUBLIC, BUILD):
        path.mkdir(parents=True, exist_ok=True)

    # PWA
    for size in (192, 512):
        draw_icon(size).save(PUBLIC / f"icon-{size}.png")
        print(f"  public/assets/icon-{size}.png")

    # Windows : .ico multi-résolutions
    base = draw_icon(256)
    base.save(BUILD / "icon.ico", format="ICO",
              sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
    print("  build/icon.ico")

    # Android : mipmaps (icône pleine, le launcher applique son propre masque)
    for folder, size in (("mipmap-mdpi", 48), ("mipmap-hdpi", 72), ("mipmap-xhdpi", 96),
                         ("mipmap-xxhdpi", 144), ("mipmap-xxxhdpi", 192)):
        out = ANDROID / folder
        out.mkdir(parents=True, exist_ok=True)
        icon = draw_icon(size, rounded=False)
        icon.save(out / "ic_launcher.png")
        draw_icon(size).save(out / "ic_launcher_round.png")
        print(f"  android/.../{folder}/ic_launcher.png")

    print("\nJeu d'icônes généré.")


if __name__ == "__main__":
    main()
