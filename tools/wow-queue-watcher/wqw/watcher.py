"""The main loop: look at the game, work out what screen it's on, send alerts,
and (if enabled) click/relaunch its way back into the queue."""
import csv
import os
import queue
import threading
import time
from collections import deque
from datetime import datetime

import requests

from . import vision as V
from .eta import EtaEstimator, combine
from .notify import AlarmManager, jpeg_bytes
from .when import parse_start

# RULESET ("Choose Your Gameplay Ruleset") only appears once the queue is done, so it counts like
# character select: we alarm, and never click or choose anything there.
GOOD = {V.QUEUE, V.CHAR_SELECT, V.RULESET, V.IN_GAME}
QUEUE_DONE = {V.CHAR_SELECT, V.RULESET}
TROUBLE = {V.DISCONNECTED, V.LOGIN, V.REALM_LIST, V.CONNECTING, V.NO_PROCESS, V.NO_WINDOW, V.PASSWORD,
           V.ACCOUNT}
ACTIONABLE = {V.DISCONNECTED, V.LOGIN, V.REALM_LIST}
# The account screen before login: we accept the preselected account, and never restart the game
# while it sits there.
DECISION = {V.ACCOUNT}
# Screens the phone should hear about if the game sits on them for a few minutes.
WAITING = DECISION | {V.UNKNOWN}
# Never click or restart while any OCR pass sees these: the queue dialog's only button is Cancel.
HANDS_OFF = ("queue", "servers are full", "estimated", "position in")

HELP = ("Commands: start (now), start 18:30, start in 45m, cancel, standby, status, ack, "
        "enter (Enter World), reconnect (kill + relaunch), pause, resume, quit")


def fmt_min(m):
    if m is None:
        return "?"
    if m >= 60:
        return f"{int(m // 60)}h {int(m % 60):02d}m"
    return f"{m:.0f} min"


class Watcher:
    def __init__(self, cfg, source, clock, notifier, log, data_dir):
        self.cfg, self.src, self.clock, self.n, self.log = cfg, source, clock, notifier, log
        self.data_dir = data_dir
        self.shots_dir = os.path.join(data_dir, "screenshots")
        os.makedirs(self.shots_dir, exist_ok=True)
        self.csv_path = os.path.join(data_dir, f"samples-{datetime.now():%Y%m%d-%H%M%S}.csv")
        self.commands = queue.Queue()
        self.alarm = AlarmManager(notifier, clock, cfg, log)
        self.est = EtaEstimator()
        self.lock = threading.Lock()
        self.snap = {}
        self.last_jpeg = None

        self.running = True
        self.paused = False
        self.finished = False  # reached the world; stop acting until "resume"
        self.mode = "active"  # "standby", "scheduled" or "active"
        self.start_at = None
        self.started = clock.now()

        self.state = None
        self.state_since = clock.now()
        self.last_known = None
        self.unknown_streak = 0
        self.reading = None
        self.image = None
        self.in_line = False  # we have a queue spot (or are at character select)

        self.position = self.blizzard_eta = self.pace_eta = self.eta = self.rate = None
        self.queue_sessions = 0
        self.queue_start_pos = None
        self.queue_started_at = None
        self.flags = {}
        self.last_update = 0
        self.samples = []
        self.events = deque(maxlen=200)

        self.trouble_since = None
        self.trouble_next_alert = 0
        self.trouble_alarmed = False
        self.last_action = 0
        self.last_launch = -1e12
        self.relaunches = 0
        self.gave_up = False
        self.auto_entered = False
        self.last_ping = 0
        self.stop_when = None  # optional callable(watcher) -> bool, used by the simulator
        self.wrong_version_alerted = False
        self.pick_attempts = 0
        self.waiting_next_alert = 0
        self.queue_done_alerted = False
        self.launch_fail_alerted = False

    # --- public ----------------------------------------------------------

    def command(self, text, origin="?"):
        self.commands.put((text, origin))

    def run(self):
        w = self.cfg.watch
        self._event("Watcher started")
        game = os.path.basename(os.path.normpath(getattr(self.cfg.game, "game_dir", "WoW")))
        start_at = self.cfg.schedule.start_at and parse_start(self.cfg.schedule.start_at, self.clock.now())
        try:
            if start_at and start_at > self.clock.now():
                self._schedule(start_at, "config", intro=f"Watcher started ({game}). ")
            elif self.cfg.schedule.start_at and start_at is None:
                # A typo in start_at must not launch the game right away.
                self.log.warning("Couldn't read start_at = %r - waiting on standby", self.cfg.schedule.start_at)
                self._standby("Watcher started",
                              intro=f"Couldn't read start_at '{self.cfg.schedule.start_at}' in the config. ")
            elif getattr(self.cfg.schedule, "standby", False):
                self._standby("Watcher started", intro=f"Watching {game}. ")
            else:
                self.n.send("WoW queue watcher started", f"Watching {game}. You'll get alerts here.",
                            "default", ("eyes",), ("status",))
                self._activate("watcher started", announce=False)
            errors = 0
            while self.running:
                t0 = self.clock.now()
                try:
                    self._process_commands()
                    if self.mode == "active":
                        self.step()
                    else:
                        self._waiting_tick()
                    errors = 0
                except Exception as e:
                    errors += 1
                    self.log.exception("Error in watch loop")
                    if errors == 5:
                        self.n.send("Watcher is having trouble", f"5 errors in a row: {e}", "high", ("warning",))
                self._health_ping()
                if self.stop_when and self.stop_when(self):
                    break
                self._sleep_until(t0 + (w.interval_seconds if self.mode == "active" else 5))
        finally:
            self.alarm.clear("(watcher stopping)")
            self._event("Watcher stopped")
            self.n.send("WoW queue watcher stopped", "The watcher is no longer running.", "high", ("stop_sign",))

    # --- standby / scheduled start ----------------------------------------

    def _waiting_tick(self):
        if self.mode == "scheduled" and self.clock.now() >= self.start_at:
            self._activate("scheduled time reached")
        self._snapshot()

    def _activate(self, reason, announce=True):
        """Go live: launch the game if needed and start watching / reconnecting."""
        self.mode, self.start_at = "active", None
        self.paused = self.finished = self.gave_up = False
        self.relaunches = 0
        self.state = None
        # Forget what we saw before standby: an old trouble timer would make the stuck check
        # kill the game on the very first look.
        self.trouble_since = None
        self.trouble_alarmed = False
        self.last_known = None
        self.in_line = self.queue_done_alerted = False
        self._event(f"Starting ({reason})")
        running = self.src.process_running()
        if announce:
            self.n.send("Starting the queue now",
                        "WoW is already running - watching it." if running else "Launching WoW through Battle.net.",
                        "default", ("rocket",), ("status", "standby"))
        if self.cfg.reconnect.auto_launch and not running:
            self._launch("initial launch")

    def _schedule(self, ts, origin, intro=""):
        self.mode, self.start_at = "scheduled", ts
        self.state = "SCHEDULED"
        self.alarm.clear("(scheduled)")
        when = datetime.fromtimestamp(ts)
        day = "" if when.date() == datetime.fromtimestamp(self.clock.now()).date() else when.strftime(" %a %d %b")
        msg = (f"{intro}WoW will be launched at {when:%H:%M}{day} "
               f"(in {fmt_min((ts - self.clock.now()) / 60)}).")
        self._event(f"Scheduled start at {when:%Y-%m-%d %H:%M} (from {origin})")
        self.n.send(f"Queue start set for {when:%H:%M}", msg, "default", ("alarm_clock",),
                    ("start", "cancel", "status"))

    def _standby(self, title, intro=""):
        self.mode, self.start_at = "standby", None
        self.state = "STANDBY"
        self.alarm.clear("(standby)")
        self._event("Standby - waiting for a start command")
        self.n.send(title, f"{intro}On standby. Tap Start now, or send 'start 18:30' or 'start in 45m' "
                    "to the command topic.", "default", ("zzz",), ("start", "status"))
    # --- one observation -------------------------------------------------

    def step(self):
        now = self.clock.now()
        state, reading, img = self._observe()
        prev = self.state
        if img is not None:
            self.last_jpeg = jpeg_bytes(img)  # local dashboard only
            # The password screen shows your email address; never push that one to the phone.
            if state == V.PASSWORD:
                img = None
            self.image = img
        if state != prev:
            self.state_since = now
            self.state = state
            self.pick_attempts = 0
            self.waiting_next_alert = 0
            self._on_transition(prev, state, reading, img, now)
        self.reading = reading
        if state != V.NO_PROCESS:
            self.launch_fail_alerted = False

        if state in GOOD:
            self.trouble_since = None
            self.trouble_alarmed = False
        elif state in TROUBLE and self.trouble_since is None:
            self.trouble_since = now
            self.trouble_next_alert = 0

        if state == V.QUEUE:
            self._on_queue(reading, img, now)
        self._check_trouble(now, state, img)
        self._check_waiting(now, state, reading, img)
        self._recover(now, state, reading)
        self._auto_enter_world(now, state)
        self.alarm.tick(self._status_line() if state == V.QUEUE else None)
        self._snapshot()

    def _observe(self):
        if not self.src.process_running():
            return V.NO_PROCESS, None, None
        img = self.src.grab()
        if img is None:
            return V.NO_WINDOW, None, None
        reading = V.read(img, self.cfg)
        state = reading.state
        if state == V.UNKNOWN:
            self.unknown_streak += 1
            # Text-free screen right after character select = loading screen / in the world.
            if self.last_known == V.IN_GAME or (self.last_known == V.CHAR_SELECT and self.unknown_streak >= 2):
                state = V.IN_GAME
        else:
            self.unknown_streak = 0
        if state != V.UNKNOWN:
            self.last_known = state
        return state, reading, img

    # --- reacting --------------------------------------------------------

    def _on_transition(self, prev, state, reading, img, now):
        code = f" ({reading.error_code})" if reading and reading.error_code else ""
        self._event(f"{prev or 'start'} -> {state}{code}")
        if img is not None and self.cfg.watch.save_screenshots:
            img.convert("RGB").save(os.path.join(self.shots_dir, f"{datetime.fromtimestamp(now):%Y%m%d-%H%M%S}-{state}.jpg"),
                                    quality=80)
        if self.finished:
            return
        r = self.cfg.reconnect
        auto = r.enabled and not self.paused

        if state == V.QUEUE and not self.in_line:
            self.in_line = True
            self.queue_done_alerted = False
            self.queue_sessions += 1
            self.flags = {"heads_up": False, "alarm": False}
            self.est.reset()
            self.queue_start_pos = reading.position if reading else None
            self.queue_started_at = now
            self.last_update = now
            pos = reading.position if reading else None
            self.n.send("You're in the queue",
                        f"Position {pos or '?'} - Blizzard estimate {fmt_min(reading.blizzard_eta if reading else None)}",
                        "default", ("hourglass_flowing_sand",), ("status",), img)
        elif state in QUEUE_DONE:
            self.in_line = True
            if state == V.CHAR_SELECT:
                self.auto_entered = False
            if not self.queue_done_alerted:
                # First sign that we're through: the ruleset screen usually comes before character select.
                self.queue_done_alerted = True
                if state == V.RULESET:
                    msg = "You're through the queue! WoW is asking you to choose a gameplay ruleset - get to the PC."
                    buttons = ("ack", "status")
                else:
                    msg = "You're at character select - get to the PC, or tap Enter world."
                    buttons = ("ack", "enter", "status")
                if self.cfg.alerts.alarm_on_queue_done:
                    self.alarm.raise_("Queue finished!", msg, img, buttons)
                else:
                    self.n.send("Queue finished!", msg, "high", ("tada",), buttons[1:], img)
            elif state == V.CHAR_SELECT and self.alarm.active:
                self.alarm.buttons = ("ack", "enter", "status")  # the Enter world button now makes sense
                self.alarm.message = "You're at character select - get to the PC, or tap Enter world."
        elif state == V.IN_GAME:
            self.alarm.clear("(in the world)")
            self.finished = True
            self.in_line = False
            self.n.send("You're in the world", "Watcher is idle now. Send 'resume' to re-arm it.",
                        "default", ("tada",))
        elif state in TROUBLE and state not in (V.CONNECTING, V.NO_WINDOW) and self.in_line:
            # Lost our spot. (A minimized window doesn't lose it: _recover just restores the window.)
            self.in_line = False
            self.queue_done_alerted = False
            # An ETA or queue-finished alarm still ringing would now be wrong.
            self.alarm.clear("(lost the queue spot)")
            where = f" at queue position {self.position}" if self.position and prev == V.QUEUE else ""
            what = "WoW closed or crashed" if state == V.NO_PROCESS else "Disconnected"
            msg = f"{what}{where}{code}." + (" Trying to get back in automatically." if auto else "")
            if auto:
                self.n.send(what, msg, "high", ("warning",), ("status", "reconnect"), img)
            else:
                self.alarm.raise_(what + "!", msg, img, ("ack", "status", "reconnect"))

        if state == V.ACCOUNT:
            self.in_line = False

    def _on_queue(self, reading, img, now):
        if reading.position is not None:
            self.position = reading.position
            if self.queue_start_pos is None:
                self.queue_start_pos = reading.position
            self.est.add(now, reading.position)
        if reading.blizzard_eta is not None:
            self.blizzard_eta = reading.blizzard_eta
        self.rate = self.est.rate_per_minute()
        self.pace_eta = self.est.eta_minutes(self.position)
        a = self.cfg.alerts
        self.eta = combine(self.blizzard_eta, self.pace_eta, a.eta_source)
        sample = {"t": now, "pos": self.position, "bl": self.blizzard_eta, "pace": self.pace_eta}
        self.samples.append(sample)
        self._write_csv(sample)

        if self.eta is not None and not self.finished:
            if not self.flags.get("alarm") and self.eta <= a.alarm_minutes:
                self.flags["alarm"] = self.flags["heads_up"] = True
                self.alarm.raise_(f"~{fmt_min(self.eta)} left in the queue!", self._status_line(), img,
                                  ("ack", "status"))
            elif not self.flags.get("heads_up") and self.eta <= a.heads_up_minutes:
                self.flags["heads_up"] = True
                self.n.send(f"Heads up: ~{fmt_min(self.eta)} left", self._status_line(), "high",
                            ("warning",), ("status",), img)
        if now - self.last_update >= a.update_every_minutes * 60 and not self.finished:
            self.last_update = now
            self.n.send("Queue update", self._status_line(), "low", ("hourglass_flowing_sand",), ("status",))

    def _check_trouble(self, now, state, img):
        if self.finished or self.trouble_since is None:
            return
        dur = now - self.trouble_since
        if dur < self.cfg.alerts.give_up_minutes * 60 or now < self.trouble_next_alert:
            return
        self.trouble_next_alert = now + 30 * 60
        msg = (f"Not in the queue for {fmt_min(dur / 60)} (screen: {state}). "
               f"Relaunches so far: {self.relaunches}.")
        if self.queue_sessions and not self.trouble_alarmed:
            self.trouble_alarmed = True
            self.alarm.raise_("Can't get back into the queue", msg, img, ("ack", "status", "reconnect"))
        elif state in DECISION:
            return  # _check_waiting already keeps the phone posted about these screens
        else:
            self.n.send("Still trying to get in", msg, "default", ("hourglass",), ("status", "reconnect"), img)

    def _check_waiting(self, now, state, reading, img):
        """Tell the phone when the game sits on a screen that needs a person, or one we don't
        recognise - otherwise the watcher would sit there silently."""
        if self.finished or state not in WAITING or now < self.waiting_next_alert:
            return
        if state == V.UNKNOWN and self.queue_done_alerted:
            return  # through the queue: probably character creation, and you've had the alarm
        r = self.cfg.reconnect
        if now - self.state_since < r.unknown_screen_minutes * 60:
            return
        self.waiting_next_alert = now + 30 * 60
        for_how_long = fmt_min((now - self.state_since) / 60)
        if state == V.ACCOUNT:
            self.n.send("WoW is waiting on the account screen",
                        f"Waiting for {for_how_long}. Pick an account on the PC"
                        + ("." if r.enabled and not self.paused else " (automation is off)."),
                        "high", ("warning",), ("status", "reconnect"))
        else:
            text = " / ".join(ln.strip() for ln in (reading.text.splitlines() if reading else []) if ln.strip())
            self.n.send("WoW is on a screen I don't recognise",
                        f"For {for_how_long} now. I won't click anything here."
                        + (f" Text on screen: {text[:180]}" if text
                           else " No text found on screen - is the PC locked, or a black/loading screen?"),
                        "high", ("question",), ("status", "reconnect"), img)

    def _pick_account(self, reading):
        """Accept the account screen: the preselected account, or account_name if set."""
        r = self.cfg.reconnect
        if r.account_name:
            pt = V.find_text(reading, r.account_name)
            if not pt:
                self._event(f"Account '{r.account_name}' not found on the account screen")
                return False
            self.src.click(*pt)
            self.clock.sleep(0.6)
        accept = V.find_text(reading, "Accept")
        if not accept:
            self._event("No Accept button found on the account screen")
            return False
        self._event("Accepting the account" + (f" '{r.account_name}'" if r.account_name else " (the preselected one)"))
        self.src.click(*accept)
        return True

    def _recover(self, now, state, reading):
        r = self.cfg.reconnect
        if not r.enabled or self.paused or self.finished:
            return
        if state == V.NO_PROCESS:
            if r.auto_launch and now - self.last_launch >= r.relaunch_wait_seconds:
                self._launch("game not running")
            return
        if state == V.PASSWORD:
            # Started without Battle.net (or its session expired). Never type a password:
            # restart through Battle.net, which logs in with the saved session.
            if now - self.last_launch >= r.relaunch_wait_seconds:
                self._event("Game is asking for a password - restarting it through Battle.net")
                self.src.kill()
                self._launch("login screen asked for a password")
            return
        if reading and any(w in reading.all_text.lower() for w in HANDS_OFF):
            return  # looks like the queue dialog: hands off, even if the screen was misread
        cooled = now - self.last_action >= r.action_cooldown_seconds and now - self.last_launch >= 30
        if state == V.ACCOUNT:
            if cooled and self.pick_attempts < 4:  # after 4 tries leave it to the person
                self.last_action = now
                self.pick_attempts += 1
                self._pick_account(reading)
            return  # never restart the game while it waits on this screen
        if state == V.NO_WINDOW and cooled:
            self.last_action = now
            self._event("Window minimized or hidden - restoring it")
            self.src.show()
        elif state in ACTIONABLE and cooled:
            self.last_action = now
            self._act(state, reading)
        if state == V.NO_WINDOW and self.in_line:
            return  # never kill a queued game just because its window stays hidden
        if (state in TROUBLE and self.trouble_since is not None
                and now - self.trouble_since >= r.stuck_minutes * 60
                and now - self.last_launch >= r.stuck_minutes * 60):
            self._event(f"Stuck on {state} for {r.stuck_minutes}+ min - restarting the game")
            self.src.kill()
            self._launch(f"stuck on {state}")

    def _act(self, state, reading):
        r = self.cfg.reconnect
        if state == V.REALM_LIST and r.realm_name:
            if pt := V.find_text(reading, r.realm_name):
                self._event(f"Double-clicking realm '{r.realm_name}'")
                self.src.click(*pt, double=True)
                return
        for label in r.click_buttons:
            if pt := V.find_text(reading, label):
                self._event(f"Clicking '{label}'")
                self.src.click(*pt)
                return
        # No blind Enter: on the queue dialog Enter means Cancel. If nothing matches,
        # the stuck timer restarts the game instead.
        self._event("No known button on screen - waiting")

    def _launch(self, reason):
        r = self.cfg.reconnect
        if self.relaunches >= r.max_relaunches:
            if not self.gave_up:
                self.gave_up = True
                self.alarm.raise_("Gave up relaunching WoW",
                                  f"Tried {self.relaunches} times. Send 'reconnect' to try again.",
                                  self.image, ("ack", "status", "reconnect"))
            return
        self.last_launch = self.last_action = self.clock.now()
        if self._wrong_version_running():
            return  # never start a second copy
        self.relaunches += 1
        self._event(f"Launching WoW ({reason})")
        if self.launch_fail_alerted:
            pass  # already told the phone launching doesn't work; don't push every retry
        elif reason != "initial launch":
            self.n.send("Relaunching WoW", f"Reason: {reason}. Attempt {self.relaunches}.", "low", ("arrows_counterclockwise",))
        else:
            self.n.send("Launching WoW", "Starting the game through Battle.net.", "low", ("rocket",))
        if self.src.launch() is False and not self._wrong_version_running():
            if self.launch_fail_alerted:
                self._event("Launch failed again")
                return
            self.launch_fail_alerted = True
            self.n.send("Couldn't start WoW from Battle.net",
                        "Neither the launch command nor the Play button worked (update pending, logged out of "
                        "Battle.net, or the launcher is on another page). I'll keep retrying quietly.",
                        "high", ("warning",), ("status", "reconnect"))

    def _wrong_version_running(self):
        """True (and one alert) if a different WoW version is running than the one we watch."""
        others = getattr(self.src, "other_versions", lambda: [])()
        if not others:
            self.wrong_version_alerted = False
            return False
        if not self.wrong_version_alerted:
            self.wrong_version_alerted = True
            other = os.path.basename(os.path.dirname(others[0]))
            mine = os.path.basename(os.path.normpath(self.cfg.game.game_dir))
            msg = (f"The {other} client is running, but I'm set up for {mine}. In Battle.net, pick the "
                   f"right version in the dropdown on the Forever page and close the other game. "
                   f"I won't start a second copy.")
            self._event(f"Wrong WoW version running: {others[0]}")
            self.n.send("Wrong WoW version running", msg, "high", ("warning",), ("status",))
        return True

    def _auto_enter_world(self, now, state):
        r = self.cfg.reconnect
        if (state == V.CHAR_SELECT and r.enabled and r.auto_enter_world and not self.paused and not self.auto_entered
                and self.alarm.active and now - self.state_since >= r.auto_enter_world_after_minutes * 60):
            self.auto_entered = True
            self._event("Nobody answered the alarm - entering the world to avoid the idle timeout")
            self.src.key("enter")
            self.n.send("Entered the world for you",
                        "You didn't answer the alarm, so I pressed Enter World to dodge the character-select "
                        "timeout. Your character is standing AFK in the world.", "max", ("rotating_light",),
                        ("ack", "status"))

    # --- commands --------------------------------------------------------

    def _process_commands(self):
        while True:
            try:
                text, origin = self.commands.get_nowait()
            except queue.Empty:
                return
            self._handle(text.strip().lower(), origin)

    def _handle(self, cmd, origin):
        word = cmd.split()[0] if cmd else ""
        self._event(f"Command '{word}' from {origin}")
        if word in ("ack", "ok", "up", "stop"):
            was = self.alarm.active
            self.alarm.clear("(acknowledged)")
            if was and self.mode == "active" and self.queue_done_alerted and not self.finished:
                # You're at the PC and through the queue: from here on it's your game. Without this,
                # closing WoW yourself would look like a crash and the watcher would relaunch it.
                self.finished = True
                self.n.send("Alarm off", "You're through the queue - the watcher stops clicking and relaunching "
                            "now. Send 'resume' to re-arm it.", "low", ("white_check_mark",))
            elif was:
                self.n.send("Alarm off", "Acknowledged - see you at the PC.", "low", ("white_check_mark",))
        elif word in ("status", "s", "screenshot"):
            self.n.send("Status", self._status_text(), "default", ("bar_chart",), ("status",), self.image)
        elif word == "enter":
            if self.state == V.CHAR_SELECT:
                self.src.key("enter")
                self.alarm.clear("(entering world)")
                self.n.send("Pressed Enter World", "Your character is entering the world.", "default", ("door",))
            else:
                self.n.send("Not at character select", f"Current screen: {self.state}", "low", ("x",))
        elif word in ("reconnect", "relaunch", "restart"):
            self.paused = self.finished = self.gave_up = False
            self.relaunches = 0
            self.src.kill()
            if self.mode != "active":
                self._activate(f"relaunch requested from {origin}")  # also start watching again
            else:
                self._launch(f"requested from {origin}")
        elif word == "launch":
            if not self.src.process_running():
                self._launch(f"requested from {origin}")
        elif word == "pause":
            self.paused = True
            self.n.send("Paused", "No more clicking or relaunching until you send 'resume'. Alerts continue.",
                        "low", ("pause_button",))
        elif word == "resume":
            self.paused = self.finished = self.gave_up = False
            self.n.send("Resumed", "Watching and auto-reconnecting again.", "low", ("arrow_forward",))
        elif word in ("start", "queue", "at", "in", "om", "kl", "kl."):
            rest = cmd[len(word):] if word in ("start", "queue") else cmd
            ts = parse_start(rest, self.clock.now())
            if ts is None:
                self.n.send("Didn't understand that time", "Try: start, start 18:30, start in 45m, start in 1h30",
                            "default", ("question",))
            elif self.mode == "active":
                self.n.send("Already running", "The watcher is already active. Send 'standby' first to "
                            "set a new start time.", "default", ("information_source",), ("status", "standby"))
            elif ts <= self.clock.now() + 30:
                self._activate(f"start command from {origin}")
            else:
                self._schedule(ts, origin)
        elif word == "cancel":
            if self.mode == "scheduled":
                self._standby("Scheduled start cancelled")
            else:
                self.n.send("Nothing to cancel", f"No start is scheduled (mode: {self.mode}).", "low",
                            ("information_source",))
        elif word == "standby":
            if self.mode == "standby":
                self.n.send("Already on standby", "Waiting for a start command.", "low", ("zzz",), ("start",))
            else:
                self._standby("Standby", intro="Stopped watching (the game was left as it is). ")
        elif word in ("quit", "exit"):
            self._event(f"Quit requested from {origin}")
            self.running = False
        else:
            self.n.send("Unknown command", HELP, "default", ("question",))

    # --- schedule / timing ------------------------------------------------

    def _sleep_until(self, t):
        while self.running and self.clock.now() < t:
            self.clock.sleep(min(1.0, t - self.clock.now()))
            if not self.commands.empty():
                self._process_commands()
                self._snapshot()

    def _health_ping(self):
        h = self.cfg.health
        if not h.ping_url or time.time() - self.last_ping < h.ping_every_seconds:
            return
        self.last_ping = time.time()

        def ping():
            try:
                requests.get(h.ping_url, timeout=10)
            except requests.RequestException as e:
                self.log.debug("health ping failed: %s", e)

        threading.Thread(target=ping, daemon=True).start()

    # --- reporting -------------------------------------------------------

    def _in_at(self):
        if self.eta is None:
            return None
        return datetime.fromtimestamp(self.clock.now() + self.eta * 60).strftime("%H:%M")

    def _status_line(self):
        if self.state != V.QUEUE:
            return f"Screen: {self.state}"
        rate = f" ({self.rate:.0f}/min)" if self.rate else ""
        in_at = f" | in at ~{self._in_at()}" if self._in_at() else ""
        return (f"#{self.position or '?'} | Blizzard: {fmt_min(self.blizzard_eta)} | "
                f"pace: {fmt_min(self.pace_eta)}{rate}{in_at}")

    def _status_text(self):
        if self.mode == "standby":
            return "On standby - send 'start', 'start 18:30' or 'start in 45m'."
        if self.mode == "scheduled":
            return (f"WoW will be launched at {datetime.fromtimestamp(self.start_at):%H:%M} "
                    f"(in {fmt_min((self.start_at - self.clock.now()) / 60)}). Send 'cancel' to call it off.")
        lines = [self._status_line() if self.state == V.QUEUE else f"Screen: {self.state}",
                 f"On this screen for {fmt_min((self.clock.now() - self.state_since) / 60)}",
                 f"Relaunches: {self.relaunches} | queue sessions: {self.queue_sessions}"]
        if self.paused:
            lines.append("Automation PAUSED")
        if self.alarm.active:
            lines.append("Alarm is ringing")
        return "\n".join(lines)

    def _event(self, text):
        self.log.info(text)
        self.events.append((self.clock.now(), text))

    def _write_csv(self, s):
        new = not os.path.exists(self.csv_path)
        with open(self.csv_path, "a", newline="") as f:
            w = csv.writer(f)
            if new:
                w.writerow(["time", "position", "blizzard_eta_min", "pace_eta_min"])
            w.writerow([datetime.fromtimestamp(s["t"]).isoformat(timespec="seconds"), s["pos"], s["bl"],
                        round(s["pace"], 1) if s["pace"] is not None else ""])

    def _snapshot(self):
        snap = {
            "now": self.clock.now(), "started": self.started, "state": self.state,
            "mode": self.mode, "start_at": self.start_at,
            "game": os.path.basename(os.path.normpath(getattr(self.cfg.game, "game_dir", ""))),
            "queue_start_pos": self.queue_start_pos, "queue_started_at": self.queue_started_at,
            "in_line": self.in_line, "interval": self.cfg.watch.interval_seconds,
            "has_shot": self.last_jpeg is not None, "topic": self.cfg.ntfy.topic,
            "state_since": self.state_since, "position": self.position, "blizzard_eta": self.blizzard_eta,
            "pace_eta": self.pace_eta, "eta": self.eta, "in_at": self._in_at(), "rate": self.rate,
            "alarm": self.alarm.active, "alarm_title": self.alarm.title if self.alarm.active else None,
            "paused": self.paused, "finished": self.finished, "relaunches": self.relaunches,
            "queue_sessions": self.queue_sessions, "auto_reconnect": self.cfg.reconnect.enabled,
            "status": self._status_line(),
            "samples": self.samples[-3000:],
            "events": [{"t": t, "text": x} for t, x in list(self.events)[-60:]],
            "thresholds": {"heads_up": self.cfg.alerts.heads_up_minutes, "alarm": self.cfg.alerts.alarm_minutes},
        }
        with self.lock:
            self.snap = snap
