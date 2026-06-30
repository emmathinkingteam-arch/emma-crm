"""Emma Thinking FB post generator. generate(brief, package, code) -> PNG bytes.

Sinhala (title + description) is converted to FM-Abhaya legacy and drawn in the
legacy fonts (Apex Apura / 4U Malith); English drawn in Fabiolla / Myriad Pro.
No libraqm needed (legacy fonts are pre-shaped ASCII), so plain Pillow works.
"""
import io
import os
import re

from PIL import Image, ImageDraw, ImageFont

from . import emma_config as C
from .legacy_sinhala import to_legacy

try:
    _LAYOUT = ImageFont.Layout.RAQM
except AttributeError:
    _LAYOUT = ImageFont.Layout.BASIC

_font_cache = {}


def get_font(path, size):
    key = (path, int(round(size)))
    if key not in _font_cache:
        try:
            f = ImageFont.truetype(path, int(round(size)), layout_engine=_LAYOUT)
        except Exception:
            f = ImageFont.truetype(path, int(round(size)))
        _font_cache[key] = f
    return _font_cache[key]


def _is_sinhala(ch):
    o = ord(ch)
    return 0x0D80 <= o <= 0x0DFF or o == 0x200D


def segment_runs(text, sinhala_path, latin_path, size, transform=None):
    runs, cur, cur_si = [], [], None
    for ch in text:
        if _is_sinhala(ch):
            script = True
        elif ch.isspace() or not ch.isalpha():
            script = cur_si
        else:
            script = False
        if cur_si is None:
            cur_si = script if script is not None else False
        if script is not None and script != cur_si and cur:
            runs.append(("".join(cur), cur_si)); cur = []; cur_si = script
        cur.append(ch)
    if cur:
        runs.append(("".join(cur), cur_si if cur_si is not None else False))
    out = []
    for t, si in runs:
        if si:
            out.append((transform(t) if transform else t, get_font(sinhala_path, size)))
        else:
            out.append((t, get_font(latin_path, size)))
    return out


def measure(text, si, la, size, transform=None):
    return sum(f.getlength(t) for t, f in segment_runs(text, si, la, size, transform))


def line_metrics(si, la, size):
    a1, d1 = get_font(si, size).getmetrics()
    a2, d2 = get_font(la, size).getmetrics()
    return max(a1, a2), max(d1, d2)


def draw_line_centered(draw, text, cx, baseline_y, si, la, size, fill, transform=None, stroke=0):
    runs = segment_runs(text, si, la, size, transform)
    total = sum(f.getlength(t) for t, f in runs)
    x = cx - total / 2.0
    for t, f in runs:
        draw.text((x, baseline_y), t, font=f, fill=fill, anchor="ls",
                  stroke_width=stroke, stroke_fill=fill)
        x += f.getlength(t)


def draw_line_justified(draw, words, left_x, width, baseline_y, si, la, size, fill,
                        transform=None, justify=True):
    widths = [measure(w, si, la, size, transform) for w in words]
    base_space = measure(" ", si, la, size, transform)
    if justify and len(words) > 1:
        gap = max((width - sum(widths)) / (len(words) - 1), base_space)
    else:
        gap = base_space
    x = left_x
    for i, w in enumerate(words):
        for t, f in segment_runs(w, si, la, size, transform):
            draw.text((x, baseline_y), t, font=f, fill=fill, anchor="ls")
            x += f.getlength(t)
        if i < len(words) - 1:
            x += gap


def fit_title_size(title, si, la, max_width, max_size, min_size, transform=None):
    size = max_size
    while size > min_size:
        if measure(title, si, la, size, transform) <= max_width:
            break
        size -= 1
    return size


def wrap_words(text, si, la, size, max_width, transform=None):
    words = text.split()
    if not words:
        return []
    space_w = measure(" ", si, la, size, transform)
    lines, cur, cur_w = [], [], 0.0
    for w in words:
        ww = measure(w, si, la, size, transform)
        if cur and cur_w + space_w + ww > max_width:
            lines.append(" ".join(cur)); cur, cur_w = [w], ww
        else:
            cur_w += (space_w if cur else 0) + ww; cur.append(w)
    if cur:
        lines.append(" ".join(cur))
    return lines


CODE_RE = re.compile(r"^[A-Za-z0-9]+(?:/[A-Za-z0-9]+){2,}$")


def parse_system_text(raw):
    lines = [ln.rstrip() for ln in raw.replace("\r\n", "\n").split("\n")]
    blocks, cur = [], []
    for ln in lines:
        if ln.strip() == "":
            if cur:
                blocks.append(cur); cur = []
        else:
            cur.append(ln)
    if cur:
        blocks.append(cur)
    if len(blocks) < 2:
        raise ValueError("Brief needs a header block and a title.")
    header = blocks[0]
    if len(header) < 4:
        raise ValueError("Header needs 4 lines: age|gender, district, religion, profession.")
    age, gender = "", ""
    for part in header[0].split("|"):
        p = part.strip()
        digits = "".join(c for c in p if c.isdigit())
        if digits:
            age = digits
        elif p:
            gender = p
    title = " ".join(s.strip() for s in blocks[1]).strip()
    # After header(0) + title(1): longDesc, shortDesc, [code], [#hashtags].
    # The image uses the SHORT description (2nd paragraph), like pbParse's blocks[3].
    code, paragraphs = "", []
    for b in blocks[2:]:
        joined = " ".join(s.strip() for s in b).strip()
        if CODE_RE.match(joined):
            code = joined
        elif joined.lstrip().startswith("#"):
            continue  # hashtags are caption-only, never on the image
        else:
            paragraphs.append(joined)
    description = paragraphs[1] if len(paragraphs) >= 2 else (paragraphs[-1] if paragraphs else "")
    return {
        "age": age, "gender": gender,
        "district": header[1].strip(), "religion": header[2].strip(),
        "profession": header[3].strip(), "title": title,
        "description": description, "code": code,
    }


def render(template_key, data):
    tpl = C.TEMPLATES[template_key]
    img = Image.open(os.path.join(C.TEMPLATE_DIR, tpl["file"])).convert("RGB")
    if img.size != (C.CANVAS, C.CANVAS):
        img = img.resize((C.CANVAS, C.CANVAS), Image.LANCZOS)
    draw = ImageDraw.Draw(img)
    cx = C.CANVAS / 2.0
    colors = tpl["colors"]

    cfn = lambda t, x, y, a: (t and draw.text((x, y), t, font=get_font(C.FONTS["corner"], C.CORNER_SIZE),
                                              fill=colors["corner"], anchor=a))
    cfn(f"{data['gender']} | Age {data['age']}".strip(" |"), C.BOX_LEFT, C.CORNER_TOP_Y, "la")
    cfn(data["profession"], C.BOX_RIGHT, C.CORNER_TOP_Y, "ra")
    cfn(data["district"], C.BOX_LEFT, C.CORNER_BOTTOM_Y, "ld")
    cfn(data["religion"], C.BOX_RIGHT, C.CORNER_BOTTOM_Y, "rd")

    region_top = tpl["region_top"]
    region_h = tpl["region_bottom"] - tpl["region_top"]
    t_si, t_la = C.FONTS["title_sinhala"], C.FONTS["title_latin"]
    b_si, b_la = C.FONTS["body_sinhala"], C.FONTS["body_latin"]

    t_size = fit_title_size(data["title"], t_si, t_la, C.TITLE_MAX_WIDTH,
                            C.TITLE_MAX_SIZE, C.TITLE_MIN_SIZE, transform=to_legacy)
    t_asc, t_desc = line_metrics(t_si, t_la, t_size)
    title_h = t_asc + t_desc

    desc_lines = wrap_words(data["description"], b_si, b_la, C.DESC_SIZE, C.DESC_WIDTH, transform=to_legacy)
    d_asc, d_desc = line_metrics(b_si, b_la, C.DESC_SIZE)
    d_adv = (d_asc + d_desc) * C.DESC_LEADING
    desc_h = d_adv * len(desc_lines)

    total_h = title_h + (C.TITLE_DESC_GAP + desc_h if desc_lines else 0)
    block_top = region_top + max(0, (region_h - total_h) / 2.0)

    draw_line_centered(draw, data["title"], cx, block_top + t_asc, t_si, t_la, t_size,
                       colors["title"], transform=to_legacy, stroke=C.TITLE_STROKE)
    if desc_lines:
        first = block_top + title_h + C.TITLE_DESC_GAP + d_asc
        for i, line in enumerate(desc_lines):
            draw_line_justified(draw, line.split(), C.DESC_LEFT, C.DESC_WIDTH, first + i * d_adv,
                                b_si, b_la, C.DESC_SIZE, colors["body"],
                                transform=to_legacy, justify=(i != len(desc_lines) - 1))

    if data.get("code"):
        draw.text((C.CODE_X_LEFT, C.CODE_Y), data["code"],
                  font=get_font(C.FONTS["code"], C.CODE_SIZE), fill=colors["code"], anchor="ls")

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def generate(brief, package="", code=""):
    """Parse the brief, pick the template from the package name, return PNG bytes."""
    data = parse_system_text(brief)
    if code:
        data["code"] = code
    key = C.template_for_package(package)
    return render(key, data)
