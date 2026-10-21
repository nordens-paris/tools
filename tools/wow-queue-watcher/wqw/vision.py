"""Reads a game screenshot: OCR with the built-in Windows engine, works out which
screen it is, and pulls out queue position / estimated time / error codes."""
import re
from dataclasses import dataclass, field

from PIL import Image, ImageChops, ImageOps
from winocr import recognize_pil_sync

QUEUE = "QUEUE"
CHAR_SELECT = "CHAR_SELECT"
DISCONNECTED = "DISCONNECTED"
REALM_LIST = "REALM_LIST"
CONNECTING = "CONNECTING"
PASSWORD = "PASSWORD"  # login screen asking for email/password (game started without Battle.net)
ACCOUNT = "ACCOUNT"    # "World of Warcraft Accounts - Select an account" (Accept / Cancel)
RULESET = "RULESET"    # "Choose Your Gameplay Ruleset" (Normal / PvP / Roleplay, then Select)
LOGIN = "LOGIN"
UNKNOWN = "UNKNOWN"
# Set by the watcher rather than read off the screen:
NO_PROCESS = "NO_PROCESS"
NO_WINDOW = "NO_WINDOW"
IN_GAME = "IN_GAME"

# Checked in this order; the first screen whose keywords appear wins. Queue goes first: its
# dialog ("Login Servers are Full ... [Cancel]") must never be mistaken for an error screen.
CLASSIFY_ORDER = [("queue", QUEUE), ("disconnected", DISCONNECTED), ("ruleset", RULESET), ("account", ACCOUNT),
                  ("char_select", CHAR_SELECT),
                  ("realm_list", REALM_LIST), ("connecting", CONNECTING), ("password", PASSWORD),
                  ("login", LOGIN)]

ERROR_CODE = re.compile(r"\b((?:wow|blz)\s?\d{6,8})\b", re.I)
POSITION = re.compile(r"position\s*in\s*queue\s*[:;.]?\s*([0-9oOlI|,.\s]{1,12})", re.I)
EST_TIME = re.compile(r"estimated\s*time\s*[:;.]?\s*([\s\S]{0,30})", re.I)


@dataclass
class Word:
    text: str
    x: float
    y: float
    w: float
    h: float


@dataclass
class Reading:
    state: str
    text: str = ""
    lines: list = field(default_factory=list)  # list[list[Word]]
    position: int | None = None
    blizzard_eta: float | None = None  # minutes
    error_code: str | None = None
    all_text: str = ""  # text from every OCR pass, for the hands-off check
    image: object = None  # the screenshot, so find_text can look again with the gold-text pass
    lang: str = "en-US"
    gold_lines: dict = field(default_factory=dict)  # scale -> lines, filled lazily by find_text


def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def _has(text_norm, keyword):
    k = norm(keyword)
    return k in text_norm or k.replace(" ", "") in text_norm.replace(" ", "")


def _parse_int(raw):
    fixed = raw.translate(str.maketrans({"o": "0", "O": "0", "l": "1", "I": "1", "|": "1"}))
    digits = re.sub(r"[^0-9]", "", fixed.strip().split("\n")[0])
    return int(digits) if digits else None


def _parse_minutes(raw):
    raw = raw.strip().split("\n")[0].lower()
    if re.match(r"\s*<\s*1", raw):
        return 1.0
    hours = re.search(r"(\d+)\s*(?:h|hr|hrs|hour|hours)\b", raw)
    mins = re.search(r"(\d+)\s*(?:m|min|mins|minute|minutes)\b", raw)
    if hours or mins:
        return (int(hours.group(1)) * 60 if hours else 0) + (int(mins.group(1)) if mins else 0)
    lone = re.match(r"\s*(\d+)", raw)
    return float(lone.group(1)) if lone else None


def _gold_text(img):
    """Keep only WoW's gold dialog text, as dark text on white. Reads the queue dialog
    reliably even over the busy, half-transparent login background."""
    r, g, b = img.convert("RGB").split()

    def above(band, t):
        return band.point(lambda v: 255 if v > t else 0)

    mask = ImageChops.multiply(above(r, 150), above(g, 120))
    mask = ImageChops.multiply(mask, b.point(lambda v: 255 if v < 140 else 0))
    mask = ImageChops.multiply(mask, above(ImageChops.subtract(r, b), 50))
    return ImageOps.invert(mask)


def ocr(img, lang="en-US", scale=2.0, mode="enhance"):
    """OCR an image. Returns (text, lines) with word boxes in the image's own pixels.
    mode: "enhance" (grey + autocontrast), "rgb" (as is) or "gold" (dialog text only)."""
    w, h = img.size
    # Upscaling helps small windows but hurts at 1440p+, so cap the longest side at ~2600 px.
    s = min(scale, 2600 / max(w, h))
    if mode == "gold":
        prepared = _gold_text(img)
    elif mode == "rgb":
        prepared = img.convert("RGB")
    else:
        prepared = ImageOps.autocontrast(img.convert("L"))
    if s != 1.0:
        prepared = prepared.resize((int(w * s), int(h * s)), Image.LANCZOS)
    res = recognize_pil_sync(prepared, lang)
    lines = []
    for line in res.get("lines", []):
        words = []
        for wd in line.get("words", []):
            r = wd["bounding_rect"]
            words.append(Word(wd["text"], r["x"] / s, r["y"] / s, r["width"] / s, r["height"] / s))
        if words:
            lines.append(words)
    text = "\n".join(" ".join(wd.text for wd in ln) for ln in lines)
    return text, lines


def classify(text, screens):
    t = norm(text)
    if any(_has(t, kw) for kw in screens.queue):
        return QUEUE
    if ERROR_CODE.search(text):
        return DISCONNECTED
    for key, state in CLASSIFY_ORDER:
        if any(_has(t, kw) for kw in getattr(screens, key)):
            return state
    return UNKNOWN


def read(img, cfg):
    """Up to three OCR passes: normal, then gold-text-only (best for the queue dialog),
    then plain colour (animated backgrounds can hide text from one pass)."""
    lang, scale = cfg.game.ocr_language, cfg.watch.ocr_scale
    best = _reading(*ocr(img, lang, scale), cfg)
    seen = [best.text]
    if best.state != QUEUE or best.position is None:
        gold = _reading(*ocr(img, lang, 1.0, mode="gold"), cfg)
        seen.append(gold.text)
        if gold.state == QUEUE or (best.state == UNKNOWN and gold.state != UNKNOWN):
            best = gold
    if best.state == UNKNOWN:
        rgb = _reading(*ocr(img, lang, scale, mode="rgb"), cfg)
        seen.append(rgb.text)
        if rgb.state != UNKNOWN:
            best = rgb
    best.all_text = "\n".join(seen)
    best.image, best.lang = img, lang
    return best


def _reading(text, lines, cfg):
    reading = Reading(classify(text, cfg.screens), text, lines)
    if m := ERROR_CODE.search(text):
        reading.error_code = m.group(1).upper().replace(" ", "")
    if m := POSITION.search(text):
        reading.position = _parse_int(m.group(1))
    if m := EST_TIME.search(text):
        reading.blizzard_eta = _parse_minutes(m.group(1))
    return reading


def _find_in(lines, want):
    """Centre of the first run of adjacent words on one line that spell `want` (no spaces),
    so "PLAYER 1" matches "PLAYER1" and "Enter World" matches "EnterWorld"."""
    for line in lines:
        toks = [norm(wd.text).replace(" ", "") for wd in line]
        for i in range(len(toks)):
            acc = ""
            for j in range(i, len(toks)):
                acc += toks[j]
                if acc == want:
                    ws = line[i:j + 1]
                    x0, y0 = min(w.x for w in ws), min(w.y for w in ws)
                    x1, y1 = max(w.x + w.w for w in ws), max(w.y + w.h for w in ws)
                    return (x0 + x1) / 2, (y0 + y1) / 2
                if not want.startswith(acc):
                    break
    return None


def find_text(reading, label):
    """Centre (x, y) of the words spelling `label` (e.g. "Enter World"), or None. Looks in the
    normal OCR first, then re-reads the screenshot keeping only gold text: the red buttons on
    dimmed dialogs (Accept, Cancel, Select) are often invisible to the normal pass."""
    want = norm(label).replace(" ", "")
    if not want:
        return None
    if pt := _find_in(reading.lines, want):
        return pt
    if reading.image is not None:
        # Full size reads big windows best; small windows need enlarging first.
        scales = (1.0,) if max(reading.image.size) >= 2000 else (1.0, 2.0)
        for scale in scales:
            if scale not in reading.gold_lines:
                reading.gold_lines[scale] = ocr(reading.image, reading.lang, scale, mode="gold")[1]
            if pt := _find_in(reading.gold_lines[scale], want):
                return pt
        # Two buttons close together on one line (Accept / Cancel) can make the OCR drop both;
        # reading the left and right halves separately finds them.
        if "halves" not in reading.gold_lines:
            reading.gold_lines["halves"] = _ocr_halves(reading.image, reading.lang, scales[-1])
        return _find_in(reading.gold_lines["halves"], want)
    return None


def _ocr_halves(img, lang, scale):
    """Gold-text OCR of the left and right halves (with some overlap), in full-image coordinates."""
    w, h = img.size
    lines = []
    for x0, x1 in ((0, w // 2 + w // 32), (w // 2 - w // 32, w)):
        for line in ocr(img.crop((x0, 0, x1, h)), lang, scale, mode="gold")[1]:
            lines.append([Word(wd.text, wd.x + x0, wd.y, wd.w, wd.h) for wd in line])
    return lines


def pick_language(preferred):
    """The OCR language to use: the configured one if Windows has it, else any English,
    else whatever is installed (Danish OCR still reads most English text).
    Returns (language, warning or None)."""
    from winocr import OcrEngine
    avail = [l.language_tag for l in OcrEngine.available_recognizer_languages]
    for cand in [preferred, "en-US", "en-GB"] + [a for a in avail if a.lower().startswith("en")]:
        if cand in avail:
            return cand, None if cand == preferred else f"OCR language {preferred} not installed, using {cand}"
    if avail:
        return avail[0], (f"No English OCR language installed - using {avail[0]}. For best results add English: "
                          "Settings > Time & language > Language & region > Add a language > English (United States).")
    raise RuntimeError("Windows has no OCR languages installed. Add English (United States) under "
                       "Settings > Time & language > Language & region.")
