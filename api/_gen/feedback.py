"""Emma Thinking — client feedback post generator.

Stamps a display name and a review text onto one of the four feedback
templates (Girltemp1/2, Boytemp1/2) and exports a 1080x1080 PNG.

Text rules:
  - Everything is Myriad Pro REGULAR (never bold).
  - Parts of the review wrapped *like this* are rendered in brand pink,
    the rest in dark grey. The asterisks themselves are stripped.
  - The review is justified inside its box (last line left-aligned) and
    the font auto-shrinks until the block fits the box.

Box positions come from the designer's spec (points on a 810pt board):
  style 1 (card + pill):  name 177.83x28.74 @ y300.73 · review 342.23x72.48 @ y382.52
  style 2 (phone mockup): name 239.72x37.15 @ y330.23 · review 363.36x100  @ y449.93
"""

import io
import os
import re

from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.abspath(__file__))
FONT_PATH = os.path.join(BASE, "assets", "fonts", "MYRIADPRO-REGULAR.OTF")
TEMPLATE_DIR = os.path.join(BASE, "assets", "templates")

CANVAS = 1080
PT = CANVAS / 810.0  # spec is in pt on a 810pt artboard

PINK = (236, 42, 123)
DARK = (58, 58, 58)

TEMPLATES = {
    "girltemp1": {"file": "Girltemp1.png", "style": 1},
    "girltemp2": {"file": "Girltemp2.png", "style": 2},
    "boytemp1":  {"file": "Boytemp1.png",  "style": 1},
    "boytemp2":  {"file": "Boytemp2.png",  "style": 2},
}

STYLES = {
    # (x, y, w, h) in pt
    1: {
        "name_box":   (243.8, 300.73, 177.83, 28.74),
        "review_box": (238.0, 382.52, 342.23, 72.48),
        "name_color": PINK,
        "name_max_pt": 19,
        "review_max_pt": 13,   # tuned against the approved samples
        "review_min_pt": 9,
    },
    2: {
        "name_box":   (349.3, 330.23, 239.72, 37.15),
        "review_box": (224.9, 449.93, 363.36, 100.0),
        "name_color": (25, 25, 25),
        "name_max_pt": 25,
        "review_max_pt": 14,
        "review_min_pt": 9,
    },
}

_font_cache = {}


def get_font(px):
    px = int(round(px))
    if px not in _font_cache:
        _font_cache[px] = ImageFont.truetype(FONT_PATH, px)
    return _font_cache[px]


def list_feedback_templates():
    return sorted(TEMPLATES.keys())


# ---------------------------------------------------------------------------
# Review text: *highlight* parsing + justified layout
# ---------------------------------------------------------------------------
def parse_highlight_words(body):
    """Return [(word, is_highlight)] — asterisk pairs toggle the highlight."""
    body = re.sub(r"\s+", " ", (body or "").strip())
    words = []
    for i, seg in enumerate(body.split("*")):
        hl = i % 2 == 1
        for w in seg.split():
            words.append((w, hl))
    return words


def wrap(words, font, space_w, max_w):
    """Greedy wrap of [(word, hl)] into lines of the same shape."""
    lines, cur, cur_w = [], [], 0.0
    for w, hl in words:
        ww = font.getlength(w)
        if cur and cur_w + space_w + ww > max_w:
            lines.append(cur)
            cur, cur_w = [(w, hl)], ww
        else:
            cur_w += (space_w if cur else 0) + ww
            cur.append((w, hl))
    if cur:
        lines.append(cur)
    return lines


def draw_review(draw, words, box_px, max_pt, min_pt):
    x, y, w, h = box_px
    # auto-shrink until the whole block fits the box
    size_pt = max_pt
    while True:
        font = get_font(size_pt * PT)
        space_w = font.getlength(" ")
        lines = wrap(words, font, space_w, w)
        ascent, descent = font.getmetrics()
        lh = (ascent + descent) * 1.12
        fits_w = all(font.getlength(t) <= w for line in lines for t, _ in line)
        if (fits_w and len(lines) * lh <= h) or size_pt <= min_pt:
            break
        size_pt -= 0.5

    baseline = y + ascent
    for li, line in enumerate(lines):
        widths = [font.getlength(t) for t, _ in line]
        last = li == len(lines) - 1
        if not last and len(line) > 1:
            gap = (w - sum(widths)) / (len(line) - 1)
            gap = max(gap, space_w)
            gap = min(gap, space_w * 3.5)  # never stretch into ugly rivers
        else:
            gap = space_w
        cx = x
        for (t, hl), tw in zip(line, widths):
            draw.text((cx, baseline), t, font=font, fill=PINK if hl else DARK, anchor="ls")
            cx += tw + gap
        baseline += lh


def draw_name(draw, name, box_px, color, max_pt):
    x, y, w, h = box_px
    size_pt = max_pt
    while size_pt > 8:
        font = get_font(size_pt * PT)
        if font.getlength(name) <= w:
            break
        size_pt -= 0.5
    draw.text((x, y + h / 2.0), name, font=get_font(size_pt * PT), fill=color, anchor="lm")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def generate_feedback(name, body, template):
    key = (template or "").strip().lower()
    if key not in TEMPLATES:
        raise ValueError(f"Unknown template '{template}'. Known: {', '.join(list_feedback_templates())}")
    name = (name or "").strip()
    if not name:
        raise ValueError("Name is required")
    words = parse_highlight_words(body)
    if not words:
        raise ValueError("Feedback text is required")

    tpl = TEMPLATES[key]
    style = STYLES[tpl["style"]]
    path = os.path.join(TEMPLATE_DIR, tpl["file"])
    img = Image.open(path).convert("RGB")
    if img.size != (CANVAS, CANVAS):
        img = img.resize((CANVAS, CANVAS), Image.LANCZOS)
    draw = ImageDraw.Draw(img)

    def px_box(b):
        return tuple(v * PT for v in b)

    draw_name(draw, name, px_box(style["name_box"]), style["name_color"], style["name_max_pt"])
    draw_review(draw, words, px_box(style["review_box"]), style["review_max_pt"], style["review_min_pt"])

    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()
