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
    "title_sinhala": os.path.join(FONT_DIR, "apex049.ttf"),                 # legacy
    "title_latin":   os.path.join(FONT_DIR, "fabiolla-personal-use.ttf"),
    "body_sinhala":  os.path.join(FONT_DIR, "4u-malith.ttf"),              # legacy
    "body_latin":    os.path.join(FONT_DIR, "MYRIADPRO-REGULAR.OTF"),
    "code":          os.path.join(FONT_DIR, "MYRIADPRO-REGULAR.OTF"),
}

THEME_BLACK = {"corner": (20, 20, 20), "title": (25, 25, 25), "body": (30, 30, 30), "code": (150, 150, 150)}
THEME_GOLD = {k: (196, 148, 58) for k in ("corner", "title", "body", "code")}
THEME_PINK = {k: (233, 64, 121) for k in ("corner", "title", "body", "code")}

CORNER_SIZE = 34
CORNER_TOP_Y = 70
CORNER_BOTTOM_Y = 1010

TITLE_MAX_SIZE = 89
TITLE_MIN_SIZE = 24
TITLE_STROKE = 0
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
    "platinum":   {"file": "platinum-japan-1.png", "region_top": 490,
                   "region_bottom": 700, "colors": THEME_BLACK},
}

# package name (e.g. "Gold Pass", "Princess Silver", "VIP Pass") -> template key.
# Order matters: princess first so "Princess Gold" -> princess (pink).
_PKG_ORDER = ["princess", "platinum", "vip", "gold", "silver", "bronze", "friendship"]

def template_for_package(name):
    n = (name or "").strip().lower()
    for key in _PKG_ORDER:
        if key in n:
            return key
    return "silver"  # safe default
