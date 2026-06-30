"""Emma Thinking post generator — layout + font config (1080x1080 space)."""
import os

BASE = os.path.dirname(os.path.abspath(__file__))
FONT_DIR = os.path.join(BASE, "assets", "fonts")
TEMPLATE_DIR = os.path.join(BASE, "assets", "templates")

CANVAS = 1080
BOX = 935.66
MARGIN = (CANVAS - BOX) / 2.0
BOX_LEFT = MARGIN
BOX_RIGHT = CANVAS - MARGIN
BOX_TOP = MARGIN
BOX_BOTTOM = CANVAS - MARGIN

FONTS = {
    "corner":        os.path.join(FONT_DIR, "MYRIADPRO-BOLD.OTF"),
    "title_sinhala": os.path.join(FONT_DIR, "apex020.ttf"),                 # legacy (Apex Apura 020)
    "title_latin":   os.path.join(FONT_DIR, "GreatVibes-Regular.ttf"),      # default English title
    "body_sinhala":  os.path.join(FONT_DIR, "4u-malith.ttf"),              # legacy
    "body_latin":    os.path.join(FONT_DIR, "MYRIADPRO-REGULAR.OTF"),
    "code":          os.path.join(FONT_DIR, "MYRIADPRO-REGULAR.OTF"),
}

# Font registry — short key -> filename. Used by the admin Post Tuner to swap
# fonts per role. Sinhala options are legacy (FM-Abhaya) fonts.
FONT_FILES = {
    # Sinhala (legacy)
    "apex": "apex020.ttf",
    "malith": "4u-malith.ttf",
    "kd": "0KDBOLIDDA.ttf",
    # English / Latin
    "fabiolla": "fabiolla-personal-use.ttf",
    "pacifico": "Pacifico-Regular.ttf",
    "greatvibes": "GreatVibes-Regular.ttf",
    "sacramento": "Sacramento-Regular.ttf",
    "dancing": "DancingScript.ttf",
    "myriad_bold": "MYRIADPRO-BOLD.OTF",
    "myriad": "MYRIADPRO-REGULAR.OTF",
}

def font_path(key, default_role):
    """Resolve a tuner font key to a path, falling back to the role default."""
    fn = FONT_FILES.get((key or "").strip().lower())
    return os.path.join(FONT_DIR, fn) if fn else FONTS[default_role]


THEME_BLACK = {"corner": (20, 20, 20), "title": (25, 25, 25), "body": (30, 30, 30), "code": (150, 150, 150)}
THEME_GOLD = {k: (196, 148, 58) for k in ("corner", "title", "body", "code")}
THEME_PINK = {k: (233, 64, 121) for k in ("corner", "title", "body", "code")}

CORNER_SIZE = 34
CORNER_TOP_Y = 70
CORNER_BOTTOM_Y = 1010

TITLE_MAX_SIZE = 89
TITLE_MIN_SIZE = 24
TITLE_STROKE = 0          # default Sinhala title boldness
TITLE_STROKE_EN = 1       # default English title boldness
TITLE_DESC_GAP = 13
DESC_SIZE = 32
DESC_LEADING = 1.06
DESC_WIDTH = 910.0
DESC_LEFT = (CANVAS - DESC_WIDTH) / 2.0
TITLE_MAX_WIDTH = BOX

CODE_SIZE = 20
CODE_X_LEFT = 545.21
CODE_Y = 1040

REGION_TOP = 80

def _normal(badge_top, theme=THEME_BLACK):
    return {"region_top": REGION_TOP, "region_bottom": badge_top, "colors": theme}

TEMPLATES = {
    "bronze":     {"file": "bronze.png",     **_normal(721)},
    "friendship": {"file": "friendship.png", **_normal(721)},
    "silver":     {"file": "silver.png",     **_normal(721)},
    "gold":       {"file": "gold.png",       **_normal(721, THEME_GOLD)},
    "vip":        {"file": "vip.png",        **_normal(735)},
    "princess":   {"file": "princess.png",   **_normal(721, THEME_PINK)},
}

# Platinum: photo is baked into each country template; text sits in the band
# below the photo (565) up to the country badge (734). Any file named
# platinum-<country>-<n>.png is picked up automatically — no config edit needed.
PLATINUM_DEFAULT = {"region_top": 565, "region_bottom": 734, "colors": THEME_BLACK}
DEFAULT_PLATINUM = "platinum-srilanka-1"

def list_platinum():
    import glob
    files = glob.glob(os.path.join(TEMPLATE_DIR, "platinum-*.png"))
    return sorted(os.path.splitext(os.path.basename(f))[0] for f in files)

def get_template(key):
    key = (key or "").strip().lower()
    if key in TEMPLATES:
        return TEMPLATES[key]
    if key.startswith("platinum"):
        f = key + ".png"
        if os.path.exists(os.path.join(TEMPLATE_DIR, f)):
            return {"file": f, **PLATINUM_DEFAULT}
    return None

# package name (e.g. "Gold Pass", "Princess Silver", "VIP Pass") -> template key.
# Order matters: princess first so "Princess Gold" -> princess (pink).
_PKG_ORDER = ["princess", "platinum", "vip", "gold", "silver", "bronze", "friendship"]

def template_for_package(name):
    n = (name or "").strip().lower()
    for key in _PKG_ORDER:
        if key in n:
            return DEFAULT_PLATINUM if key == "platinum" else key
    return "silver"  # safe default
