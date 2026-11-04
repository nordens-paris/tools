"""Our own queue ETA: fit a line through recent (time, position) samples and
divide the current position by how fast it is dropping."""
from collections import deque


def _far_off(pos, last):
    """A jump no real queue makes in one look: way up (a new queue, or an OCR misread)
    or way down (usually a dropped digit)."""
    return pos > last * 1.2 + 50 or pos < last * 0.5 - 50


class EtaEstimator:
    def __init__(self, window_minutes=30, min_span_minutes=5, min_samples=4):
        self.window = window_minutes * 60
        self.min_span = min_span_minutes * 60
        self.min_samples = min_samples
        self.samples = deque()
        self.pending = None  # a far-off reading waiting for the next one to confirm it

    def reset(self):
        self.samples.clear()
        self.pending = None

    def add(self, t, pos):
        """Add a reading. Returns False if it was held back as a likely OCR glitch: a reading far
        off the trend only counts once the next reading lands near it too."""
        if self.samples and _far_off(pos, self.samples[-1][1]):
            if self.pending is None or _far_off(pos, self.pending[1]):
                self.pending = (t, pos)
                return False
            first = self.pending
            if pos > self.samples[-1][1]:
                self.samples.clear()  # confirmed jump up: this is a new queue
            self.samples.append(first)
        self.pending = None
        self.samples.append((t, pos))
        while self.samples and t - self.samples[0][0] > self.window:
            self.samples.popleft()
        return True

    def rate_per_minute(self):
        """Positions gained per minute, or None until there is enough data."""
        s = self.samples
        if len(s) < self.min_samples or s[-1][0] - s[0][0] < self.min_span:
            return None
        n = len(s)
        mt = sum(t for t, _ in s) / n
        mp = sum(p for _, p in s) / n
        var = sum((t - mt) ** 2 for t, _ in s)
        if var == 0:
            return None
        slope = sum((t - mt) * (p - mp) for t, p in s) / var  # positions per second
        rate = -slope * 60
        return rate if rate > 0 else None

    def eta_minutes(self, pos):
        rate = self.rate_per_minute()
        return pos / rate if rate and pos is not None else None


def combine(blizzard, pace, source="earliest"):
    if source == "blizzard":
        return blizzard if blizzard is not None else pace
    if source == "pace":
        return pace if pace is not None else blizzard
    known = [v for v in (blizzard, pace) if v is not None]
    return min(known) if known else None
