#!/usr/bin/env python3
"""
build/installer-art.py — renders the installer's screens as bitmaps.

The FinCraftly installer draws every screen itself (build/installer.nsh) instead
of using Windows' stock dialog furniture, so each screen is a full-window BMP
(497x334, the client size of the NSIS dialog at 96 dpi) plus bitmap "buttons".
Text is baked into the bitmaps in Geist, the brand typeface, so the installer
looks like the product and not like the OS.

    python3 build/installer-art.py        # writes build/art/*.bmp

Requires Pillow. Re-run after changing copy or colours; commit the BMPs.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent
ART = ROOT / "art"
FONTS = ROOT / "fonts"
ART.mkdir(exist_ok=True)

W, H = 497, 334                       # NSIS modern dialog client area @96dpi
BG = (0x12, 0x14, 0x17)
SURFACE = (0x1B, 0x1F, 0x24)
TEXT = (0xF7, 0xF6, 0xF3)
MUTED = (0x9A, 0xA2, 0xAE)
ACCENT = (0x4E, 0x84, 0xF3)
ACCENT_HOVER = (0x6B, 0x99, 0xF5)


def font(weight: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTS / f"Geist-{weight}.ttf"), size)


def base() -> Image.Image:
    """Dark ground with the brand's soft blue glow, top-centre."""
    img = Image.new("RGB", (W, H), BG)
    glow = Image.new("RGB", (W, H), BG)
    g = ImageDraw.Draw(glow)
    g.ellipse([W / 2 - 220, -170, W / 2 + 220, 150], fill=(0x24, 0x33, 0x52))
    glow = glow.filter(ImageFilter.GaussianBlur(70))
    return Image.blend(img, glow, 0.9)


def centred(draw: ImageDraw.ImageDraw, y: int, text: str, fnt, fill, spacing: float = 0) -> None:
    if spacing:
        # letter-spaced (the wordmark)
        widths = [draw.textlength(ch, font=fnt) for ch in text]
        total = sum(widths) + spacing * (len(text) - 1)
        x = (W - total) / 2
        for ch, w in zip(text, widths):
            draw.text((x, y), ch, font=fnt, fill=fill)
            x += w + spacing
        return
    w = draw.textlength(text, font=fnt)
    draw.text(((W - w) / 2, y), text, font=fnt, fill=fill)


def mark(size: int) -> Image.Image:
    return Image.open(ROOT.parent / "src/renderer/assets/mark.png").convert("RGBA").resize((size, size), Image.LANCZOS)


def brand_header(img: Image.Image, top: int = 40) -> int:
    """Mark + wordmark; returns the y just below them."""
    m = mark(64)
    img.paste(m, ((W - 64) // 2, top), m)
    d = ImageDraw.Draw(img)
    centred(d, top + 64 + 14, "FINCRAFTLY", font("SemiBold", 11), MUTED, spacing=3.2)
    return top + 64 + 14 + 16


def screen(headline: str, sub: str, name: str, header_top: int = 40) -> Image.Image:
    img = base()
    y = brand_header(img, header_top)
    d = ImageDraw.Draw(img)
    centred(d, y + 22, headline, font("SemiBold", 21), TEXT)
    centred(d, y + 22 + 34, sub, font("Regular", 12), MUTED)
    img.save(ART / f"{name}.bmp")
    return img


PILL = (0x1F, 0x24, 0x2B)          # the sidebar's active-row fill
PILL_BORDER = (0x2E, 0x34, 0x3B)   # its hairline
PILL_HOVER = (0x26, 0x2C, 0x34)


def button(label: str, name: str, width: int = 168, height: int = 34, ghost: bool = False,
           text_fill=TEXT) -> None:
    """A small, sharp neutral pill — the AI Workspace sidebar's row style, not a
    blue call-to-action. BMPs have no alpha, so corners are pre-composited on BG."""
    scale = 3
    img = Image.new("RGB", (width * scale, height * scale), BG)
    d = ImageDraw.Draw(img)
    fill = BG if ghost else PILL
    d.rounded_rectangle([0, 0, width * scale - 1, height * scale - 1], radius=8 * scale,
                        outline=PILL_BORDER, width=scale, fill=fill)
    fnt = font("Medium", 13 * scale)
    tw = d.textlength(label, font=fnt)
    d.text(((width * scale - tw) / 2, (height * scale - 13 * scale) / 2 - 2 * scale), label, font=fnt, fill=text_fill)
    img.resize((width, height), Image.LANCZOS).save(ART / f"{name}.bmp")


def text_link(label: str, name: str, width: int = 120, height: int = 20) -> None:
    img = Image.new("RGB", (width, height), BG)
    d = ImageDraw.Draw(img)
    fnt = font("Medium", 12)
    tw = d.textlength(label, font=fnt)
    d.text(((width - tw) / 2, 2), label, font=fnt, fill=MUTED)
    img.save(ART / f"{name}.bmp")


def progress_track(width: int = 260, height: int = 6) -> None:
    """The track behind the progress bar, so the bar reads as a rounded pill."""
    img = Image.new("RGB", (width, height), BG)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, width - 1, height - 1], radius=3, fill=(0x2A, 0x30, 0x38))
    img.save(ART / "track.bmp")


if __name__ == "__main__":
    screen("Your AI workforce, on your desktop.", "Installs for your account. No admin needed.", "welcome")
    screen("Installing FinCraftly", "This takes under a minute.", "installing")
    screen("FinCraftly is ready.", "Find it in your Start menu and on your desktop.", "done")
    button("Install FinCraftly", "btn-install")
    button("Launch FinCraftly", "btn-launch")
    button("Close", "btn-close", width=96, height=32, ghost=True, text_fill=MUTED)
    text_link("Not now", "link-not-now")
    progress_track()
    print("wrote", sorted(p.name for p in ART.glob("*.bmp")))
