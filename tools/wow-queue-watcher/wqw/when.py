"""Parses start times typed on the phone: "now", "18:30", "at 18.30", "in 45m",
"in 1h30", "in 2 hours", "2026-11-04 18:00"."""
import re
from datetime import datetime, timedelta


def parse_start(text, now_ts):
    """Timestamp to start at, or None if `text` isn't a time. Empty / "now" means now.
    A clock time that has already passed today means tomorrow."""
    t = text.strip().lower()
    t = re.sub(r"^(at|@|kl\.?)\s*", "", t)
    t = re.sub(r"^om\b", "in", t)  # Danish: "start om 45m"
    if t in ("", "now", "nu", "queue", "queue now"):
        return now_ts
    now = datetime.fromtimestamp(now_ts)

    if m := re.fullmatch(r"(\d{4}-\d{2}-\d{2})[ t](\d{1,2})[:.](\d{2})", t):
        return datetime.strptime(f"{m[1]} {int(m[2]):02d}:{m[3]}", "%Y-%m-%d %H:%M").timestamp()

    if m := re.fullmatch(r"(\d{1,2})[:.](\d{2})", t):
        h, mi = int(m[1]), int(m[2])
        if h > 23 or mi > 59:
            return None
        target = now.replace(hour=h, minute=mi, second=0, microsecond=0)
        if target <= now:
            target += timedelta(days=1)
        return target.timestamp()

    if t.startswith("in"):
        minutes = _duration_minutes(t[2:])
        return now_ts + minutes * 60 if minutes is not None else None
    return None


def _duration_minutes(s):
    s = s.strip().replace(",", ".")
    if re.fullmatch(r"\d+(\.\d+)?", s):  # bare number = minutes
        return float(s)
    m = re.fullmatch(r"(?:(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours|t|timer?))?\s*"
                     r"(?:(\d+)\s*(?:m|min|mins|minute|minutes|minutter?)?)?", s)
    if not m or not (m[1] or m[2]):
        return None
    return float(m[1] or 0) * 60 + int(m[2] or 0)
