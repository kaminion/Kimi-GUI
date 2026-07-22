#!/usr/bin/env python3
"""Render assets/icon.png (1024x1024) to match assets/icon.svg.

Draws at 4x and downsamples with LANCZOS for smooth edges
(Pillow's ImageDraw is not antialiased at 1x).
"""

from PIL import Image, ImageDraw

S = 1024
SS = 4  # supersample factor


def sc(v):
    return v * SS


def main():
    img = Image.new("RGBA", (S * SS, S * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Black rounded square (macOS-style squircle approximation, rx=229)
    d.rounded_rectangle(
        [0, 0, S * SS - 1, S * SS - 1], radius=sc(229), fill=(10, 10, 12, 255)
    )

    # Terminal prompt chevron ">" in near-white, round caps + joint
    white = (245, 245, 247, 255)
    w = sc(88)
    pts = [(sc(376), sc(352)), (sc(552), sc(512)), (sc(376), sc(672))]
    d.line(pts, fill=white, width=w, joint="curve")
    r = w // 2
    for x, y in pts:  # round the two open caps and the vertex
        d.ellipse([x - r, y - r, x + r, y + r], fill=white)

    # Block cursor in accent blue (#0A84FF)
    d.rounded_rectangle(
        [sc(608), sc(612), sc(736), sc(692)], radius=sc(16), fill=(10, 132, 255, 255)
    )

    img = img.resize((S, S), Image.LANCZOS)
    img.save("assets/icon.png", optimize=True)
    print("wrote assets/icon.png", img.size)


if __name__ == "__main__":
    main()
