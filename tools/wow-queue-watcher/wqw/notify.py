"""Phone notifications through ntfy, phone -> PC commands over a second ntfy
topic, a repeating alarm, and a loud local alarm on the PC speakers."""
import io
import json
import math
import struct
import threading
import time
import wave

import requests

PRIO = {"min": 1, "low": 2, "default": 3, "high": 4, "max": 5}


class Notifier:
    def __init__(self, cfg, log, dry_run=False):
        self.server = cfg.ntfy.server.rstrip("/")
        self.topic = cfg.ntfy.topic
        self.cmd_topic = cfg.ntfy.topic + "-cmd"
        self.token = cfg.ntfy.token
        self.log = log
        self.dry_run = dry_run

    @property
    def cmd_url(self):
        return f"{self.server}/{self.cmd_topic}"

    def buttons(self, *names):
        """ntfy action buttons that send a command back to the watcher."""
        labels = {"ack": "I'm up", "status": "Screenshot", "enter": "Enter world",
                  "reconnect": "Relaunch", "start": "Start now", "cancel": "Cancel start",
                  "standby": "Standby"}
        return [{"action": "http", "label": labels[n], "url": self.cmd_url, "method": "POST",
                 "body": n, "clear": n in ("ack", "enter")} for n in names]

    def send(self, title, message, priority="default", tags=(), buttons=(), image=None):
        prio = PRIO.get(priority, priority)
        actions = self.buttons(*buttons) if buttons else []
        if self.dry_run:
            self.log.info("[ntfy p%s] %s | %s%s%s", prio, title, message.replace("\n", " / "),
                          f" [buttons: {', '.join(buttons)}]" if buttons else "",
                          " [+screenshot]" if image is not None else "")
            return True
        headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}
        try:
            if image is not None:
                # Attachments go as the request body, so everything else goes in query params.
                params = {"title": title, "message": message, "priority": prio, "tags": ",".join(tags),
                          "filename": "wow.jpg"}
                if actions:
                    params["actions"] = json.dumps(actions)
                r = requests.put(f"{self.server}/{self.topic}", data=jpeg_bytes(image), params=params,
                                 headers=headers, timeout=20)
            else:
                body = {"topic": self.topic, "title": title, "message": message, "priority": prio,
                        "tags": list(tags), "actions": actions}
                r = requests.post(self.server, json=body, headers=headers, timeout=15)
            if r.status_code >= 300:
                self.log.warning("ntfy returned %s: %s", r.status_code, r.text[:200])
                return False
            return True
        except requests.RequestException as e:
            self.log.warning("ntfy send failed: %s", e)
            return False


def jpeg_bytes(img, max_width=1280, quality=70):
    img = img.convert("RGB")
    if img.width > max_width:
        img = img.resize((max_width, int(img.height * max_width / img.width)))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality)
    return buf.getvalue()


class CommandListener(threading.Thread):
    """Streams the command topic and hands each message text to on_command."""

    def __init__(self, notifier, on_command, log):
        super().__init__(daemon=True)
        self.n, self.on_command, self.log = notifier, on_command, log
        self.since = str(int(time.time()))

    def run(self):
        headers = {"Authorization": f"Bearer {self.n.token}"} if self.n.token else {}
        # Listen on the command topic (used by the push buttons) and on the alerts topic
        # itself, so commands can be typed right where the alerts arrive. The watcher's own
        # pushes always have a title; typed messages don't, which is how they're told apart.
        topics = f"{self.n.topic},{self.n.cmd_topic}"
        while True:
            try:
                with requests.get(f"{self.n.server}/{topics}/json", params={"since": self.since},
                                  headers=headers, stream=True, timeout=(10, 120)) as r:
                    for line in r.iter_lines():
                        if not line:
                            continue
                        msg = json.loads(line)
                        if msg.get("event") != "message":
                            continue
                        self.since = msg["id"]
                        if msg.get("topic") == self.n.topic and (msg.get("title") or msg.get("attachment")):
                            continue  # one of our own alerts
                        self.on_command(msg.get("message", ""), "phone")
            except Exception as e:
                self.log.debug("command stream reconnecting: %s", e)
            time.sleep(5)


def chime_wav(volume=0.3):
    """A soft three-note bell chime (G5-B5-D6), about 1.6 s long."""
    rate = 44100
    n = int(rate * 1.6)
    samples = [0.0] * n
    for k, freq in enumerate((784.0, 987.8, 1174.7)):
        start = int(rate * 0.2 * k)
        for i in range(n - start):
            t = i / rate
            env = min(1.0, t / 0.006) * math.exp(-3.2 * t)  # quick attack, bell-like fade
            s = (math.sin(2 * math.pi * freq * t) + 0.22 * math.sin(4 * math.pi * freq * t)
                 + 0.06 * math.sin(2 * math.pi * freq * 2.76 * t))
            samples[start + i] += s * env
    peak = max(abs(s) for s in samples) or 1.0
    frames = b"".join(struct.pack("<h", int(s / peak * volume * 32767)) for s in samples)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(frames)
    return buf.getvalue()


class LocalAlarm:
    """Alarm on the PC speakers: a soft chime every few seconds that gets a bit louder
    after the first minute - or your own .wav file (alerts.alarm_sound)."""

    def __init__(self, enabled, sound_file=""):
        self.enabled = enabled
        self.sound_file = sound_file
        self._stop = threading.Event()
        self._stop.set()

    def start(self):
        if not self.enabled or not self._stop.is_set():
            return  # off, or already sounding
        import os
        import winsound
        # A fresh event per alarm: an old loop still finishing its last chime can't keep a new
        # alarm silent.
        stop = self._stop = threading.Event()
        custom = self.sound_file if self.sound_file and os.path.isfile(self.sound_file) else None
        soft, louder = (None, None) if custom else (chime_wav(0.25), chime_wav(0.5))

        def loop():
            started = time.time()
            while not stop.is_set():
                if custom:
                    winsound.PlaySound(custom, winsound.SND_FILENAME)
                else:
                    winsound.PlaySound(soft if time.time() - started < 60 else louder, winsound.SND_MEMORY)
                stop.wait(1.5)

        self._thread = threading.Thread(target=loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()


class AlarmManager:
    """An alarm keeps re-sending a max-priority push (and sounding the PC speakers)
    until it's acknowledged from the phone or dashboard, or cleared by the watcher."""

    def __init__(self, notifier, clock, cfg, log):
        self.n, self.clock, self.log = notifier, clock, log
        self.repeat = cfg.alerts.alarm_repeat_seconds
        self.max_repeats = cfg.alerts.alarm_max_repeats
        self.local = LocalAlarm(cfg.alerts.local_sound, getattr(cfg.alerts, "alarm_sound", ""))
        self.active = False
        self.title = self.message = ""
        self.buttons = ()
        self.last_sent = 0
        self.repeats = 0

    def raise_(self, title, message, image=None, buttons=("ack", "status")):
        self.active = True
        self.title, self.message, self.buttons = title, message, buttons
        self.repeats = 0
        self.last_sent = self.clock.now()
        self.log.warning("ALARM: %s - %s", title, message)
        self.n.send(title, message, "max", ("rotating_light",), buttons, image)
        self.local.start()

    def tick(self, message=None):
        if not self.active:
            return
        if message:
            self.message = message
        if self.clock.now() - self.last_sent >= self.repeat and self.repeats < self.max_repeats:
            self.repeats += 1
            self.last_sent = self.clock.now()
            self.n.send(f"{self.title} (reminder {self.repeats})", self.message, "max",
                        ("rotating_light",), self.buttons)

    def clear(self, why=""):
        if not self.active:
            return
        self.active = False
        self.local.stop()
        self.log.info("Alarm cleared %s", why)
