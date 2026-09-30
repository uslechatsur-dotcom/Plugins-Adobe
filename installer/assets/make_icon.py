"""Generates assets/icon.ico (the app logo) — run: python3 assets/make_icon.py"""
from PIL import Image, ImageDraw
S = 1024
def logo(size):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    grad = Image.new("RGBA", (S, S))
    px = grad.load()
    a, b = (123, 140, 255), (82, 209, 178)
    for y in range(S):
        for x in range(S):
            t = (x + y) / (2 * S)
            px[x, y] = tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3)) + (255,)
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((20, 20, S - 20, S - 20), radius=250, fill=255)
    img.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(img)
    def bez(p0, p1, p2, p3, n=200):
        return [tuple((1-t)**3*p0[i] + 3*(1-t)**2*t*p1[i] + 3*(1-t)*t*t*p2[i] + t**3*p3[i] for i in (0, 1)) for t in [k/n for k in range(n+1)]]
    pts = bez((190, 780), (440, 780), (400, 260), (840, 260))
    d.line(pts, fill=(15, 20, 32, 255), width=96, joint="curve")
    for c in (pts[0], pts[-1]):
        d.ellipse((c[0]-52, c[1]-52, c[0]+52, c[1]+52), fill=(15, 20, 32, 255))
    return img.resize((size, size), Image.LANCZOS)
sizes = [16, 24, 32, 48, 64, 128, 256]
logo(256).save("assets/icon.ico", sizes=[(s, s) for s in sizes])
print("icon.ico written")
