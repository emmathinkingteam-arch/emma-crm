"""Unicode Sinhala -> FM-Abhaya legacy (for Apex Apura / 4U Malith). English kept."""
import json
import os

_MAP_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "legacy_fm.json")
_MAP = None
_MAXLEN = 1


def _load():
    global _MAP, _MAXLEN
    if _MAP is None:
        with open(_MAP_PATH, encoding="utf-8") as fh:
            data = json.load(fh)
        _MAP = {it["uni"]: it["fm"] for it in data if it.get("uni") and it.get("fm")}
        _MAXLEN = max(len(k) for k in _MAP)
    return _MAP, _MAXLEN


def to_legacy(text):
    m, maxlen = _load()
    out, i, n = [], 0, len(text)
    while i < n:
        hit = False
        for l in range(min(maxlen, n - i), 0, -1):
            sub = text[i:i + l]
            if sub in m:
                out.append(m[sub]); i += l; hit = True; break
        if not hit:
            out.append(text[i]); i += 1
    return "".join(out)
